/**
 * Agent Card Publisher
 *
 * Serves /.well-known/agent-card.json — the machine-readable description
 * that lets AI agents discover this merchant and understand how to buy.
 *
 * Without this, your store is invisible to agent commerce.
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
    mandateTypes: string[];
    paymentRails: string[];
    catalog: boolean;
  };
  endpoints: {
    catalog: string;
    cartMandate: string;
    intentVerify: string;
    pay: string;
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
      mandateTypes: ["cart-mandate", "intent-mandate"],
      paymentRails: config.paymentRails,
      catalog: true,
    },
    endpoints: {
      catalog: `${baseUrl}/ap2/catalog`,
      cartMandate: `${baseUrl}/ap2/mandates/cart`,
      intentVerify: `${baseUrl}/ap2/mandates/intent/verify`,
      pay: `${baseUrl}/ap2/pay`,
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
    } catch (err) {
      res.status(500).json({ error: "Failed to load catalog" });
    }
  };
}
