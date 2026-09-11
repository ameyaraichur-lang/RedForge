"""M6c gate: end-to-end campaign DRIVEN THROUGH THE CONSOLE.
Starts the Live API (:8000) + production Console (:3000), drives a full campaign
from the Mission Control UI, verifies live findings/scorecard/gates screens and
the HUD (JARVIS) layer, and checks the FP-rate gate (<= 10%)."""
import json
import subprocess
import sys
import time
from pathlib import Path

import httpx
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent.parent
CONSOLE = ROOT / "console"
OUT = ROOT / "output" / "console"
API = "http://127.0.0.1:8000"
UI = "http://localhost:3100"  # 3000 is occupied by the threat-modeller reference app


def wait_health(url: str, proc, timeout_s: float = 90, marker: str | None = None) -> None:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"server exited early rc={proc.returncode}")
        try:
            r = httpx.get(url, timeout=2)
            if r.status_code == 200 and (marker is None or marker in r.text):
                return
        except httpx.HTTPError:
            pass
        time.sleep(1)
    raise RuntimeError(f"server not healthy: {url}")


def kill_port(port: int) -> None:
    """Free the port from stale servers left by previously killed runs (Windows)."""
    try:
        out = subprocess.run(["netstat", "-ano"], capture_output=True, text=True,
                             timeout=15).stdout
    except Exception:
        return
    pids: set[str] = set()
    for line in out.splitlines():
        if f":{port}" in line and "LISTEN" in line:
            parts = line.split()
            if parts:
                pids.add(parts[-1])
    for pid in pids:
        subprocess.run(["taskkill", "/F", "/PID", pid],
                       capture_output=True, timeout=15)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    kill_port(8000)
    kill_port(3100)
    api = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "redforge.api.server:app",
         "--host", "127.0.0.1", "--port", "8000", "--log-level", "warning"],
        cwd=ROOT)
    ui = subprocess.Popen(
        ["npm", "run", "start", "--", "-p", "3100"],
        cwd=CONSOLE, shell=True)
    try:
        wait_health(f"{API}/api/health", api)
        wait_health(UI, ui, marker="RedForge")  # never accept the wrong app on a busy port

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            pg = browser.new_page(viewport={"width": 1600, "height": 950})

            # --- connect + start campaign from Mission Control ----------------
            pg.goto(f"{UI}/mission", wait_until="networkidle")
            expect(pg.get_by_role("button", name="start campaign")).to_be_visible(timeout=20000)
            pg.get_by_role("button", name="start campaign").click()
            print("[e2e] campaign started from console", flush=True)

            # live transcript must stream attempts (real SSE evidence, not the DAG label)
            expect(pg.locator("text=payload dispatched").first).to_be_visible(timeout=60000)
            print("[e2e] live attempts streaming over sse", flush=True)

            # wait for campaign completion (topbar chip / status text)
            deadline = time.time() + 300
            done = False
            while time.time() < deadline:
                st = httpx.get(f"{API}/api/campaign/status", timeout=10).json()
                if not st["running"] and st.get("stopped_reason") == "completed":
                    done = True
                    break
                time.sleep(3)
            assert done, f"campaign did not complete: {st}"
            pg.reload(wait_until="networkidle")
            expect(pg.locator("text=campaign complete").first).to_be_visible(timeout=15000)
            print(f"[e2e] campaign complete: {st['attempts']} attempts, "
                  f"{st['findings_confirmed']}/{st['findings_total']} findings, "
                  f"score {st['scorecard']['total']} {st['scorecard']['band']}", flush=True)
            pg.screenshot(path=str(OUT / "live-mission.png"))

            # --- findings screen: live register --------------------------------
            pg.goto(f"{UI}/findings", wait_until="networkidle")
            expect(pg.locator("text=Findings Explorer · LIVE")).to_be_visible(timeout=15000)
            expect(pg.locator("text=RF-F-").first).to_be_visible(timeout=15000)
            pg.screenshot(path=str(OUT / "live-findings.png"))
            print("[e2e] live findings table verified", flush=True)

            # --- scorecard screen: live totals ---------------------------------
            pg.goto(f"{UI}/scorecard", wait_until="networkidle")
            expect(pg.locator("text=Security Scorecard · LIVE")).to_be_visible(timeout=15000)
            expect(pg.locator("text=band ·").first).to_be_visible(timeout=15000)
            pg.screenshot(path=str(OUT / "live-scorecard.png"))
            print("[e2e] live scorecard verified", flush=True)

            # --- gates screen: live gate rows + countersign --------------------
            pg.goto(f"{UI}/gates", wait_until="networkidle")
            expect(pg.locator("text=Gatekeeper Console · LIVE")).to_be_visible(timeout=15000)
            expect(pg.get_by_role("button", name="sign · operator").first).to_be_visible(timeout=15000)
            pg.get_by_role("button", name="sign · operator").first.click()
            pg.get_by_role("button", name="sign · red lead").first.click()
            time.sleep(1.5)
            pg.screenshot(path=str(OUT / "live-gates.png"))
            print("[e2e] live gates verified + countersigned", flush=True)

            # --- HUD (JARVIS) layer ---------------------------------------------
            pg.goto(f"{UI}/mission", wait_until="networkidle")
            pg.get_by_role("button", name="Toggle HUD mode").click()
            expect(pg.locator("text=Swarm Constellation · HUD Mode")).to_be_visible(timeout=15000)
            canvas = pg.locator("canvas")
            expect(canvas.first).to_be_visible(timeout=15000)
            time.sleep(3)  # let the constellation animate + bloom settle
            pg.screenshot(path=str(OUT / "hud-mode.png"))

            # copilot command core opens
            pg.keyboard.press("Control+k")
            expect(pg.locator("text=copilot").first).to_be_visible(timeout=5000)
            pg.keyboard.press("Escape")
            print("[e2e] HUD constellation + copilot verified", flush=True)

            # --- WORLD VIEW (D9) — boot ritual, then the live world ------------
            pg.goto(f"{UI}/world", wait_until="networkidle")
            expect(pg.locator("main[aria-label='RedForge world view']")).to_be_visible(timeout=20000)
            expect(pg.locator("canvas").first).to_be_visible(timeout=20000)
            expect(pg.get_by_text("REDFORGE", exact=True).first).to_be_visible(timeout=10000)
            # boot ritual: molecules assemble → the orchestrator asks readiness
            expect(pg.get_by_role("button", name="Yes, initialize mission")).to_be_visible(timeout=30000)
            time.sleep(1.5)  # let the assembled head shimmer for the screenshot
            pg.screenshot(path=str(OUT / "world-head.png"))
            print("[e2e] orchestrator assembled + readiness prompt shown", flush=True)
            # YES → the swarm is summoned around him
            pg.get_by_role("button", name="Yes, initialize mission").click()
            expect(pg.locator(".world-node-label")).to_have_count(11, timeout=20000)
            expect(pg.locator(".world-glass")).to_be_visible(timeout=20000)
            expect(pg.locator(".world-term-line").first).to_be_visible(timeout=15000)
            expect(pg.locator("svg[role='img'][aria-label='Fleet radar']")).to_be_visible(timeout=10000)
            print("[e2e] constellation summoned: 11 agent worlds + instruments", flush=True)
            time.sleep(3)
            pg.screenshot(path=str(OUT / "world-overview.png"))

            # drive a full campaign from the world's objective banner
            pg.get_by_role("button", name="initialize campaign").click()
            expect(pg.locator(".world-live-badge.world-live-hot")).to_be_visible(timeout=20000)
            print("[e2e] campaign launched from world view", flush=True)
            # the world instruments must stream the live campaign (not just replay)
            expect(pg.locator(".world-term-line", has_text="payload dispatched").first).to_be_visible(timeout=60000)
            print("[e2e] world instruments streaming live campaign", flush=True)
            time.sleep(15)  # mid-campaign richness for the screenshot
            pg.screenshot(path=str(OUT / "world-live.png"))

            # node hologram: fly-to + detail panel (labels animate — dispatch events)
            pg.locator("[data-world-node=N4_judge]").dispatch_event("click")
            expect(pg.locator(".world-holo")).to_be_visible(timeout=15000)
            expect(pg.locator(".world-holo-val").first).to_be_visible(timeout=10000)
            time.sleep(2.5)
            pg.screenshot(path=str(OUT / "world-hologram.png"))
            pg.keyboard.press("Escape")
            # gate hologram (signature bridge surface)
            pg.locator("[data-world-node=G1_gatekeeper]").dispatch_event("click")
            expect(pg.locator(".world-holo")).to_be_visible(timeout=15000)
            time.sleep(1.5)
            pg.screenshot(path=str(OUT / "world-gate.png"))
            pg.keyboard.press("Escape")
            print("[e2e] node + gate holograms verified", flush=True)

            # theme toggle (violet <-> navy)
            pg.get_by_role("button", name="Toggle world theme").click()
            expect(pg.locator("main[data-world-theme='navy']")).to_be_visible(timeout=10000)
            pg.get_by_role("button", name="Toggle world theme").click()
            expect(pg.locator("main[data-world-theme='violet']")).to_be_visible(timeout=10000)
            print("[e2e] world theme toggle verified", flush=True)

            # wait for the world-driven campaign to complete
            deadline = time.time() + 300
            done = False
            while time.time() < deadline:
                st = httpx.get(f"{API}/api/campaign/status", timeout=10).json()
                if not st["running"] and st.get("stopped_reason") == "completed":
                    done = True
                    break
                time.sleep(3)
            assert done, f"world-driven campaign did not complete: {st}"
            expect(pg.locator(".world-live-badge").get_by_text("complete")).to_be_visible(timeout=30000)
            time.sleep(2)
            pg.screenshot(path=str(OUT / "world-complete.png"))
            print(f"[e2e] world campaign complete: {st['attempts']} attempts, "
                  f"score {st['scorecard']['total']} {st['scorecard']['band']}", flush=True)

            # --- FP-rate gate ----------------------------------------------------
            st = httpx.get(f"{API}/api/campaign/status", timeout=10).json()
            fp = (st["findings_voided"] / st["findings_total"]) if st["findings_total"] else 0.0
            packs = set(st["confirmed_packs"])
            print(f"[e2e] FP rate {fp:.3f} (gate <= 0.10) · packs confirmed: {sorted(packs)}", flush=True)
            assert fp <= 0.10, f"FP rate {fp} exceeds gate"
            assert packs == {"PIN", "EXF", "OUT", "AGE", "MEM", "CON", "HAL", "SUP"}, packs

            # report artifacts exist
            rep = httpx.get(f"{API}/api/report", timeout=30).json()
            assert rep["ready"] and rep["pdf_bytes"] > 1000, "report/dossier not generated"

            browser.close()
            summary = {"attempts": st["attempts"], "findings": st["findings_total"],
                       "confirmed": st["findings_confirmed"], "fp_rate": round(fp, 4),
                       "packs": sorted(packs), "score": st["scorecard"]["total"],
                       "band": st["scorecard"]["band"], "pdf_bytes": rep["pdf_bytes"]}
            (OUT / "e2e_console_summary.json").write_text(json.dumps(summary, indent=2))
            print("[e2e] PASS", json.dumps(summary), flush=True)
            return 0
    finally:
        for proc in (ui, api):
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()


if __name__ == "__main__":
    sys.exit(main())
