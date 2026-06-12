/**
 * Ramp Demo — Corporate Expense Agent with AP2 Spending Controls
 *
 * Ramp's Agent Cards let employees authorize AI agents to spend on their behalf
 * (today on Visa rails). This shows the same controls as REAL AP2 payment
 * mandates, verified with @goodmeta/agent-verifier, settling over x402 — cheaper
 * for SaaS/API micropayments where card interchange adds friction.
 *
 * Each policy is a real, minted AP2 mandate (per-tx amount_range, vendor
 * allowed_payees, cumulative budget). NOTE: AP2 has no "category" or "blocklist"
 * constraint — category limits are an agent-policy concern, and "block a
 * competitor" is modeled as an allowlist that excludes them.
 *
 * Run: npm run demo:ramp
 */

import { verifyPresentedMandate, type MerchantTrust } from "../verify-mandate.js";
import { scenario, usd } from "../fixtures/scenarios.js";

async function check(name: string) {
  const s = scenario(name);
  // The receiving merchant is the payee/vendor; it trusts the authorizing manager's key.
  const merchant: MerchantTrust = { audience: s.audience, resolveRootKey: () => s.rootKey as never };
  const r = await verifyPresentedMandate({ mandateChain: s.chain, expectedNonce: s.nonce }, merchant);
  return { s, r };
}

async function main() {
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  Ramp + AP2: Corporate Expense Agent Controls    ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  console.log("━━━ Engineering agent — $500/tx, $5,000 budget, vendor allowlist ━━━\n");
  let { s, r } = await check("ramp_eng_approved");
  console.log(`  → Buy Tavily API credits`);
  console.log(`    ${r.approved ? "✅ APPROVED" : "❌ DENIED"}  ${usd(r.payment!.amount)} → ${r.payment!.payeeName}`);
  console.log(`    rail x402 → instant settlement, no 2.9% interchange\n`);

  ({ s, r } = await check("ramp_eng_unapproved_vendor"));
  console.log(`  → Try to pay an unapproved vendor (Figma)`);
  console.log(`    ${r.approved ? "✅ APPROVED" : "❌ DENIED"}  ${r.violations?.[0] ?? r.detail}`);
  console.log(`    → Figma is not in the mandate's allowed_payees. Agent must request approval.\n`);

  console.log("━━━ Marketing agent — tighter: $250/tx, $2,000 budget ━━━\n");
  ({ s, r } = await check("ramp_mkt_approved"));
  console.log(`  → Buy ElevenLabs credits`);
  console.log(`    ${r.approved ? "✅ APPROVED" : "❌ DENIED"}  ${usd(r.payment!.amount)} → ${r.payment!.payeeName}\n`);

  ({ s, r } = await check("ramp_mkt_competitor"));
  console.log(`  → Try to pay a competitor's ad network`);
  console.log(`    ${r.approved ? "✅ APPROVED" : "❌ DENIED"}  ${r.violations?.[0] ?? r.detail}`);
  console.log(`    note: ${s.note}\n`);

  console.log("━━━ What this means for Ramp ━━━\n");
  console.log("  Same spending controls Ramp already offers (per-tx limits, vendor lists,");
  console.log("  budgets) — expressed as cryptographic AP2 mandates and settled over x402.");
  console.log("  Verification is real (@goodmeta/agent-verifier); the authorization,");
  console.log("  constraints, and payment are all cryptographically linked.\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
