"""Voice gateway contract tests against a local fake OpenAI-compatible provider."""
from __future__ import annotations

import json
import os
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import httpx
import pytest

import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from redforge.operator.voice import SttRequest, VoiceAdapterKind  # noqa: E402
from redforge.operator.voice_openai import OpenAICompatibleVoiceGateway  # noqa: E402


class _FakeVoiceHandler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args) -> None:  # noqa: A003
        return

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", 0))
        _ = self.rfile.read(length)
        if self.path.endswith("/transcriptions"):
            body = json.dumps({"text": "report status"}).encode()
        else:
            body = b"\xff\xfb" + b"\x00" * 64  # fake mp3-ish bytes
        self.send_response(200)
        self.send_header("Content-Type", "application/json" if "transcriptions" in self.path else "audio/mpeg")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


@pytest.fixture
def fake_voice_server():
    srv = HTTPServer(("127.0.0.1", 0), _FakeVoiceHandler)
    port = srv.server_address[1]
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    base = f"http://127.0.0.1:{port}"
    yield base
    srv.shutdown()


@pytest.mark.asyncio
async def test_openai_compat_stt_contract(fake_voice_server, monkeypatch):
    monkeypatch.setenv("RF_OPERATOR_VOICE_MODE", "openai_compat")
    monkeypatch.setenv("RF_OPERATOR_VOICE_STT_URL", f"{fake_voice_server}/v1/audio/transcriptions")
    monkeypatch.setenv("RF_OPERATOR_VOICE_TTS_URL", f"{fake_voice_server}/v1/audio/speech")
    monkeypatch.setenv("RF_OPERATOR_AUTH_MODE", "demo")

    from redforge.config import settings

    settings.operator_voice_mode = "openai_compat"
    settings.operator_voice_stt_url = f"{fake_voice_server}/v1/audio/transcriptions"
    settings.operator_voice_tts_url = f"{fake_voice_server}/v1/audio/speech"

    import base64

    gw = OpenAICompatibleVoiceGateway()
    audio = base64.b64encode(b"\x00" * 128).decode()
    resp = await gw.transcribe(SttRequest(audio_b64=audio, mime_type="audio/webm"))
    assert resp.adapter == VoiceAdapterKind.OPENAI_COMPAT
    assert "status" in resp.transcript.lower()


@pytest.mark.asyncio
async def test_openai_compat_tts_returns_audio(fake_voice_server, monkeypatch):
    from redforge.config import settings

    settings.operator_voice_mode = "openai_compat"
    settings.operator_voice_stt_url = f"{fake_voice_server}/v1/audio/transcriptions"
    settings.operator_voice_tts_url = f"{fake_voice_server}/v1/audio/speech"

    gw = OpenAICompatibleVoiceGateway()
    from redforge.operator.voice import TtsRequest

    resp = await gw.synthesize(TtsRequest(text="hello operator"))
    assert resp.audio_b64 is not None
    assert resp.adapter == VoiceAdapterKind.OPENAI_COMPAT


def test_audio_validation_rejects_oversize():
    from redforge.config import settings
    from redforge.operator.voice import validate_audio_input
    from fastapi import HTTPException
    import base64

    settings.operator_voice_max_audio_bytes = 100
    big = base64.b64encode(b"x" * 200).decode()
    with pytest.raises(HTTPException) as exc:
        validate_audio_input(big, "audio/webm")
    assert exc.value.status_code == 413
