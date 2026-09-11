"""MCP server: thin PyRIT bridge.

PyRIT stays an OPTIONAL accelerator: the framework works without it (demo-mode
first, decision D3), so this server reports install status without failing and
exports the round-1 seed corpus in a JSON shape PyRIT can import.

Run: ``python -m redforge.mcp_servers.pyrit_thin`` (stdio).
"""
from __future__ import annotations

from fastmcp import FastMCP

from redforge.catalog import PACKS, TECHNIQUES, seeds_for

mcp = FastMCP("redforge-pyrit-thin")


@mcp.tool
def pyrit_status() -> dict:
    """Report whether the PyRIT orchestrator package is importable.

    Returns {"installed": true, "version": ...} or
    {"installed": false, "note": "pip install pyrit"} — never raises.
    """
    try:
        import pyrit  # noqa: PLC0415 - lazy on purpose: optional dependency
        return {"installed": True, "version": getattr(pyrit, "__version__", "unknown")}
    except ImportError:
        return {"installed": False, "note": "pip install pyrit"}


@mcp.tool
def list_packs() -> dict:
    """List the 8 technique packs with technique counts and scorecard mappings."""
    return {
        "packs": {
            pack: {
                "name": meta["name"],
                "owasp": meta["owasp"],
                "scorecard_dim": meta["scorecard_dim"],
                "techniques": sum(1 for t in TECHNIQUES if t.pack == pack),
            }
            for pack, meta in PACKS.items()
        }
    }


@mcp.tool
def export_seed_dataset(pack: str = "", tech_id: str = "") -> dict:
    """Export round-1 seed payloads as a PyRIT-importable corpus.

    No args -> every technique in every pack; ``pack`` filters to one pack
    (e.g. "PIN"); ``tech_id`` filters to a single technique (e.g. "PIN-004").
    Returns {"count": n, "dataset": [{tech_id, pack, payloads: [...]}]}.
    """
    if pack and pack not in PACKS:
        return {"error": f"unknown pack {pack!r}; expected one of {sorted(PACKS)}"}
    if tech_id and not any(t.id == tech_id for t in TECHNIQUES):
        return {"error": f"unknown technique {tech_id!r}"}

    dataset = [
        {"tech_id": t.id, "pack": t.pack, "payloads": seeds_for(t.id)}
        for t in TECHNIQUES
        if (not pack or t.pack == pack) and (not tech_id or t.id == tech_id)
    ]
    return {"count": len(dataset), "dataset": dataset}


if __name__ == "__main__":
    mcp.run()
