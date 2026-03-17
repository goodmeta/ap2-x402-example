/**
 * Demo Merchant Server
 *
 * A coffee shop that uses AP2 middleware to accept agent purchases.
 * This is what "agent-ready commerce" looks like — 20 lines of config,
 * everything else handled by the middleware.
 *
 * Run: npm run merchant
 *
 * Then try:
 *   curl http://localhost:3000/.well-known/agent-card.json
 *   curl http://localhost:3000/ap2/catalog
 *   npm run agent-demo  (runs the full purchase flow)
 */

import express from "express";
import { generatePrivateKey } from "viem/accounts";
import { createAP2Middleware } from "../middleware/index.js";
import type { CatalogItem, Order } from "../middleware/types.js";

// --- Merchant config ---
// In production, these come from env vars / config file
const MERCHANT_KEY = generatePrivateKey();
const PORT = 3000;

const catalog: CatalogItem[] = [
  {
    id: "ethiopian-yirgacheffe",
    name: "Ethiopian Yirgacheffe (1lb)",
    description: "Bright, fruity, floral. Single origin.",
    price: "1800",
    currency: "USDC",
    category: "coffee",
    inStock: true,
  },
  {
    id: "colombian-supremo",
    name: "Colombian Supremo (12oz)",
    description: "Rich, nutty, balanced. Medium roast.",
    price: "2200",
    currency: "USDC",
    category: "coffee",
    inStock: true,
  },
  {
    id: "kenya-aa",
    name: "Kenya AA (1lb)",
    description: "Bold, wine-like acidity. Complex.",
    price: "2400",
    currency: "USDC",
    category: "coffee",
    inStock: true,
  },
  {
    id: "ceramic-v60",
    name: "Ceramic V60 Dripper",
    description: "Hario V60-02. White ceramic.",
    price: "2800",
    currency: "USDC",
    category: "equipment",
    inStock: true,
  },
];

// --- Create Express app with AP2 middleware ---
const app = express();

const ap2 = createAP2Middleware({
  merchant: {
    name: "Coffee Roasters Co.",
    url: `http://localhost:${PORT}`,
    paymentAddress: "0x0000000000000000000000000000000000000001", // demo
    signingKey: MERCHANT_KEY,
    description: "Specialty coffee roaster. Single-origin beans and brewing equipment.",
    paymentRails: ["x402", "card"],
    categories: ["coffee", "equipment"],
    x402: {
      chain: "base-sepolia",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      facilitatorUrl: "https://x402-facilitator.goodmeta.co",
    },
  },
  catalog: () => catalog,
  onFulfillment: async (order: Order) => {
    console.log(`\n📦 New order! ${order.id}`);
    console.log(
      `   Items: ${order.items.map((i) => `${i.quantity}x ${i.name}`).join(", ")}`
    );
    console.log(`   Total: $${(Number(order.total) / 100).toFixed(2)}`);
    console.log(`   Paid via: ${order.paymentResult.rail}`);
    console.log(`   Tx: ${order.paymentResult.transactionId}\n`);
  },
  debug: true,
});

app.use(ap2);

// --- Merchant's own routes (non-AP2) ---
app.get("/", (_req, res) => {
  res.json({
    name: "Coffee Roasters Co.",
    message: "Welcome! AI agents: check /.well-known/agent-card.json",
    humanSite: "https://coffee-roasters.example.com",
  });
});

app.listen(PORT, () => {
  console.log(`\n☕ Coffee Roasters Co. — AP2-enabled merchant`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   Agent Card: http://localhost:${PORT}/.well-known/agent-card.json`);
  console.log(`   Catalog:    http://localhost:${PORT}/ap2/catalog\n`);
  console.log(`Waiting for agent purchases...\n`);
});
