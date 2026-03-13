/**
 * Intent Mandate Flow (Human-Not-Present / Autonomous Agent)
 *
 * Demonstrates AP2 intent mandates — the user pre-authorizes
 * spending constraints, then the agent transacts autonomously.
 *
 * This is the interesting one for the agentic economy:
 * agents shopping on their own, within bounds.
 *
 * 1. User creates and signs an Intent Mandate with constraints
 * 2. Agent finds a merchant and builds a cart
 * 3. Agent validates cart against mandate constraints
 * 4. Agent creates Payment Mandate and settles via x402
 *
 * Run: npm run intent-flow
 */

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { IntentMandate, CartItem } from "./ap2-types.js";
import { userSignIntent, createPaymentMandate } from "./ap2-signer.js";

/**
 * Agent-side constraint checker.
 * Before paying, the agent MUST verify the purchase fits the mandate.
 */
function validateAgainstMandate(
  mandate: IntentMandate,
  cart: { items: CartItem[]; total: string },
  merchantId: string
): { valid: boolean; reason?: string } {
  const c = mandate.constraints;

  // Check expiry
  if (new Date(mandate.validUntil) < new Date()) {
    return { valid: false, reason: "Mandate expired" };
  }

  // Check per-transaction limit
  if (BigInt(cart.total) > BigInt(c.maxAmount)) {
    return {
      valid: false,
      reason: `Cart total ${cart.total} exceeds max ${c.maxAmount}`,
    };
  }

  // Check remaining budget
  const remaining = BigInt(mandate.budgetTotal) - BigInt(mandate.budgetSpent);
  if (BigInt(cart.total) > remaining) {
    return {
      valid: false,
      reason: `Cart total ${cart.total} exceeds remaining budget ${remaining}`,
    };
  }

  // Check blocked merchants
  if (c.blockedMerchants?.includes(merchantId)) {
    return { valid: false, reason: `Merchant ${merchantId} is blocked` };
  }

  // Check allowed merchants (if whitelist is set)
  if (c.allowedMerchants?.length && !c.allowedMerchants.includes(merchantId)) {
    return { valid: false, reason: `Merchant ${merchantId} not in allowlist` };
  }

  // Check transaction count
  if (mandate.maxTransactions !== undefined && mandate.maxTransactions <= 0) {
    return { valid: false, reason: "Transaction limit reached" };
  }

  return { valid: true };
}

