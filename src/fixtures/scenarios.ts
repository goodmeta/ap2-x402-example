/**
 * Loader for the minted real-AP2 scenario mandates (ap2-scenarios.json).
 *
 * Every entry is a genuine AP2 dSD-JWT payment-mandate chain minted with AP2's
 * own SDK (see gen_example_vectors.py). The example only ever VERIFIES these.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export interface Scenario {
  description: string;
  /** Compact dSD-JWT presentation chain. */
  chain: string;
  /** Trusted root issuer public JWK (with kid). */
  rootKey: Record<string, unknown>;
  /** The audience the presentation was minted for (the receiving merchant). */
  audience: string;
  /** The KB nonce baked in at mint time. */
  nonce: string;
  /** "approve" | "deny:<constraint>" — what verification should yield. */
  expect: string;
  note?: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const all = JSON.parse(readFileSync(resolve(__dirname, "ap2-scenarios.json"), "utf8")) as Record<string, Scenario>;

export function scenario(name: string): Scenario {
  const s = all[name];
  if (!s) throw new Error(`scenario fixture missing: ${name}`);
  return s;
}

export function allScenarios(): Record<string, Scenario> {
  return all;
}

export const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`;
