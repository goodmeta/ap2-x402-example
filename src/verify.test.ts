/**
 * Tests: every minted scenario verifies or denies exactly as labeled, through
 * the real @goodmeta/agent-verifier package. Run: npm test
 */
import { BudgetLedger, verifyPresentedMandate, type MerchantTrust } from "./verify-mandate.js";
import { allScenarios, scenario, usd } from "./fixtures/scenarios.js";

let pass = 0;
let fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.log(`  ✗ ${msg}`); }
};

async function main() {
  console.log("scenario verify/deny parity:");
  for (const [name, s] of Object.entries(allScenarios())) {
    const trust: MerchantTrust = { audience: s.audience, resolveRootKey: () => s.rootKey as never };
    const r = await verifyPresentedMandate({ mandateChain: s.chain, expectedNonce: s.nonce }, trust);
    const wantApprove = s.expect === "approve";
    ok(r.approved === wantApprove,
      `${name}: expect=${s.expect} got=${r.approved ? "approve" : `deny(${r.reason})`}` +
      (r.payment ? ` ${usd(r.payment.amount)}→${r.payment.payeeName}` : ""));
    if (wantApprove) ok(!!r.payment && r.payment.amount > 0, `  ${name}: amount+payee came from the mandate`);
    else ok(!!r.violations?.length || r.reason !== "CONSTRAINT_VIOLATION", `  ${name}: denial carries a reason`);
  }

  // Replay / tamper safety on a known-good chain.
  const coffee = scenario("coffee_valid");
  const merchant: MerchantTrust = { audience: coffee.audience, resolveRootKey: () => coffee.rootKey as never };
  const wrongAud: MerchantTrust = { audience: "someone-else", resolveRootKey: () => coffee.rootKey as never };
  console.log("\nreplay / tamper safety:");
  ok((await verifyPresentedMandate({ mandateChain: coffee.chain, expectedNonce: coffee.nonce }, wrongAud)).approved === false,
    "cross-merchant replay (wrong audience) is rejected");
  ok((await verifyPresentedMandate({ mandateChain: coffee.chain, expectedNonce: "nope" }, merchant)).approved === false,
    "wrong nonce is rejected");
  const segs = coffee.chain.split("~~");
  const [h, p, sig] = segs[0].split("~")[0].split(".");
  segs[0] = [h, p.slice(0, -1) + (p.at(-1) === "A" ? "B" : "A"), sig].join(".") + (segs[0].includes("~") ? "~" + segs[0].split("~").slice(1).join("~") : "");
  ok((await verifyPresentedMandate({ mandateChain: segs.join("~~"), expectedNonce: coffee.nonce }, merchant)).approved === false,
    "tampered root payload is rejected");

  // Cumulative budget: $22 + $30 fit a $100 budget and decrement remaining.
  console.log("\ncumulative budget:");
  const ledger = new BudgetLedger();
  const r1 = await verifyPresentedMandate({ mandateChain: coffee.chain, expectedNonce: coffee.nonce }, merchant, ledger);
  if (r1.approved && r1.budget) ledger.record(r1.budget.id, r1.payment!.amount);
  const second = scenario("coffee_second");
  const r2 = await verifyPresentedMandate({ mandateChain: second.chain, expectedNonce: second.nonce }, merchant, ledger);
  ok(r2.approved && r2.budget?.remainingCents === 10000 - 2200 - 3000, "remaining budget decrements correctly ($48 left of $100)");

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
