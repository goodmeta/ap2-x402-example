#!/usr/bin/env python3
"""Mint REAL AP2 dSD-JWT payment-mandate chains for this example's demos.

These are genuine AP2 mandates, minted with AP2's own SDK (pinned to commit
e1ea56db72a6385bce3e5c1112b3a56ce60acb43) — the SAME way @goodmeta/agent-verifier
mints its golden vectors. The example VERIFIES them at runtime with the published
@goodmeta/agent-verifier package. Nothing here re-implements AP2 crypto; we only
DRIVE AP2's issuer SDK to produce real presentations.

Each scenario is a crypto-valid chain. "Denied" scenarios are valid chains whose
CLOSED payment falls outside the OPEN mandate's constraints (e.g. amount over the
amount_range max, or a payee not in allowed_payees) — exactly what a misbehaving
agent would present. The constraint violation is caught by the verifier's
`verifyPaymentChain`, not by the crypto layer.

Constraint vocabulary note: AP2's payment constraints are a FIXED set
(amount_range, allowed_payees, budget, agent_recurrence, allowed_payment_instruments,
allowed_pisps, execution_date, reference). There is NO blocklist and NO category
constraint. "Block a competitor" is therefore modeled as an allowed_payees
allowlist that simply excludes them; category limits are an agent-policy concern,
not a mandate constraint.

Setup (one-time):
    python3.13 -m venv /tmp/ap2venv
    /tmp/ap2venv/bin/pip install \
        "git+https://github.com/google-agentic-commerce/AP2.git@e1ea56db72a6385bce3e5c1112b3a56ce60acb43"
Run:
    /tmp/ap2venv/bin/python src/fixtures/gen_example_vectors.py

Re-running is NOT byte-identical (random ECDSA nonce + SD-JWT salts). The committed
ap2-scenarios.json is the source of truth; regenerate only when AP2 changes.
"""
from __future__ import annotations

import hashlib
import json
import pathlib
from types import SimpleNamespace

from jwcrypto.jwk import JWK

from ap2.sdk.mandate import MandateClient
from ap2.sdk.sdjwt import common, kb_sd_jwt, sd_jwt
from ap2.sdk.generated.open_payment_mandate import (
    OpenPaymentMandate,
    AmountRange,
    AllowedPayees,
    Budget,
)
from ap2.sdk.generated.payment_mandate import PaymentMandate
from ap2.sdk.generated.types.amount import Amount
from ap2.sdk.generated.types.merchant import Merchant
from ap2.sdk.generated.types.payment_instrument import PaymentInstrument

OUT = pathlib.Path(__file__).parent / "ap2-scenarios.json"

# Frozen issuance clock (a fixed 2026 timestamp in the past) — deterministic iat
# that always passes a verifier's "iat not in the future" check.
FROZEN_NOW = 1780000000
kb_sd_jwt.time = SimpleNamespace(time=lambda: FROZEN_NOW)

_P256_ORDER = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551


def gen_key(kid: str) -> JWK:
    """Deterministically derive a stable P-256 signing JWK from a fixed label."""
    from cryptography.hazmat.primitives.asymmetric import ec

    scalar = int.from_bytes(hashlib.sha256(kid.encode()).digest(), "big") % (_P256_ORDER - 1) + 1
    priv = ec.derive_private_key(scalar, ec.SECP256R1())
    jwk = JWK.from_pyca(priv)
    d = json.loads(jwk.export())
    d["kid"] = kid
    return JWK.from_json(json.dumps(d))


def pub(jwk: JWK) -> dict:
    return json.loads(jwk.export_public())


def make_cnf(jwk: JWK) -> dict:
    return {"jwk": json.loads(jwk.export_public())}


def root_open(issuer: JWK, holder_pub: JWK, constraints: list) -> str:
    """Root SD-JWT: an open payment mandate (cnf = holder/agent) signed by the user."""
    return sd_jwt.create(
        payload=OpenPaymentMandate(constraints=constraints, cnf=make_cnf(holder_pub)),
        issuer_key=issuer,
    ).sd_jwt_issuance


def terminal(prev_segment: str, holder: JWK, pay: PaymentMandate, *, aud: str, nonce: str) -> str:
    """One terminal KB-SD-JWT payment hop bound to the previous segment."""
    return kb_sd_jwt.create(
        prev_token=common.parse_token(prev_segment),
        holder_key=holder,
        payload=pay,
        aud=aud,
        nonce=nonce,
    ).sd_jwt_issuance


def join(*segments: str) -> str:
    parts = []
    for i, s in enumerate(segments):
        last = i == len(segments) - 1
        parts.append(s if last else (s[:-1] if s.endswith("~") else s))
    return "~~".join(parts)


def pay(*, tx: str, payee: Merchant, amount: int, currency: str = "USD") -> PaymentMandate:
    return PaymentMandate(
        transaction_id=tx,
        payee=payee,
        payment_amount=Amount(amount=amount, currency=currency),
        payment_instrument=PaymentInstrument(id="pi-usdc", type="stablecoin"),
    )


