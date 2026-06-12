/**
 * Demo Merchant Server
 *
 * A coffee shop that accepts agent purchases by VERIFYING real AP2 mandates.
 * "Agent-ready commerce" in ~20 lines of config — the middleware does the rest.
 *
 * Run: npm run merchant
 * Then: npm run agent-demo  (an agent presents a real, pre-minted AP2 mandate)
 *
 * The merchant trusts one issuer (Alice's wallet key, from the minted coffee
 * scenarios) and accepts the demo's pre-minted presentation nonces. In
 * production it would issue nonces live via POST /ap2/payment-context and trust
 * issuers via an x5c chain or a kid directory.
 */

import express from "express";
import { createAP2Middleware } from "../middleware/index.js";
import type { CatalogItem, Order } from "../middleware/types.js";
import { scenario, usd } from "../fixtures/scenarios.js";

const PORT = 3000;

// The issuer this merchant trusts + the nonces its pre-minted demo mandates use.
const coffee = scenario("coffee_valid");
const coffeeNonces = ["coffee_valid", "coffee_second", "coffee_over_amount"].map((n) => scenario(n).nonce);

const catalog: CatalogItem[] = [
  { id: "ethiopian-yirgacheffe", name: "Ethiopian Yirgacheffe (1lb)", description: "Bright, fruity, floral. Single origin.", price: "1800", currency: "USD", category: "coffee", inStock: true },
  { id: "colombian-supremo", name: "Colombian Supremo (12oz)", description: "Rich, nutty, balanced. Medium roast.", price: "2200", currency: "USD", category: "coffee", inStock: true },
  { id: "kenya-aa", name: "Kenya AA (1lb)", description: "Bold, wine-like acidity. Complex.", price: "2400", currency: "USD", category: "coffee", inStock: true },
];

const app = express();

app.use(
  createAP2Middleware({
    merchant: {
      name: "Coffee Roasters Co.",
      url: `http://localhost:${PORT}`,
      paymentAddress: "0x0000000000000000000000000000000000000001", // demo
      audience: coffee.audience, // "coffee-roasters" — agents bind their KB-JWT to this
      trustedIssuerKeys: [coffee.rootKey], // Alice's wallet issuer key
      description: "Specialty coffee roaster. Single-origin beans and brewing equipment.",
      paymentRails: ["x402", "card"],
      categories: ["coffee", "equipment"],
      x402: { chain: "base-sepolia", asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", facilitatorUrl: "https://x402-facilitator.goodmeta.co" },
    },
    catalog: () => catalog,
    preIssuedNonces: coffeeNonces, // demo: accept the pre-minted presentations' nonces
    onFulfillment: async (order: Order) => {
      console.log(`\n📦 Order ${order.id} — ${usd(order.amount)} ${order.currency} → ${order.payeeId}`);
      console.log(`   tx ${order.transactionId} settled via ${order.paymentResult.rail}\n`);
    },
    debug: true,
  }),
);

app.get("/", (_req, res) => {
  res.json({ name: "Coffee Roasters Co.", message: "AI agents: see /.well-known/agent-card.json" });
});

app.listen(PORT, () => {
  console.log(`\n☕ Coffee Roasters Co. — AP2-enabled merchant (verifies real dSD-JWT mandates)`);
  console.log(`   Agent Card: http://localhost:${PORT}/.well-known/agent-card.json`);
  console.log(`   Catalog:    http://localhost:${PORT}/ap2/catalog`);
  console.log(`\nWaiting for agent presentations (run: npm run agent-demo)...\n`);
});
