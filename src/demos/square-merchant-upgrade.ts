/**
 * Square Demo — From "Agent Can Browse" to "Agent Can Buy"
 *
 * Square's MCP server lets agents read catalog and orders, but not complete
 * purchases. AP2 closes that gap: the customer's agent presents a real AP2
 * payment mandate, the Square merchant verifies it with @goodmeta/agent-verifier,
 * and the order settles — same catalog data, but agents can now BUY.
 *
 * Run: npm run demo:square
 */

import { verifyPresentedMandate, type MerchantTrust } from "../verify-mandate.js";
import { scenario, usd } from "../fixtures/scenarios.js";

async function main() {
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  Square + AP2: Agent Can Browse → Agent Can Buy  ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  console.log("  Today (Square MCP):  agent reads catalog + orders, but cannot pay.");
  console.log("  With AP2:            agent presents a signed mandate → merchant verifies → buys.\n");

  const s = scenario("square_lunch_approved");
  const merchant: MerchantTrust = { audience: s.audience, resolveRootKey: () => s.rootKey as never };
  const r = await verifyPresentedMandate({ mandateChain: s.chain, expectedNonce: s.nonce }, merchant);

  console.log("━━━ Diner's agent places a catered lunch order ━━━\n");
  console.log(`  ${r.approved ? "✅ APPROVED + verifiable" : "❌ DENIED"}`);
  console.log(`    amount ${usd(r.payment!.amount)} ${r.payment!.currency} → ${r.payment!.payeeName}`);
  console.log(`    tx ${r.payment!.transactionId}   (amount + payee FROM the verified mandate)\n`);

  console.log("━━━ What this means for Square ━━━\n");
  console.log("  Same catalog the MCP server already exposes — plus a verifiable purchase path.");
  console.log("  The merchant never holds the customer's keys; it just verifies the mandate");
  console.log("  the customer's wallet signed. Settlement rides x402 (or card).\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
