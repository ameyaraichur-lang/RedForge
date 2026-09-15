"""The contract a campaign target must satisfy.

Mirrors ``redforge.judge.llm_judge.LLMJudge``: the swarm depends on this
Protocol, never on a concrete class, so a new target type is a new
implementation plus a registry entry rather than an edit to the engine.

``call_chat`` is the only method every technique needs. ``list_tools`` and
``call_tool`` back the tool-oriented packs (AGE, SUP); an adapter for a target
with no tool surface should raise ``TargetCapabilityError`` from them rather
than return something invented, so recon records "not supported" instead of a
false negative.
"""
from __future__ import annotations

from typing import Protocol, runtime_checkable

from .adapter import ChatResponse


class TargetCapabilityError(RuntimeError):
    """Raised when a target cannot service a capability a pack requires."""


@runtime_checkable
class TargetAdapter(Protocol):
    """Structural contract for anything a campaign can attack."""

    #: Identifies the endpoint in health output and evidence; never a secret.
    base_url: str

    async def call_chat(self, messages: list[dict],
                        session_id: str | None = None) -> ChatResponse: ...

    async def list_tools(self) -> dict: ...

    async def call_tool(self, name: str, args: dict,
                        confirmed: bool = False) -> dict: ...
