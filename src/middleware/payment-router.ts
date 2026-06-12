/**
 * Payment Router
 *
 * Settles an already-VERIFIED payment over the merchant's rail. AP2 handles
 * authorization (did the user approve this?); the rail handles settlement (move
 * the money). This example stubs settlement — wiring a real rail is the only
 * production gap, and it's deliberately out of scope for an AP2 verification demo.
 */

import type { PaymentResult, MerchantConfig } from "./types.js";
import type { VerifiedPayment } from "../verify-mandate.js";

type Payment = NonNullable<VerifiedPayment["payment"]>;

const txId = (rail: string) => `${rail}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;

/**
 * x402 settlement (stub). A real implementation POSTs the verified payment to
 * an x402 facilitator's `/settle`, which submits the agent's signed USDC
 * authorization on-chain. x402's EVM `exact` scheme uses an EIP-3009
 * `transferWithAuthorization` signature (NOT an ERC-2612 permit) — that signing
 * happens agent-side, before the agent presents the AP2 mandate here.
 */
async function processX402(_payment: Payment, config: MerchantConfig): Promise<PaymentResult> {
  if (!config.x402) {
    return { success: false, rail: "x402", error: "x402 not configured for this merchant" };
  }
  // POST ${config.x402.facilitatorUrl}/settle { authorization, amount, payTo, asset }
  return { success: true, rail: "x402", transactionId: txId("x402") };
}

/** Card settlement (stub) — production calls Stripe/Adyen/Square. */
async function processCard(_payment: Payment): Promise<PaymentResult> {
  return { success: true, rail: "card", transactionId: txId("card") };
}

/** Bank settlement (stub) — production initiates ACH/wire. */
async function processBank(_payment: Payment): Promise<PaymentResult> {
  return { success: true, rail: "bank", transactionId: txId("bank") };
}

/** Settle a verified payment over a merchant-accepted rail. */
export async function settlePayment(
  payment: Payment,
  rail: "x402" | "card" | "bank",
  config: MerchantConfig,
): Promise<PaymentResult> {
  if (!config.paymentRails.includes(rail)) {
    return { success: false, rail, error: `Merchant does not accept ${rail} payments` };
  }
  switch (rail) {
    case "x402":
      return processX402(payment, config);
    case "card":
      return processCard(payment);
    case "bank":
      return processBank(payment);
    default:
      return { success: false, rail, error: `Unknown payment rail: ${rail}` };
  }
}
