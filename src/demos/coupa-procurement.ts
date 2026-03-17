/**
 * Coupa Demo — Enterprise Procurement with AP2 Intent Mandates
 *
 * Scenario: Coupa manages corporate spending — budgets, approvals,
 * vendor management, compliance. Their Navi agents handle procurement
 * tasks. AP2 Intent Mandates map 1:1 to Coupa's spending controls.
 *
 * This demo shows how AP2 extends Coupa's policy engine to AI agents,
 * so procurement agents can buy autonomously within corporate policy.
 *
 * What Coupa cares about:
 * - Policy enforcement for AI agent spending
 * - Multi-department, multi-agent budget tracking
 * - Vendor approval workflows
 * - Audit trail and compliance reporting
 * - Existing spending controls → AP2 mandate constraints
 *
 * Run: npm run demo:coupa
 */

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { userSignIntent } from "../ap2-signer.js";
import type { IntentMandate } from "../ap2-types.js";
import { verifyIntentMandate } from "../middleware/mandate-verifier.js";

// Simulate Coupa's policy engine output
interface CoupaPolicy {
  department: string;
  approver: string;
  monthlyBudget: number;
  maxPerPO: number;
  approvedVendors: string[];
  blockedVendors: string[];
  categories: string[];
  requiresApproval: boolean;
  approvalThreshold: number;
}

function policyToMandate(
  policy: CoupaPolicy,
  approverAccount: ReturnType<typeof privateKeyToAccount>,
  agentId: string
): IntentMandate {
  return {
    type: "intent-mandate",
    version: "0.1.0",
    id: crypto.randomUUID(),
    user: { id: approverAccount.address },
    agent: { id: agentId },
    intent: `${policy.department} procurement: ${policy.categories.join(", ")}`,
    constraints: {
      maxAmount: (policy.maxPerPO * 100).toString(),
      currency: "USDC",
      categories: policy.categories,
      allowedMerchants: policy.approvedVendors.length > 0
        ? policy.approvedVendors
        : undefined,
      blockedMerchants: policy.blockedVendors.length > 0
        ? policy.blockedVendors
        : undefined,
    },
    validFrom: new Date().toISOString(),
    validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    maxTransactions: 50,
    budgetTotal: (policy.monthlyBudget * 100).toString(),
    budgetSpent: "0",
  };
}

