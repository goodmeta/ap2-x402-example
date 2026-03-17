/**
 * Square Demo — From "Agent Can Browse" to "Agent Can Buy"
 *
 * Scenario: Square's MCP server lets AI agents read catalog, check
 * inventory, and view orders. But agents can't complete a purchase.
 * There's no payment settlement path for agent-initiated transactions.
 *
 * This demo shows how AP2 middleware bridges that gap — same catalog
 * data, but now agents can actually buy.
 *
 * What Square cares about:
 * - Making their 4M+ merchants instantly agent-purchasable
 * - Minimal merchant effort (they already have catalog data)
 * - Works with existing Square payment processing
 * - Supports both human-approved and autonomous purchases
 *
 * Run: npm run demo:square
 */

import express from "express";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createAP2Middleware } from "../middleware/index.js";
import { userApproveCart, userSignIntent } from "../ap2-signer.js";
import type { CatalogItem } from "../middleware/types.js";
import type { CartMandate, IntentMandate } from "../ap2-types.js";

async function main() {
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  Square + AP2: Agent-Purchasable Merchants      ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  // --- Simulate a Square merchant's existing data ---
  // This is what Square's MCP server already exposes (read-only)
  const catalog: CatalogItem[] = [
    {
      id: "LATTE-REG",
      name: "Cafe Latte (Regular)",
      description: "Espresso with steamed milk",
      price: "550",
      currency: "USDC",
      category: "beverages",
      inStock: true,
    },
    {
      id: "LATTE-LRG",
      name: "Cafe Latte (Large)",
      description: "Double shot espresso with steamed milk",
      price: "700",
      currency: "USDC",
      category: "beverages",
      inStock: true,
    },
    {
      id: "CROISSANT",
      name: "Butter Croissant",
      description: "Fresh-baked, flaky French croissant",
      price: "450",
      currency: "USDC",
      category: "pastries",
      inStock: true,
    },
    {
      id: "AVOCADO-TOAST",
      name: "Avocado Toast",
      description: "Sourdough, avocado, everything seasoning, poached egg",
      price: "1400",
      currency: "USDC",
      category: "food",
      inStock: true,
    },
  ];

  // ================================================
  // Show the gap
  // ================================================
  console.log("━━━ Today: Square MCP Server (Read-Only) ━━━\n");
  console.log("  Agent can:");
  console.log("  ✅ GET /catalog        → browse items");
  console.log("  ✅ GET /inventory      → check stock");
  console.log("  ✅ GET /orders         → view past orders");
  console.log("  ❌ POST /purchase      → buy something ← MISSING\n");
  console.log("  Agent sees the menu but can't order.\n");

  // ================================================
  // Start merchant with AP2 middleware
  // ================================================
  console.log("━━━ With AP2 Middleware: Full Commerce ━━━\n");

  const MERCHANT_KEY = generatePrivateKey();
  const merchantAccount = privateKeyToAccount(MERCHANT_KEY);
  const PORT = 3001;

  const app = express();
  app.use(
    createAP2Middleware({
      merchant: {
        name: "Corner Cafe (Square merchant)",
        url: `http://localhost:${PORT}`,
        paymentAddress: merchantAccount.address,
        signingKey: MERCHANT_KEY,
        description: "Neighborhood cafe. Coffee, pastries, light bites.",
        paymentRails: ["x402", "card"],
        categories: ["beverages", "pastries", "food"],
        x402: {
          chain: "base",
          asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          facilitatorUrl: "https://x402-facilitator.goodmeta.co",
        },
      },
      catalog: () => catalog,
      debug: false,
    })
  );

  const server = app.listen(PORT);

  console.log("  Added to merchant's Express app: createAP2Middleware(config)");
  console.log("  That's it. The merchant is now agent-purchasable.\n");
  console.log("  New agent capabilities:");
  console.log("  ✅ GET  /.well-known/agent-card.json → discover merchant");
  console.log("  ✅ GET  /ap2/catalog                 → structured catalog");
  console.log("  ✅ POST /ap2/mandates/cart            → submit purchase");
  console.log("  ✅ POST /ap2/mandates/intent/verify   → autonomous buying");
  console.log("  ✅ GET  /ap2/orders/:id               → order status\n");

  const BASE = `http://localhost:${PORT}`;
  const userAccount = privateKeyToAccount(generatePrivateKey());

  // ================================================
  // Flow 1: Customer's agent orders lunch (Cart Mandate)
  // ================================================
  console.log("━━━ Flow 1: Agent Orders Lunch (Customer Approves) ━━━\n");
  console.log('  User: "Get me a latte and a croissant from Corner Cafe"\n');

  // Agent discovers merchant
  const cardRes = await fetch(`${BASE}/.well-known/agent-card.json`);
  const card = await cardRes.json();
  console.log(`  Agent discovers: ${card.merchant.name}`);

  // Agent browses catalog
  const catRes = await fetch(`${BASE}/ap2/catalog`);
  const { items }: { items: CatalogItem[] } = await catRes.json();
  const latte = items.find((i) => i.id === "LATTE-REG")!;
  const croissant = items.find((i) => i.id === "CROISSANT")!;

  // Agent submits cart
  const cartRes = await fetch(`${BASE}/ap2/mandates/cart`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [
        { id: latte.id, name: latte.name, quantity: 1, unitPrice: latte.price, currency: "USDC" },
        { id: croissant.id, name: croissant.name, quantity: 1, unitPrice: croissant.price, currency: "USDC" },
      ],
      agentId: "personal-assistant-agent",
      userId: userAccount.address,
    }),
  });

  const { mandate }: { mandate: CartMandate } = await cartRes.json();
  const total = (Number(mandate.cart.total) / 100).toFixed(2);
  console.log(`  Cart: ${latte.name} + ${croissant.name} = $${total}`);

  // Agent shows to user, user approves
  console.log(`  Agent: "Found your order at Corner Cafe — $${total}. Approve?"`);
  console.log(`  User: "Yes"\n`);

  const userSig = await userApproveCart(mandate, userAccount);

  const orderRes = await fetch(`${BASE}/ap2/mandates/cart/${mandate.id}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userSignature: userSig, rail: "x402" }),
  });

  const result = await orderRes.json();
  console.log(`  ✅ Order placed!`);
  console.log(`  Order ID: ${result.order.id.slice(0, 8)}...`);
  console.log(`  Paid: $${total} via x402 (instant USDC settlement)`);
  console.log(`  Status: ${result.order.status}\n`);

  // ================================================
  // Flow 2: Office coffee agent (Intent Mandate)
  // ================================================
  console.log("━━━ Flow 2: Office Coffee Agent (Autonomous) ━━━\n");
  console.log('  Office manager: "Order coffee for the team every morning,');
  console.log('   up to $30/order, from Corner Cafe only"\n');

  const officeMandate: IntentMandate = {
    type: "intent-mandate",
    version: "0.1.0",
    id: crypto.randomUUID(),
    user: { id: userAccount.address },
    agent: { id: "office-coffee-agent" },
    intent: "Daily coffee order for engineering team, Corner Cafe only",
    constraints: {
      maxAmount: "3000",
      currency: "USDC",
      categories: ["beverages"],
      allowedMerchants: [merchantAccount.address],
    },
    validFrom: new Date().toISOString(),
    validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    maxTransactions: 22, // ~1/workday
    budgetTotal: "66000", // $660/month
    budgetSpent: "0",
  };

  officeMandate.userSignature = await userSignIntent(officeMandate, userAccount);

  console.log("  Mandate created:");
  console.log(`    Max per order: $30`);
  console.log(`    Monthly budget: $660`);
  console.log(`    Vendor: Corner Cafe only`);
  console.log(`    Category: beverages only`);
  console.log(`    Frequency: up to 22 orders/month\n`);

  // Agent orders Monday morning coffee
  console.log("  Monday 8am — agent orders automatically:");
  const mondayRes = await fetch(`${BASE}/ap2/mandates/intent/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mandate: officeMandate,
      cart: {
        items: [
          { id: "LATTE-LRG", name: "Cafe Latte (Large)", quantity: 4, unitPrice: "700", currency: "USDC" },
        ],
        total: "2800", // $28 for 4 large lattes
      },
      rail: "x402",
    }),
  });

  const mondayResult = await mondayRes.json();
  if (mondayResult.order) {
    console.log(`    ✅ 4x Large Lattes — $28.00 → Order ${mondayResult.order.id.slice(0, 8)}...`);
  }

  // Agent tries to order food — DENIED (beverages only)
  console.log("\n  Agent tries to add avocado toast to the order:");
  const foodRes = await fetch(`${BASE}/ap2/mandates/intent/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mandate: officeMandate,
      cart: {
        items: [
          { id: "AVOCADO-TOAST", name: "Avocado Toast", quantity: 4, unitPrice: "1400", currency: "USDC" },
        ],
        total: "5600",
      },
      rail: "x402",
    }),
  });

  const foodResult = await foodRes.json();
  console.log(`    ❌ Denied: ${foodResult.detail}`);
  console.log(`    → $56 exceeds $30 per-transaction limit.\n`);

  // ================================================
  // The pitch
  // ================================================
  console.log("━━━ What This Means for Square ━━━\n");
  console.log("  Square's MCP server is the discovery + catalog layer.");
  console.log("  AP2 middleware is the purchase + payment layer.\n");
  console.log("  Together: agents can discover, browse, AND buy from");
  console.log("  any Square merchant.\n");
  console.log("  For Square:");
  console.log("  • 4M+ merchants become agent-purchasable overnight");
  console.log("  • Catalog data already exists (MCP server)");
  console.log("  • Middleware auto-generates Agent Cards from catalog");
  console.log("  • Supports human-approved AND autonomous purchases");
  console.log("  • Multi-rail: existing Square card processing + x402\n");
  console.log("  Merchant effort: zero config. Square generates it");
  console.log("  from existing merchant data.\n");

  server.close();
}

main().catch(console.error);