async function main() {
  console.log("\n=== AP2 Intent Mandate Flow (Autonomous Agent) ===\n");

  // --- Setup ---
  const userKey = generatePrivateKey();
  const userAccount = privateKeyToAccount(userKey);
  const merchantAddress = privateKeyToAccount(generatePrivateKey()).address;

  console.log(`User:     ${userAccount.address}`);
  console.log(`Merchant: ${merchantAddress}\n`);

  // --- Step 1: User creates and signs an Intent Mandate ---
  console.log('Step 1: User signs Intent Mandate\n');
  console.log('  "Buy coffee beans, up to $30 per order, $100/month budget"\n');

  const mandate: IntentMandate = {
    type: "intent-mandate",
    version: "0.1.0",
    id: crypto.randomUUID(),
    user: { id: userAccount.address },
    agent: { id: "coffee-shopper-agent" },
    intent: "Buy coffee beans, up to $30 per order, $100/month total budget",
    constraints: {
      maxAmount: "3000", // $30 per transaction (cents/USDC 2-decimal)
      currency: "USDC",
      categories: ["coffee", "beverages"],
    },
    validFrom: new Date().toISOString(),
    validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
    maxTransactions: 10,
    budgetTotal: "10000", // $100 total
    budgetSpent: "0",
  };

  mandate.userSignature = await userSignIntent(mandate, userAccount);
  console.log(`  Mandate ID: ${mandate.id.slice(0, 8)}...`);
  console.log(`  Max per tx: $${Number(mandate.constraints.maxAmount) / 100}`);
  console.log(`  Budget:     $${Number(mandate.budgetTotal) / 100}`);
  console.log(`  Valid until: ${mandate.validUntil}`);
  console.log(`  Signature:  ${mandate.userSignature.slice(0, 20)}...\n`);
  console.log(`  → User can now close their laptop. Agent takes over.\n`);

  // --- Step 2: Agent finds a deal ---
  console.log("Step 2: Agent discovers merchant and builds cart\n");

  const cart = {
    items: [
      {
        id: "colombian-supremo",
        name: "Colombian Supremo (12oz)",
        quantity: 1,
        unitPrice: "2200", // $22
        currency: "USDC",
      },
    ],
    total: "2200",
  };

  console.log(`  Found: ${cart.items[0].name} — $${Number(cart.items[0].unitPrice) / 100}`);
  console.log(`  Merchant: ${merchantAddress.slice(0, 10)}...\n`);

  // --- Step 3: Agent validates against mandate ---
  console.log("Step 3: Agent checks mandate constraints\n");

  const validation = validateAgainstMandate(mandate, cart, merchantAddress);

  console.log(`  Under max per tx ($30)?  ✅ $${Number(cart.total) / 100} < $${Number(mandate.constraints.maxAmount) / 100}`);
  console.log(`  Under remaining budget?  ✅ $${Number(cart.total) / 100} < $${Number(mandate.budgetTotal) / 100}`);
  console.log(`  Merchant not blocked?    ✅`);
  console.log(`  Mandate not expired?     ✅`);
  console.log(`  Transactions remaining?  ✅ ${mandate.maxTransactions} left`);
  console.log(`  Validation result: ${validation.valid ? "APPROVED" : "DENIED — " + validation.reason}\n`);

  if (!validation.valid) {
    console.log(`  Agent cannot proceed. Mandate constraints violated.`);
    return;
  }

  // --- Step 4: Agent creates Payment Mandate ---
  console.log("Step 4: Agent creates Payment Mandate\n");

  const paymentMandate = createPaymentMandate(mandate, {
    amount: cart.total,
    payTo: merchantAddress,
    agentId: mandate.agent.id,
    rail: "x402",
    x402: {
      chain: "base-sepolia",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      permitSignature: "0x...", // in production, sign ERC-2612 permit
    },
  });

  console.log(`  Rail: x402 (USDC on Base)`);
  console.log(`  Amount: $${Number(paymentMandate.amount) / 100}`);
  console.log(`  Agent flagged: ${paymentMandate.isAgentTransaction}`);
  console.log(`  Authorization proof: ${paymentMandate.authorizationProof.slice(0, 20)}...\n`);

  // --- Update budget tracking ---
  mandate.budgetSpent = (
    BigInt(mandate.budgetSpent) + BigInt(cart.total)
  ).toString();
  if (mandate.maxTransactions) mandate.maxTransactions--;

  console.log("Step 5: Budget updated\n");
  console.log(`  Spent: $${Number(mandate.budgetSpent) / 100} / $${Number(mandate.budgetTotal) / 100}`);
  console.log(`  Transactions remaining: ${mandate.maxTransactions}\n`);

  console.log("=== Flow Complete ===\n");
  console.log("The agent bought coffee without the user being present.");
  console.log("The mandate proves: user authorized it, within constraints.");
  console.log("The payment mandate proves: agent paid, flagged as agent tx.");
  console.log("x402 handles the actual USDC settlement.\n");

  // --- Bonus: show a DENIED scenario ---
  console.log("--- Bonus: What if the agent tries to overspend? ---\n");

  const expensiveCart = {
    items: [
      {
        id: "kopi-luwak",
        name: "Kopi Luwak (8oz)",
        quantity: 1,
        unitPrice: "5000", // $50
        currency: "USDC",
      },
    ],
    total: "5000",
  };

  const denied = validateAgainstMandate(mandate, expensiveCart, merchantAddress);
  console.log(`  Agent tries: ${expensiveCart.items[0].name} — $${Number(expensiveCart.items[0].unitPrice) / 100}`);
  console.log(`  Result: ${denied.valid ? "APPROVED" : "DENIED"}`);
  console.log(`  Reason: ${denied.reason}\n`);
  console.log("The mandate's constraints prevent overspending. No human needed.\n");
}

main().catch(console.error);
