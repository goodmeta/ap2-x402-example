/**
 * Cart Mandate Flow (Human-Present)
 *
 * Demonstrates the full AP2 cart flow with x402 settlement:
 *
 * 1. Agent finds an item at a merchant
 * 2. Merchant signs a Cart Mandate (price commitment)
 * 3. User reviews and countersigns (approval)
 * 4. Agent creates a Payment Mandate
 * 5. Payment settles via x402 (ERC-2612 USDC permit)
 *
 * Run: npm run cart-flow
 */

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { CartMandate } from "./ap2-types.js";
import {
  merchantSignCart,
  userApproveCart,
  createPaymentMandate,
} from "./ap2-signer.js";

async function main() {
  console.log("\n=== AP2 Cart Mandate Flow ===\n");

  // --- Setup: create test accounts ---
  const merchantKey = generatePrivateKey();
  const userKey = generatePrivateKey();
  const merchantAccount = privateKeyToAccount(merchantKey);
  const userAccount = privateKeyToAccount(userKey);

  console.log(`Merchant: ${merchantAccount.address}`);
  console.log(`User:     ${userAccount.address}\n`);

  // --- Step 1: Agent finds an item ---
  console.log("Step 1: Agent browses merchant catalog\n");

  const mandate: CartMandate = {
    type: "cart-mandate",
    version: "0.1.0",
    id: crypto.randomUUID(),
    merchant: {
      id: merchantAccount.address,
      name: "Coffee Roasters Co.",
      url: "https://coffee-roasters.example.com",
    },
    agent: {
      id: "agent-001", // in production, agent's public key or DID
    },
    user: {
      id: userAccount.address,
    },
    cart: {
      items: [
        {
          id: "ethiopian-yirgacheffe",
          name: "Ethiopian Yirgacheffe (1lb)",
          quantity: 2,
          unitPrice: "1800", // $18.00 in cents / 18 USDC in 2-decimal units
          currency: "USDC",
        },
      ],
      total: "3600", // $36.00
      currency: "USDC",
    },
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 min
    paymentRails: ["x402", "card"],
  };

  console.log(
    `  Cart: ${mandate.cart.items.map((i) => `${i.quantity}x ${i.name}`).join(", ")}`
  );
  console.log(`  Total: ${mandate.cart.total} ${mandate.cart.currency}`);
  console.log(`  Expires: ${mandate.expiresAt}\n`);

  // --- Step 2: Merchant signs the cart ---
  console.log("Step 2: Merchant signs cart (price commitment)\n");

  mandate.merchantSignature = await merchantSignCart(mandate, merchantAccount);
  console.log(`  Merchant signature: ${mandate.merchantSignature.slice(0, 20)}...`);
  console.log(
    `  → Merchant is now committed to this price until expiry\n`
  );

  // --- Step 3: User approves ---
  console.log("Step 3: User reviews and approves\n");

  mandate.userSignature = await userApproveCart(mandate, userAccount);
  console.log(`  User signature: ${mandate.userSignature.slice(0, 20)}...`);
  console.log(`  → User has authorized this exact purchase\n`);

  // --- Step 4: Agent creates Payment Mandate ---
  console.log("Step 4: Agent creates Payment Mandate for x402 settlement\n");

  const paymentMandate = createPaymentMandate(mandate, {
    amount: mandate.cart.total,
    payTo: merchantAccount.address,
    agentId: mandate.agent.id,
    rail: "x402",
    x402: {
      chain: "base-sepolia",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // USDC on Base Sepolia
      permitSignature: "0x...", // in production, sign ERC-2612 permit here
    },
  });

  console.log(`  Payment Mandate:`);
  console.log(`    Source: ${paymentMandate.sourceMandate.type} (${paymentMandate.sourceMandate.id.slice(0, 8)}...)`);
  console.log(`    Amount: ${paymentMandate.amount} ${paymentMandate.currency}`);
  console.log(`    Pay to: ${paymentMandate.payTo}`);
  console.log(`    Rail:   ${paymentMandate.rail}`);
  console.log(`    Agent:  ${paymentMandate.isAgentTransaction ? "yes (flagged)" : "no"}`);
  console.log(`    Auth:   ${paymentMandate.authorizationProof.slice(0, 20)}...\n`);

  // --- Step 5: Settlement ---
  console.log("Step 5: Settlement via x402\n");
  console.log("  In production, the agent would now:");
  console.log("  1. Hit the merchant's x402-protected endpoint");
  console.log("  2. Get HTTP 402 with payment requirements");
  console.log("  3. Sign an ERC-2612 USDC permit (using the Payment Mandate's authority)");
  console.log("  4. Retry with PAYMENT-SIGNATURE header");
  console.log("  5. Merchant verifies mandate chain + receives USDC\n");

  console.log("=== Flow Complete ===\n");
  console.log("Key insight: AP2 provides the AUTHORIZATION (who approved what).");
  console.log("x402 provides the SETTLEMENT (actual USDC movement).");
  console.log("Together: cryptographic proof of intent + instant payment.\n");
}

main().catch(console.error);
