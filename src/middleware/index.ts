/**
 * AP2 Merchant Middleware
 *
 * Drop this into any Express app to make it agent-purchasable. It VERIFIES real
 * AP2 dSD-JWT payment mandates (via @goodmeta/agent-verifier) and settles
 * approved payments over a rail.
 *
 * Usage:
 *   import { createAP2Middleware } from "./middleware/index.js";
 *   app.use(createAP2Middleware({ merchant: {...}, catalog: () => products }));
 *
 * Routes added:
 *   GET  /.well-known/agent-card.json  — discovery (incl. this merchant's AP2 audience)
 *   GET  /ap2/catalog                  — structured product catalog
 *   POST /ap2/payment-context          — issue a single-use nonce to bind a presentation to
 *   POST /ap2/verify                    — verify a presented mandate chain → settle → order
 *   GET  /ap2/orders/:id               — order status
 *
 * The merchant never mints mandates. The user's wallet/issuer mints them; the
 * agent presents one here bound to (this merchant's audience, an issued nonce).
 */

import { Router, json } from "express";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { agentCardHandler, catalogHandler } from "./agent-card.js";
import { settlePayment } from "./payment-router.js";
import type { AP2MiddlewareOptions, MerchantConfig, Order, OrderStore } from "./types.js";
import { verifyPresentedMandate, BudgetLedger, type MerchantTrust } from "../verify-mandate.js";

export type { AP2MiddlewareOptions, MerchantConfig, CatalogItem } from "./types.js";
export { buildAgentCard } from "./agent-card.js";

/** Build a trust resolver: match the root issuer JWT's `kid` to a trusted key. */
function trustFor(merchant: MerchantConfig): MerchantTrust {
  const keysByKid = new Map(merchant.trustedIssuerKeys.map((k) => [String(k.kid ?? ""), k]));
  return {
    audience: merchant.audience,
    resolveRootKey: (root) => {
      const kid = String((root.header as { kid?: unknown }).kid ?? "");
      // Prefer an explicit kid match; fall back to the sole trusted key if there's one.
      return keysByKid.get(kid) ?? (merchant.trustedIssuerKeys.length === 1 ? merchant.trustedIssuerKeys[0] : null) ?? null;
    },
  };
}

export function createAP2Middleware(options: AP2MiddlewareOptions): Router {
  const router = Router();
  router.use(json());

  const { merchant, catalog, onPayment, onFulfillment, preIssuedNonces = [], debug = false } = options;
  const trust = trustFor(merchant);
  const ledger = new BudgetLedger(); // enforces each mandate's cumulative payment.budget
  const store: OrderStore = { issuedNonces: new Set(preIssuedNonces), completed: new Map() };
  const log = debug ? (...a: unknown[]) => console.log("[ap2]", ...a) : () => {};

  // --- Discovery ---
  router.get("/.well-known/agent-card.json", agentCardHandler(merchant, merchant.url));
  router.get("/ap2/catalog", catalogHandler(catalog));

  // --- Issue a single-use nonce for a presentation (KB replay protection) ---
  router.post("/ap2/payment-context", (_req: Request, res: Response) => {
    const nonce = `nonce_${randomUUID()}`;
    store.issuedNonces.add(nonce);
    res.status(201).json({ audience: merchant.audience, nonce });
  });

  // --- Verify a presented AP2 mandate chain, then settle ---
  router.post("/ap2/verify", async (req: Request, res: Response) => {
    try {
      const { mandate_chain, expected_nonce, rail } = req.body as {
        mandate_chain?: string;
        expected_nonce?: string;
        rail?: "x402" | "card" | "bank";
      };
      if (!mandate_chain || !expected_nonce) {
        res.status(400).json({ error: "Missing required fields: mandate_chain, expected_nonce" });
        return;
      }

      const result = await verifyPresentedMandate({ mandateChain: mandate_chain, expectedNonce: expected_nonce }, trust, ledger);
      if (!result.approved || !result.payment) {
        log(`verify denied: ${result.reason} — ${result.detail}`);
        res.status(result.reason === "CONSTRAINT_VIOLATION" ? 403 : 401).json({
          approved: false,
          reason: result.reason,
          detail: result.detail,
          violations: result.violations,
        });
        return;
      }

      // The nonce must be one this merchant issued (and is now consumed).
      if (!store.issuedNonces.delete(expected_nonce)) {
        log(`verify rejected: nonce '${expected_nonce}' was not issued by this merchant (or already used)`);
        res.status(409).json({ approved: false, reason: "UNKNOWN_NONCE", detail: "Nonce was not issued by this merchant or already consumed" });
        return;
      }

      // Settle over a rail (amount + payee come FROM the verified mandate).
      const selectedRail = rail || merchant.paymentRails[0] || "x402";
      const settlement = onPayment
        ? await onPayment(result.payment, merchant)
        : await settlePayment(result.payment, selectedRail, merchant);
      if (!settlement.success) {
        res.status(402).json({ approved: true, settled: false, error: "Settlement failed", detail: settlement.error });
        return;
      }

      // Record the spend against the cumulative budget (post-settlement).
      if (result.budget) ledger.record(result.budget.id, result.payment.amount);

      const order: Order = {
        id: randomUUID(),
        transactionId: result.payment.transactionId,
        payeeId: result.payment.payeeId,
        amount: result.payment.amount,
        currency: result.payment.currency,
        status: "confirmed",
        paymentResult: settlement,
        createdAt: new Date().toISOString(),
      };
      store.completed.set(order.id, order);
      if (onFulfillment) await onFulfillment(order);
      log(`order ${order.id} confirmed via ${settlement.rail} (tx ${result.payment.transactionId})`);

      res.status(200).json({ approved: true, settled: true, order, budget: result.budget });
    } catch (err) {
      log("verify error:", err);
      res.status(500).json({ error: "Failed to process presentation" });
    }
  });

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