async function main() {
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  Coupa + AP2: Enterprise Procurement Agents     ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  // --- Enterprise org structure ---
  const vpEngineering = privateKeyToAccount(generatePrivateKey());
  const vpMarketing = privateKeyToAccount(generatePrivateKey());
  const cfo = privateKeyToAccount(generatePrivateKey());

  console.log("Enterprise: GlobalTech Inc.\n");
  console.log("Budget Approvers:");
  console.log(`  VP Engineering:  ${vpEngineering.address.slice(0, 10)}...`);
  console.log(`  VP Marketing:    ${vpMarketing.address.slice(0, 10)}...`);
  console.log(`  CFO (override):  ${cfo.address.slice(0, 10)}...`);
  console.log();

  // ================================================
  // STEP 1: Coupa policies → AP2 mandates
  // ================================================
  console.log("━━━ Step 1: Coupa Policies → AP2 Mandates ━━━\n");
  console.log("  Coupa's policy engine defines spending rules.");
  console.log("  AP2 translates them to cryptographically enforced mandates.\n");

  const engPolicy: CoupaPolicy = {
    department: "Engineering",
    approver: "VP Engineering",
    monthlyBudget: 25000,
    maxPerPO: 5000,
    approvedVendors: ["aws.amazon.com", "github.com", "datadog.com", "pagerduty.com"],
    blockedVendors: [],
    categories: ["cloud-infrastructure", "developer-tools", "monitoring"],
    requiresApproval: false, // under threshold = auto-approve
    approvalThreshold: 5000,
  };

  const mktPolicy: CoupaPolicy = {
    department: "Marketing",
    approver: "VP Marketing",
    monthlyBudget: 15000,
    maxPerPO: 2000,
    approvedVendors: [],  // any vendor in approved categories
    blockedVendors: ["competitor-analytics.com"],
    categories: ["advertising", "content-creation", "analytics"],
    requiresApproval: false,
    approvalThreshold: 2000,
  };

  console.log("  Engineering Policy:");
  console.log(`    Budget:    $${engPolicy.monthlyBudget.toLocaleString()}/mo`);
  console.log(`    Max PO:    $${engPolicy.maxPerPO.toLocaleString()}`);
  console.log(`    Vendors:   ${engPolicy.approvedVendors.join(", ")}`);
  console.log(`    Auto-buy:  under $${engPolicy.approvalThreshold.toLocaleString()}\n`);

  console.log("  Marketing Policy:");
  console.log(`    Budget:    $${mktPolicy.monthlyBudget.toLocaleString()}/mo`);
  console.log(`    Max PO:    $${mktPolicy.maxPerPO.toLocaleString()}`);
  console.log(`    Vendors:   any (except ${mktPolicy.blockedVendors.join(", ")})`);
  console.log(`    Auto-buy:  under $${mktPolicy.approvalThreshold.toLocaleString()}\n`);

  // Convert policies to signed mandates
  const engMandate = policyToMandate(engPolicy, vpEngineering, "navi-eng-procurement");
  engMandate.userSignature = await userSignIntent(engMandate, vpEngineering);

  const mktMandate = policyToMandate(mktPolicy, vpMarketing, "navi-mkt-procurement");
  mktMandate.userSignature = await userSignIntent(mktMandate, vpMarketing);

  console.log("  ✅ Policies converted to signed AP2 mandates");
  console.log("  → Agents can now procure autonomously within policy\n");

  // ================================================
  // STEP 2: Procurement scenarios
  // ================================================
  console.log("━━━ Step 2: Agents Procure Autonomously ━━━\n");

  // Engineering agent orders cloud resources
  console.log("  [ENG] Navi agent: AWS Reserved Instances — $4,500");
  const awsResult = await verifyIntentMandate(
    engMandate,
    {
      items: [{
        id: "aws-ri-m5xlarge",
        name: "AWS EC2 m5.xlarge Reserved (1yr)",
        quantity: 3,
        unitPrice: "150000",
        currency: "USDC",
      }],
      total: "450000",
    },
    "aws.amazon.com"
  );
  console.log(`        ${awsResult.valid ? "✅ APPROVED — within policy, approved vendor" : "❌ DENIED — " + awsResult.error}\n`);

  // Engineering agent orders from unapproved vendor
  console.log("  [ENG] Navi agent: DigitalOcean Droplets — $800");
  const doResult = await verifyIntentMandate(
    engMandate,
    {
      items: [{
        id: "do-droplet-pro",
        name: "DigitalOcean Pro Droplets (12mo)",
        quantity: 1,
        unitPrice: "80000",
        currency: "USDC",
      }],
      total: "80000",
    },
    "digitalocean.com"
  );
  console.log(`        ${doResult.valid ? "✅ APPROVED" : "❌ DENIED — " + doResult.error}`);
  console.log("        → Agent escalates to VP Engineering for vendor approval\n");

  // Marketing agent buys analytics
  console.log("  [MKT] Navi agent: Mixpanel Analytics — $1,200");
  const mixResult = await verifyIntentMandate(
    mktMandate,
    {
      items: [{
        id: "mixpanel-growth",
        name: "Mixpanel Growth Plan (annual)",
        quantity: 1,
        unitPrice: "120000",
        currency: "USDC",
      }],
      total: "120000",
    },
    "mixpanel.com"
  );
  console.log(`        ${mixResult.valid ? "✅ APPROVED — within budget, approved category" : "❌ DENIED — " + mixResult.error}\n`);

  // Marketing agent tries blocked vendor
  console.log("  [MKT] Navi agent: Competitor Analytics — $500");
  const compResult = await verifyIntentMandate(
    mktMandate,
    {
      items: [{
        id: "comp-analytics",
        name: "Competitor Analytics Suite",
        quantity: 1,
        unitPrice: "50000",
        currency: "USDC",
      }],
      total: "50000",
    },
    "competitor-analytics.com"
  );
  console.log(`        ${compResult.valid ? "✅ APPROVED" : "❌ DENIED — " + compResult.error}\n`);

  // Marketing agent tries to exceed budget
  console.log("  [MKT] Navi agent: Conference Sponsorship — $8,000");
  const overResult = await verifyIntentMandate(
    mktMandate,
    {
      items: [{
        id: "conf-sponsor",
        name: "DevCon 2026 Gold Sponsorship",
        quantity: 1,
        unitPrice: "800000",
        currency: "USDC",
      }],
      total: "800000",
    },
    "devcon.io"
  );
  console.log(`        ${overResult.valid ? "✅ APPROVED" : "❌ DENIED — " + overResult.error}`);
  console.log("        → Agent escalates to VP Marketing + CFO for approval\n");

  // ================================================
  // STEP 3: Compliance dashboard
  // ================================================
  console.log("━━━ Step 3: Compliance Dashboard ━━━\n");
  console.log("  ┌──────────────┬───────────────┬───────────────┬──────────┐");
  console.log("  │ Department   │ Budget        │ Spent         │ Status   │");
  console.log("  ├──────────────┼───────────────┼───────────────┼──────────┤");
  console.log("  │ Engineering  │ $25,000/mo    │ $4,500        │ 18% used │");
  console.log("  │ Marketing    │ $15,000/mo    │ $1,200        │  8% used │");
  console.log("  └──────────────┴───────────────┴───────────────┴──────────┘\n");

  console.log("  Agent Transactions:");
  console.log("  ┌────┬─────────────────────┬──────────────────┬─────────┬──────────┐");
  console.log("  │ #  │ Agent               │ Purchase         │ Amount  │ Status   │");
  console.log("  ├────┼─────────────────────┼──────────────────┼─────────┼──────────┤");
  console.log("  │ 1  │ navi-eng-procurement│ AWS RI (3x)      │ $4,500  │ Approved │");
  console.log("  │ 2  │ navi-eng-procurement│ DigitalOcean     │ $800    │ Blocked  │");
  console.log("  │ 3  │ navi-mkt-procurement│ Mixpanel Growth  │ $1,200  │ Approved │");
  console.log("  │ 4  │ navi-mkt-procurement│ Competitor Anlyt │ $500    │ Blocked  │");
  console.log("  │ 5  │ navi-mkt-procurement│ DevCon Sponsor   │ $8,000  │ Escalated│");
  console.log("  └────┴─────────────────────┴──────────────────┴─────────┴──────────┘\n");

  console.log("  Every transaction has:");
  console.log("  • Cryptographic proof of who authorized the mandate");
  console.log("  • Constraint verification (was it within policy?)");
  console.log("  • On-chain receipt (if x402 rail — immutable)");
  console.log("  • Escalation trail (if over threshold)\n");

  // ================================================
  // Summary
  // ================================================
  console.log("━━━ What This Means for Coupa ━━━\n");
  console.log("  Coupa already has the policy engine.");
  console.log("  AP2 mandates are the cryptographic encoding of those policies.\n");
  console.log("  The mapping is 1:1:");
  console.log("  ┌──────────────────────┬─────────────────────────────────┐");
  console.log("  │ Coupa Concept        │ AP2 Equivalent                  │");
  console.log("  ├──────────────────────┼─────────────────────────────────┤");
  console.log("  │ Spending limit       │ Intent Mandate: maxAmount       │");
  console.log("  │ Department budget    │ Intent Mandate: budgetTotal     │");
  console.log("  │ Approved vendor list │ Mandate: allowedMerchants       │");
  console.log("  │ Blocked vendor list  │ Mandate: blockedMerchants       │");
  console.log("  │ Category restriction │ Mandate: categories             │");
  console.log("  │ Approval workflow    │ Mandate: maxAmount threshold    │");
  console.log("  │ Purchase order       │ Payment Mandate                 │");
  console.log("  │ Audit trail          │ EIP-712 signatures + on-chain   │");
  console.log("  └──────────────────────┴─────────────────────────────────┘\n");
  console.log("  We build the bridge: Coupa policies → AP2 mandates →");
  console.log("  agent procurement → payment settlement → audit trail.\n");
  console.log("  Coupa's Navi agents get cryptographic spending authority.");
  console.log("  Finance keeps full visibility and control.\n");
}

main().catch(console.error);
