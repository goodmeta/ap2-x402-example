/**
 * Agent Demo — Full Purchase Flow (real AP2)
 *
 * An AI agent discovers a merchant, then PRESENTS a real, pre-minted AP2 mandate
 * to authorize a payment. The merchant verifies it with @goodmeta/agent-verifier;
 * amount + payee come from the mandate, not from the agent's request.
 *
 * Run the merchant first:  npm run merchant
 * Then run this:           npm run agent-demo
 */

import type { AgentCard } from "../middleware/agent-card.js";
import { scenario, usd } from "../fixtures/scenarios.js";

const MERCHANT_URL = "http://localhost:3000";

async function present(card: AgentCard, name: string) {
  const s = scenario(name);
  const res = await fetch(card.endpoints.verify, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // In production the agent's WALLET mints this chain bound to (card.ap2.audience, a
    // freshly-issued nonce). Here we present a pre-minted real mandate.
    body: JSON.stringify({ mandate_chain: s.chain, expected_nonce: s.nonce, rail: "x402" }),
  });
  return { status: res.status, body: await res.json() };
}

async function main() {
  console.log("\n=== AP2 Agent Demo (real dSD-JWT mandates) ===\n");

  // 1) Discover the merchant.
  const card: AgentCard = await fetch(`${MERCHANT_URL}/.well-known/agent-card.json`).then((r) => r.json());
  console.log(`Discovered: ${card.merchant.name}`);
  console.log(`  mandate format: ${card.capabilities.mandateFormat} (${card.capabilities.acceptedVct})`);
  console.log(`  AP2 audience:   ${card.ap2.audience}`);
  console.log(`  rails:          ${card.capabilities.paymentRails.join(", ")}\n`);

  // 2) Present a valid mandate → verified + settled. Amount/payee FROM the mandate.
  console.log("--- Agent presents a signed mandate ($22 to Coffee Roasters) ---");
  let r = await present(card, "coffee_valid");
  if (r.body.approved && r.body.settled) {
    const o = r.body.order;
    console.log(`  ✅ ${r.status} approved + settled`);
    console.log(`     amount ${usd(o.amount)} ${o.currency} (from the verified mandate)`);
    console.log(`     payee  ${o.payeeId}   tx ${o.transactionId}`);
    console.log(`     budget remaining ${usd(r.body.budget.remainingCents)}   order ${o.id}\n`);
  } else {
    console.log(`  ❌ ${r.status} ${JSON.stringify(r.body)}\n`);
  }

  // 3) Present a second payment — cumulative budget ticks down.
  console.log("--- Agent makes a second purchase ($30) — same authorization ---");
  r = await present(card, "coffee_second");
  if (r.body.approved && r.body.settled) {
    console.log(`  ✅ ${r.status} approved — budget remaining ${usd(r.body.budget.remainingCents)}\n`);
  } else {
    console.log(`  ❌ ${r.status} ${JSON.stringify(r.body)}\n`);
  }

  // 4) Agent tries to overspend — the mandate's own amount_range constraint denies it.
  console.log("--- Agent tries to overspend ($80 > $50 per-tx cap) ---");
  r = await present(card, "coffee_over_amount");
  console.log(`  ${r.body.approved ? "✅" : "❌"} ${r.status} ${r.body.approved ? "approved" : "denied"}`);
  if (!r.body.approved) console.log(`     reason: ${r.body.violations?.[0] ?? r.body.detail}\n`);

  console.log("=== What you just saw ===");
  console.log("  • The merchant VERIFIED a real AP2 dSD-JWT mandate (no minting, real crypto).");
  console.log("  • Amount + payee came from the mandate, not the agent's request.");
  console.log("  • The mandate's own constraints (per-tx cap, cumulative budget) were enforced by AP2.\n");
}

main().catch((e) => {
  console.error("demo failed (is the merchant running? `npm run merchant`):", e);
  process.exit(1);
});
