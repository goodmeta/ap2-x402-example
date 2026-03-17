/**
 * Mandate Verifier
 *
 * Verifies AP2 mandate signatures and constraints.
 * This is the security-critical piece — if this is wrong,
 * unauthorized purchases go through.
 */

import {
  verifyTypedData,
  type Address,
} from "viem";
import type {
  CartMandate,
  IntentMandate,
  CartItem,
} from "../ap2-types.js";

// Must match the domain/types in ap2-signer.ts
const AP2_DOMAIN = {
  name: "AP2",
  version: "0.1.0",
} as const;

const CART_MANDATE_TYPES = {
  CartMandate: [
    { name: "id", type: "string" },
    { name: "merchantId", type: "string" },
    { name: "total", type: "string" },
    { name: "currency", type: "string" },
    { name: "expiresAt", type: "string" },
  ],
} as const;

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

export interface VerificationResult {
  valid: boolean;
  error?: string;
}

/**
 * Verify a Cart Mandate has valid merchant and user signatures.
 */
export async function verifyCartMandate(
  mandate: CartMandate,
  expectedMerchantAddress: Address
): Promise<VerificationResult> {
  // Check expiry
  if (new Date(mandate.expiresAt) < new Date()) {
    return { valid: false, error: "Cart mandate expired" };
  }

  // Must have both signatures
  if (!mandate.merchantSignature || !mandate.userSignature) {
    return { valid: false, error: "Missing required signatures" };
  }

  // Verify merchant signature
  const merchantValid = await verifyTypedData({
    address: expectedMerchantAddress,
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
    signature: mandate.merchantSignature as `0x${string}`,
  });

  if (!merchantValid) {
    return { valid: false, error: "Invalid merchant signature" };
  }

  // Verify user signature
  const userValid = await verifyTypedData({
    address: mandate.user.id as Address,
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
    signature: mandate.userSignature as `0x${string}`,
  });

  if (!userValid) {
    return { valid: false, error: "Invalid user signature" };
  }

  return { valid: true };
}

/**
 * Verify an Intent Mandate has a valid user signature and
 * the proposed purchase fits within constraints.
 */
export async function verifyIntentMandate(
  mandate: IntentMandate,
  cart: { items: CartItem[]; total: string },
  merchantId: string
): Promise<VerificationResult> {
  // Check expiry
  if (new Date(mandate.validUntil) < new Date()) {
    return { valid: false, error: "Intent mandate expired" };
  }

  if (new Date(mandate.validFrom) > new Date()) {
    return { valid: false, error: "Intent mandate not yet valid" };
  }

  // Must have user signature
  if (!mandate.userSignature) {
    return { valid: false, error: "Missing user signature" };
  }

  // Verify user signature
  const userValid = await verifyTypedData({
    address: mandate.user.id as Address,
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
    signature: mandate.userSignature as `0x${string}`,
  });

  if (!userValid) {
    return { valid: false, error: "Invalid user signature" };
  }

  // Check per-transaction limit
  if (BigInt(cart.total) > BigInt(mandate.constraints.maxAmount)) {
    return {
      valid: false,
      error: `Cart total ${cart.total} exceeds per-transaction max ${mandate.constraints.maxAmount}`,
    };
  }

  // Check remaining budget
  const remaining =
    BigInt(mandate.budgetTotal) - BigInt(mandate.budgetSpent);
  if (BigInt(cart.total) > remaining) {
    return {
      valid: false,
      error: `Cart total ${cart.total} exceeds remaining budget ${remaining.toString()}`,
    };
  }

  // Check blocked merchants
  if (mandate.constraints.blockedMerchants?.includes(merchantId)) {
    return { valid: false, error: `Merchant ${merchantId} is blocked` };
  }

  // Check allowed merchants
  if (
    mandate.constraints.allowedMerchants?.length &&
    !mandate.constraints.allowedMerchants.includes(merchantId)
  ) {
    return {
      valid: false,
      error: `Merchant ${merchantId} not in allowlist`,
    };
  }

  // Check transaction count
  if (
    mandate.maxTransactions !== undefined &&
    mandate.maxTransactions <= 0
  ) {
    return { valid: false, error: "Transaction limit reached" };
  }

  return { valid: true };
}
