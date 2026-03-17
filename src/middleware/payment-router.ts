/**
 * Payment Router
 *
 * Routes verified mandates to the appropriate payment rail.
 * This is the multi-rail piece — most processors only handle their own rail.
 * The middleware handles x402, card, and bank, routing based on mandate preferences.
 */

import type { PaymentMandate } from "../ap2-types.js";
import type { PaymentResult, MerchantConfig } from "./types.js";

/**
 * Default x402 payment processor.
 * In production, this calls the facilitator to settle on-chain.
 */
async function processX402(
  _mandate: PaymentMandate,
  config: MerchantConfig
): Promise<PaymentResult> {
  if (!config.x402) {
    return {
      success: false,
      rail: "x402",
      error: "x402 not configured for this merchant",
    };
  }

  // In production: call facilitator API to verify permit and settle on-chain
  // POST ${config.x402.facilitatorUrl}/settle
  // { permit: mandate.x402.permitSignature, amount, payTo, chain, asset }
  //
  // For the POC, we simulate settlement. In production, this would verify
  // the ERC-2612 permit signature and submit it on-chain.
  return {
    success: true,
    rail: "x402",
    transactionId: `x402_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  };
}

/**
 * Default card payment processor (stub).
 * In production, this calls Stripe/Adyen/Square with the card token.
 */
async function processCard(
  _mandate: PaymentMandate
): Promise<PaymentResult> {
  // In production: call Stripe API with payment intent
  // const intent = await stripe.paymentIntents.create({ amount, currency, ... })

  return {
    success: true,
    rail: "card",
    transactionId: `card_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  };
}

/**
 * Default bank payment processor (stub).
 * In production, this initiates ACH/wire transfer.
 */
async function processBank(
  _mandate: PaymentMandate
): Promise<PaymentResult> {
  return {
    success: true,
    rail: "bank",
    transactionId: `bank_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  };
}

/**
 * Route a payment mandate to the appropriate rail and process it.
 */
export async function routePayment(
  mandate: PaymentMandate,
  config: MerchantConfig
): Promise<PaymentResult> {
  // Verify the merchant accepts this rail
  if (!config.paymentRails.includes(mandate.rail)) {
    return {
      success: false,
      rail: mandate.rail,
      error: `Merchant does not accept ${mandate.rail} payments`,
    };
  }

  switch (mandate.rail) {
    case "x402":
      return processX402(mandate, config);
    case "card":
      return processCard(mandate);
    case "bank":
      return processBank(mandate);
    default:
      return {
        success: false,
        rail: mandate.rail,
        error: `Unknown payment rail: ${mandate.rail}`,
      };
  }
}
