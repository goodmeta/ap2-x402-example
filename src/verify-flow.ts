/**
 * AP2 Verification Flow — the core walkthrough.
 *
 * Verifies REAL AP2 dSD-JWT payment mandates with @goodmeta/agent-verifier. No
 * server, no mocks — just the library doing the cryptography on genuine mandates
 * minted by AP2's own SDK.
 *
 * Run: npm run verify
 *
 * Shows: a valid presentation; cross-merchant replay rejected; wrong-nonce replay
 * rejected; a tampered chain rejected (real crypto); a constraint denial; and the
 * mandate's cumulative budget enforced across payments.
 */

import { BudgetLedger, verifyPresentedMandate, type MerchantTrust } from "./verify-mandate.js";
import { scenario, usd } from "./fixtures/scenarios.js";

const line = (s = "") => console.log(s);

async function main() {
  line("\n━━━ AP2 mandate verification — real dSD-JWT, no mocks ━━━\n");

  const coffee = scenario("coffee_valid");
  // The merchant trusts Alice's issuer key and identifies itself as "coffee-roasters".
  const merchant: MerchantTrust = { audience: coffee.audience, resolveRootKey: () => coffee.rootKey as never };
  const ledger = new BudgetLedger();

  // 1) A valid presentation verifies — amount/payee come FROM the mandate.
  line("1) Agent presents a signed mandate  →  verify");
  let r = await verifyPresentedMandate({ mandateChain: coffee.chain, expectedNonce: coffee.nonce }, merchant, ledger);
  line(`   approved=${r.approved}`);
  line(`   amount ${usd(r.payment!.amount)} ${r.payment!.currency}  →  ${r.payment!.payeeName} (${r.payment!.payeeId})`);
  line(`   tx ${r.payment!.transactionId}   (all FROM the verified mandate, not the request)`);
  if (r.approved && r.budget) ledger.record(r.budget.id, r.payment!.amount);

  // 2) Cross-merchant replay — a presentation minted for "coffee-roasters" can't
  //    be used by another store (the KB audience is server-controlled).
  line("\n2) A DIFFERENT merchant replays the same presentation");
  const otherStore: MerchantTrust = { audience: "other-store", resolveRootKey: () => coffee.rootKey as never };
  r = await verifyPresentedMandate({ mandateChain: coffee.chain, expectedNonce: coffee.nonce }, otherStore);
  line(`   approved=${r.approved}  reason=${r.reason}  (${r.detail})`);

  // 3) Replay with the wrong nonce — rejected.
  line("\n3) Replayed with a stale / wrong nonce");
  r = await verifyPresentedMandate({ mandateChain: coffee.chain, expectedNonce: "some-other-nonce" }, merchant);
  line(`   approved=${r.approved}  reason=${r.reason}  (${r.detail})`);

  // 4) Tampered presentation — flip one byte in the root issuer-JWT payload.
  line("\n4) A tampered presentation (one byte flipped in the root mandate)");
  const tampered = tamperRootPayload(coffee.chain);
  r = await verifyPresentedMandate({ mandateChain: tampered, expectedNonce: coffee.nonce }, merchant);
  line(`   approved=${r.approved}  reason=${r.reason}  (real signature check, not a rubber stamp)`);

  // 5) Constraint denial — the mandate authorizes ≤ $50/tx; this one is $80.
  line("\n5) Agent presents an $80 payment — over the mandate's $50 per-tx cap");
  const over = scenario("coffee_over_amount");
  r = await verifyPresentedMandate({ mandateChain: over.chain, expectedNonce: over.nonce }, merchant, ledger);
  line(`   approved=${r.approved}  reason=${r.reason}`);
  line(`   violation: ${r.violations?.[0]}   (enforced by AP2's own constraint evaluator)`);

  // 6) Cumulative budget — a second valid payment ticks the $100 budget down.
  line("\n6) Cumulative budget across payments (the mandate's payment.budget)");
  const second = scenario("coffee_second");
  r = await verifyPresentedMandate({ mandateChain: second.chain, expectedNonce: second.nonce }, merchant, ledger);
  if (r.approved && r.budget) {
    ledger.record(r.budget.id, r.payment!.amount);
    line(`   2 payments settled — spent ${usd(r.budget.spentCents)} of ${usd(r.budget.capCents!)}, remaining ${usd(r.budget.remainingCents!)}`);
  }

  line("\n━━━ done — every check ran against the real @goodmeta/agent-verifier ━━━\n");
}

/** Flip one base64url char in the root segment's issuer-JWT payload (breaks the signature). */
function tamperRootPayload(chain: string): string {
  const segs = chain.split("~~");
  const [h, p, s] = segs[0].split("~")[0].split(".");
  const flipped = p.slice(0, -1) + (p.at(-1) === "A" ? "B" : "A");
  const seg0Rest = segs[0].split("~").slice(1).join("~");
  segs[0] = [h, flipped, s].join(".") + (seg0Rest ? "~" + seg0Rest : "");
  return segs.join("~~");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
