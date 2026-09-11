"""MCP tool-servers (M3) — drive the RedForge framework from an MCP client.

Six P0 servers, one module each, all stdio-runnable via ``python -m``::

    python -m redforge.mcp_servers.target_adapter
    python -m redforge.mcp_servers.pyrit_thin
    python -m redforge.mcp_servers.judge_server
    python -m redforge.mcp_servers.canary_server
    python -m redforge.mcp_servers.opa_server
    python -m redforge.mcp_servers.evidence_server

SERVERS is the registry consumed by tooling/tests: name -> (module, description).
"""
from __future__ import annotations

SERVERS: dict[str, tuple[str, str]] = {
    "target_adapter": (
        "redforge.mcp_servers.target_adapter",
        "Target catalogue, health checks, chat, and tool calls against any "
        "OpenAI-compatible red-team target (demo target in-process).",
    ),
    "pyrit_thin": (
        "redforge.mcp_servers.pyrit_thin",
        "Thin PyRIT bridge: install status, pack listing, and seed-dataset "
        "export for every pack/technique.",
    ),
    "judge_server": (
        "redforge.mcp_servers.judge_server",
        "Dual-mode judging: rule detectors first, LLM-as-judge second, fused "
        "verdicts (no single-judge calls).",
    ),
    "canary_server": (
        "redforge.mcp_servers.canary_server",
        "Honeytoken lifecycle: mint canaries, substitute into payloads, scan "
        "leaked text, and prove exfiltration.",
    ),
    "opa_server": (
        "redforge.mcp_servers.opa_server",
        "Policy scorer: OPA availability, scorecard computation, and severity "
        "derivation with source tracking.",
    ),
    "evidence_server": (
        "redforge.mcp_servers.evidence_server",
        "Evidence store access: finding counts, listing, recording, and "
        "retrieval (graceful when the store is not built).",
    ),
}

__all__ = ["SERVERS"]
