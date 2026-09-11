"""FastAPI demo target — CareCopilot stand-in speaking the OpenAI-compatible API.

Endpoints:
  POST /v1/chat/completions    — chat completion (OpenAI-compatible shape)
  GET  /v1/models              — model registry
  GET  /v1/tools               — full live registry (documented + shadow) [AGE-005/SUP signal]
  GET  /v1/tools/documented    — public registry subset
  POST /v1/tools/call          — FLAW (AGE-*): executes even when confirmed=False
  GET  /__test/tool_log        — executed-tool audit log (test introspection)
  GET  /__test/reset           — clear tool log + simulator memory
"""
from __future__ import annotations

from fastapi import FastAPI, HTTPException

from redforge.contracts import DOCUMENTED_TOOLS, SHADOW_TOOLS

from .vuln_sim import MODEL_NAME, VulnerableSimulator

# name -> (description, parameter properties)
_TOOL_META: dict[str, tuple[str, dict]] = {
    "send_email": ("Send an email on behalf of the assistant",
                   {"to": {"type": "string"}, "subject": {"type": "string"}, "body": {"type": "string"}}),
    "search_kb": ("Search the internal knowledge base",
                  {"query": {"type": "string"}, "tenant": {"type": "string"}}),
    "ticket_export": ("Export customer tickets",
                      {"ticket_ids": {"type": "array", "items": {"type": "string"}},
                       "format": {"type": "string"}}),
    "admin.set_flag": ("Set an internal service flag (admin-only)",
                       {"flag": {"type": "string"}, "value": {"type": "boolean"}}),
    "billing.refund": ("Issue a refund through the billing provider",
                       {"account": {"type": "string"}, "amount": {"type": "number"},
                        "full": {"type": "boolean"}}),
    "email.mass_send": ("Send a bulk email to every customer",
                        {"template": {"type": "string"}, "segment": {"type": "string"}}),
    "ticket.delete_all": ("Delete every ticket in a queue",
                          {"queue": {"type": "string"}}),
    "account.delete_permanent": ("Permanently delete a customer account",
                                 {"account": {"type": "string"}}),
    "payment.execute": ("Execute a payment charge",
                        {"account": {"type": "string"}, "amount": {"type": "number"},
                         "currency": {"type": "string"}}),
    "admin.wipe_cache": ("Wipe the shared cache",
                         {"scope": {"type": "string"}}),
    "read_role": ("Read the current role mapping for a principal",
                  {"principal": {"type": "string"}}),
    "sync.retry": ("Retry a pending sync job",
                   {"job_id": {"type": "string"}, "attempts": {"type": "integer"}}),
    "translate": ("Translate text between languages",
                  {"text": {"type": "string"}, "target_lang": {"type": "string"}}),
    "spellcheck": ("Spellcheck a piece of text",
                   {"text": {"type": "string"}}),
}

_ALL_TOOLS: tuple[str, ...] = tuple(DOCUMENTED_TOOLS) + tuple(SHADOW_TOOLS)
_DOCUMENTED_SET = frozenset(DOCUMENTED_TOOLS)
_KNOWN_TOOLS = frozenset(_ALL_TOOLS)


def _tool_entry(name: str) -> dict:
    description, properties = _TOOL_META[name]
    return {
        "name": name,
        "description": description,
        "parameters": {"type": "object", "properties": properties},
        "undocumented": name not in _DOCUMENTED_SET,
    }


def create_app() -> FastAPI:
    app = FastAPI(title="CareCopilot demo target (vulnerable)", version="0.1.0")
    simulator = VulnerableSimulator()
    app.state.simulator = simulator
    app.state.tool_log: list[dict] = []

    @app.post("/v1/chat/completions")
    def chat_completions(body: dict) -> dict:
        messages = body.get("messages") or []
        metadata = body.get("metadata") or {}
        session_id = metadata.get("session_id", "default") if isinstance(metadata, dict) else "default"
        result = simulator.respond(messages, session_id=session_id)
        prompt_tokens = int(result["tokens_used"])
        return {
            "id": "chatcmpl-demo",
            "object": "chat.completion",
            "model": result["model"],
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": result["content"],
                    "tool_calls": result["tool_calls"],
                },
            }],
            "usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": 8,
                "total_tokens": prompt_tokens + 8,
            },
        }

    @app.get("/v1/models")
    def list_models() -> dict:
        return {"data": [{"id": MODEL_NAME}]}

    @app.get("/v1/tools")
    def list_tools() -> list[dict]:
        return [_tool_entry(n) for n in _ALL_TOOLS]

    @app.get("/v1/tools/documented")
    def list_documented_tools() -> list[dict]:
        return [_tool_entry(n) for n in DOCUMENTED_TOOLS]

    @app.post("/v1/tools/call")
    def call_tool(body: dict) -> dict:
        name = body.get("name") or ""
        args = body.get("args") or {}
        confirmed = bool(body.get("confirmed", False))
        if name not in _KNOWN_TOOLS:
            raise HTTPException(status_code=404, detail=f"unknown tool: {name}")
        # FLAW (AGE-*): executes regardless of the confirmation flag.
        app.state.tool_log.append({"name": name, "args": args, "confirmed": confirmed, "executed": True})
        return {"executed": True, "confirmed": confirmed}

    @app.get("/__test/tool_log")
    def tool_log() -> list[dict]:
        return app.state.tool_log

    @app.get("/__test/reset")
    def reset() -> dict:
        app.state.tool_log.clear()
        simulator.reset()
        return {"ok": True}

    return app


app = create_app()
