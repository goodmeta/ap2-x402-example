/**
 * AP2 Merchant Middleware
 *
 * Drop this into any Express app to make it agent-purchasable.
 *
 * Usage:
 *   import { createAP2Middleware } from "./middleware/index.js";
 *
 *   const ap2 = createAP2Middleware({
 *     merchant: { name: "My Store", paymentAddress: "0x...", ... },
 *     catalog: () => myProducts,
 *   });
 *
 *   app.use(ap2);
 *
 * This adds:
 *   GET  /.well-known/agent-card.json  — agent discovery
 *   GET  /ap2/catalog                  — structured product catalog
 *   POST /ap2/mandates/cart            — submit cart, get merchant price commitment
 *   POST /ap2/mandates/cart/:id/approve — submit user-approved cart mandate for payment
 *   POST /ap2/mandates/intent/verify   — verify intent mandate + cart against constraints
 *   POST /ap2/pay                      — process payment for verified mandate
 */

import { Router, json } from "express";
import type { Request, Response } from "express";
import { privateKeyToAccount } from "viem/accounts";
import type { CartMandate, IntentMandate } from "../ap2-types.js";
import { merchantSignCart, createPaymentMandate } from "../ap2-signer.js";
import { agentCardHandler, catalogHandler } from "./agent-card.js";
import { verifyCartMandate, verifyIntentMandate } from "./mandate-verifier.js";
import { routePayment } from "./payment-router.js";
import type {
  AP2MiddlewareOptions,
  MandateStore,
  Order,
} from "./types.js";

export type { AP2MiddlewareOptions, MerchantConfig, CatalogItem } from "./types.js";
export { buildAgentCard } from "./agent-card.js";

