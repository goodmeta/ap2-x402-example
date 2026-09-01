/**
 * Real AP2 mandate verification — the heart of this example.
 *
 * A merchant receives a PRESENTED AP2 payment mandate (a `~~`-separated dSD-JWT
 * delegation chain: issuer → agent → … → closed payment) and verifies it with
 * the published @goodmeta/agent-verifier package. The package does all the hard
 * cryptography (SD-JWT disclosure hashing, key-binding, chain linkage, ES256
 * pinning, constraint evaluation); this module just wires it to a merchant's
 * trust config and a small in-memory budget ledger.
 *
 * Direction of trust (this is real AP2, not the old toy model): the merchant
 * VERIFIES a mandate the user's wallet/issuer already minted. It never mints or
 * signs mandates itself. Minting needs an AP2 issuer (see the project README) —
 * the demos present pre-minted real mandates (src/fixtures/ap2-scenarios.json).
 *
 * Two invariants the package enforces for us:
 *   - `audience` is SERVER-controlled (this merchant's id). A presentation an
 *     agent minted for merchant A cannot be replayed at merchant B — the KB
 *     audience check fails.
 *   - amount + payee come FROM the verified mandate, never from the request.
 */

import { createHash } from "node:crypto";
import { ap2 } from "@goodmeta/agent-verifier";

const PAYMENT_OPEN_VCT = "mandate.payment.open.1";
const PAYMENT_CLOSED_VCT = "mandate.payment.1";

/** What an agent presents to a merchant to authorize a payment. */
export interface PresentedMandate {
  /** Compact dSD-JWT presentation chain (root `~~` hop `~~` … `~~` closed). */
  mandateChain: string;
  /** The per-presentation nonce the merchant issued (KB replay protection). */
  expectedNonce: string;
}

/** A merchant's trust configuration for verifying presentations. */
export interface MerchantTrust {
  /** The audience agents must mint their KB presentation to (this merchant's id). */
  audience: string;
  /**
   * Resolve the trusted root issuer key for a presentation. Return `null` to
   * reject an unknown issuer (fail-closed). In production this is an x5c chain
   * to a trusted root or a kid→key lookup (see `ap2.x5cOrKidProvider`); the demos
   * pin a single known issuer key per scenario.
   */
  resolveRootKey: (root: ap2.ParsedToken) => ap2.VerificationKey | null;
  /**
   * Constraint types this merchant refuses to settle without, e.g.
   * `["payment.budget"]`.
   *
   * AP2 evaluates only the constraints PRESENT in the mandate. A holder may
   * legitimately withhold one through selective disclosure, and the result is not
   * an error: no evaluator is built, no violation is raised, and the payment is
   * approved with no cap at all. An empty violation list cannot tell you the
   * budget was respected, only that nothing checked it.
   *
   * Naming a constraint here makes that difference visible: if it is absent from
   * the mandate, verification fails instead of silently approving unlimited
   * spend. Optional, so omitting it keeps plain AP2 behaviour.
   *
   * Requires agent-verifier >= 0.6.1. See AP2 issue #339.
   */
  requireConstraints?: string[];
}

export interface VerifiedPayment {
  approved: boolean;
  /** Machine reason when not approved. */
  reason?: "VERIFICATION_FAILED" | "INCOMPLETE_CHAIN" | "UNSUPPORTED_MANDATE" | "CONSTRAINT_VIOLATION";
  detail?: string;
  /** All constraint violations (the mandate's own rules, evaluated by AP2). */
  violations?: string[];
  /** Authorized payment details — taken FROM the verified mandate. */
  payment?: {
    transactionId: string;
    payeeId: string;
    payeeName: string;
    /** Integer minor units (cents). */
    amount: number;
    currency: string;
  };
  /** The cumulative budget this authorization draws on. */
  budget?: {
    id: string;
    /** Cumulative cap in cents, when the mandate carries a `payment.budget`. */
    capCents?: number;
    spentCents: number;
    /** cap − spent, when capped. */
    remainingCents?: number;
  };
}

/**
 * In-memory cumulative budget ledger.
 *
 * AP2 verifies ONE payment statelessly; its `payment.budget` constraint is
 * evaluated against a caller-supplied cumulative context. Something has to track
 * that cumulative spend — this tiny ledger is the example's stand-in. The hosted
 * verifier (verifier.goodmeta.co / @goodmeta/agent-verifier-pro) is the durable,
 * cross-merchant version of exactly this.
 */
export class BudgetLedger {
  private readonly rows = new Map<string, { spentCents: number; uses: number }>();

  context(budgetId: string): ap2.MandateContext {
    const r = this.rows.get(budgetId);
    return { total_amount: r?.spentCents ?? 0, total_uses: r?.uses ?? 0 };
  }

  /** Record a settled payment against a budget (call after settlement). */
  record(budgetId: string, amountCents: number): void {
    const r = this.rows.get(budgetId) ?? { spentCents: 0, uses: 0 };
    r.spentCents += amountCents;
    r.uses += 1;
    this.rows.set(budgetId, r);
  }

  spentCents(budgetId: string): number {
    return this.rows.get(budgetId)?.spentCents ?? 0;
  }
}

