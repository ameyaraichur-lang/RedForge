"""Browser E2E: Orchestrator entry, text/voice paths, confirmation, audit, fallbacks."""
from __future__ import annotations

import json
import os

HAS_PROCESS_GROUPS = hasattr(os, "killpg")  # POSIX only; Windows has no pgids
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
CONSOLE = ROOT / "console"
OUT = ROOT / "output" / "operator-e2e"
OUT.mkdir(parents=True, exist_ok=True)

sys.path.insert(0, str(ROOT / "scripts"))
from process_utils import _kill_proc_group  # noqa: E402


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def wait_health(url: str, proc: subprocess.Popen, timeout_s: float = 120) -> None:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"process exited rc={proc.returncode} before {url}")
        try:
            r = httpx.get(url, timeout=3)
            if r.status_code == 200:
                return
        except httpx.HTTPError:
            pass
        time.sleep(1)
    raise RuntimeError(f"timeout waiting for {url}")


def _operator_last_result_text(page) -> str:
    loc = page.locator('[data-testid="operator-last-result"]')
    if loc.count() == 0:
        return ""
    return loc.inner_text().strip()


def wait_operator_report_status(page, *, submit: bool = True, timeout_ms: int = 30000) -> None:
    """Wait for report status — success phase is ephemeral (~2.2s) so also accept fresh result text."""
    prev = _operator_last_result_text(page)
    if submit:
        cmd = page.get_by_label("Operator text command")
        cmd.fill("report status")
        send = page.get_by_label("Send command")
        if send.count() > 0 and send.is_enabled():
            send.click()
        else:
            cmd.press("Enter")
    page.wait_for_function(
        """({ prev }) => {
          const phase = document.querySelector('[data-operator-phase]')?.getAttribute('data-operator-phase') || '';
          if (phase === 'success') return true;
          const tx = document.querySelector('[data-testid="operator-last-result"]')?.textContent?.trim() || '';
          if (tx && tx !== prev && /attempts|findings|campaign|running|standby/i.test(tx)) return true;
          const transcript = document.querySelector('[aria-label="Operator transcript"]')?.textContent || '';
          return /attempts|findings|Campaign/i.test(transcript) && phase !== 'error';
        }""",
        arg={"prev": prev},
        timeout=timeout_ms,
    )
    transcript = page.locator('[aria-label="Operator transcript"]').inner_text()
    assert any(k in transcript for k in ("attempts", "findings", "Campaign")), (
        f"report status transcript missing status tokens: {transcript[:400]}"
    )


def _dump_operator_state(page, label: str) -> str:
    phase = page.locator('[aria-label="Operator command dock"]').get_attribute("data-operator-phase")
    auth = page.locator('[aria-label="Operator command dock"]').get_attribute("data-operator-auth")
    entry = page.locator("main[data-entry-phase]").first.get_attribute("data-entry-phase")
    tx = page.locator('[aria-label="Operator transcript"]').inner_text() if page.locator('[aria-label="Operator transcript"]').count() else ""
    msg = f"{label}: entry={entry} auth={auth} phase={phase} transcript_tail={tx[-240:]!r}"
    print(msg, flush=True)
    return msg


