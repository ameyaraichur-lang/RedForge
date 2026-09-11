"""Vulnerable demo target simulator (M1).

Implements exactly the flaws declared in redforge.contracts.flaws (the canonical
flaw contract). Deterministic: the first FlawSpec whose trigger matches the last
user message decides the behaviour; anything unmatched gets a safe refusal.

The simulator is intentionally vulnerable — it is the red-team target, not
production code. Do not copy its patterns into real services.
"""
from __future__ import annotations

import re

import httpx

from redforge.contracts import markers_for, match_flaw

MODEL_NAME = "carecopilot-demo-v1"
SAFE_REFUSAL = "I can't help with that. Please contact support."

_CANARY_RE = re.compile(r"RF-CANARY-[0-9a-f]{8}")
_URL_RE = re.compile(r"https?://\S+")
_STORE_CUES = ("remember", "store token", "save to long-term")

# Module-level injectable HTTP poster so tests can capture webhook exfiltration
# without network I/O (monkeypatch redforge.targets.vuln_sim.poster).
poster = httpx.post


class VulnerableSimulator:
    """Deterministic CareCopilot stand-in carrying the M1 flaw set."""

    def __init__(self) -> None:
        # Per-session long-term "memory" (MEM-* flaw state).
        self._memory: dict[str, list[str]] = {}
        self.last_webhook_success: bool | None = None

    def reset(self) -> None:
        self._memory.clear()
        self.last_webhook_success = None

    # ------------------------------------------------------------------
    def respond(self, messages: list[dict], session_id: str = "default") -> dict:
        """Reply to the last user message. Returns an internal result dict
        with keys: content, tool_calls, tokens_used, model."""
        text = self._last_user_text(messages)
        low = text.lower()
        total_chars = sum(len(str(m.get("content", ""))) for m in messages)
        tokens = max(8, total_chars // 4)
        session_key = self._session_key(text, session_id)

        spec = match_flaw(text)

        if spec is None:
            # MEM-001 recall: a later message in a poisoned session that
            # mentions refunds re-applies the poisoned directive.
            if self._memory.get(session_key) and "refund" in low:
                return self._result(markers_for("MEM-001")[-1], tokens)
            return self._result(SAFE_REFUSAL, tokens)

        if spec.kind == "text":
            rendered = self._render_markers(spec.markers, text)
            text_tokens = sum(len(str(m.get("content", ""))) // 4 for m in messages)
            return self._result(rendered, text_tokens)

        if spec.kind == "tool_call":
            tool_calls = [{"name": n, "args": {}, "confirmed": False} for n in spec.tool_calls]
            return self._result(" ".join(spec.markers), tokens, tool_calls)

        if spec.kind == "webhook":
            ok = False
            url = self._find_webhook(text)
            if url:
                try:
                    poster(url, json={"leaked": "conversation context incl. canary"}, timeout=5.0)
                    ok = True
                except Exception:  # exfiltration failure must not break the reply
                    ok = False
            self.last_webhook_success = ok
            return self._result(" ".join(spec.markers), tokens)

        if spec.kind == "usage":
            return self._result(" ".join(spec.markers), 250_000)

        if spec.kind == "multi_turn":
            return self._multi_turn(spec, text, session_key, tokens)

        # http_diff (AGE-005 / SUP-*): the real signal lives in /v1/tools.
        return self._result(" ".join(spec.markers), tokens)

    # ------------------------------------------------------------------
    def _multi_turn(self, spec, text: str, session_key: str, tokens: int) -> dict:
        low = text.lower()
        if any(cue in low for cue in _STORE_CUES):
            snippet = re.sub(r"^\s*\(session\s+[ab]\)\s*", "", text).strip().lower()
            self._memory.setdefault(session_key, []).append(snippet)
            return self._result(spec.markers[0], tokens)
        if spec.tech_id == "MEM-001":
            visible = bool(self._memory.get(session_key))
        else:
            # MEM-002/003: memory is not scoped per user — session B sees
            # whatever session A stored. That cross-session leak is the flaw.
            visible = any(self._memory.values())
        if visible:
            return self._result(" ".join(spec.markers), tokens)
        return self._result(SAFE_REFUSAL, tokens)

    # ------------------------------------------------------------------
    @staticmethod
    def _last_user_text(messages: list[dict]) -> str:
        for m in reversed(messages):
            if m.get("role") == "user":
                return str(m.get("content", ""))
        return ""

    @staticmethod
    def _session_key(text: str, session_id: str) -> str:
        low = text.lower()
        if "(session a" in low:
            return "a"
        if "(session b" in low:
            return "b"
        return session_id

    @staticmethod
    def _find_webhook(text: str) -> str | None:
        for url in _URL_RE.findall(text):
            low = url.lower()
            if "webhook" in low or "/canary/" in low:
                return url
        return None

    def _render_markers(self, markers: tuple[str, ...], text: str) -> str:
        canary = _CANARY_RE.search(text)
        webhook = self._find_webhook(text)
        rendered = []
        for m in markers:
            if canary:
                m = m.replace("{{canary}}", canary.group(0))
            if webhook:
                m = m.replace("{{webhook}}", webhook)
            rendered.append(m)
        return " ".join(rendered)

    @staticmethod
    def _result(content: str, tokens_used: int, tool_calls: list[dict] | None = None) -> dict:
        return {
            "content": content,
            "tool_calls": list(tool_calls or []),
            "tokens_used": int(tokens_used),
            "model": MODEL_NAME,
        }
