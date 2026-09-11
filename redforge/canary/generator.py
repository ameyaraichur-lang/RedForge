"""Canary token generation, RAG corpus seeding, and payload substitution."""
import random
import re
import secrets

# Canonical honeytoken shape: RF-CANARY-<8 lowercase hex>
CANARY_RE = re.compile(r"RF-CANARY-[0-9a-f]{8}")

_PREFIX = "RF-CANARY-"


def make_canary(seed: int | None = None) -> str:
    """Mint a canary token.

    Deterministic for a given seed (reproducible campaigns); secrets-based
    (unpredictable to the target) when seed is None.
    """
    value = random.Random(seed).getrandbits(32) if seed is not None else secrets.randbits(32)
    return f"{_PREFIX}{value:08x}"


def seed_corpus(docs: list[str], canary: str) -> list[str]:
    """Return copies of docs with a canary reference appended (RAG corpus seeding)."""
    return [f"{doc}\n[ref:{canary}]" for doc in docs]


def substitute(payload: str, canary: str, webhook: str) -> str:
    """Fill {{CANARY}} / {{WEBHOOK}} placeholders (case-insensitive) in an attack payload."""
    payload = re.sub(r"\{\{CANARY\}\}", lambda _m: canary, payload, flags=re.IGNORECASE)
    payload = re.sub(r"\{\{WEBHOOK\}\}", lambda _m: webhook, payload, flags=re.IGNORECASE)
    return payload
