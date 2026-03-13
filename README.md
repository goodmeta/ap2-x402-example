# AP2 + x402 Example

Educational examples showing how [AP2](https://ap2-protocol.org/) (Agent Payments Protocol) and [x402](https://www.x402.org/) work together — AP2 handles authorization, x402 handles settlement.

## What is AP2?

AP2 is Google's open protocol for agent payments. When an AI agent buys something on your behalf, three questions need answers:

1. **Authorization** — How does the merchant know *you* approved this?
2. **Authenticity** — How does anyone know the agent isn't hallucinating a purchase?
3. **Accountability** — Who's liable if it goes wrong?

AP2 answers all three with **Mandates** — cryptographically signed permission slips.

## The Agentic Protocol Stack

```
┌──────────┬──────────────┬──────────────┬────────────────┐
│   MCP    │     A2A      │     AP2      │     x402       │
│  (data)  │   (comms)    │   (authz)    │  (settlement)  │
├──────────┼──────────────┼──────────────┼────────────────┤
│ "What's  │ "Find me     │ "User said   │ "Here's the    │
│  out     │  a deal"     │  up to $30"  │  USDC"         │
│  there?" │              │              │                │
├──────────┼──────────────┼──────────────┼────────────────┤
│Anthropic │ Google / LF  │ Google + 60  │ Coinbase       │
└──────────┴──────────────┴──────────────┴────────────────┘
```

AP2 provides the **authorization wrapper**. x402 is one of the **settlement rails** inside AP2 (alongside Visa, Mastercard, Stripe, etc).

## Examples

### Cart Mandate Flow (human present)

User is watching. Agent finds an item, merchant commits to a price, user approves.

```bash
npm run cart-flow
```

```
Merchant signs cart → User approves → Payment Mandate → x402 settles
```

### Intent Mandate Flow (autonomous agent)

User pre-authorizes spending constraints, then walks away. Agent shops alone.

```bash
npm run intent-flow
```

```
User signs intent ("$30 max, $100/month") → Agent finds deal →
Validates against constraints → Pays via x402 → Budget updated
```

The intent flow also demonstrates constraint enforcement — the agent is **denied** when it tries to overspend.

## AP2 Concepts Covered

| Concept | File | What it shows |
|---------|------|---------------|
| **Cart Mandate** | `src/cart-mandate-flow.ts` | Merchant price commitment + user approval |
| **Intent Mandate** | `src/intent-mandate-flow.ts` | Pre-authorized autonomous spending |
| **Payment Mandate** | `src/ap2-signer.ts` | Derived credential for payment networks |
| **Constraint validation** | `src/intent-mandate-flow.ts` | Budget, per-tx limits, merchant allowlists |
| **EIP-712 signing** | `src/ap2-signer.ts` | Same crypto primitive as x402 permits |
| **Type definitions** | `src/ap2-types.ts` | Full mandate type system |

## Quick Start

```bash
npm install
npm run cart-flow     # human-present flow
npm run intent-flow   # autonomous agent flow
```

No wallet or testnet tokens needed — examples use generated keys for demonstration.

## Further Reading

- [AP2 Protocol Specification](https://ap2-protocol.org/specification/)
- [AP2 GitHub](https://github.com/google-agentic-commerce/AP2)
- [x402 Protocol](https://www.x402.org/)
- [Coinbase: Google AP2 + x402](https://www.coinbase.com/developer-platform/discover/launches/google_x402)

## Built by

[Good Meta](https://goodmeta.co) — agentic commerce integration services.
