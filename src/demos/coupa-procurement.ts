/**
 * Coupa Demo — Enterprise Procurement Agents with AP2
 *
 * Coupa manages corporate spend — budgets, approvals, approved suppliers. This
 * shows a sourcing agent buying autonomously within a REAL AP2 mandate
 * (per-tx amount_range, supplier allowed_payees, cumulative budget), verified
 * with @goodmeta/agent-verifier.
 *
 * NOTE: AP2 has no "category" constraint — category restrictions are enforced
 * agent-side as policy; the mandate enforces amount, payee, and budget.
 *
 * Run: npm run demo:coupa
 */

import { verifyPresentedMandate, type MerchantTrust } from "../verify-mandate.js";
import { scenario, usd } from "../fixtures/scenarios.js";

async function check(name: string) {
  const s = scenario(name);
  const merchant: MerchantTrust = { audience: s.audience, resolveRootKey: () => s.rootKey as never };
  const r = await verifyPresentedMandate({ mandateChain: s.chain, expectedNonce: s.nonce }, merchant);
  return { s, r };
}

async function main() {
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  Coupa + AP2: Enterprise Procurement Agents      ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  console.log("  Procurement authorizes a sourcing agent: $1,000/tx, $25,000 budget,");
  console.log("  approved suppliers only — all as one signed AP2 mandate.\n");

  console.log("━━━ Agent buys from an approved supplier ━━━\n");
  let { r } = await check("coupa_approved");
  console.log(`  → Purchase from ${r.payment!.payeeName}`);
  console.log(`    ${r.approved ? "✅ APPROVED" : "❌ DENIED"}  ${usd(r.payment!.amount)} → ${r.payment!.payeeId}`);
  console.log(`    tx ${r.payment!.transactionId}   (cryptographic audit trail)\n`);

  console.log("━━━ Agent tries to exceed the per-transaction policy ━━━\n");
  ({ r } = await check("coupa_over_limit"));
  console.log(`  → Attempt a $1,500 purchase`);
  console.log(`    ${r.approved ? "✅ APPROVED" : "❌ DENIED"}  ${r.violations?.[0] ?? r.detail}`);
  console.log(`    → Over the $1,000 per-transaction limit. Blocked by the mandate.\n`);

  console.log("━━━ What this means for Coupa ━━━\n");
  console.log("  Procurement policies (per-tx limits, approved suppliers, budgets) become");
  console.log("  cryptographic AP2 mandates a sourcing agent carries — verifiable by any");
  console.log("  supplier, settled over x402, with a tamper-evident audit trail.\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
