/**
 * Agent Card Publisher
 *
 * Serves /.well-known/agent-card.json — the machine-readable description that
 * lets AI agents discover this merchant, learn its AP2 audience, and understand
 * how to present a mandate for verification.
 */

import type { Request, Response } from "express";
import type { MerchantConfig, CatalogProvider } from "./types.js";

export interface AgentCard {
  schema: "https://ap2-protocol.org/agent-card/v0.1";
  merchant: {
    name: string;
    url: string;
    description: string;
    categories: string[];
  };
  capabilities: {
    /** The AP2 mandate format this merchant verifies (real dSD-JWT payment mandates). */
    mandateFormat: "ap2-dsd-jwt";
    /** The closed-mandate `vct` accepted on /ap2/verify. */
    acceptedVct: string;
    paymentRails: string[];
    catalog: boolean;
  };
  ap2: {
    /** The audience an agent's KB-JWT must bind to when presenting to this merchant. */
    audience: string;
  };
  endpoints: {
    catalog: string;
    /** Ask for a single-use nonce to bind a presentation to. */
    paymentContext: string;
    /** Present a dSD-JWT mandate chain for verification + settlement. */
    verify: string;
    orders: string;
  };
}

export function buildAgentCard(config: MerchantConfig, baseUrl: string): AgentCard {
  return {
    schema: "https://ap2-protocol.org/agent-card/v0.1",
    merchant: {
      name: config.name,
      url: config.url,
      description: config.description,
      categories: config.categories,
    },
    capabilities: {
      mandateFormat: "ap2-dsd-jwt",
      acceptedVct: "mandate.payment.1",
      paymentRails: config.paymentRails,
      catalog: true,
    },
    ap2: {
      audience: config.audience,
    },
    endpoints: {
      catalog: `${baseUrl}/ap2/catalog`,
      paymentContext: `${baseUrl}/ap2/payment-context`,
      verify: `${baseUrl}/ap2/verify`,
      orders: `${baseUrl}/ap2/orders`,
    },
  };
}

export function agentCardHandler(config: MerchantConfig, baseUrl: string) {
  const card = buildAgentCard(config, baseUrl);
  return (_req: Request, res: Response) => {
    res.json(card);
  };
}

export function catalogHandler(catalogProvider: CatalogProvider) {
  return async (_req: Request, res: Response) => {
    try {
      const items = await catalogProvider();
      res.json({ items });
    } catch {
      res.status(500).json({ error: "Failed to load catalog" });
    }
  };
}
