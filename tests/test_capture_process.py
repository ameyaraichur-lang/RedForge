"""Capture/E2E process hygiene — bounded teardown and nonzero failure propagation."""
from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from process_utils import ManagedProcess, spawn_process, wait_http_ok  # noqa: E402


def _port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def test_managed_process_terminates_and_frees_port():
    port = 8765
    if not _port_free(port):
        pytest.skip("port 8765 in use")
    env = {**os.environ, "RF_LLM_PROVIDER": "demo", "RF_OPERATOR_AUTH_MODE": "demo",
           "RF_OPERATOR_DEMO_BOOTSTRAP": "1", "RF_OPERATOR_SESSION_SECRET": "test-capture-process-secret-min24"}
    mp = spawn_process(
        "api",
        [sys.executable, "-m", "uvicorn", "redforge.api.server:app",
         "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"],
        cwd=ROOT,
        env=env,
    )
    try:
        wait_http_ok(f"http://127.0.0.1:{port}/api/health", mp.proc, timeout_s=30)
    finally:
        mp.stop()
    deadline = time.time() + 5
    while time.time() < deadline:
        if _port_free(port):
            return
        time.sleep(0.2)
    pytest.fail("port still bound after managed stop")


def test_capture_script_exits_nonzero_on_missing_evidence(tmp_path, monkeypatch):
    """Sanity failure must propagate nonzero exit (no silent success)."""
    monkeypatch.setenv("RF_LLM_PROVIDER", "demo")
    proc = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "check_visual_sanity.py")],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    if (ROOT / "output" / "visual-fidelity" / "phase-speaking-normal.png").exists():
        pytest.skip("visual evidence present — run after failed capture to assert nonzero")
    assert proc.returncode != 0
