/**
 * Ramp Demo — Corporate Expense Agent with AP2 Spending Controls
 *
 * Scenario: Ramp's Agent Cards let employees authorize AI agents to
 * make purchases on their behalf. Today this works on Visa rails.
 *
 * This demo shows how AP2 Intent Mandates extend Agent Cards to
 * support native-web payment rails (x402/USDC) — cheaper for SaaS,
 * instant for API access, no card interchange fees.
 *
 * What Ramp cares about:
 * - Department-level spending controls (already their core product)
 * - Per-agent authorization with constraints
 * - Audit trail for compliance
 * - Multi-rail flexibility (Visa + x402 + bank)
 *
 * Run: npm run demo:ramp
 */

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { userSignIntent } from "../ap2-signer.js";
import type { IntentMandate } from "../ap2-types.js";
import { verifyIntentMandate } from "../middleware/mandate-verifier.js";

async function main() {
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  Ramp + AP2: Corporate Expense Agent Controls   ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  // --- Company setup ---
  // In production, these map to Ramp's existing card program structure
  const cfo = privateKeyToAccount(generatePrivateKey());
  const engineeringManager = privateKeyToAccount(generatePrivateKey());
  const marketingManager = privateKeyToAccount(generatePrivateKey());

  console.log("Company: Acme Corp\n");
  console.log("Departments:");
  console.log(`  CFO (admin):      ${cfo.address.slice(0, 10)}...`);
  console.log(`  Engineering Mgr:  ${engineeringManager.address.slice(0, 10)}...`);
  console.log(`  Marketing Mgr:    ${marketingManager.address.slice(0, 10)}...`);
  console.log();

  // ================================================
  // SCENARIO 1: Engineering agent buys SaaS/API access
  // This is where Visa rails add friction — usage-based billing,
  // micro-payments for API calls, no card auth for $0.002/request
  // ================================================
  console.log("━━━ Scenario 1: Engineering Agent — SaaS/API Purchases ━━━\n");
  console.log("  Problem: Engineering needs AI agents to buy API access");
  console.log("  (Tavily search, E2B sandboxes, etc). Visa cards don't");
  console.log("  handle per-request micropayments well.\n");

  const engMandate: IntentMandate = {
    type: "intent-mandate",
    version: "0.1.0",
    id: crypto.randomUUID(),
    user: { id: engineeringManager.address },
    agent: { id: "eng-devtools-agent" },
    intent: "Purchase developer tools and API access for engineering team",
    constraints: {
      maxAmount: "50000", // $500 per transaction
      currency: "USDC",
      categories: ["developer-tools", "api-access", "cloud-compute"],
      allowedMerchants: [
        "tavily.com",
        "e2b.dev",
        "exa.ai",
        "browserbase.com",
      ],
    },
    validFrom: new Date().toISOString(),
    validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    maxTransactions: 100,
    budgetTotal: "500000", // $5,000/month
    budgetSpent: "0",
  };

  engMandate.userSignature = await userSignIntent(engMandate, engineeringManager);

  console.log("  Engineering Manager creates Agent Card (AP2 mandate):");
  console.log(`    Agent:          eng-devtools-agent`);
  console.log(`    Max per tx:     $500`);
  console.log(`    Monthly budget: $5,000`);
  console.log(`    Vendors:        Tavily, E2B, Exa, Browserbase`);
  console.log(`    Categories:     dev-tools, api-access, cloud-compute`);
  console.log(`    Rail:           x402 (USDC) — no card interchange fees`);
  console.log(`    Signed by:      Engineering Manager\n`);

  // Agent tries to buy Tavily API access — APPROVED
  console.log("  → Agent purchases Tavily API credits ($200)...");
  const tavilyResult = await verifyIntentMandate(
    engMandate,
    {
      items: [{
        id: "tavily-api-1000",
        name: "Tavily Search API — 1000 credits",
        quantity: 1,
        unitPrice: "20000",
        currency: "USDC",
      }],
      total: "20000",
    },
    "tavily.com"
  );
  console.log(`    Result: ${tavilyResult.valid ? "✅ APPROVED" : "❌ DENIED — " + tavilyResult.error}`);
  console.log(`    Rail: x402 → instant settlement, no 2.9% interchange\n`);

  // Agent tries to buy from unauthorized vendor — DENIED
  console.log("  → Agent tries to buy from unauthorized vendor (figma.com)...");
  const figmaResult = await verifyIntentMandate(
    engMandate,
    {
      items: [{
        id: "figma-enterprise",
        name: "Figma Enterprise Seat",
        quantity: 1,
        unitPrice: "7500",
        currency: "USDC",
      }],
      total: "7500",
    },
    "figma.com"
  );
  console.log(`    Result: ${figmaResult.valid ? "✅ APPROVED" : "❌ DENIED"}`);
  console.log(`    Reason: ${figmaResult.error}`);
  console.log(`    → Figma not in approved vendor list. Agent must request approval.\n`);

  // ================================================
  // SCENARIO 2: Marketing agent with tighter controls
  // ================================================
  console.log("━━━ Scenario 2: Marketing Agent — Content & Ads ━━━\n");
  console.log("  Different department, different rules, same middleware.\n");

  const mktMandate: IntentMandate = {
    type: "intent-mandate",
    version: "0.1.0",
    id: crypto.randomUUID(),
    user: { id: marketingManager.address },
    agent: { id: "mkt-content-agent" },
    intent: "Purchase content creation tools and ad credits",
    constraints: {
      maxAmount: "25000", // $250 max per transaction (tighter)
      currency: "USDC",
      categories: ["content-creation", "advertising"],
      blockedMerchants: ["competitor-ads.com"], // block specific vendors
    },
    validFrom: new Date().toISOString(),
    validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    maxTransactions: 20,
    budgetTotal: "200000", // $2,000/month (smaller than engineering)
    budgetSpent: "0",
  };

  mktMandate.userSignature = await userSignIntent(mktMandate, marketingManager);

  console.log("  Marketing Manager creates Agent Card:");
  console.log(`    Agent:          mkt-content-agent`);
  console.log(`    Max per tx:     $250 (lower than eng)`);
  console.log(`    Monthly budget: $2,000`);
  console.log(`    Blocked:        competitor-ads.com`);
  console.log(`    Signed by:      Marketing Manager\n`);

  // Agent buys content tool — APPROVED
  console.log("  → Agent purchases ElevenLabs API credits ($150)...");
  const elevenResult = await verifyIntentMandate(
    mktMandate,
    {
      items: [{
        id: "elevenlabs-credits",
        name: "ElevenLabs Voice API — 500K characters",
        quantity: 1,
        unitPrice: "15000",
        currency: "USDC",
      }],
      total: "15000",
    },
    "elevenlabs.io"
  );
  console.log(`    Result: ${elevenResult.valid ? "✅ APPROVED" : "❌ DENIED — " + elevenResult.error}\n`);

  // Agent tries blocked vendor — DENIED
  console.log("  → Agent tries blocked vendor (competitor-ads.com)...");
  const blockedResult = await verifyIntentMandate(
    mktMandate,
    {
      items: [{
        id: "ad-credits",
        name: "Ad credits",
        quantity: 1,
        unitPrice: "10000",
        currency: "USDC",
      }],
      total: "10000",
    },
    "competitor-ads.com"
  );
  console.log(`    Result: ${blockedResult.valid ? "✅ APPROVED" : "❌ DENIED"}`);
  console.log(`    Reason: ${blockedResult.error}\n`);

  // ================================================
  // SCENARIO 3: Audit trail
  // ================================================
  console.log("━━━ Scenario 3: Compliance Audit Trail ━━━\n");
  console.log("  Every agent purchase has a cryptographic paper trail:\n");
  console.log("  ┌─────────────────────────────────────────────────────┐");
  console.log("  │ Purchase: Tavily API credits — $200                 │");
  console.log("  ├─────────────────────────────────────────────────────┤");
  console.log(`  │ Authorized by: Engineering Manager                  │`);
  console.log(`  │ Mandate ID:    ${engMandate.id.slice(0, 8)}...                           │`);
  console.log("  │ Agent:         eng-devtools-agent                   │");
  console.log("  │ Vendor:        tavily.com (approved list)           │");
  console.log("  │ Amount:        $200 (under $500 tx limit)           │");
  console.log("  │ Budget used:   $200 / $5,000                        │");
  console.log("  │ Rail:          x402 (on-chain receipt)              │");
  console.log("  │ Signature:     EIP-712 (tamper-proof)               │");
  console.log("  └─────────────────────────────────────────────────────┘\n");
  console.log("  This is better than card receipts — the authorization,");
  console.log("  constraints, and payment are all cryptographically linked.\n");

  // ================================================
  // Summary
  // ================================================
  console.log("━━━ What This Means for Ramp ━━━\n");
  console.log("  Today: Agent Cards → Visa rails → works for most purchases");
  console.log("  Gap:   SaaS/API micropayments, cross-border B2B, crypto-native vendors");
  console.log("  Fix:   AP2 mandates → x402 settlement → instant, no interchange, per-request\n");
  console.log("  Same spending controls Ramp already offers (budgets, vendor lists,");
  console.log("  per-tx limits, department policies) — extended to native-web rails.\n");
  console.log("  The middleware handles: mandate creation, signature verification,");
  console.log("  constraint enforcement, payment routing, and audit trail.\n");
  console.log("  Ramp's team focuses on UX and policy engine.");
  console.log("  We handle the protocol integration.\n");
}

main().catch(console.error);
