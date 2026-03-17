# AP2 + x402: Agentic Commerce Middleware

AP2 merchant middleware + educational examples showing how [AP2](https://ap2-protocol.org/) (Agent Payments Protocol) and [x402](https://www.x402.org/) work together — AP2 handles authorization, x402 handles settlement.

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

## AP2 Merchant Middleware

Drop-in Express middleware that makes any merchant agent-purchasable. One function call adds:

- `GET /.well-known/agent-card.json` — agent discovery
- `GET /ap2/catalog` — structured product catalog
- `POST /ap2/mandates/cart` — cart mandate (human approves)
- `POST /ap2/mandates/cart/:id/approve` — process approved cart
- `POST /ap2/mandates/intent/verify` — intent mandate (autonomous agent)
- `GET /ap2/orders/:id` — order status

```typescript
import { createAP2Middleware } from "./middleware/index.js";

app.use(createAP2Middleware({
  merchant: {
    name: "My Store",
    url: "https://mystore.com",
    paymentAddress: "0x...",
    signingKey: process.env.MERCHANT_KEY,
    description: "What we sell",
    paymentRails: ["x402", "card"],
    categories: ["products"],
  },
  catalog: () => myProducts,
}));
```

### Run the demo merchant

```bash
npm install
npm run merchant       # start demo coffee shop (port 3000)
npm run agent-demo     # agent discovers, browses, and buys
```

The agent demo shows the full flow: discovery → catalog → cart mandate (human-approved purchase) → intent mandate (autonomous purchase) → overspend denial.

## Prospect Demos

Industry-specific demos showing how AP2 middleware applies to real companies:

### Ramp — Corporate Expense Agent Controls

```bash
npm run demo:ramp
```

Department-level spending controls as AP2 Intent Mandates. Shows engineering vs marketing budgets, vendor allowlists/blocklists, and compliance audit trail. Demonstrates how AP2 extends Ramp's Agent Cards to native-web payment rails (x402) for SaaS/API micropayments where Visa adds friction.

### Square — From "Agent Can Browse" to "Agent Can Buy"

```bash
npm run demo:square
```

Square's MCP server lets agents read catalog and orders, but can't complete purchases. This demo shows the middleware bridging that gap — same catalog data, but agents can now buy. Includes human-approved lunch order and autonomous office coffee agent.

### Coupa — Enterprise Procurement Agents

```bash
npm run demo:coupa
```

Maps Coupa's spending policies 1:1 to AP2 Intent Mandates. Multi-department budgets, approved vendor lists, category restrictions, and escalation workflows. Shows how procurement agents buy autonomously within corporate policy with cryptographic audit trail.

## Educational Examples

### Cart Mandate Flow (human present)

```bash
npm run cart-flow
```

```
Merchant signs cart → User approves → Payment Mandate → x402 settles
```

### Intent Mandate Flow (autonomous agent)

```bash
npm run intent-flow
```

```
User signs intent ("$30 max, $100/month") → Agent finds deal →
Validates against constraints → Pays via x402 → Budget updated
```

## Project Structure

```
src/
  middleware/              # AP2 Merchant Middleware (the product)
    index.ts              # Main factory: createAP2Middleware()
    types.ts              # MerchantConfig, CatalogItem, Order
    agent-card.ts         # Agent Card publisher
    mandate-verifier.ts   # Signature verification + constraint checking
    payment-router.ts     # Multi-rail routing (x402/card/bank)

  demo-merchant/          # Demo merchant using middleware
    server.ts             # Coffee shop (20 lines of config)
    agent-demo.ts         # Full agent purchase flow

  demos/                  # Prospect-specific demos
    ramp-corporate-expense.ts
    square-merchant-upgrade.ts
    coupa-procurement.ts

  ap2-types.ts            # Core AP2 type system
  ap2-signer.ts           # EIP-712 mandate signing
  cart-mandate-flow.ts    # Educational: cart flow walkthrough
  intent-mandate-flow.ts  # Educational: intent flow walkthrough
```

## Further Reading

- [AP2 Protocol Specification](https://ap2-protocol.org/specification/)
- [AP2 GitHub](https://github.com/google-agentic-commerce/AP2)
- [x402 Protocol](https://www.x402.org/)
- [Coinbase: Google AP2 + x402](https://www.coinbase.com/developer-platform/discover/launches/google_x402)

## Built by

[Good Meta](https://goodmeta.co) — agentic commerce infrastructure.
