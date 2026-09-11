"""Canary detection: scan leaked text and prove exfiltration via listener hits."""
import httpx
from httpx import AsyncClient

from .generator import CANARY_RE


def scan(text: str, tokens: list[str] | None = None) -> list[str]:
    """Find canaries in text.

    tokens=None -> every CANARY_RE match, in order of appearance; otherwise the
    subset of the given tokens literally present in the text (seeded-token check).
    """
    if tokens is None:
        return CANARY_RE.findall(text)
    return [t for t in tokens if t in text]


async def hits(client: httpx.AsyncClient) -> list[dict]:
    """Fetch recorded hits from a listener (GET /canary/hits)."""
    resp = await client.get("/canary/hits")
    resp.raise_for_status()
    return resp.json()["hits"]


def prove_exfiltration(text: str = "", hit_records: list[dict] | None = None,
                       tokens: list[str] | None = None) -> bool:
    """True if any canary leaked into text OR any hit was recorded for a seeded token."""
    if text and scan(text, tokens=tokens):
        return True
    if hit_records:
        if tokens is None:
            return True
        seeded = set(tokens)
        return any(rec.get("token") in seeded for rec in hit_records)
    return False


async def check_and_prove(base_url: str, text: str, tokens: list[str]) -> bool:
    """Scan text and query the listener at base_url; combine both signals."""
    async with AsyncClient(base_url=base_url, timeout=5.0) as client:
        records = await hits(client)
    return prove_exfiltration(text=text, hit_records=records, tokens=tokens)
