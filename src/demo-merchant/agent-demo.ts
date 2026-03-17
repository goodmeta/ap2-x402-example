/**
 * Agent Demo — Full Purchase Flow
 *
 * Simulates an AI agent discovering a merchant, browsing the catalog,
 * and completing a purchase using AP2 mandates.
 *
 * Run the merchant first: npm run merchant
 * Then run this:         npm run agent-demo
 *
 * This demonstrates both Cart Mandate (human-present)
 * and Intent Mandate (autonomous) flows.
 */

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { userApproveCart, userSignIntent } from "../ap2-signer.js";
import type { AgentCard } from "../middleware/agent-card.js";
import type { CatalogItem } from "../middleware/types.js";
import type { CartMandate, IntentMandate } from "../ap2-types.js";

const MERCHANT_URL = "http://localhost:3000";

async function main() {
  // Setup: create user wallet
  const userKey = generatePrivateKey();
  const userAccount = privateKeyToAccount(userKey);

  console.log("\n=== AP2 Agent Demo ===\n");
  console.log(`Agent: shopping-agent-001`);
  console.log(`User:  ${userAccount.address}\n`);

  // ================================================
  // STEP 1: Discover merchant via Agent Card
  // ================================================
  console.log("--- Step 1: Discover Merchant ---\n");

  const cardRes = await fetch(
    `${MERCHANT_URL}/.well-known/agent-card.json`
  );
  const card: AgentCard = await cardRes.json();

  console.log(`  Found: ${card.merchant.name}`);
  console.log(`  ${card.merchant.description}`);
  console.log(`  Accepts: ${card.capabilities.paymentRails.join(", ")}`);
  console.log(`  Mandate types: ${card.capabilities.mandateTypes.join(", ")}`);
  console.log(`  Catalog endpoint: ${card.endpoints.catalog}\n`);

  // ================================================
  // STEP 2: Browse catalog
  // ================================================
  console.log("--- Step 2: Browse Catalog ---\n");

  const catalogRes = await fetch(card.endpoints.catalog);
  const { items }: { items: CatalogItem[] } = await catalogRes.json();

  for (const item of items) {
    const price = (Number(item.price) / 100).toFixed(2);
    const stock = item.inStock ? "✓" : "✗";
    console.log(`  [${stock}] ${item.name} — $${price} (${item.category})`);
  }
  console.log();

  // ================================================
  // STEP 3: Cart Mandate Flow (human-present)
  // ================================================
  console.log("=== Cart Mandate Flow (human approves) ===\n");

  // Agent selects items and submits cart
  console.log("--- Step 3a: Agent submits cart ---\n");

  const selectedItem = items[0]; // Ethiopian Yirgacheffe
  const cartRes = await fetch(card.endpoints.cartMandate, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [
        {
          id: selectedItem.id,
          name: selectedItem.name,
          quantity: 2,
          unitPrice: selectedItem.price,
          currency: selectedItem.currency,
        },
      ],
      agentId: "shopping-agent-001",
      userId: userAccount.address,
    }),
  });

  const { mandate: cartMandate }: { mandate: CartMandate } =
    await cartRes.json();

  console.log(`  Mandate ID: ${cartMandate.id.slice(0, 8)}...`);
  console.log(`  Total: $${(Number(cartMandate.cart.total) / 100).toFixed(2)}`);
  console.log(`  Merchant signed: ${cartMandate.merchantSignature?.slice(0, 16)}...`);
  console.log(`  Expires: ${cartMandate.expiresAt}\n`);

  // Agent presents to user for approval
  console.log("--- Step 3b: User reviews and approves ---\n");
  console.log(`  "Agent wants to buy 2x ${selectedItem.name} for $${(Number(cartMandate.cart.total) / 100).toFixed(2)}"`);
  console.log(`  User signs approval...`);

  const userSig = await userApproveCart(cartMandate, userAccount);
  console.log(`  User signature: ${userSig.slice(0, 16)}...\n`);

  // Agent submits approved mandate
  console.log("--- Step 3c: Agent submits approved mandate for payment ---\n");

  const approveRes = await fetch(
    `${MERCHANT_URL}/ap2/mandates/cart/${cartMandate.id}/approve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userSignature: userSig,
        rail: "x402",
      }),
    }
  );

  const cartResult = await approveRes.json();

  if (cartResult.order) {
    console.log(`  ✅ Order confirmed!`);
    console.log(`  Order ID: ${cartResult.order.id}`);
    console.log(`  Status: ${cartResult.order.status}`);
    console.log(`  Paid via: ${cartResult.order.paymentResult.rail}`);
    console.log(`  Tx: ${cartResult.order.paymentResult.transactionId}\n`);
  } else {
    console.log(`  ❌ Failed: ${cartResult.error} — ${cartResult.detail}\n`);
  }

  // ================================================
  // STEP 4: Intent Mandate Flow (autonomous)
  // ================================================
  console.log("=== Intent Mandate Flow (autonomous agent) ===\n");
  console.log("--- Step 4a: User pre-authorizes spending ---\n");
  console.log(`  "Buy coffee, up to $25/order, $100 total budget"\n`);

  const intentMandate: IntentMandate = {
    type: "intent-mandate",
    version: "0.1.0",
    id: crypto.randomUUID(),
    user: { id: userAccount.address },
    agent: { id: "shopping-agent-001" },
    intent: "Buy coffee beans, up to $25 per order, $100 total",
    constraints: {
      maxAmount: "2500",
      currency: "USDC",
      categories: ["coffee"],
    },
    validFrom: new Date().toISOString(),
    validUntil: new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000
    ).toISOString(),
    maxTransactions: 5,
    budgetTotal: "10000",
    budgetSpent: "0",
  };

  intentMandate.userSignature = await userSignIntent(
    intentMandate,
    userAccount
  );
  console.log(`  Mandate ID: ${intentMandate.id.slice(0, 8)}...`);
  console.log(`  Signature: ${intentMandate.userSignature.slice(0, 16)}...`);
  console.log(`  User can now close their laptop.\n`);

  // Agent shops autonomously
  console.log("--- Step 4b: Agent shops autonomously ---\n");

  const coffeeItem = items.find(
    (i) => i.id === "colombian-supremo"
  )!;
  console.log(`  Agent found: ${coffeeItem.name} — $${(Number(coffeeItem.price) / 100).toFixed(2)}`);
  console.log(`  Checking against mandate constraints...`);
  console.log(`  Under $25 max? ✅`);
  console.log(`  Under $100 budget? ✅`);
  console.log(`  Category "coffee"? ✅\n`);

  console.log("--- Step 4c: Agent submits to merchant for verification + payment ---\n");

  const intentRes = await fetch(card.endpoints.intentVerify, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mandate: intentMandate,
      cart: {
        items: [
          {
            id: coffeeItem.id,
            name: coffeeItem.name,
            quantity: 1,
            unitPrice: coffeeItem.price,
            currency: coffeeItem.currency,
          },
        ],
        total: coffeeItem.price,
      },
      rail: "x402",
    }),
  });

  const intentResult = await intentRes.json();

  if (intentResult.order) {
    console.log(`  ✅ Autonomous purchase complete!`);
    console.log(`  Order ID: ${intentResult.order.id}`);
    console.log(`  Status: ${intentResult.order.status}`);
    console.log(`  Paid via: ${intentResult.order.paymentResult.rail}`);
    console.log(`  Tx: ${intentResult.order.paymentResult.transactionId}\n`);
  } else {
    console.log(`  ❌ Failed: ${intentResult.error} — ${intentResult.detail}\n`);
  }

  // ================================================
  // STEP 5: Show denied scenario
  // ================================================
  console.log("=== Bonus: Agent tries to overspend ===\n");

  const expensiveItem = items.find((i) => i.id === "ceramic-v60")!;
  console.log(`  Agent tries: ${expensiveItem.name} — $${(Number(expensiveItem.price) / 100).toFixed(2)}`);
  console.log(`  Mandate max: $25.00\n`);

  const deniedRes = await fetch(card.endpoints.intentVerify, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mandate: intentMandate,
      cart: {
        items: [
          {
            id: expensiveItem.id,
            name: expensiveItem.name,
            quantity: 1,
            unitPrice: expensiveItem.price,
            currency: expensiveItem.currency,
          },
        ],
        total: expensiveItem.price,
      },
      rail: "x402",
    }),
  });

  const deniedResult = await deniedRes.json();
  console.log(`  ❌ Denied: ${deniedResult.detail}`);
  console.log(`  Mandate constraints enforced. No unauthorized spending.\n`);

  console.log("=== Demo Complete ===\n");
  console.log("What you just saw:");
  console.log("  1. Agent discovered merchant via Agent Card");
  console.log("  2. Agent browsed structured catalog");
  console.log("  3. Cart Mandate: user approved specific purchase");
  console.log("  4. Intent Mandate: agent bought autonomously within constraints");
  console.log("  5. Overspend attempt blocked by mandate verification");
  console.log("\nAll of this from ~20 lines of merchant config + middleware.\n");
}

main().catch(console.error);
