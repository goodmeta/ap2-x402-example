/**
 * AP2 Middleware Configuration Types
 *
 * What a merchant provides to make itself agent-purchasable. The merchant
 * VERIFIES presented AP2 mandates (it never mints them) and settles approved
 * payments over a rail (x402/card/bank).
 */

import type { VerifiedPayment } from "../verify-mandate.js";

// --- Merchant Configuration ---

export interface MerchantConfig {
  /** Merchant's display name. */
  name: string;
  /** Merchant's website URL. */
  url: string;
  /** Where settled funds go (x402 EVM address, or an off-chain account id). */
  paymentAddress: string;
  /**
   * The merchant's AP2 audience — the value an agent's key-binding (KB) JWT must
   * carry. SERVER-controlled: a presentation an agent minted for another
   * merchant cannot be replayed here (the KB `aud` check fails).
   */
  audience: string;
  /**
   * Issuer keys this merchant trusts to sign root mandates (public JWKs, each
   * with a `kid`). In production this is typically an x5c chain to a trusted
   * root or a kid→key directory (see `ap2.x5cOrKidProvider`).
   */
  trustedIssuerKeys: Array<Record<string, unknown>>;
  /** Description of what the merchant sells. */
  description: string;
  /** Accepted payment rails. */
  paymentRails: ("x402" | "card" | "bank")[];
  /** Product categories this merchant sells (discovery metadata, not a mandate constraint). */
  categories: string[];
  /** x402 configuration (required if "x402" is in paymentRails). */
  x402?: {
    chain: string;
    asset: string;
    facilitatorUrl: string;
  };
}

// --- Catalog Types ---

export interface CatalogItem {
  id: string;
  name: string;
  description: string;
  price: string; // smallest unit (cents)
  currency: string;
  category: string;
  inStock: boolean;
}

export type CatalogProvider = () => Promise<CatalogItem[]> | CatalogItem[];

// --- Payment Processing ---

export interface PaymentResult {
  success: boolean;
  transactionId?: string;
  rail: "x402" | "card" | "bank";
  error?: string;
}

/** Settle an already-verified payment. `payment` is taken from the verified mandate. */
export type PaymentProcessor = (
  payment: NonNullable<VerifiedPayment["payment"]>,
  merchant: MerchantConfig,
) => Promise<PaymentResult>;

// --- Order Fulfillment ---

export interface Order {
  id: string;
  /** The AP2 transaction_id from the verified mandate. */
  transactionId: string;
  payeeId: string;
  /** Integer minor units (cents). */
  amount: number;
  currency: string;
  status: "confirmed" | "processing" | "shipped" | "delivered";
  paymentResult: PaymentResult;
  createdAt: string;
}

export type FulfillmentHandler = (order: Order) => Promise<void>;

// --- Middleware Options ---

export interface AP2MiddlewareOptions {
  merchant: MerchantConfig;
  catalog: CatalogProvider;
  onPayment?: PaymentProcessor;
  onFulfillment?: FulfillmentHandler;
  /**
   * Nonces to treat as already-issued. Production issues nonces live via
   * POST /ap2/payment-context; this is a DEMO affordance so pre-minted
   * presentations (whose KB nonce was fixed at mint time) validate. A nonce not
   * issued live and not listed here is rejected (real replay protection).
   */
  preIssuedNonces?: string[];
  /** Enable request logging (default: false). */
  debug?: boolean;
}

// --- Internal State ---

export interface OrderStore {
  /** Issued single-use nonces the merchant is awaiting a presentation for. */
  issuedNonces: Set<string>;
  completed: Map<string, Order>;
}
