/**
 * AP2 Core Types
 *
 * AP2 mandates are Verifiable Digital Credentials (VDCs) —
 * cryptographically signed JSON objects that prove authorization.
 *
 * Think of them as signed permission slips between:
 * - User (who's paying)
 * - Agent (who's shopping)
 * - Merchant (who's selling)
 */

// --- Cart Mandate ---
// Used when the user is present and approves a specific cart.
// Merchant signs first (committing to price/items), user countersigns.

export interface CartItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: string; // in smallest unit (e.g., cents or USDC base units)
  currency: string;
}

export interface CartMandate {
  type: "cart-mandate";
  version: "0.1.0";
  id: string;

  // Who's involved
  merchant: {
    id: string;
    name: string;
    url: string;
  };
  agent: {
    id: string; // agent's public key or DID
  };
  user: {
    id: string; // user's public key or DID
  };

  // What's being purchased
  cart: {
    items: CartItem[];
    total: string;
    currency: string;
  };

  // Constraints
  expiresAt: string; // ISO timestamp — merchant's price guarantee window
  paymentRails: string[]; // accepted rails: ["x402", "card", "bank"]

  // Signatures (filled in during the flow)
  merchantSignature?: string; // merchant signs the cart commitment
  userSignature?: string; // user approves the purchase
}

// --- Intent Mandate ---
// Used when the agent acts autonomously. User pre-signs spending authority
// with constraints. Agent can transact within those bounds without asking.

export interface SpendingConstraint {
  maxAmount: string; // max per transaction
  currency: string;
  categories?: string[]; // allowed categories (e.g., ["coffee", "office-supplies"])
  allowedMerchants?: string[]; // whitelist (empty = any)
  blockedMerchants?: string[]; // blacklist
}

export interface IntentMandate {
  type: "intent-mandate";
  version: "0.1.0";
  id: string;

  // Who
  user: {
    id: string;
  };
  agent: {
    id: string;
  };

  // What the agent is allowed to do
  intent: string; // human-readable description: "Buy coffee beans monthly"
  constraints: SpendingConstraint;

  // Time bounds
  validFrom: string; // ISO timestamp
  validUntil: string; // ISO timestamp
  maxTransactions?: number; // total transactions allowed

  // Budget tracking
  budgetTotal: string; // total budget for the mandate's lifetime
  budgetSpent: string; // how much has been used

  // Authorization
  userSignature?: string; // user signs the full mandate
}

// --- Payment Mandate ---
// Stripped-down credential derived from either Cart or Intent mandate.
// This is what gets sent to the payment network (Visa, x402, etc.)

export interface PaymentMandate {
  type: "payment-mandate";
  version: "0.1.0";

  // Reference to source mandate
  sourceMandate: {
    type: "cart-mandate" | "intent-mandate";
    id: string;
  };

  // Payment details
  amount: string;
  currency: string;
  payTo: string; // merchant's payment address or account

  // Agent transaction metadata
  agentId: string;
  isAgentTransaction: true; // flag for payment networks
  authorizationProof: string; // hash of the source mandate + signatures

  // Settlement rail
  rail: "x402" | "card" | "bank";

  // x402-specific fields (when rail = "x402")
  x402?: {
    chain: string; // e.g., "base", "base-sepolia"
    asset: string; // USDC contract address
    permitSignature: string; // ERC-2612 permit
  };
}
