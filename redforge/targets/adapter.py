"""OpenAICompatibleTarget — HTTP client for any OpenAI-compatible red-team target.

One of the implementations of the ``TargetAdapter`` Protocol in
``redforge.targets.protocol``. `demo_adapter()` wires it to the in-process
FastAPI app via httpx.ASGITransport so tests (and offline demo runs) need no
live server; `tests/test_target_http_real_mode.py` exercises the same class
over a real socket and asserts both transports find the same flaws.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import httpx


@dataclass
class ChatResponse:
    content: str
    tool_calls: list[dict] = field(default_factory=list)
    tokens_used: int = 0
    raw: dict = field(default_factory=dict)


class OpenAICompatibleTarget:
    """Async client speaking the OpenAI-compatible chat/tools API.

    base_url already includes the /v1 prefix, e.g. http://127.0.0.1:8901/v1.
    """

    def __init__(self, base_url: str, api_key: str = "",
                 transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self._transport = transport

    def _client(self) -> httpx.AsyncClient:
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        return httpx.AsyncClient(transport=self._transport, headers=headers, timeout=30.0)

    async def call_chat(self, messages: list[dict], session_id: str | None = None) -> ChatResponse:
        payload: dict = {"messages": list(messages)}
        if session_id is not None:
            payload["metadata"] = {"session_id": session_id}
        async with self._client() as client:
            resp = await client.post(f"{self.base_url}/chat/completions", json=payload)
            resp.raise_for_status()
            data = resp.json()
        message = data["choices"][0]["message"]
        usage = data.get("usage") or {}
        return ChatResponse(
            content=message.get("content", ""),
            tool_calls=list(message.get("tool_calls") or []),
            tokens_used=int(usage.get("total_tokens", 0)),
            raw=data,
        )

    async def list_tools(self) -> dict:
        async with self._client() as client:
            all_resp = await client.get(f"{self.base_url}/tools")
            doc_resp = await client.get(f"{self.base_url}/tools/documented")
            all_resp.raise_for_status()
            doc_resp.raise_for_status()
            return {"all": all_resp.json(), "documented": doc_resp.json()}

    async def call_tool(self, name: str, args: dict, confirmed: bool = False) -> dict:
        async with self._client() as client:
            resp = await client.post(f"{self.base_url}/tools/call",
                                     json={"name": name, "args": args, "confirmed": confirmed})
            resp.raise_for_status()
            return resp.json()


DEMO_BASE_URL = "http://demo.local/v1"


def demo_adapter() -> OpenAICompatibleTarget:
    """Adapter wired to the in-process demo app — no server required."""
    from .app import app

    return OpenAICompatibleTarget(base_url=DEMO_BASE_URL,
                                  transport=httpx.ASGITransport(app=app))
