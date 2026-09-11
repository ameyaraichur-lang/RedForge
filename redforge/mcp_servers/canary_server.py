"""MCP server: canary framework — honeytoken minting, substitution, and proof.

A canary leak proves data crossed the target boundary: either the token shows
up in leaked text (scan) or the webhook listener records an out-of-band hit
(prove_exfiltration). See listener_spec for the webhook contract.

Run: ``python -m redforge.mcp_servers.canary_server`` (stdio).
"""
from __future__ import annotations

import json

from fastmcp import FastMCP

from redforge.canary import make_canary, prove_exfiltration, scan, substitute
from redforge.config import settings

mcp = FastMCP("redforge-canary")


def _tokens(tokens_json: str) -> list[str] | None:
    """Parse the seeded-token list; empty/blank means "discover any canary"."""
    if not tokens_json.strip():
        return None
    try:
        parsed = json.loads(tokens_json)
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, list) or not parsed:
        return None
    return [str(t) for t in parsed]


@mcp.tool
def make(seed: int = 0) -> dict:
    """Mint a canary token RF-CANARY-<8 hex>. seed 0 -> random (unpredictable);
    seed > 0 -> deterministic (reproducible campaigns).

    Returns {"canary": "RF-CANARY-xxxxxxxx"}.
    """
    return {"canary": make_canary(seed if seed else None)}


@mcp.tool
def substitute_payload(payload: str, canary: str, webhook: str) -> dict:
    """Fill {{CANARY}} / {{WEBHOOK}} placeholders (case-insensitive) in a payload.

    Returns {"payload": "..."} with both placeholders substituted.
    """
    return {"payload": substitute(payload, canary, webhook)}


@mcp.tool
def check_proven(text: str, tokens_json: str = "[]") -> dict:
    """Scan text for canaries and decide whether exfiltration is proven.

    tokens_json: JSON list of seeded canaries; "[]" (default) scans for ANY
    canary shape. Returns {"leaked": [tokens found], "proven": bool}.
    """
    tokens = _tokens(tokens_json)
    leaked = scan(text, tokens=tokens)
    proven = prove_exfiltration(text=text, tokens=tokens)
    return {"leaked": leaked, "proven": bool(proven)}


@mcp.tool
def listener_spec() -> dict:
    """Describe the canary webhook listener contract and its default endpoint.

    The listener (redforge.canary.listener) accepts POST /canary/hit with
    {"token": "RF-CANARY-...", "payload": "..."} — any hit proves the token
    left the target boundary. GET /canary/hits lists recorded hits,
    GET /canary/hits/{token} filters, DELETE /canary/hits clears.
    """
    return {
        "contract": {
            "POST /canary/hit": {"token": "RF-CANARY-<8 hex>", "payload": "optional context"},
            "GET /canary/hits": "list all recorded hits",
            "GET /canary/hits/{token}": "hits for one canary",
            "DELETE /canary/hits": "clear the hit store",
        },
        "example_hit": {"token": "RF-CANARY-deadbeef", "payload": "leaked doc fragment"},
        "default_host": settings.canary_host,
        "default_port": settings.canary_port,
        "launch": 'python -c "from redforge.canary import run_listener; run_listener()"',
    }


if __name__ == "__main__":
    mcp.run()