def main() -> None:
    client = MandateClient()
    scenarios: dict[str, dict] = {}

    def two_hop(*, user: JWK, agent: JWK, constraints: list, payment: PaymentMandate, aud: str, nonce: str) -> str:
        root = root_open(user, agent, constraints)
        leaf = terminal(root, agent, payment, aud=aud, nonce=nonce)
        return join(root, leaf)

    def confirm_crypto(name: str, chain: str, user: JWK, *, aud: str, nonce: str) -> None:
        """AP2's own verifier must accept the CRYPTO (chain is genuine)."""
        try:
            client.verify(
                token=chain,
                key_or_provider=lambda _t, u=user: JWK.from_json(u.export_public()),
                expected_aud=aud,
                expected_nonce=nonce,
            )
        except Exception as e:  # noqa: BLE001
            raise SystemExit(f"[FATAL] scenario '{name}': AP2 rejected the crypto ({e})")

    def add(name, description, chain, user, *, aud, nonce, expect, note=None):
        confirm_crypto(name, chain, user, aud=aud, nonce=nonce)
        scenarios[name] = {
            "description": description,
            "chain": chain,
            "rootKey": pub(user),
            "audience": aud,
            "nonce": nonce,
            "expect": expect,  # "approve" (crypto+constraints ok) | "deny:<reason>" (constraint)
        }
        if note:
            scenarios[name]["note"] = note

    # ── Coffee shop (demo-merchant + verify-flow) ────────────────────────────
    # One user (Alice) delegates to her shopping agent: $50/tx cap, $100 budget.
    alice, alice_agent = gen_key("alice"), gen_key("alice-agent")
    coffee = Merchant(name="Coffee Roasters Co.", id="coffee-roasters")
    coffee_constraints = [
        AmountRange(currency="USD", max=5000),   # $50 per transaction (cents)
        Budget(max=100.0, currency="USD"),       # $100 cumulative budget (major units)
    ]
    add(
        "coffee_valid",
        "Alice's agent pays $22 to Coffee Roasters — within the $50/tx cap and $100 budget.",
        two_hop(user=alice, agent=alice_agent, constraints=coffee_constraints,
                payment=pay(tx="ord_coffee_1", payee=coffee, amount=2200), aud="coffee-roasters", nonce="order-nonce-1"),
        alice, aud="coffee-roasters", nonce="order-nonce-1", expect="approve",
    )
    add(
        "coffee_second",
        "A second $30 payment from the same authorization (drives the cumulative budget).",
        two_hop(user=alice, agent=alice_agent, constraints=coffee_constraints,
                payment=pay(tx="ord_coffee_2", payee=coffee, amount=3000), aud="coffee-roasters", nonce="order-nonce-2"),
        alice, aud="coffee-roasters", nonce="order-nonce-2", expect="approve",
    )
    add(
        "coffee_over_amount",
        "Agent tries an $80 payment — exceeds the $50 per-transaction amount_range max.",
        two_hop(user=alice, agent=alice_agent, constraints=coffee_constraints,
                payment=pay(tx="ord_coffee_big", payee=coffee, amount=8000), aud="coffee-roasters", nonce="order-nonce-3"),
        alice, aud="coffee-roasters", nonce="order-nonce-3", expect="deny:amount_range",
    )

    # ── Ramp — engineering corporate-expense agent ───────────────────────────
    # Eng manager authorizes a dev-tools agent: $500/tx, $5,000 budget, vendor allowlist.
    ramp_eng, ramp_eng_agent = gen_key("ramp-eng-mgr"), gen_key("ramp-eng-agent")
    eng_allowlist = [
        Merchant(name="Tavily", id="tavily.com"),
        Merchant(name="E2B", id="e2b.dev"),
        Merchant(name="Exa", id="exa.ai"),
        Merchant(name="Browserbase", id="browserbase.com"),
    ]
    eng_constraints = [
        AmountRange(currency="USD", max=50000),  # $500 per tx
        AllowedPayees(allowed=eng_allowlist),
        Budget(max=5000.0, currency="USD"),      # $5,000/month
    ]
    add(
        "ramp_eng_approved",
        "Eng agent buys $200 of Tavily API credits — Tavily is on the allowlist, under $500/tx.",
        two_hop(user=ramp_eng, agent=ramp_eng_agent, constraints=eng_constraints,
                payment=pay(tx="ramp_eng_tavily", payee=Merchant(name="Tavily", id="tavily.com"), amount=20000),
                aud="tavily.com", nonce="ramp-eng-1"),
        ramp_eng, aud="tavily.com", nonce="ramp-eng-1", expect="approve",
    )
    add(
        "ramp_eng_unapproved_vendor",
        "Eng agent tries to pay Figma ($75) — Figma is NOT in the allowed_payees allowlist.",
        two_hop(user=ramp_eng, agent=ramp_eng_agent, constraints=eng_constraints,
                payment=pay(tx="ramp_eng_figma", payee=Merchant(name="Figma", id="figma.com"), amount=7500),
                aud="figma.com", nonce="ramp-eng-2"),
        ramp_eng, aud="figma.com", nonce="ramp-eng-2", expect="deny:allowed_payees",
    )

    # ── Ramp — marketing agent (tighter; "block competitor" = allowlist that excludes it) ──
    ramp_mkt, ramp_mkt_agent = gen_key("ramp-mkt-mgr"), gen_key("ramp-mkt-agent")
    mkt_allowlist = [
        Merchant(name="ElevenLabs", id="elevenlabs.io"),
        Merchant(name="Jasper", id="jasper.ai"),
        Merchant(name="Meta Ads", id="ads.meta.com"),
    ]
    mkt_constraints = [
        AmountRange(currency="USD", max=25000),  # $250 per tx (tighter than eng)
        AllowedPayees(allowed=mkt_allowlist),
        Budget(max=2000.0, currency="USD"),
    ]
    add(
        "ramp_mkt_approved",
        "Marketing agent buys $150 of ElevenLabs credits — on the allowlist, under $250/tx.",
        two_hop(user=ramp_mkt, agent=ramp_mkt_agent, constraints=mkt_constraints,
                payment=pay(tx="ramp_mkt_eleven", payee=Merchant(name="ElevenLabs", id="elevenlabs.io"), amount=15000),
                aud="elevenlabs.io", nonce="ramp-mkt-1"),
        ramp_mkt, aud="elevenlabs.io", nonce="ramp-mkt-1", expect="approve",
    )
    add(
        "ramp_mkt_competitor",
        "Marketing agent tries to pay a competitor's ad network — not in the allowlist (AP2 has no blocklist; an allowlist that excludes them is the real mechanism).",
        two_hop(user=ramp_mkt, agent=ramp_mkt_agent, constraints=mkt_constraints,
                payment=pay(tx="ramp_mkt_competitor", payee=Merchant(name="Competitor Ads", id="competitor-ads.com"), amount=10000),
                aud="competitor-ads.com", nonce="ramp-mkt-2"),
        ramp_mkt, aud="competitor-ads.com", nonce="ramp-mkt-2", expect="deny:allowed_payees",
        note="categories are NOT an AP2 mandate constraint — that filtering is an agent-policy concern",
    )

    # ── Square — "agent can browse" → "agent can buy" ────────────────────────
    # A diner authorizes a payment to a Square-powered cafe.
    diner, diner_agent = gen_key("square-diner"), gen_key("square-diner-agent")
    square_cafe = Merchant(name="Blue Bottle (Square)", id="square-cafe-001")
    square_constraints = [
        AmountRange(currency="USD", max=10000),  # $100 per tx
        AllowedPayees(allowed=[square_cafe]),
        Budget(max=300.0, currency="USD"),
    ]
    add(
        "square_lunch_approved",
        "Diner's agent pays $42 for a catered lunch order at a Square cafe — agents can finally BUY, not just browse.",
        two_hop(user=diner, agent=diner_agent, constraints=square_constraints,
                payment=pay(tx="square_lunch_1", payee=square_cafe, amount=4200), aud="square-cafe-001", nonce="square-1"),
        diner, aud="square-cafe-001", nonce="square-1", expect="approve",
    )

    # ── Coupa — enterprise procurement agent ─────────────────────────────────
    # Procurement authorizes a sourcing agent: $1,000/tx, $25,000 budget, approved suppliers.
    coupa_buyer, coupa_agent = gen_key("coupa-procurement"), gen_key("coupa-agent")
    suppliers = [
        Merchant(name="Staples Business", id="staples-business"),
        Merchant(name="CDW", id="cdw.com"),
        Merchant(name="Grainger", id="grainger.com"),
    ]
    coupa_constraints = [
        AmountRange(currency="USD", max=100000),  # $1,000 per tx
        AllowedPayees(allowed=suppliers),
        Budget(max=25000.0, currency="USD"),
    ]
    add(
        "coupa_approved",
        "Sourcing agent pays $640 to an approved supplier (CDW) — under the $1,000/tx limit.",
        two_hop(user=coupa_buyer, agent=coupa_agent, constraints=coupa_constraints,
                payment=pay(tx="coupa_cdw_1", payee=Merchant(name="CDW", id="cdw.com"), amount=64000),
                aud="cdw.com", nonce="coupa-1"),
        coupa_buyer, aud="cdw.com", nonce="coupa-1", expect="approve",
    )
    add(
        "coupa_over_limit",
        "Sourcing agent tries a $1,500 purchase — exceeds the $1,000 per-transaction policy.",
        two_hop(user=coupa_buyer, agent=coupa_agent, constraints=coupa_constraints,
                payment=pay(tx="coupa_cdw_big", payee=Merchant(name="CDW", id="cdw.com"), amount=150000),
                aud="cdw.com", nonce="coupa-2"),
        coupa_buyer, aud="cdw.com", nonce="coupa-2", expect="deny:amount_range",
    )

    OUT.write_text(json.dumps(scenarios, indent=2) + "\n")
    print(f"wrote {len(scenarios)} scenarios -> {OUT}")
    for name, s in scenarios.items():
        print(f"  - {name}: {s['expect']}")


if __name__ == "__main__":
    main()
