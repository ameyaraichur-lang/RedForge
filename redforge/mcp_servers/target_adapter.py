"""MCP server: target adapter — catalogue, health, chat, and tool calls.

THE demo entry point is ``demo_chat``: it talks to the in-process vulnerable
demo app via an ASGI transport, so the M3 demo path runs end-to-end with no
server and no network. Every other tool takes an explicit ``base_url`` (e.g.
``http://127.0.0.1:8901/v1``) and speaks the same OpenAI-compatible API.

Run: ``python -m redforge.mcp_servers.target_adapter`` (stdio).
"""
from __future__ import annotations

import json

import httpx
from fastmcp import FastMCP

from redforge.catalog import TARGET_CATALOGUE, demo_target
from redforge.targets.adapter import TargetAdapter, demo_adapter

mcp = FastMCP("redforge-target-adapter")


def _spec_dict(spec) -> dict:
    return {
        "id": spec.id,
        "name": spec.name,
        "class": getattr(spec.target_class, "value", str(spec.target_class)),
        "interface": getattr(spec.interface, "value", str(spec.interface)),
        "packs": list(spec.packs),
        "criticality": spec.asset_criticality,
    }


@mcp.tool
def list_targets() -> dict:
    """List the 10 target-catalogue classes plus the local demo target.

    Returns {"count": n, "targets": [{id, name, class, interface, packs, criticality}]}.
    """
    targets = [_spec_dict(t) for t in TARGET_CATALOGUE]
    demo = _spec_dict(demo_target())
    return {"count": len(targets) + 1, "targets": targets + [demo]}


@mcp.tool
async def target_health(base_url: str) -> dict:
    """Check a target's health via GET {base_url}/models (5s timeout).

    Returns {"ok": bool, "models": [model ids], "error": str | None}.
    """
    url = f"{base_url.rstrip('/')}/models"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
        entries = data.get("data", data) if isinstance(data, dict) else data
        models = [e.get("id", str(e)) if isinstance(e, dict) else str(e)
                  for e in entries or []]
        return {"ok": True, "models": models, "error": None}
    except Exception as exc:
        return {"ok": False, "models": [], "error": f"{type(exc).__name__}: {exc}"}


@mcp.tool
async def chat(base_url: str, message: str, session_id: str = "default") -> dict:
    """Send one user message to a target: POST {base_url}/chat/completions.

    Returns {"content": str, "tool_calls": [...], "tokens_used": int};
    transport failures add an "error" key instead of raising.
    """
    adapter = TargetAdapter(base_url)
    try:
        r = await adapter.call_chat([{"role": "user", "content": message}],
                                     session_id=session_id)
        return {"content": r.content, "tool_calls": r.tool_calls,
                "tokens_used": r.tokens_used}
    except Exception as exc:
        return {"content": "", "tool_calls": [], "tokens_used": 0,
                "error": f"{type(exc).__name__}: {exc}"}


@mcp.tool
async def list_target_tools(base_url: str) -> dict:
    """List a target's live tool registry: {"all": names, "documented": names}.

    Shadow tools (all minus documented) are the AGE-005/SUP signal.
    """
    adapter = TargetAdapter(base_url)
    try:
        raw = await adapter.list_tools()
        names = lambda entries: [e.get("name", str(e)) if isinstance(e, dict) else str(e)
                                 for e in entries or []]
        return {"all": names(raw.get("all")),
                "documented": names(raw.get("documented"))}
    except Exception as exc:
        return {"all": [], "documented": [], "error": f"{type(exc).__name__}: {exc}"}


@mcp.tool
async def call_target_tool(base_url: str, name: str, args_json: str = "{}",
                           confirmed: bool = False) -> dict:
    """Invoke one tool on a target via POST {base_url}/tools/call.

    ``args_json`` is a JSON object string; ``confirmed`` mirrors the human
    confirmation flag (the demo target's flaw: it executes even when False).
    """
    try:
        args = json.loads(args_json) if args_json.strip() else {}
        if not isinstance(args, dict):
            return {"error": "args_json must be a JSON object"}
    except json.JSONDecodeError as exc:
        return {"error": f"args_json is not valid JSON: {exc}"}
    adapter = TargetAdapter(base_url)
    try:
        return await adapter.call_tool(name, args, confirmed=confirmed)
    except Exception as exc:
        return {"error": f"{type(exc).__name__}: {exc}"}


@mcp.tool
async def demo_chat(message: str, session_id: str = "default") -> dict:
    """Chat with the in-process vulnerable DEMO target (no URL, no server).

    The M3 demo entry point: same OpenAI-compatible contract as ``chat``,
    answered by redforge.targets.app over an ASGI transport.
    """
    adapter = demo_adapter()
    r = await adapter.call_chat([{"role": "user", "content": message}],
                                session_id=session_id)
    return {"content": r.content, "tool_calls": r.tool_calls,
            "tokens_used": r.tokens_used}


if __name__ == "__main__":
    mcp.run()
