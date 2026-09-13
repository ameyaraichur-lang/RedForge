"""Managed child processes for capture/E2E — process groups, bounded waits, clean teardown."""
from __future__ import annotations

import os
import signal
import socket
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import httpx


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def _kill_proc_group(proc: subprocess.Popen, grace_s: float = 3.0) -> None:
    if proc.poll() is not None:
        return
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError:
        proc.terminate()
    except PermissionError:
        proc.terminate()
    deadline = time.time() + grace_s
    while time.time() < deadline:
        if proc.poll() is not None:
            return
        time.sleep(0.1)
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except ProcessLookupError:
        proc.kill()
    except PermissionError:
        proc.kill()


@dataclass
class ManagedProcess:
    name: str
    proc: subprocess.Popen
    _stopped: bool = field(default=False, init=False)

    def stop(self) -> None:
        if self._stopped:
            return
        self._stopped = True
        _kill_proc_group(self.proc)
        try:
            self.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            self.proc.wait(timeout=5)


def spawn_process(
    name: str,
    cmd: list[str],
    *,
    cwd: Path | str,
    env: dict[str, str] | None = None,
) -> ManagedProcess:
    proc = subprocess.Popen(
        cmd,
        cwd=str(cwd),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    return ManagedProcess(name=name, proc=proc)


def wait_http_ok(
    url: str,
    proc: subprocess.Popen,
    *,
    timeout_s: float = 120,
    predicate: Callable[[httpx.Response], bool] | None = None,
) -> None:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"{url}: process exited rc={proc.returncode}")
        try:
            r = httpx.get(url, timeout=3)
            if r.status_code == 200 and (predicate is None or predicate(r)):
                return
        except httpx.HTTPError:
            pass
        time.sleep(0.5)
    raise RuntimeError(f"timeout waiting for {url}")


def wait_page_ready(
    url: str,
    proc: subprocess.Popen,
    *,
    timeout_s: float = 120,
    selector: str = "[data-entry-phase]",
) -> None:
    """Wait for Next to serve HTML containing the entry marker (API probe + page fetch)."""
    wait_http_ok(url, proc, timeout_s=timeout_s)
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"{url}: UI process exited rc={proc.returncode}")
        try:
            r = httpx.get(url, timeout=5, follow_redirects=True)
            if r.status_code == 200 and selector.strip("[]") in r.text:
                return
        except httpx.HTTPError:
            pass
        time.sleep(0.5)
    raise RuntimeError(f"timeout: page marker {selector!r} not in HTML from {url}")


def run_with_timeout(fn: Callable[[], int], timeout_s: float) -> int:
    """Run callable in a child; kill on timeout. Returns exit code."""
    import multiprocessing as mp

    ctx = mp.get_context("spawn")
    q: mp.Queue = ctx.Queue()

    def _wrapper() -> None:
        try:
            q.put(fn())
        except Exception as exc:
            q.put(f"ERROR:{exc}")

    p = ctx.Process(target=_wrapper, daemon=True)
    p.start()
    p.join(timeout_s)
    if p.is_alive():
        p.terminate()
        p.join(5)
        if p.is_alive():
            p.kill()
        raise TimeoutError(f"capture exceeded {timeout_s}s global timeout")
    if q.empty():
        raise RuntimeError("capture worker exited without result")
    result = q.get()
    if isinstance(result, str) and result.startswith("ERROR:"):
        raise RuntimeError(result[6:])
    return int(result)
