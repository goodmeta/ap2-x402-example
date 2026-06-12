# AP2 + x402: Agentic Commerce Middleware

A merchant-side example that **verifies real [AP2](https://ap2-protocol.org/) payment mandates** and settles them over [x402](https://www.x402.org/). AP2 handles authorization (did the user approve this?), x402 handles settlement (move the money).

Verification uses [`@goodmeta/agent-verifier`](https://www.npmjs.com/package/@goodmeta/agent-verifier) — real AP2 dSD-JWT verification (ES256-pinned, key-binding, chain linkage, constraint evaluation), byte-exact against AP2's reference SDK.

## What AP2 mandates actually are

An AP2 mandate is a **dSD-JWT delegation chain** — a W3C Verifiable-Credential-style SD-JWT, signed with ES256, with key-binding (KB) JWTs that bind each hop to a holder and to a specific verifier (audience + nonce). A user's wallet/issuer delegates authority to an agent; the agent presents a closed payment mandate; the merchant verifies the whole chain.

This is **not** an EIP-712 typed-data signature or a whole-payload JWS. If you see an "AP2" example signing a flat struct with `viem`, it isn't verifying real AP2 mandates. (An earlier version of this repo did exactly that — it's been replaced.)

## The agentic protocol stack

```
┌──────────┬──────────────┬──────────────┬────────────────┐
│   MCP    │     A2A      │     AP2      │     x402       │
│  (data)  │   (comms)    │   (authz)    │  (settlement)  │
├──────────┼──────────────┼──────────────┼────────────────┤
│ "What's  │ "Find me     │ "User said   │ "Here's the    │
│  out     │  a deal"     │  up to $30"  │  USDC"         │
│  there?" │              │              │                │
└──────────┴──────────────┴──────────────┴────────────────┘
```

AP2 provides the authorization wrapper. x402 is one of the settlement rails inside AP2 (alongside cards, bank, etc).

## Direction of trust (important)

In real AP2, the **merchant verifies a mandate the user's wallet/issuer already minted.** The merchant never mints or signs mandates. Minting requires an AP2 *issuer* (today that's AP2's Python SDK; a standalone TS issuer is a separate concern). So this example **verifies** — it ships real, pre-minted mandates and runs them through the verifier. See [`src/fixtures/gen_example_vectors.py`](src/fixtures/gen_example_vectors.py) for how the demo mandates were minted with AP2's own SDK.

## Run it

```bash
npm install

npm run verify        # core walkthrough: verify a real mandate; replay/tamper/constraint/budget
npm test              # every minted scenario verifies/denies as labeled (real crypto)

npm run merchant      # demo merchant server (verifies real mandates on POST /ap2/verify)
npm run agent-demo    # an agent presents a real, pre-minted mandate to the merchant

npm run demo:ramp     # prospect demos: corporate-expense / merchant-upgrade / procurement
npm run demo:square
npm run demo:coupa
```

`npm run verify` shows the whole story end-to-end: a valid presentation verifies (amount + payee come **from** the mandate), a presentation minted for one merchant can't be replayed at another, a stale nonce is rejected, a tampered chain fails the signature check, an over-limit payment is denied by the mandate's own constraint, and a cumulative budget is enforced across payments.

## The merchant middleware

Drop-in Express middleware that makes any merchant agent-purchasable:

```typescript
import { createAP2Middleware } from "./middleware/index.js";

app.use(createAP2Middleware({
  merchant: {
    name: "My Store",
    url: "https://mystore.com",
    paymentAddress: "0x...",
    audience: "my-store",                 // agents bind their KB-JWT to this
    trustedIssuerKeys: [/* issuer pub JWKs */],
    description: "What we sell",
    paymentRails: ["x402", "card"],
    categories: ["products"],
  },
  catalog: () => myProducts,
}));
```

Routes added:

- `GET /.well-known/agent-card.json` — discovery (incl. this merchant's AP2 audience + accepted mandate format)
- `GET /ap2/catalog` — structured product catalog
- `POST /ap2/payment-context` — issue a single-use nonce to bind a presentation to
- `POST /ap2/verify` — verify a presented dSD-JWT mandate chain → settle → order
- `GET /ap2/orders/:id` — order status

## What AP2 mandate constraints can (and can't) express

AP2's payment constraints are a fixed set: `amount_range`, `allowed_payees`, `budget`, `agent_recurrence`, `allowed_payment_instruments`, `allowed_pisps`, `execution_date`, `reference`. The prospect demos map real policies onto these:

| Policy | AP2 constraint |
|---|---|
| Per-transaction limit | `payment.amount_range` |
| Approved-vendor list | `payment.allowed_payees` |
| Monthly/total budget (cumulative) | `payment.budget` |

Two things AP2 has **no** constraint for, so the demos don't pretend otherwise:

- **Blocklists** — there's no "blocked merchants" constraint. "Block a competitor" is modeled as an `allowed_payees` allowlist that simply excludes them.
- **Categories** — there's no category constraint. Category filtering is an agent-policy concern (the agent decides what to buy), not something the mandate enforces.

Cumulative budget is stateful — AP2 verifies one payment against a caller-supplied cumulative context. This example tracks that in a small in-memory ledger; the hosted [verifier.goodmeta.co](https://verifier.goodmeta.co) is the durable, cross-merchant version.

## Project structure

```
src/
  verify-mandate.ts        # the core: verify a presented chain via @goodmeta/agent-verifier
  verify-flow.ts           # `npm run verify` — the end-to-end walkthrough
  verify.test.ts           # `npm test` — scenario parity + replay/tamper/budget
  fixtures/
    gen_example_vectors.py # mints the demo mandates with AP2's own SDK (issuer side)
    ap2-scenarios.json     # the minted real mandates (verified at runtime)
    scenarios.ts           # loader
  middleware/              # drop-in AP2 merchant middleware
    index.ts               # createAP2Middleware()
    agent-card.ts          # discovery
    payment-router.ts      # rail settlement (x402/card/bank — stubbed)
    types.ts
  demo-merchant/           # demo merchant server + agent client
  demos/                   # Ramp / Square / Coupa prospect demos
```

## Further reading

- [AP2 Protocol Specification](https://ap2-protocol.org/specification/)
- [AP2 GitHub](https://github.com/google-agentic-commerce/AP2)
- [`@goodmeta/agent-verifier`](https://www.npmjs.com/package/@goodmeta/agent-verifier) — the verification library this example uses
- [x402 Protocol](https://www.x402.org/) (x402's EVM `exact` scheme uses an EIP-3009 `transferWithAuthorization`, not an ERC-2612 permit)

## Built by

[Good Meta](https://goodmeta.co) — agentic commerce infrastructure.