/**
 * One user's authorization = one budget. Keyed by the root issuer key (the
 * principal who signed the root mandate) × the canonical authorization terms,
 * so rotating the delegate agent key does not reset the user's budget. (The
 * hosted verifier uses an RFC 7638 thumbprint; for the example a hash over the
 * public key's curve/coords is plenty.)
 */
function deriveBudgetId(rootKey: ap2.VerificationKey, rootOpen: Record<string, unknown>): string {
  const jwk = rootKey as Record<string, unknown>;
  const keyPart = JSON.stringify([jwk.crv ?? "", jwk.x ?? "", jwk.y ?? ""]);
  const terms = JSON.stringify(rootOpen.constraints ?? []);
  const digest = createHash("sha256").update(`${keyPart}\n${terms}`).digest("base64url").slice(0, 16);
  return `bud_${digest}`;
}

/** Cumulative cap (cents) from a `payment.budget` constraint matching `currency`. */
function budgetCapCents(rootOpen: Record<string, unknown>, currency: string): number | undefined {
  const constraints = (rootOpen.constraints ?? []) as Array<Record<string, unknown>>;
  for (const c of constraints) {
    if (c?.type === "payment.budget" && (!currency || c.currency === currency) && typeof c.max === "number") {
      return Math.trunc(c.max * 100);
    }
  }
  return undefined;
}

/**
 * Verify a presented AP2 payment-mandate chain against a merchant's trust config.
 *
 * Pass a `ledger` to enforce the mandate's cumulative `payment.budget` across
 * payments. The verify is non-mutating — on approval, the caller settles the
 * x402 payment and THEN calls `ledger.record(result.budget.id, amount)`.
 */
export async function verifyPresentedMandate(
  presented: PresentedMandate,
  trust: MerchantTrust,
  ledger?: BudgetLedger,
): Promise<VerifiedPayment> {
  // ── Cryptographic chain verification (the package does all of this) ────────
  let payloads: Record<string, unknown>[];
  let rootKey: ap2.VerificationKey | null = null;
  try {
    const tokens = ap2.splitChain(presented.mandateChain);
    const provider: ap2.RootKeyProvider = (root) => {
      const key = trust.resolveRootKey(root);
      if (!key) throw new Error("Untrusted issuer: no trusted root key for this presentation");
      rootKey = key;
      return key;
    };
    payloads = (await ap2.verifyChain(tokens, provider, {
      expectedAud: trust.audience,
      expectedNonce: presented.expectedNonce,
    })) as Record<string, unknown>[];
  } catch (err) {
    return { approved: false, reason: "VERIFICATION_FAILED", detail: (err as Error).message };
  }

  if (payloads.length < 2) {
    return { approved: false, reason: "INCOMPLETE_CHAIN", detail: "A payment chain needs an open mandate and a closed payment mandate" };
  }
  const closed = payloads[payloads.length - 1];
  const opens = payloads.slice(0, -1);
  if (closed.vct !== PAYMENT_CLOSED_VCT || !opens.every((o) => o.vct === PAYMENT_OPEN_VCT)) {
    return { approved: false, reason: "UNSUPPORTED_MANDATE", detail: `Expected a ${PAYMENT_CLOSED_VCT} chain` };
  }
  if (rootKey === null) {
    return { approved: false, reason: "VERIFICATION_FAILED", detail: "Root key was not resolved" };
  }

  // Amount + payee come FROM the verified mandate, never from the request.
  const paymentAmount = (closed.payment_amount ?? {}) as { amount?: unknown; currency?: unknown };
  const amount = Number(paymentAmount.amount);
  const currency = String(paymentAmount.currency ?? "");
  const payee = (closed.payee ?? {}) as { id?: unknown; name?: unknown };
  const transactionId = String(closed.transaction_id ?? "");
  const paymentView = {
    transactionId,
    payeeId: String(payee.id ?? ""),
    payeeName: String(payee.name ?? ""),
    amount,
    currency,
  };

  // ── Constraint enforcement (the mandate's own rules — AP2 evaluates them) ──
  const rootOpen = opens[0];
  const budgetId = deriveBudgetId(rootKey, rootOpen);
  const capCents = budgetCapCents(rootOpen, currency);
  const spentBefore = ledger?.spentCents(budgetId) ?? 0;

  /** Budget view for a given cumulative spend (cents). */
  const budgetAt = (spentCents: number): NonNullable<VerifiedPayment["budget"]> => ({
    id: budgetId,
    ...(capCents !== undefined ? { capCents, remainingCents: capCents - spentCents } : {}),
    spentCents,
  });

  const mandateContext = ledger ? ledger.context(budgetId) : { total_amount: 0, total_uses: 0 };
  const violations: string[] = [];
  for (const open of opens) {
    try {
      violations.push(...ap2.verifyPaymentChain(ap2.parsePaymentChain([open, closed]), {
        mandateContext,
        requiredConstraints: trust.requireConstraints,
      }));
    } catch (err) {
      violations.push((err as Error).message);
    }
  }
  if (violations.length > 0) {
    // Denied: this payment does not apply, so the budget view reflects prior spend only.
    return {
      approved: false,
      reason: "CONSTRAINT_VIOLATION",
      detail: violations[0],
      violations,
      payment: paymentView,
      budget: budgetAt(spentBefore),
    };
  }

  // Approved: the budget view reflects this payment landing (the caller records it).
  return { approved: true, payment: paymentView, budget: budgetAt(spentBefore + amount) };
}
