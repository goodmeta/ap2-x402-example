/**
 * AP2 Middleware Configuration Types
 *
 * These are what a merchant provides when setting up the middleware.
 * Everything else is handled automatically.
 */

import type { CartMandate, PaymentMandate } from "../ap2-types.js";

// --- Merchant Configuration ---

export interface MerchantConfig {
  /** Merchant's display name */
  name: string;
  /** Merchant's website URL */
  url: string;
  /** Merchant's payment address (Ethereum address for x402, or account ID) */
  paymentAddress: string;
  /** Merchant's private key for signing cart commitments (hex string) */
  signingKey: string;
  /** Description of what the merchant sells */
  description: string;
  /** Accepted payment rails */
  paymentRails: ("x402" | "card" | "bank")[];
  /** Product categories this merchant sells */
  categories: string[];
  /** x402 configuration (required if "x402" is in paymentRails) */
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
  price: string; // in smallest unit
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

export type PaymentProcessor = (
  mandate: PaymentMandate,
  sourceMandateId: string
) => Promise<PaymentResult>;

// --- Order Fulfillment ---

export interface Order {
  id: string;
  mandateId: string;
  items: Array<{ id: string; name: string; quantity: number; unitPrice: string }>;
  total: string;
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
  /** Price commitment window in ms (default: 10 minutes) */
  priceCommitmentWindow?: number;
  /** Enable request logging (default: false) */
  debug?: boolean;
}

// --- Internal State ---

export interface PendingMandate {
  mandate: CartMandate;
  expiresAt: number;
}

export interface MandateStore {
  pending: Map<string, PendingMandate>;
  completed: Map<string, Order>;
}
