"""M6c gate: Orchestrator-first console E2E.

Starts Live API + production Console on dynamic free ports, drives a full
campaign from the Orchestrator (/) via operator text + confirmation, validates
live SSE evidence, ops drill-down screens, text-only fallback, and FP gate."""
from __future__ import annotations

import json
import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from redforge.gates.demo_env import apply_gate_demo_env, gate_demo_env

apply_gate_demo_env()

import httpx
from playwright.sync_api import expect, sync_playwright

OUT = ROOT / "output" / "console"


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def wait_health(url: str, proc: subprocess.Popen, timeout_s: float = 120, marker: str | None = None) -> None:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"server exited early rc={proc.returncode}")
        try:
            response = httpx.get(url, timeout=2)
            if response.status_code == 200 and (marker is None or marker in response.text):
                return
        except httpx.HTTPError:
            pass
        time.sleep(0.5)
    raise RuntimeError(f"server not healthy: {url}")


def terminate(proc: subprocess.Popen | None) -> None:
    if proc is None or proc.poll() is not None:
        return
    proc.send_signal(signal.SIGTERM)
    try:
        proc.wait(timeout=12)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)


def wait_campaign(api_base: str, timeout_s: float = 360) -> dict:
    deadline = time.time() + timeout_s
    last: dict = {}
    while time.time() < deadline:
        last = httpx.get(f"{api_base}/api/campaign/status", timeout=10).json()
        if not last.get("running") and last.get("stopped_reason") == "completed":
            return last
        time.sleep(2)
    raise AssertionError(f"campaign did not complete: {last}")


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    api_port = free_port()
    ui_port = free_port()
    api_base = f"http://127.0.0.1:{api_port}"
    ui_base = f"http://127.0.0.1:{ui_port}"

    env = dict(gate_demo_env())
    env["RF_API_BASE"] = api_base
    env["NEXT_PUBLIC_API_BASE"] = api_base

    api = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "redforge.api.server:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(api_port),
            "--log-level",
            "warning",
        ],
        cwd=ROOT,
        env=env,
    )
    ui = subprocess.Popen(
        ["npm", "run", "start", "--", "-p", str(ui_port), "-H", "127.0.0.1"],
        cwd=ROOT / "console",
        env=env,
        shell=sys.platform == "win32",
    )

    browser_errors: list[str] = []
    http_failures: list[str] = []
    essential_api_paths = (
        "/api/operator/plan",
        "/api/operator/audit",
        "/api/operator/intent",
        "/api/operator/action",
        "/api/operator/bootstrap",
        "/api/campaign/",
        "/api/events/",
        "/api/report",
        "/api/findings",
        "/api/gates",
    )

    try:
        wait_health(f"{api_base}/api/health", api)
        wait_health(ui_base, ui, marker="RedForge")

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            context = browser.new_context(viewport={"width": 1600, "height": 950})
            page = context.new_page()

            def _on_console(msg) -> None:
                if msg.type == "error" and "favicon" not in msg.text.lower():
                    browser_errors.append(f"console: {msg.text}")

            def _on_page_error(exc) -> None:
                browser_errors.append(f"pageerror: {exc}")

            def _on_response(response) -> None:
                url = response.url
                if response.request.resource_type not in {"fetch", "xhr", "eventsource"}:
                    return
                if not any(path in url for path in essential_api_paths):
                    return
                if response.status >= 400:
                    http_failures.append(f"{response.status} {url}")

            page.on("console", _on_console)
            page.on("pageerror", _on_page_error)
            page.on("response", _on_response)

            # --- Orchestrator entry (boot=skip skips animation; enter unlocks MC) ---
            page.goto(f"{ui_base}/?boot=skip", wait_until="networkidle")
            expect(page.locator("main[aria-label='RedForge world view']")).to_be_visible(timeout=30000)
            page.get_by_test_id("enter-mission-control").click()
            expect(page.locator("[data-entry-phase='mission_control']")).to_be_visible(timeout=30000)
            expect(page.get_by_label("Operator command dock")).to_be_visible(timeout=20000)
            expect(page.locator("[data-operator-auth='authenticated']")).to_be_visible(timeout=20000)
            expect(page.get_by_text("demo auth")).to_be_visible(timeout=20000)
            print("[e2e] orchestrator world view online (auth ready)", flush=True)

            # --- operator text: status (no confirmation) ---------------------
            status_input = page.get_by_label("Operator text command")
            status_input.fill("status")
            page.get_by_label("Send command").click()
            expect(page.get_by_test_id("operator-phase")).to_be_visible(timeout=10000)
            page.screenshot(path=str(OUT / "operator-dock.png"))
            print("[e2e] operator status command accepted", flush=True)

            # --- operator text: start campaign + confirmation ----------------
            status_input.fill("start campaign")
            page.get_by_label("Send command").click()
            confirm = page.get_by_role("alertdialog", name="Confirm action")
            expect(confirm).to_be_visible(timeout=15000)
            expect(confirm).to_contain_text("Start bounded campaign")
            page.get_by_role("button", name="confirm").click()
            print("[e2e] campaign confirmed via operator dock", flush=True)

            expect(page.locator(".world-term-line", has_text="payload dispatched").first).to_be_visible(
                timeout=90000,
            )
            print("[e2e] live SSE attempts streaming", flush=True)
            page.screenshot(path=str(OUT / "orchestrator-live.png"))

            st = wait_campaign(api_base)
            expect(page.locator(".world-live-badge").get_by_text("complete")).to_be_visible(timeout=30000)
            print(
                f"[e2e] campaign complete: {st['attempts']} attempts, "
                f"{st['findings_confirmed']}/{st['findings_total']} findings, "
                f"score {st['scorecard']['total']} {st['scorecard']['band']}",
                flush=True,
            )

            # --- ops drill-down: findings / gates ----------------------------
            page.goto(f"{ui_base}/findings", wait_until="networkidle")
            expect(page.locator("text=Findings Explorer · LIVE")).to_be_visible(timeout=20000)
            expect(page.locator("text=RF-F-").first).to_be_visible(timeout=20000)
            page.screenshot(path=str(OUT / "live-findings.png"))
            print("[e2e] live findings verified", flush=True)

            page.goto(f"{ui_base}/gates", wait_until="networkidle")
            expect(page.locator("text=Gatekeeper Console · LIVE")).to_be_visible(timeout=20000)
            expect(page.get_by_role("button", name="sign · operator").first).to_be_visible(timeout=15000)
            page.get_by_role("button", name="sign · operator").first.click()
            page.get_by_role("button", name="sign · red lead").first.click()
            time.sleep(1)
            page.screenshot(path=str(OUT / "live-gates.png"))
            print("[e2e] live gates verified + countersigned", flush=True)

            # --- text-only fallback (no WebGL) -------------------------------
            page.goto(f"{ui_base}/?nowebgl=1&boot=fast", wait_until="networkidle")
            expect(page.locator("main[aria-label='RedForge mission control text mode']")).to_be_visible(timeout=15000)
            page.get_by_test_id("enter-mission-control").click()
            expect(page.locator("[data-entry-phase='mission_control']")).to_be_visible(timeout=30000)
            expect(page.get_by_label("Operator command dock")).to_be_visible(timeout=10000)
            expect(page.get_by_role("link", name="continue in ops mode")).to_be_visible(timeout=5000)
            page.screenshot(path=str(OUT / "fallback-text.png"))
            print("[e2e] text-only fallback verified", flush=True)

            # --- FP-rate gate + dossier --------------------------------------
            fp = (st["findings_voided"] / st["findings_total"]) if st["findings_total"] else 0.0
            packs = set(st["confirmed_packs"])
            print(f"[e2e] FP rate {fp:.3f} (gate <= 0.10) · packs confirmed: {sorted(packs)}", flush=True)
            assert fp <= 0.10, f"FP rate {fp} exceeds gate"
            assert packs == {"PIN", "EXF", "OUT", "AGE", "MEM", "CON", "HAL", "SUP"}, packs

            rep = httpx.get(f"{api_base}/api/report", timeout=30).json()
            assert rep["ready"] and rep["pdf_bytes"] > 1000, "report/dossier not generated"

            assert not http_failures, f"essential HTTP failures: {http_failures[:8]}"
            assert not browser_errors, f"browser console errors: {browser_errors[:5]}"

            browser.close()

            summary = {
                "attempts": st["attempts"],
                "findings": st["findings_total"],
                "confirmed": st["findings_confirmed"],
                "fp_rate": round(fp, 4),
                "packs": sorted(packs),
                "score": st["scorecard"]["total"],
                "band": st["scorecard"]["band"],
                "pdf_bytes": rep["pdf_bytes"],
                "api_port": api_port,
                "ui_port": ui_port,
            }
            (OUT / "e2e_console_summary.json").write_text(json.dumps(summary, indent=2))
            print("[e2e] PASS", json.dumps(summary), flush=True)
            return 0
    finally:
        terminate(ui)
        terminate(api)


if __name__ == "__main__":
    sys.exit(main())