def main() -> int:
    api_port = _free_port()
    ui_port = _free_port()
    api = f"http://127.0.0.1:{api_port}"
    ui = f"http://127.0.0.1:{ui_port}"
    e2e_db = tempfile.mkdtemp(prefix="rf-operator-e2e-")

    env = {
        **os.environ,
        "RF_LLM_PROVIDER": "demo",
        "RF_ASTRA_API_KEY": "",
        "RF_OPERATOR_AUTH_MODE": "demo",
        "RF_OPERATOR_DEMO_BOOTSTRAP": "1",
        "RF_OPERATOR_SESSION_SECRET": "e2e-test-secret-key",
        "RF_OPERATOR_DB": str(Path(e2e_db) / "operator.db"),
    }

    build_marker = CONSOLE / ".next" / "BUILD_ID"
    if not build_marker.exists() or os.environ.get("RF_E2E_FORCE_BUILD") == "1":
        print("e2e: building console…", flush=True)
        build = subprocess.run(
            ["npm", "run", "build"],
            cwd=CONSOLE,
            env={**env, "RF_API_BASE": api, "NEXT_PUBLIC_API_BASE": api},
            capture_output=True,
            text=True,
        )
        if build.returncode != 0:
            print(build.stdout[-4000:])
            print(build.stderr[-4000:])
            raise RuntimeError("console build failed before e2e")
    else:
        print(f"e2e: reusing console build ({build_marker.read_text().strip()})", flush=True)

    api_proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "redforge.api.server:app",
         "--host", "127.0.0.1", "--port", str(api_port), "--log-level", "warning"],
        cwd=ROOT,
        env=env,
        **({"start_new_session": True} if HAS_PROCESS_GROUPS else {}),
    )
    ui_proc = subprocess.Popen(
        ["npm", "run", "start", "--", "-p", str(ui_port)],
        cwd=CONSOLE,
        env={**env, "RF_API_BASE": api, "NEXT_PUBLIC_API_BASE": api, "HOSTNAME": "127.0.0.1"},
        **({"start_new_session": True} if HAS_PROCESS_GROUPS else {}),
    )
    errors: list[str] = []
    screenshots: list[str] = []

    try:
        wait_health(f"{api}/api/health", api_proc)
        assert httpx.get(f"{api}/api/health").json().get("ok") is True
        wait_health(ui, ui_proc)

        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            ctx = browser.new_context(viewport={"width": 1600, "height": 950})
            page = ctx.new_page()
            console_errors: list[str] = []
            failed_reqs: list[str] = []
            page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
            page.on("requestfailed", lambda r: failed_reqs.append(r.url))

            # 0) Manifest parity — all backend agents render as planets
            import httpx as hx
            manifest = hx.get(f"{api}/api/world/manifest").json()
            assert manifest["agent_count"] == 9
            assert manifest["gate_count"] == 2
            assert len(manifest["nodes"]) == 11
            assert len(manifest["edges"]) == 15

            # 1) Primary Orchestrator entry — boot=skip skips animation, not auth; enter for live MC
            page.goto(f"{ui}/?boot=skip", wait_until="networkidle", timeout=90000)
            page.wait_for_selector('[data-testid="enter-mission-control"]', timeout=60000)
            page.get_by_test_id("enter-mission-control").click()
            page.wait_for_selector('[data-entry-phase="mission_control"]', timeout=30000)
            page.wait_for_timeout(2500)
            rendered = page.locator("[data-world-node]").count()
            assert rendered == len(manifest["nodes"]), f"nodes {rendered} != manifest {len(manifest['nodes'])}"
            for node in manifest["nodes"]:
                assert page.locator(f'[data-world-node="{node["id"]}"]').count() == 1
            assert page.locator('[data-testid="operator-entry-locked"]').count() == 0
            shot = OUT / "01-orchestrator-entry.png"
            page.screenshot(path=str(shot), full_page=True)
            screenshots.append(str(shot))
            assert page.locator('[aria-label="RedForge world view"]').count() > 0

            dock = page.get_by_label("Operator command dock")
            dock.wait_for(timeout=30000)

            # 2) Text status command
            page.wait_for_function(
                """() => fetch('/api/operator/session', { credentials: 'include' })
                  .then(r => r.json()).then(j => j.authenticated === true)""",
                timeout=45000,
            )
            cmd = page.get_by_label("Operator command dock").get_by_label("Operator text command")
            cmd.fill("report status")
            cmd.press("Enter")
            page.wait_for_selector('[data-operator-phase="success"], [data-operator-phase="idle"]', timeout=30000)
            assert "authentication not configured" not in page.content().lower()
            shot = OUT / "02-text-status.png"
            page.screenshot(path=str(shot))
            screenshots.append(str(shot))

            # 3) Simulated voice path via API + UI transcript
            c = httpx.Client(base_url=api)
            c.post("/api/operator/bootstrap")
            stt = c.post("/api/operator/voice/stt", json={"simulate_transcript": "report status"})
            assert stt.json()["adapter"] == "simulated"
            cmd = page.get_by_label("Operator command dock").get_by_label("Operator text command")
            cmd.fill(stt.json()["transcript"])
            cmd.press("Enter")
            page.wait_for_timeout(1500)

            # 4) Campaign confirmation
            cmd.fill("start campaign")
            cmd.press("Enter")
            page.wait_for_timeout(1500)
            confirm = page.get_by_role("alertdialog", name="Confirm action")
            if confirm.count():
                page.get_by_role("button", name="confirm").click()
                page.wait_for_timeout(2000)
            shot = OUT / "03-campaign-confirm.png"
            page.screenshot(path=str(shot))
            screenshots.append(str(shot))

            audit = c.get("/api/operator/audit?limit=10").json()
            assert any(a["decision"] == "executed" for a in audit)

            # 5) Keyboard focus
            page.keyboard.press("Control+/")
            page.wait_for_timeout(300)

            # 6) No-WebGL — entry/auth/readiness parity before mission control
            page.goto(f"{ui}/?nowebgl=1&boot=fast", wait_until="domcontentloaded")
            page.wait_for_selector('[data-entry-phase="awaiting_entry"]', timeout=90000)
            assert page.locator('[aria-label="Operator command dock"]').count() == 0
            page.get_by_test_id("enter-mission-control").click()
            page.wait_for_selector('[data-entry-phase="summoning"], [data-entry-phase="mission_control"]', timeout=15000)
            page.wait_for_selector('[data-entry-phase="mission_control"]', timeout=45000)
            page.get_by_label("Operator command dock").wait_for(timeout=20000)
            cmd = page.get_by_label("Operator text command")
            wait_operator_report_status(page, submit=True)
            shot = OUT / "04-no-webgl-fallback.png"
            page.screenshot(path=str(shot))
            screenshots.append(str(shot))

            # 7) Reduced motion — timing, honest state, keyboard entry, typed status
            rm_page = ctx.new_page()
            rm_page.emulate_media(reduced_motion="reduce")
            rm_page.add_init_script(
                "sessionStorage.clear(); localStorage.removeItem('rf-quality');",
            )
            t_rm = time.time()
            rm_page.goto(f"{ui}/?boot=fast", wait_until="domcontentloaded")
            rm_page.wait_for_selector('[data-entry-phase="awaiting_entry"]', timeout=45000)
            rm_elapsed = time.time() - t_rm
            assert rm_elapsed < 35, f"reduced-motion entry too slow ({rm_elapsed:.1f}s)"
            root = rm_page.locator('main[data-entry-phase]').first
            assert root.get_attribute("data-assembly-duration-ms") == "400", (
                "boot=fast + prefers-reduced-motion must expose 400ms assembly duration"
            )
            rm_page.wait_for_selector('[data-testid="enter-mission-control"]', timeout=30000)
            rm_page.keyboard.press("Enter")
            rm_page.wait_for_selector('[data-entry-phase="mission_control"]', timeout=45000)
            rm_page.wait_for_function(
                """() => fetch('/api/operator/session', { credentials: 'include' })
                  .then(r => r.json()).then(j => j.authenticated === true)""",
                timeout=45000,
            )
            rm_page.get_by_label("Operator command dock").wait_for(timeout=20000)
            assert root.get_attribute("data-post-fx") == "0", (
                "prefers-reduced-motion must disable post FX at mission control"
            )
            wait_operator_report_status(rm_page, submit=True)
            shot = OUT / "05-reduced-motion.png"
            rm_page.screenshot(path=str(shot))
            screenshots.append(str(shot))

            # 8) Entry — Enter key vs Space key (separate)
            page.goto(f"{ui}/?boot=fast&assembly=1", wait_until="networkidle")
            page.wait_for_selector('[data-testid="enter-mission-control"]', timeout=60000)
            page.keyboard.press("Enter")
            page.wait_for_selector('[data-entry-phase="mission_control"]', timeout=30000)

            page.goto(f"{ui}/?boot=fast&assembly=1", wait_until="networkidle")
            page.wait_for_selector('[data-testid="enter-mission-control"]', timeout=60000)
            page.keyboard.press("Space")
            page.wait_for_selector('[data-entry-phase="mission_control"]', timeout=30000)
            shot = OUT / "06-enter-mission-control.png"
            page.screenshot(path=str(shot))
            screenshots.append(str(shot))

            # 8b) Campaign blocked before entry
            page.goto(f"{ui}/?boot=fast&assembly=1", wait_until="networkidle")
            assert page.locator('[data-entry-phase="awaiting_entry"]').count() > 0
            assert page.locator('[aria-label="Operator command dock"]').count() == 0
            assert page.get_by_role("alertdialog", name="Confirm action").count() == 0
            shot = OUT / "08-entry-blocks-campaign.png"
            page.screenshot(path=str(shot))
            screenshots.append(str(shot))

            # 8c) Normal live assembly — visual progress must form bust (not DOM-only)
            page.add_init_script("sessionStorage.clear()")
            page.goto(f"{ui}/", wait_until="networkidle", timeout=120000)
            page.wait_for_function(
                """() => {
                  const prog = parseFloat(document.querySelector('[data-assembly-visual-progress]')?.getAttribute('data-assembly-visual-progress') || '0');
                  const phase = document.querySelector('[data-entry-phase]')?.getAttribute('data-entry-phase') || '';
                  return prog >= 0.35 || document.querySelector('[data-head-formed="1"]');
                }""",
                timeout=120000,
            )
            page.wait_for_selector('[data-head-formed="1"]', timeout=120000)
            formed_p = float(page.locator("[data-assembly-visual-progress]").first.get_attribute("data-assembly-visual-progress") or "0")
            assert formed_p >= 0.99, f"normal assembly visual progress {formed_p}"

            # Normal-path speaking (greeting TTS) retains formed bust
            page.add_init_script("sessionStorage.clear(); localStorage.setItem('rf-voice', '1')")
            page.goto(f"{ui}/", wait_until="networkidle", timeout=120000)
            page.wait_for_selector('[data-head-formed="1"]', timeout=120000)
            page.wait_for_function(
                """() => {
                  const chrome = document.querySelector('[data-hero-chrome="1"]')?.textContent || '';
                  const mic = document.querySelector('[data-hero-chrome="1"] [data-mic-state]')?.getAttribute('data-mic-state') || '';
                  return /TTS active/i.test(chrome) && mic === 'tts';
                }""",
                timeout=60000,
            )
            assert float(page.locator("[data-assembly-visual-progress]").first.get_attribute("data-assembly-visual-progress") or "0") >= 0.99
            assert page.locator('[data-entry-phase="speaking"], [data-entry-phase="awaiting_entry"]').count() > 0

            # Normal-path listening (PTT + gateway STT) on full boot
            page.add_init_script(
                "sessionStorage.clear(); window.__RF_SIMULATE_STT__ = true; "
                "window.__RF_SIMULATE_STT_DELAY_MS = 4000;",
            )
            page.goto(f"{ui}/", wait_until="networkidle", timeout=120000)
            page.wait_for_selector('[data-entry-phase="awaiting_entry"]', timeout=120000)
            page.wait_for_selector('[data-head-formed="1"]', timeout=30000)
            ptt = page.get_by_label("Push to talk")
            ptt.wait_for(timeout=15000)
            ptt.dispatch_event("mousedown")
            page.wait_for_selector('[data-entry-phase="listening"]', timeout=20000)
            page.wait_for_selector('[data-mic-state="active"]', timeout=5000)
            page.wait_for_timeout(800)
            ptt.dispatch_event("mouseup")

            # Voice YES must reach mission_control
            page.goto(f"{ui}/?boot=fast&assembly=1", wait_until="networkidle")
            page.wait_for_selector('[data-testid="readiness-prompt"]', timeout=60000)
            page.evaluate(
                "() => window.dispatchEvent(new CustomEvent('rf:ptt-result', { detail: 'yes' }))",
            )
            page.wait_for_selector('[data-entry-phase="summoning"], [data-entry-phase="mission_control"]', timeout=15000)
            page.wait_for_selector('[data-entry-phase="mission_control"]', timeout=45000)

            # Campaign phrase blocked at readiness
            page.goto(f"{ui}/?boot=fast&assembly=1", wait_until="networkidle")
            stt_block = c.post(
                f"{api}/api/operator/voice/stt",
                json={"simulate_transcript": "start campaign"},
            ).json()
            assert stt_block.get("transcript"), stt_block
            page.evaluate(
                "(t) => window.dispatchEvent(new CustomEvent('rf:ptt-result', { detail: t }))",
                stt_block["transcript"],
            )
            page.wait_for_timeout(800)
            assert page.locator('[data-entry-phase="mission_control"]').count() == 0
            assert page.get_by_role("alertdialog").count() == 0

            # 8d) Low quality runtime path — factual postFx/DPR state
            page.evaluate("() => localStorage.setItem('rf-quality', 'low')")
            page.goto(f"{ui}/?boot=skip", wait_until="domcontentloaded")
            page.get_by_test_id("enter-mission-control").click()
            page.wait_for_selector('[data-entry-phase="mission_control"]', timeout=30000)
            assert page.locator('[data-quality-tier="low"]').count() > 0
            assert page.locator('[data-post-fx="0"]').count() > 0
            assert page.locator('[data-dpr-max="1"]').count() > 0
            shot = OUT / "09-low-quality.png"
            page.screenshot(path=str(shot))
            screenshots.append(str(shot))

            # 8e) Privacy mute — real report status updates lastResult; muted blocks TTS
            failed_reqs.clear()
            page = ctx.new_page()
            page.add_init_script("sessionStorage.clear(); localStorage.setItem('rf-voice', '1')")
            page.goto(f"{ui}/?boot=skip", wait_until="domcontentloaded")
            page.get_by_test_id("enter-mission-control").click()
            page.wait_for_selector('[data-entry-phase="mission_control"]', timeout=30000)
            page.get_by_label("Operator command dock").wait_for(timeout=20000)
            tts_calls: list[str] = []
            page.route(
                "**/api/operator/voice/tts",
                lambda route: (
                    tts_calls.append(route.request.url),
                    route.fulfill(status=200, content_type="application/json", body='{"ok":true}'),
                ),
            )
            def toggle_privacy_mute(want_pressed: bool) -> None:
                page.get_by_label("Toggle privacy mute").click(force=True)
                want = "true" if want_pressed else "false"
                page.wait_for_function(
                    f"() => document.querySelector('[aria-label=\"Toggle privacy mute\"]')?.getAttribute('aria-pressed') === '{want}'",
                    timeout=10000,
                )

            toggle_privacy_mute(True)
            assert page.locator('text=🔇 muted').count() > 0
            wait_operator_report_status(page, submit=True, timeout_ms=20000)
            page.wait_for_timeout(600)
            assert len(tts_calls) == 0, "privacy mute must block gateway TTS"
            toggle_privacy_mute(False)
            wait_operator_report_status(page, submit=True, timeout_ms=20000)
            for _ in range(40):
                if len(tts_calls) >= 1:
                    break
                page.wait_for_timeout(200)
            assert len(tts_calls) >= 1, "unmuted voice must reach TTS gateway after report status"
            page.unroute("**/api/operator/voice/tts")
            failed_reqs.clear()

            # 9) Mobile viewport — fresh page (operator React state persists across goto on same tab)
            page = ctx.new_page()
            page.set_viewport_size({"width": 390, "height": 844})
            page.goto(f"{ui}/?boot=fast&assembly=1", wait_until="domcontentloaded")
            enter = page.get_by_test_id("enter-mission-control")
            enter.wait_for(timeout=30000)
            box = enter.bounding_box()
            assert box and box["width"] >= 120 and box["height"] >= 28
            enter.click()
            page.wait_for_selector('[data-entry-phase="mission_control"]', timeout=45000)
            page.wait_for_function(
                """() => fetch('/api/operator/session', { credentials: 'include' })
                  .then(r => r.json()).then(j => j.authenticated === true)""",
                timeout=45000,
            )
            page.get_by_label("Operator command dock").wait_for(timeout=20000)
            wait_operator_report_status(page, submit=True)
            shot = OUT / "07-mobile-low-tier.png"
            page.screenshot(path=str(shot))
            screenshots.append(str(shot))

            # 10) Secure true-cold entry — plain / without boot=skip
            sec2_api_port = _free_port()
            sec2_ui_port = _free_port()
            sec2_api = f"http://127.0.0.1:{sec2_api_port}"
            sec2_ui = f"http://127.0.0.1:{sec2_ui_port}"
            sec2_env = {
                **env,
                "RF_OPERATOR_AUTH_MODE": "secure",
                "RF_OPERATOR_DEMO_BOOTSTRAP": "0",
                "RF_OPERATOR_DB": str(Path(e2e_db) / "sec2-operator.db"),
                "RF_OPERATOR_SESSION_SECRET": "test-secure-secret-min-16-chars",
                "RF_OPERATOR_AUDIT_SIGNING_KEY": "test-secure-audit-signing-key-32b",
                "RF_OPERATOR_SECURE_USERS": json.dumps([
                    {"username": "operator", "password": "op-pass", "role": "operator"},
                ]),
                "RF_OPERATOR_ALLOW_PLAIN_PASSWORDS": "1",
            }
            sec2_api_proc = subprocess.Popen(
                [sys.executable, "-m", "uvicorn", "redforge.api.server:app",
                 "--host", "127.0.0.1", "--port", str(sec2_api_port), "--log-level", "warning"],
                cwd=ROOT, env=sec2_env,
            )
            sec2_ui_proc = subprocess.Popen(
                ["npm", "run", "start", "--", "-p", str(sec2_ui_port)],
                cwd=CONSOLE,
                env={**sec2_env, "RF_API_BASE": sec2_api, "NEXT_PUBLIC_API_BASE": sec2_api, "HOSTNAME": "127.0.0.1"},
            )
            try:
                wait_health(f"{sec2_api}/api/health", sec2_api_proc)
                wait_health(sec2_ui, sec2_ui_proc)
                sec2_ctx = browser.new_context(viewport={"width": 1600, "height": 950})
                s2 = sec2_ctx.new_page()
                s2.add_init_script("sessionStorage.clear()")
                s2.goto(f"{sec2_ui}/", wait_until="domcontentloaded", timeout=120000)
                s2.wait_for_selector('[data-entry-phase="authenticating"]', timeout=90000)
                s2.get_by_label("Username").fill("operator")
                s2.get_by_label("Password").fill("op-pass")
                s2.get_by_role("button", name="sign in").click()
                s2.wait_for_function(
                    """() => parseFloat(document.querySelector('[data-assembly-visual-progress]')?.getAttribute('data-assembly-visual-progress') || '0') >= 0.35""",
                    timeout=120000,
                )
                s2.wait_for_selector('[data-head-formed="1"]', timeout=180000)
                s2.wait_for_selector('[data-testid="enter-mission-control"]', timeout=60000)
                assert s2.locator('[aria-label="Operator command dock"]').count() == 0
                s2.evaluate(
                    "(t) => window.dispatchEvent(new CustomEvent('rf:ptt-result', { detail: t }))",
                    "start campaign",
                )
                s2.wait_for_timeout(1000)
                assert s2.locator('[data-entry-phase="mission_control"]').count() == 0
                assert s2.get_by_role("alertdialog", name="Confirm action").count() == 0
                s2.get_by_test_id("enter-mission-control").click()
                s2.wait_for_selector('[data-entry-phase="mission_control"]', timeout=90000)
                s2.get_by_label("Operator command dock").wait_for(state="visible", timeout=30000)
                s2.wait_for_function("() => window.__RF_MISSION_CONTROL_LIVE__ === true", timeout=15000)
                s2.wait_for_selector('[data-operator-auth="authenticated"]', timeout=15000)
                s2.wait_for_function(
                    "() => !document.querySelector('[aria-label=\"Operator text command\"]')?.disabled",
                    timeout=15000,
                )
                s2.get_by_label("Operator text command").fill("report status")
                s2.get_by_label("Send command").click()
                s2.wait_for_function(
                    """() => {
                      const phase = document.querySelector('[data-testid="operator-phase"]')?.textContent || '';
                      const tx = document.querySelector('[aria-label="Operator transcript"]')?.textContent || '';
                      return phase.includes('success') || phase.includes('error') || tx.includes('attempts') || tx.includes('Campaign');
                    }""",
                    timeout=30000,
                )
                tx = s2.locator('[aria-label="Operator transcript"]').inner_text()
                assert "not live" not in tx.lower() and "login required" not in tx.lower()
                assert "attempts" in tx or "findings" in tx or "Campaign" in tx
                shot = OUT / "11-secure-true-cold.png"
                s2.screenshot(path=str(shot))
                screenshots.append(str(shot))
                sec2_ctx.close()
            finally:
                for proc in (sec2_api_proc, sec2_ui_proc):
                    _kill_proc_group(proc)
                    try:
                        proc.wait(timeout=15)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                        proc.wait(timeout=5)

            # 11) Secure no-WebGL auth/readiness path
            sec3_api_port = _free_port()
            sec3_ui_port = _free_port()
            sec3_api = f"http://127.0.0.1:{sec3_api_port}"
            sec3_ui = f"http://127.0.0.1:{sec3_ui_port}"
            sec3_env = {
                **env,
                "RF_OPERATOR_AUTH_MODE": "secure",
                "RF_OPERATOR_DEMO_BOOTSTRAP": "0",
                "RF_OPERATOR_DB": str(Path(e2e_db) / "sec3-operator.db"),
                "RF_OPERATOR_SESSION_SECRET": "test-secure-secret-min-16-chars",
                "RF_OPERATOR_AUDIT_SIGNING_KEY": "test-secure-audit-signing-key-32b",
                "RF_OPERATOR_SECURE_USERS": json.dumps([
                    {"username": "operator", "password": "op-pass", "role": "operator"},
                ]),
                "RF_OPERATOR_ALLOW_PLAIN_PASSWORDS": "1",
            }
            sec3_api_proc = subprocess.Popen(
                [sys.executable, "-m", "uvicorn", "redforge.api.server:app",
                 "--host", "127.0.0.1", "--port", str(sec3_api_port), "--log-level", "warning"],
                cwd=ROOT, env=sec3_env,
            )
            sec3_ui_proc = subprocess.Popen(
                ["npm", "run", "start", "--", "-p", str(sec3_ui_port)],
                cwd=CONSOLE,
                env={**sec3_env, "RF_API_BASE": sec3_api, "NEXT_PUBLIC_API_BASE": sec3_api, "HOSTNAME": "127.0.0.1"},
            )
            try:
                wait_health(f"{sec3_api}/api/health", sec3_api_proc)
                wait_health(sec3_ui, sec3_ui_proc)
                sec3_ctx = browser.new_context(viewport={"width": 1600, "height": 950})
                s3 = sec3_ctx.new_page()
                s3.goto(f"{sec3_ui}/?nowebgl=1", wait_until="domcontentloaded", timeout=90000)
                s3.get_by_label("Username").wait_for(timeout=90000)
                s3.get_by_label("Username").fill("operator")
                s3.get_by_label("Password").fill("op-pass")
                s3.get_by_role("button", name="sign in").click()
                s3.wait_for_selector('[data-entry-phase="awaiting_entry"]', timeout=120000)
                s3.get_by_test_id("enter-mission-control").wait_for(timeout=30000)
                assert s3.locator('[aria-label="Operator command dock"]').count() == 0
                s3.evaluate(
                    "(t) => window.dispatchEvent(new CustomEvent('rf:ptt-result', { detail: t }))",
                    "start campaign",
                )
                s3.wait_for_timeout(1000)
                assert s3.get_by_role("alertdialog", name="Confirm action").count() == 0
                assert s3.locator('[data-entry-phase="mission_control"]').count() == 0
                s3.get_by_test_id("enter-mission-control").click()
                s3.wait_for_selector('[data-entry-phase="mission_control"]', timeout=90000)
                s3.wait_for_function("() => window.__RF_MISSION_CONTROL_LIVE__ === true", timeout=15000)
                s3.wait_for_selector('[data-operator-auth="authenticated"]', timeout=15000)
                wait_operator_report_status(s3, submit=True)
                tx = s3.locator('[aria-label="Operator transcript"]').inner_text()
                assert "attempts" in tx or "findings" in tx or "Campaign" in tx
                sec3_ctx.close()
            finally:
                for proc in (sec3_api_proc, sec3_ui_proc):
                    _kill_proc_group(proc)
                    try:
                        proc.wait(timeout=15)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                        proc.wait(timeout=5)

            # 12) Secure cold entry — boot=skip must not bypass auth
            sec_api_port = _free_port()
            sec_ui_port = _free_port()
            sec_api = f"http://127.0.0.1:{sec_api_port}"
            sec_ui = f"http://127.0.0.1:{sec_ui_port}"
            sec_env = {
                **env,
                "RF_OPERATOR_AUTH_MODE": "secure",
                "RF_OPERATOR_DEMO_BOOTSTRAP": "0",
                "RF_OPERATOR_DB": str(Path(e2e_db) / "sec-operator.db"),
                "RF_OPERATOR_SESSION_SECRET": "test-secure-secret-min-16-chars",
                "RF_OPERATOR_AUDIT_SIGNING_KEY": "test-secure-audit-signing-key-32b",
                "RF_OPERATOR_SECURE_USERS": json.dumps([
                    {"username": "operator", "password": "op-pass", "role": "operator"},
                    {"username": "lead", "password": "lead-pass", "role": "lead"},
                ]),
                "RF_OPERATOR_ALLOW_PLAIN_PASSWORDS": "1",
            }
            sec_api_proc = subprocess.Popen(
                [sys.executable, "-m", "uvicorn", "redforge.api.server:app",
                 "--host", "127.0.0.1", "--port", str(sec_api_port), "--log-level", "warning"],
                cwd=ROOT, env=sec_env,
            )
            sec_ui_proc = subprocess.Popen(
                ["npm", "run", "start", "--", "-p", str(sec_ui_port)],
                cwd=CONSOLE,
                env={**sec_env, "RF_API_BASE": sec_api, "NEXT_PUBLIC_API_BASE": sec_api, "HOSTNAME": "127.0.0.1"},
            )
            try:
                wait_health(f"{sec_api}/api/health", sec_api_proc)
                wait_health(sec_ui, sec_ui_proc)
                sec_ctx = browser.new_context(viewport={"width": 1600, "height": 950})
                spage = sec_ctx.new_page()
                cfg_r = hx.get(f"{sec_api}/api/operator/config")
                assert cfg_r.status_code == 200, cfg_r.text
                cfg = cfg_r.json()
                assert cfg.get("auth_mode") == "secure", cfg
                spage.goto(f"{sec_ui}/?boot=skip", wait_until="networkidle", timeout=90000)
                spage.wait_for_selector('[data-entry-phase="authenticating"]', timeout=60000)
                spage.get_by_label("Username").wait_for(timeout=15000)
                assert spage.locator('[aria-label="Operator command dock"]').count() == 0
                spage.get_by_label("Username").fill("operator")
                spage.get_by_label("Password").fill("op-pass")
                spage.get_by_role("button", name="sign in").click()
                spage.wait_for_selector(
                    '[data-entry-phase="awaiting_entry"], [data-entry-phase="assembling"]',
                    timeout=45000,
                )
                spage.get_by_test_id("enter-mission-control").click()
                spage.wait_for_selector('[data-entry-phase="mission_control"]', timeout=30000)
                spage.get_by_label("Operator text command").fill("report status")
                spage.get_by_label("Operator text command").press("Enter")
                spage.wait_for_timeout(2000)
                shot = OUT / "10-secure-cold-entry.png"
                spage.screenshot(path=str(shot))
                screenshots.append(str(shot))
                sec_ctx.close()
            finally:
                for proc in (sec_api_proc, sec_ui_proc):
                    _kill_proc_group(proc)
                    try:
                        proc.wait(timeout=15)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                        proc.wait(timeout=5)

            essential_failures = [u for u in failed_reqs if "/api/operator" in u or "/api/health" in u]
            if essential_failures:
                errors.append(f"failed requests: {essential_failures[:5]}")
            bad_console = [e for e in console_errors if "operator bootstrap failed" in e.lower()]
            if bad_console:
                errors.append(f"console errors: {bad_console[:3]}")

            browser.close()

        manifest = {"api": api, "ui": ui, "screenshots": screenshots, "errors": errors}
        (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        print(json.dumps(manifest, indent=2))
        return 1 if errors else 0
    finally:
        for proc in (api_proc, ui_proc):
            _kill_proc_group(proc)
            try:
                proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=5)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"E2E FAILED: {type(exc).__name__}: {exc}", flush=True)
        raise
