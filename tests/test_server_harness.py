"""Uvicorn test harness — fast failure and bounded child stderr propagation."""
from __future__ import annotations

import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _server import allocate_port, uvicorn_server, wait_for_health  # noqa: E402


def test_wait_for_health_fails_fast_on_child_exit():
    proc = subprocess.Popen(
        [sys.executable, "-c", "import sys; sys.exit(42)"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        with pytest.raises(RuntimeError, match="exited rc=42"):
            wait_for_health("http://127.0.0.1:1", proc, timeout_s=2)
    finally:
        proc.wait(timeout=5)


def test_uvicorn_server_surfaces_bind_failure():
    port = allocate_port()
    holder = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    holder.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    holder.bind(("127.0.0.1", port))
    holder.listen(1)
    try:
        t0 = time.time()
        with pytest.raises(RuntimeError, match="startup failed|exited rc=") as exc:
            with uvicorn_server(port=port, startup_timeout_s=5):
                pass
        elapsed = time.time() - t0
        assert elapsed < 8, f"bind failure waited {elapsed:.1f}s (must stay well under 30s startup timeout)"
        # POSIX: errno 48 / "address already in use"; Windows: errno 10048
        err = str(exc.value).lower()
        assert (
            "address already in use" in err
            or "errno 48" in err
            or "10048" in err
            or "only one usage of each socket address" in err
        )
    finally:
        holder.close()


def test_uvicorn_server_starts_demo_api():
    port = allocate_port()
    with uvicorn_server(port=port) as base:
        import httpx

        r = httpx.get(f"{base}/api/health", timeout=5)
        assert r.status_code == 200


def test_uvicorn_server_surfaces_secure_env_misconfig_fast():
    """Inherited secure .env without keys must fail fast with child stderr, not hang 30s."""
    port = allocate_port()
    t0 = time.time()
    with pytest.raises(RuntimeError, match="startup failed|exited rc=") as exc:
        with uvicorn_server(
            port=port,
            env={
                "RF_OPERATOR_AUTH_MODE": "secure",
                "RF_OPERATOR_SESSION_SECRET": "short",
                "RF_OPERATOR_AUDIT_SIGNING_KEY": "",
            },
            startup_timeout_s=5,
        ):
            pass
    elapsed = time.time() - t0
    assert elapsed < 8, f"secure misconfig waited {elapsed:.1f}s (must stay well under 30s startup timeout)"
    msg = str(exc.value).lower()
    assert (
        "audit_signing_key" in msg
        or "session_secret" in msg
        or "runtimeerror" in msg
        or "application startup failed" in msg
    )
