"""OpenAI-compatible self-hosted STT/TTS connector (Whisper / Piper / Speaches)."""
from __future__ import annotations

import base64
import logging
from typing import Any

import httpx

from fastapi import HTTPException

from ..config import settings
from .voice import (
    SttRequest,
    SttResponse,
    TtsRequest,
    TtsResponse,
    VoiceAdapterKind,
    VoiceGateway,
    validate_audio_input,
)

log = logging.getLogger(__name__)


class OpenAICompatibleVoiceGateway(VoiceGateway):
    """Proxy browser audio to a local OpenAI-compatible speech endpoint."""

    async def transcribe(self, req: SttRequest) -> SttResponse:
        if req.simulate_transcript:
            if settings.operator_auth_mode == "secure":
                raise HTTPException(status_code=403, detail="simulate_transcript not allowed in secure mode")
            t = req.simulate_transcript.strip()
            return SttResponse(transcript=t, confidence=1.0, adapter=VoiceAdapterKind.SIMULATED)

        audio_bytes, mime = validate_audio_input(req.audio_b64, req.mime_type)
        headers: dict[str, str] = {}
        key = settings.operator_voice_api_key.strip()
        if key:
            headers["Authorization"] = f"Bearer {key}"

        files = {"file": ("audio.webm", audio_bytes, mime)}
        data = {"model": settings.operator_voice_model_stt}
        url = settings.operator_voice_stt_url.rstrip("/")

        try:
            async with httpx.AsyncClient(timeout=settings.operator_voice_timeout_s) as client:
                r = await client.post(url, headers=headers, files=files, data=data)
                r.raise_for_status()
                body = r.json()
        except httpx.HTTPError as e:
            log.warning("voice STT upstream error: %s", type(e).__name__)
            return SttResponse(transcript="", confidence=0.0, adapter=VoiceAdapterKind.OPENAI_COMPAT)

        text = str(body.get("text") or "").strip()
        return SttResponse(
            transcript=text,
            confidence=float(body.get("confidence", 0.9 if text else 0.0)),
            adapter=VoiceAdapterKind.OPENAI_COMPAT,
        )

    async def synthesize(self, req: TtsRequest) -> TtsResponse:
        text = req.text.strip()[:2000]
        if not text:
            return TtsResponse(adapter=VoiceAdapterKind.OPENAI_COMPAT, duration_ms=0)

        headers: dict[str, str] = {"Content-Type": "application/json"}
        key = settings.operator_voice_api_key.strip()
        if key:
            headers["Authorization"] = f"Bearer {key}"

        payload: dict[str, Any] = {
            "model": settings.operator_voice_model_tts,
            "input": text,
            "voice": req.voice_id,
            "response_format": "mp3",
        }
        url = settings.operator_voice_tts_url.rstrip("/")

        try:
            async with httpx.AsyncClient(timeout=settings.operator_voice_timeout_s) as client:
                r = await client.post(url, headers=headers, json=payload)
                r.raise_for_status()
                audio = r.content
        except httpx.HTTPError as e:
            log.warning("voice TTS upstream error: %s", type(e).__name__)
            return TtsResponse(
                audio_b64=None,
                viseme_energy=min(1.0, len(text) / 120.0),
                adapter=VoiceAdapterKind.OPENAI_COMPAT,
                duration_ms=max(500, len(text) * 45),
            )

        b64 = base64.b64encode(audio).decode("ascii")
        return TtsResponse(
            audio_b64=b64,
            viseme_energy=min(1.0, len(text) / 120.0),
            adapter=VoiceAdapterKind.OPENAI_COMPAT,
            duration_ms=max(500, len(text) * 45),
            mime_type="audio/mpeg",
        )
