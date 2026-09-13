"""Shared helpers for real-uvicorn integration tests (dynamic ports, no collisions)."""
from __future__ import annotations

import os
import socket
import subprocess
import sys
import tempfile
import time
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent

# Reuse process-group teardown from capture/E2E helpers.
_SCRIPTS = ROOT / "scripts"
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))
from process_utils import _kill_proc_group  # noqa: E402

_STDERR_TAIL_BYTES = 8192
_LOG_FAIL_MARKERS = (
    b"error while attempting to bind",
    b"application startup failed",
    b"runtimeerror:",
    b"modulenotfounderror:",
    b"importerror:",
)


def allocate_port(host: str = "127.0.0.1") -> int:
    """Bind to port 0 and return the OS-assigned ephemeral port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((host, 0))
        return int(sock.getsockname()[1])


def subprocess_demo_env(overrides: Mapping[str, str] | None = None) -> dict[str, str]:
    """Offline demo baseline for uvicorn subprocesses (overrides local .env)."""
    from redforge.gates.demo_env import gate_demo_env

    env = dict(gate_demo_env())
    if overrides:
        env.update({k: str(v) for k, v in overrides.items()})
    return env


def _log_bytes(log_path: Path | None) -> bytes:
    if log_path is None or not log_path.is_file():
        return b""
    data = log_path.read_bytes()
    if len(data) > _STDERR_TAIL_BYTES:
        data = data[-_STDERR_TAIL_BYTES:]
    return data


def _stderr_tail(log_path: Path | None) -> str:
    text = _log_bytes(log_path).decode("utf-8", errors="replace").strip()
    if not text:
        return ""
    return f"\n--- server log (tail) ---\n{text}"


def _log_indicates_startup_failure(log_path: Path | None) -> bool:
    blob = _log_bytes(log_path).lower()
    if not blob:
        return False
    if b"uvicorn running on http" in blob:
        return False
    return any(marker in blob for marker in _LOG_FAIL_MARKERS)


def wait_for_health(
    base_url: str,
    proc: subprocess.Popen[bytes],
    *,
    log_path: Path | None = None,
    timeout_s: float = 30,
    interval_s: float = 0.25,
) -> None:
    """Poll /api/health; fail fast when the child exits or the deadline passes."""
    deadline = time.time() + timeout_s
    health_url = f"{base_url.rstrip('/')}/api/health"
    fail_fast_after: float | None = None
    while time.time() < deadline:
        rc = proc.poll()
        if rc is not None:
            raise RuntimeError(
                f"api server exited rc={rc} before {health_url}{_stderr_tail(log_path)}"
            )
        if _log_indicates_startup_failure(log_path):
            if fail_fast_after is None:
                fail_fast_after = time.time() + 1.0
            elif time.time() >= fail_fast_after:
                rc = proc.poll()
                suffix = f" (exited rc={rc})" if rc is not None else " (still running)"
                raise RuntimeError(
                    f"api server startup failed before {health_url}{suffix}{_stderr_tail(log_path)}"
                )
        try:
            if httpx.get(health_url, timeout=2).status_code == 200:
                return
        except httpx.HTTPError:
            pass
        time.sleep(interval_s)
    rc = proc.poll()
    suffix = " (still running)" if rc is None else f" (exited rc={rc})"
    raise RuntimeError(
        f"api server did not become healthy at {health_url}{suffix}{_stderr_tail(log_path)}"
    )


@contextmanager
def uvicorn_server(
    *,
    port: int | None = None,
    host: str = "127.0.0.1",
    env: dict[str, str] | None = None,
    log_level: str = "warning",
    startup_timeout_s: float = 30,
) -> Iterator[str]:
    """Start uvicorn on an ephemeral (or explicit) port; yield base URL; tear down."""
    chosen = port if port is not None else allocate_port(host)
    base = f"http://{host}:{chosen}"
    overrides = env or {}
    with tempfile.TemporaryDirectory(prefix="rf-opdb-") as opdb_dir:
        proc_env = subprocess_demo_env(overrides)
        if "RF_OPERATOR_DB" not in overrides:
            proc_env["RF_OPERATOR_DB"] = str(Path(opdb_dir) / "operator.db")
        log_file = tempfile.NamedTemporaryFile(prefix="rf-uvicorn-", suffix=".log", delete=False)
        log_path = Path(log_file.name)
        log_file.close()
        log_handle = log_path.open("ab")
        proc = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "redforge.api.server:app",
             "--host", host, "--port", str(chosen), "--log-level", log_level],
            cwd=str(ROOT),
            env=proc_env,
            stdout=log_handle,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        log_handle.close()
        try:
            wait_for_health(base, proc, log_path=log_path, timeout_s=startup_timeout_s)
            yield base
        finally:
            _kill_proc_group(proc)
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=5)
            log_path.unlink(missing_ok=True)
