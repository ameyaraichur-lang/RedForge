"""Pluggable self-hosted voice gateway — keys stay server-side."""
from __future__ import annotations

import base64
import hashlib
import re
from abc import ABC, abstractmethod
from enum import Enum

from fastapi import HTTPException
from pydantic import BaseModel, Field

from ..config import settings


class VoiceAdapterKind(str, Enum):
    SIMULATED = "simulated"
    OPENAI_COMPAT = "openai_compat"
    BROWSER_FALLBACK = "browser_fallback"


class SttRequest(BaseModel):
    audio_b64: str | None = None
    mime_type: str | None = None
    simulate_transcript: str | None = None  # test-only; blocked in secure mode


class SttResponse(BaseModel):
    transcript: str
    confidence: float
    adapter: VoiceAdapterKind


class TtsRequest(BaseModel):
    text: str
    voice_id: str = "orchestrator-default"


class TtsResponse(BaseModel):
    audio_b64: str | None = None
    viseme_energy: float = 0.0
    adapter: VoiceAdapterKind
    duration_ms: int = 0
    mime_type: str | None = None


class VoiceGateway(ABC):
    @abstractmethod
    async def transcribe(self, req: SttRequest) -> SttResponse: ...

    @abstractmethod
    async def synthesize(self, req: TtsRequest) -> TtsResponse: ...


def _allowed_mimes() -> set[str]:
    return {m.strip().lower() for m in settings.operator_voice_allowed_mime.split(",") if m.strip()}


def validate_audio_input(audio_b64: str | None, mime_type: str | None) -> tuple[bytes, str]:
    if not audio_b64:
        raise HTTPException(status_code=400, detail="audio_b64 required")
    mime = (mime_type or "audio/webm").lower().split(";")[0].strip()
    if mime not in _allowed_mimes():
        raise HTTPException(status_code=415, detail=f"MIME type not allowed: {mime}")
    try:
        raw = base64.b64decode(audio_b64, validate=True)
    except Exception as e:
        raise HTTPException(status_code=400, detail="Invalid base64 audio") from e
    if len(raw) > settings.operator_voice_max_audio_bytes:
        raise HTTPException(status_code=413, detail="Audio payload too large")
    if len(raw) < 16:
        raise HTTPException(status_code=400, detail="Audio payload too small")
    # Rough duration guard for PCM-less containers: ~32kbps minimum for webm
    est_duration = len(raw) / 4000.0
    if est_duration > settings.operator_voice_max_duration_s * 2:
        raise HTTPException(status_code=413, detail="Audio exceeds duration limit")
    return raw, mime


class SimulatedVoiceGateway(VoiceGateway):
    """Deterministic STT/TTS for tests — NOT production voice."""

    async def transcribe(self, req: SttRequest) -> SttResponse:
        if req.simulate_transcript:
            t = req.simulate_transcript.strip()
        elif req.audio_b64:
            h = hashlib.sha256(req.audio_b64.encode()).hexdigest()
            t = f"simulated transcript {h[:8]}"
        else:
            t = ""
        return SttResponse(
            transcript=t,
            confidence=1.0 if t else 0.0,
            adapter=VoiceAdapterKind.SIMULATED,
        )

    async def synthesize(self, req: TtsRequest) -> TtsResponse:
        energy = min(1.0, len(req.text) / 120.0)
        return TtsResponse(
            audio_b64=None,
            viseme_energy=energy,
            adapter=VoiceAdapterKind.SIMULATED,
            duration_ms=max(500, len(req.text) * 45),
        )


class CompositeVoiceGateway(VoiceGateway):
    """Simulated test injection + openai_compat production path."""

    def __init__(self) -> None:
        self._sim = SimulatedVoiceGateway()

    async def transcribe(self, req: SttRequest) -> SttResponse:
        if req.simulate_transcript and settings.operator_auth_mode == "demo":
            return await self._sim.transcribe(req)
        if settings.operator_voice_mode == "openai_compat":
            from .voice_openai import OpenAICompatibleVoiceGateway

            return await OpenAICompatibleVoiceGateway().transcribe(req)
        if req.audio_b64:
            return await self._sim.transcribe(req)
        return SttResponse(transcript="", confidence=0.0, adapter=VoiceAdapterKind.SIMULATED)

    async def synthesize(self, req: TtsRequest) -> TtsResponse:
        if settings.operator_voice_mode == "openai_compat":
            from .voice_openai import OpenAICompatibleVoiceGateway

            return await OpenAICompatibleVoiceGateway().synthesize(req)
        return await self._sim.synthesize(req)


def get_voice_gateway() -> VoiceGateway:
    return CompositeVoiceGateway()


def redact_transcript_for_log(text: str) -> str:
    """Keep audit/logs free of long verbatim speech content."""
    t = re.sub(r"\s+", " ", text.strip())
    if len(t) <= 48:
        return t
    return t[:45] + "…"
