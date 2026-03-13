/**
 * AP2 Mandate Signer
 *
 * Uses EIP-712 typed data signing (same as x402 permits) to
 * cryptographically sign mandates. This proves:
 * - Merchant committed to a price (Cart Mandate)
 * - User authorized a purchase (Cart or Intent Mandate)
 *
 * In production, AP2 supports Ed25519, ECDSA, and device-backed keys.
 * We use viem's EIP-712 signing here since it's the same primitive
 * x402 uses — showing how the protocols share crypto foundations.
 */

import { type PrivateKeyAccount, hashMessage } from "viem";
import type { CartMandate, IntentMandate, PaymentMandate } from "./ap2-types.js";

// EIP-712 domain for AP2 mandates
const AP2_DOMAIN = {
  name: "AP2",
  version: "0.1.0",
} as const;

// EIP-712 types for Cart Mandate
const CART_MANDATE_TYPES = {
  CartMandate: [
    { name: "id", type: "string" },
    { name: "merchantId", type: "string" },
    { name: "total", type: "string" },
    { name: "currency", type: "string" },
    { name: "expiresAt", type: "string" },
  ],
} as const;

// EIP-712 types for Intent Mandate
const INTENT_MANDATE_TYPES = {
  IntentMandate: [
    { name: "id", type: "string" },
    { name: "intent", type: "string" },
    { name: "maxAmount", type: "string" },
    { name: "currency", type: "string" },
    { name: "validUntil", type: "string" },
    { name: "budgetTotal", type: "string" },
  ],
} as const;

/**
 * Merchant signs a Cart Mandate — committing to price and items.
 * This is step 1 of the Cart flow.
 */
export async function merchantSignCart(
  mandate: CartMandate,
  merchantAccount: PrivateKeyAccount
): Promise<string> {
  return merchantAccount.signTypedData({
    domain: AP2_DOMAIN,
    types: CART_MANDATE_TYPES,
    primaryType: "CartMandate",
    message: {
      id: mandate.id,
      merchantId: mandate.merchant.id,
      total: mandate.cart.total,
      currency: mandate.cart.currency,
      expiresAt: mandate.expiresAt,
    },
  });
}

/**
 * User approves a Cart Mandate — authorizing the specific purchase.
 * This is step 2 of the Cart flow.
 */
export async function userApproveCart(
  mandate: CartMandate,
  userAccount: PrivateKeyAccount
): Promise<string> {
  // User signs the same data — both parties agree on the same terms
  return userAccount.signTypedData({
    domain: AP2_DOMAIN,
    types: CART_MANDATE_TYPES,
    primaryType: "CartMandate",
    message: {
      id: mandate.id,
      merchantId: mandate.merchant.id,
      total: mandate.cart.total,
      currency: mandate.cart.currency,
      expiresAt: mandate.expiresAt,
    },
  });
}

/**
 * User signs an Intent Mandate — pre-authorizing autonomous spending.
 * Agent can transact within these bounds without asking again.
 */
export async function userSignIntent(
  mandate: IntentMandate,
  userAccount: PrivateKeyAccount
): Promise<string> {
  return userAccount.signTypedData({
    domain: AP2_DOMAIN,
    types: INTENT_MANDATE_TYPES,
    primaryType: "IntentMandate",
    message: {
      id: mandate.id,
      intent: mandate.intent,
      maxAmount: mandate.constraints.maxAmount,
      currency: mandate.constraints.currency,
      validUntil: mandate.validUntil,
      budgetTotal: mandate.budgetTotal,
    },
  });
}

/**
 * Create a Payment Mandate from a signed Cart or Intent Mandate.
 * This is the credential that goes to the payment network.
 */
export function createPaymentMandate(
  source: CartMandate | IntentMandate,
  options: {
    amount: string;
    payTo: string;
    agentId: string;
    rail: "x402" | "card" | "bank";
    x402?: PaymentMandate["x402"];
  }
): PaymentMandate {
  // Hash the source mandate signatures as authorization proof
  const sigData =
    source.type === "cart-mandate"
      ? `${source.merchantSignature}:${source.userSignature}`
      : source.userSignature || "";

  const authProof = hashMessage(sigData);

  return {
    type: "payment-mandate",
    version: "0.1.0",
    sourceMandate: {
      type: source.type,
      id: source.id,
    },
    amount: options.amount,
    currency:
      source.type === "cart-mandate"
        ? source.cart.currency
        : source.constraints.currency,
    payTo: options.payTo,
    agentId: options.agentId,
    isAgentTransaction: true,
    authorizationProof: authProof,
    rail: options.rail,
    x402: options.x402,
  };
}
