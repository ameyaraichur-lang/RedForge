"""MCP server: OPA policy scorer.

Only policy (OPA/Rego) derives scores and severity authoritatively; when the
OPA binary is missing the scoring package falls back silently to its Python
mirrors and stamps ``source`` so every result says which path produced it.

Run: ``python -m redforge.mcp_servers.opa_server`` (stdio).
"""
from __future__ import annotations

import json

from fastmcp import FastMCP

from redforge.config import settings
from redforge.scoring import opa_available, score_via_opa, severity_via_opa

mcp = FastMCP("redforge-opa")


@mcp.tool
def opa_status() -> dict:
    """Report OPA availability and the configured binary path."""
    return {"available": opa_available(), "path": settings.opa_path}


@mcp.tool
def scorecard(actuals_json: str = "") -> dict:
    """Compute the AI Security Scorecard via the OPA policy.

    actuals_json: JSON object mapping scorecard dimension name -> percent
    (0-100), e.g. {"Injection Resistance": 80}. Empty string uses the demo
    baseline actuals. Returns {"total", "band", "contributions", "source"}.
    """
    if not actuals_json.strip():
        return score_via_opa({})
    try:
        actuals = json.loads(actuals_json)
    except json.JSONDecodeError as exc:
        return {"error": f"actuals_json is not valid JSON: {exc}"}
    if not isinstance(actuals, dict):
        return {"error": "actuals_json must be a JSON object of {dimension: pct}"}
    return score_via_opa(actuals)


@mcp.tool
def severity(pack: str, confidence: float, criticality: int = 1) -> dict:
    """Derive finding severity from the OPA policy.

    pack: technique pack id (PIN/EXF/OUT/AGE/MEM/CON/HAL/SUP); confidence:
    judge confidence 0..1; criticality: asset criticality 1..5.
    Returns {"pack", "confidence", "criticality", "severity", "source"}
    where source is "opa" | "python-fallback".
    """
    result = severity_via_opa(pack, confidence, criticality)
    return {
        "pack": pack,
        "confidence": confidence,
        "criticality": criticality,
        "severity": str(result),
        "source": getattr(result, "source", "python-fallback"),
    }


if __name__ == "__main__":
    mcp.run()