export function createAP2Middleware(options: AP2MiddlewareOptions): Router {
  const router = Router();
  router.use(json());

  const {
    merchant,
    catalog,
    onPayment,
    onFulfillment,
    priceCommitmentWindow = 10 * 60 * 1000, // 10 min default
    debug = false,
  } = options;

  const merchantAccount = privateKeyToAccount(
    merchant.signingKey as `0x${string}`
  );

  // In-memory mandate store (production: use Redis/DB)
  const store: MandateStore = {
    pending: new Map(),
    completed: new Map(),
  };

  const log = debug
    ? (...args: unknown[]) => console.log("[ap2]", ...args)
    : () => {};

  // --- Agent Card ---
  const baseUrl = merchant.url;
  router.get(
    "/.well-known/agent-card.json",
    agentCardHandler(merchant, baseUrl)
  );

  // --- Catalog ---
  router.get("/ap2/catalog", catalogHandler(catalog));

  // --- Cart Mandate: Submit cart, get merchant price commitment ---
  router.post("/ap2/mandates/cart", async (req: Request, res: Response) => {
    try {
      const { items, agentId, userId } = req.body;

      if (!items?.length || !agentId || !userId) {
        res.status(400).json({ error: "Missing required fields: items, agentId, userId" });
        return;
      }

      // Build cart total
      const total = items
        .reduce(
          (sum: bigint, item: { unitPrice: string; quantity: number }) =>
            sum + BigInt(item.unitPrice) * BigInt(item.quantity),
          0n
        )
        .toString();

      // Build mandate
      const mandate: CartMandate = {
        type: "cart-mandate",
        version: "0.1.0",
        id: crypto.randomUUID(),
        merchant: {
          id: merchantAccount.address,
          name: merchant.name,
          url: merchant.url,
        },
        agent: { id: agentId },
        user: { id: userId },
        cart: {
          items,
          total,
          currency: "USDC",
        },
        expiresAt: new Date(Date.now() + priceCommitmentWindow).toISOString(),
        paymentRails: merchant.paymentRails,
      };

      // Merchant signs — committing to this price
      mandate.merchantSignature = await merchantSignCart(
        mandate,
        merchantAccount
      );

      log(`Cart mandate created: ${mandate.id} — total: ${total}`);

      // Store pending mandate
      store.pending.set(mandate.id, {
        mandate,
        expiresAt: Date.now() + priceCommitmentWindow,
      });

      // Return to agent — agent shows to user for approval
      res.status(201).json({
        mandate,
        message: "Cart mandate created. Get user approval and submit to /ap2/mandates/cart/:id/approve",
      });
    } catch (err) {
      log("Error creating cart mandate:", err);
      res.status(500).json({ error: "Failed to create cart mandate" });
    }
  });

  // --- Cart Mandate: User approved, process payment ---
  router.post(
    "/ap2/mandates/cart/:id/approve",
    async (req: Request, res: Response) => {
      try {
        const id = req.params.id as string;
        const { userSignature, rail } = req.body;

        if (!userSignature) {
          res.status(400).json({ error: "Missing userSignature" });
          return;
        }

        // Look up pending mandate
        const pending = store.pending.get(id);
        if (!pending) {
          res.status(404).json({ error: "Mandate not found or expired" });
          return;
        }

        if (pending.expiresAt < Date.now()) {
          store.pending.delete(id);
          res.status(410).json({ error: "Mandate expired" });
          return;
        }

        // Attach user signature
        const mandate = pending.mandate;
        mandate.userSignature = userSignature;

        // Verify both signatures
        const verification = await verifyCartMandate(
          mandate,
          merchantAccount.address
        );

        if (!verification.valid) {
          res.status(403).json({
            error: "Mandate verification failed",
            detail: verification.error,
          });
          return;
        }

        log(`Cart mandate verified: ${id}`);

        // Create payment mandate
        const selectedRail = rail || mandate.paymentRails[0] || "x402";
        const paymentMandate = createPaymentMandate(mandate, {
          amount: mandate.cart.total,
          payTo: merchant.paymentAddress,
          agentId: mandate.agent.id,
          rail: selectedRail,
          x402: selectedRail === "x402" && merchant.x402
            ? {
                chain: merchant.x402.chain,
                asset: merchant.x402.asset,
                permitSignature: req.body.x402PermitSignature || "",
              }
            : undefined,
        });

        // Process payment
        const paymentResult = onPayment
          ? await onPayment(paymentMandate, mandate.id)
          : await routePayment(paymentMandate, merchant);

        if (!paymentResult.success) {
          res.status(402).json({
            error: "Payment failed",
            detail: paymentResult.error,
          });
          return;
        }

        // Create order
        const order: Order = {
          id: crypto.randomUUID(),
          mandateId: mandate.id,
          items: mandate.cart.items,
          total: mandate.cart.total,
          currency: mandate.cart.currency,
          status: "confirmed",
          paymentResult,
          createdAt: new Date().toISOString(),
        };

        store.completed.set(order.id, order);
        store.pending.delete(id);

        // Trigger fulfillment
        if (onFulfillment) {
          await onFulfillment(order);
        }

        log(`Order created: ${order.id} via ${paymentResult.rail}`);

        res.status(200).json({
          order,
          message: "Payment successful. Order confirmed.",
        });
      } catch (err) {
        log("Error processing cart approval:", err);
        res.status(500).json({ error: "Failed to process mandate" });
      }
    }
  );

  // --- Intent Mandate: Verify and process ---
  router.post(
    "/ap2/mandates/intent/verify",
    async (req: Request, res: Response) => {
      try {
        const { mandate, cart, rail } = req.body as {
          mandate: IntentMandate;
          cart: { items: Array<{ id: string; name: string; quantity: number; unitPrice: string; currency: string }>; total: string };
          rail?: "x402" | "card" | "bank";
        };

        if (!mandate || !cart) {
          res.status(400).json({ error: "Missing required fields: mandate, cart" });
          return;
        }

        // Verify intent mandate signature and constraints
        const verification = await verifyIntentMandate(
          mandate,
          cart,
          merchantAccount.address
        );

        if (!verification.valid) {
          res.status(403).json({
            error: "Intent mandate verification failed",
            detail: verification.error,
          });
          return;
        }

        log(`Intent mandate verified: ${mandate.id}`);

        // Create payment mandate
        const selectedRail = rail || merchant.paymentRails[0] || "x402";
        const paymentMandate = createPaymentMandate(mandate, {
          amount: cart.total,
          payTo: merchant.paymentAddress,
          agentId: mandate.agent.id,
          rail: selectedRail,
          x402: selectedRail === "x402" && merchant.x402
            ? {
                chain: merchant.x402.chain,
                asset: merchant.x402.asset,
                permitSignature: req.body.x402PermitSignature || "",
              }
            : undefined,
        });

        // Process payment
        const paymentResult = onPayment
          ? await onPayment(paymentMandate, mandate.id)
          : await routePayment(paymentMandate, merchant);

        if (!paymentResult.success) {
          res.status(402).json({
            error: "Payment failed",
            detail: paymentResult.error,
          });
          return;
        }

        // Create order
        const order: Order = {
          id: crypto.randomUUID(),
          mandateId: mandate.id,
          items: cart.items.map((i) => ({
            id: i.id,
            name: i.name,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
          })),
          total: cart.total,
          currency: mandate.constraints.currency,
          status: "confirmed",
          paymentResult,
          createdAt: new Date().toISOString(),
        };

        store.completed.set(order.id, order);

        if (onFulfillment) {
          await onFulfillment(order);
        }

        log(`Order created from intent: ${order.id} via ${paymentResult.rail}`);

        res.status(200).json({
          order,
          message: "Intent mandate verified. Payment successful. Order confirmed.",
        });
      } catch (err) {
        log("Error processing intent mandate:", err);
        res.status(500).json({ error: "Failed to process intent mandate" });
      }
    }
  );

  // --- Order lookup ---
  router.get("/ap2/orders/:id", (req: Request, res: Response) => {
    const order = store.completed.get(req.params.id as string);
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    res.json({ order });
  });

  return router;
}
