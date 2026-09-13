"""Capture phase-named screenshots and frame sequences — evidence only, no scoring."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "output" / "visual-fidelity"
CONSOLE = ROOT / "console"
SEQ = OUT / "sequences"
GLOBAL_TIMEOUT_S = 900

sys.path.insert(0, str(ROOT / "scripts"))
from process_utils import (  # noqa: E402
    ManagedProcess,
    free_port,
    spawn_process,
    wait_http_ok,
    wait_page_ready,
)


def read_assembly_progress(page) -> float:
    raw = page.locator("[data-assembly-visual-progress]").first.get_attribute("data-assembly-visual-progress")
    return float(raw or "0")


def read_scene_diagnostics(page) -> dict:
    return page.evaluate(
        """() => {
          const root = document.querySelector('main[data-entry-phase]') || document.querySelector('[data-entry-phase]');
          const q = (k) => root?.getAttribute(`data-${k}`);
          return {
            visual: q('assembly-visual-progress'),
            shell: q('gpu-shell-progress'),
            core: q('gpu-core-progress'),
            convergence: q('gpu-convergence'),
            listen: q('gpu-listen'),
            energy: q('gpu-energy'),
            fade: q('gpu-fade'),
            phase: q('entry-phase'),
            assemblyActive: q('assembly-active'),
            assemblyDurationMs: q('assembly-duration-ms'),
            assemblyElapsedMs: q('assembly-elapsed-ms'),
            diagElapsedMs: (window.__RF_ASSEMBLY_DIAG__?.elapsedMs ?? null),
            diagShell: (window.__RF_ASSEMBLY_DIAG__?.shell ?? null),
            headFormed: q('head-formed'),
            summonT: q('summon-t'),
            summonHud: q('summon-hud'),
            summonPlanets: q('summon-planets'),
            summonAmbient: q('summon-ambient'),
            summonDurationS: q('summon-duration-s'),
            summonAnchorMs: q('summon-anchor-ms'),
          };
        }""",
    )


def dump_page_diagnostics(page, label: str, diag_dir: Path) -> dict:
    diag_dir.mkdir(parents=True, exist_ok=True)
    shot = diag_dir / f"{label}.png"
    page.screenshot(path=str(shot), full_page=True, timeout=90000)
    console_logs = []
    page.on("console", lambda m: console_logs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    dom = page.evaluate(
        """() => ({
          url: location.href,
          phases: Array.from(document.querySelectorAll('[data-entry-phase]')).map(e => ({
            tag: e.tagName,
            phase: e.getAttribute('data-entry-phase'),
            visible: !!(e.offsetWidth || e.offsetHeight),
          })),
          bodyText: document.body?.innerText?.slice(0, 800) || '',
          progress: document.querySelector('[data-assembly-visual-progress]')?.getAttribute('data-assembly-visual-progress'),
          headFormed: document.querySelector('[data-head-formed]')?.getAttribute('data-head-formed'),
        })""",
    )
    info = {"label": label, "screenshot": str(shot.relative_to(ROOT)), "dom": dom, "console": console_logs[-20:]}
    (diag_dir / f"{label}.json").write_text(json.dumps(info, indent=2), encoding="utf-8")
    return info


def wait_entry_marker(page, timeout_ms: int = 90000, diag_dir: Path | None = None) -> None:
    try:
        page.wait_for_selector("[data-entry-phase]", state="attached", timeout=timeout_ms)
        page.wait_for_function(
            """() => {
              const el = document.querySelector('[data-entry-phase]');
              return el && (el.getAttribute('data-entry-phase') || '').length > 0;
            }""",
            timeout=min(timeout_ms, 45000),
        )
    except Exception as exc:
        if diag_dir is not None:
            dump_page_diagnostics(page, "timeout-entry-phase", diag_dir)
        raise RuntimeError(f"[data-entry-phase] not ready: {exc}") from exc


# Camera checkpoints only — FSM labels come from live state, not ?phase=.
PHASE_STILLS = [
    ("phase-assembly-mid", "/?capture=1&assembly=0.36"),
    ("phase-formed-idle", "/?capture=1&assembly=1&boot=fast"),
    ("phase-awaiting-entry", "/?capture=1&assembly=1&boot=fast"),
    ("phase-summon-mid", "/?capture=1&assembly=1&summon=0.55"),
    ("phase-mission-control", "/?boot=skip&phase=mission_control"),
]

ASSEMBLY_SYNC_JS = """
() => new Promise((resolve, reject) => {
  const deadline = Date.now() + 120000;
  const readShell = () => {
    const diag = window.__RF_ASSEMBLY_DIAG__;
    if (diag && Number.isFinite(diag.shell)) return diag.shell;
    const root = document.querySelector('main[data-entry-phase]');
    const attr = parseFloat(root?.getAttribute('data-gpu-shell-progress') || 'NaN');
    return Number.isFinite(attr) ? attr : NaN;
  };
  const readElapsed = () => {
    const diag = window.__RF_ASSEMBLY_DIAG__;
    if (diag && Number.isFinite(diag.elapsedMs)) return diag.elapsedMs;
    const root = document.querySelector('main[data-entry-phase]');
    const attr = parseFloat(root?.getAttribute('data-assembly-elapsed-ms') || 'NaN');
    return Number.isFinite(attr) ? attr : 0;
  };
  // Scene warm-up (geometry upload + shader compile) can overshoot the sparse
  // window, so re-arm the assembly clock instead of racing a single pass.
  let rearms = 0;
  const tick = () => {
    if (Date.now() > deadline) {
      reject(new Error('assembly sync timeout'));
      return;
    }
    const root = document.querySelector('main[data-entry-phase]');
    const active = root?.getAttribute('data-assembly-active') === '1';
    const phase = root?.getAttribute('data-entry-phase');
    const shell = readShell();
    const elapsed = readElapsed();
    if (phase !== 'assembling' || !active || !Number.isFinite(shell) || shell < 0) {
      requestAnimationFrame(tick);
      return;
    }
    if (elapsed >= 40 && shell < 0.06) {
      // Freeze the assembly clock atomically at the sparse moment so the
      // caller reads a stationary state instead of racing the render loop.
      window.__RF_ASSEMBLY_HOLD__ = true;
      window.__RF_ASSEMBLY_HOLD_AT__ = performance.now();
      resolve({ shell, elapsed, rearms });
      return;
    }
    if (shell >= 0.06 && rearms < 40 && typeof window.__RF_RESET_ASSEMBLY_CAPTURE__ === 'function') {
      rearms += 1;
      window.__RF_RESET_ASSEMBLY_CAPTURE__();
    }
    requestAnimationFrame(tick);
  };
  tick();
})
"""


def try_assemble_video(frame_dir: Path, out_mp4: Path, interval_ms: int) -> dict | None:
    if not shutil.which("ffmpeg"):
        return None
    fps = round(1000 / interval_ms, 3)
    pattern = str(frame_dir / "*.png")
    cmd = [
        "ffmpeg", "-y", "-framerate", str(fps), "-pattern_type", "glob", "-i", pattern,
        "-pix_fmt", "yuv420p", str(out_mp4),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        return None
    duration_s = probe_mp4_duration(out_mp4)
    return {
        "path": str(out_mp4.relative_to(ROOT)),
        "interval_ms": interval_ms,
        "encoded_fps": fps,
        "duration_s": duration_s,
    }


def probe_mp4_duration(path: Path) -> float | None:
    if not shutil.which("ffprobe"):
        return None
    proc = subprocess.run(
        [
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", str(path),
        ],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        return None
    try:
        return float(proc.stdout.strip())
    except ValueError:
        return None


def set_capture_hold(page, assembly: bool, summon: bool) -> None:
    page.evaluate(
        """({ assembly, summon }) => {
          const now = performance.now();
          if (assembly) {
            window.__RF_ASSEMBLY_HOLD__ = true;
            window.__RF_ASSEMBLY_HOLD_AT__ = now;
          } else if (window.__RF_ASSEMBLY_HOLD_AT__ != null) {
            window.__RF_ASSEMBLY_PAUSED_TOTAL__ = (window.__RF_ASSEMBLY_PAUSED_TOTAL__ || 0)
              + (now - window.__RF_ASSEMBLY_HOLD_AT__);
            window.__RF_ASSEMBLY_HOLD__ = false;
            window.__RF_ASSEMBLY_HOLD_AT__ = undefined;
          } else {
            window.__RF_ASSEMBLY_HOLD__ = false;
          }
          if (typeof window.__RF_SUMMON_SET_HOLD__ === 'function') {
            window.__RF_SUMMON_SET_HOLD__(summon);
          }
        }""",
        {"assembly": assembly, "summon": summon},
    )


SUMMON_CLOCK_JS = """() => {
  const root = document.querySelector('main[data-entry-phase]');
  const anchor = window.__RF_SUMMON_ANCHOR_MS__;
  const dur = 5600;
  let elapsed = 0;
  if (anchor != null) {
    let holdMs = window.__RF_SUMMON_HOLD_MS__ || 0;
    if (window.__RF_SUMMON_HOLDING__ && window.__RF_SUMMON_HOLD_SINCE__ != null) {
      holdMs += performance.now() - window.__RF_SUMMON_HOLD_SINCE__;
    }
    elapsed = Math.max(0, performance.now() - anchor - holdMs);
  }
  const liveT = anchor != null ? Math.min(1, elapsed / dur) : null;
  const domT = parseFloat(root?.getAttribute('data-summon-t') || '0');
  return {
    phase: root?.getAttribute('data-entry-phase') ?? null,
    t: liveT != null && Number.isFinite(liveT) ? liveT : domT,
    elapsedMs: elapsed,
    anchor: anchor != null,
    holding: Boolean(window.__RF_SUMMON_HOLDING__),
  };
}"""

ASSEMBLY_CLOCK_JS = """() => {
  const root = document.querySelector('main[data-entry-phase]');
  const diag = window.__RF_ASSEMBLY_DIAG__;
  const attr = parseFloat(root?.getAttribute('data-assembly-elapsed-ms') || '0');
  return {
    phase: root?.getAttribute('data-entry-phase') ?? null,
    elapsedMs: Number.isFinite(diag?.elapsedMs) ? diag.elapsedMs : attr,
    shell: Number.isFinite(diag?.shell) ? diag.shell : null,
    holding: Boolean(window.__RF_ASSEMBLY_HOLD__),
  };
}"""


def advance_held_clock(page, read_js: str, reached, *, label: str, step_ms: int = 100,
                       max_steps: int = 300, leave_held: bool = True) -> dict:
    """Step a capture-held animation clock forward in bounded slices.

    The clock only advances while explicitly released, so a slow render loop can
    never overshoot the target the way rAF-polled waits can.
    """
    state = page.evaluate(read_js)
    for _ in range(max_steps):
        if reached(state):
            if not leave_held:
                set_capture_hold(page, assembly=False, summon=False)
            return state
        set_capture_hold(page, assembly=False, summon=False)
        page.wait_for_timeout(step_ms)
        set_capture_hold(page, assembly=label == "assembly", summon=label == "summon")
        state = page.evaluate(read_js)
    raise RuntimeError(f"{label} clock never reached target: {state}")


def capture_live_assembly(page, ui: str, out_dir: Path, prefix: str, frames: int, interval_ms: int) -> tuple[list[str], dict]:
    out_dir.mkdir(parents=True, exist_ok=True)
    page.goto(f"{ui}/", wait_until="domcontentloaded", timeout=120000)
    page.wait_for_selector("[data-entry-phase]", state="attached", timeout=120000)
    page.wait_for_selector('[data-entry-phase="assembling"]', state="attached", timeout=120000)
    page.wait_for_selector("canvas", state="attached", timeout=120000)
    page.wait_for_function(
        "() => typeof window.__RF_RESET_ASSEMBLY_CAPTURE__ === 'function'",
        timeout=120000,
    )
    page.evaluate(
        """() => {
          window.__RF_DELAY_ASSEMBLY_UNTIL_ARM__ = false;
          window.__RF_ASSEMBLY_CAPTURE_ARMED__ = true;
          window.__RF_RESET_ASSEMBLY_CAPTURE__?.();
          requestAnimationFrame(() => window.__RF_RESET_ASSEMBLY_CAPTURE__?.());
        }""",
    )
    page.wait_for_function(
        "() => (window.__RF_ASSEMBLY_DIAG__?.elapsedMs ?? 9999) < 120",
        timeout=30000,
    )
    page.wait_for_timeout(80)
    # wait_for_function yields a JSHandle — json_value() gives the sparse-moment
    # snapshot, which is what the assertion must judge (a later DOM read has
    # already advanced past the sparse window on slower scenes).
    sync_handle = page.wait_for_function(ASSEMBLY_SYNC_JS, timeout=120000)
    sync_observed = sync_handle.json_value()
    sync_diag = read_scene_diagnostics(page)
    sync_shell = float(sync_observed.get("shell"))
    if sync_shell > 0.08:
        raise RuntimeError(f"assembly sync not sparse: shell={sync_shell} diag={sync_diag}")
    sync_diag = {**sync_diag, "shell": f"{sync_shell:.3f}", "observed": sync_observed}
    paths: list[str] = []
    gpu_frames: list[dict] = [{"frame": -1, "t_ms": 0, **sync_diag}]
    for i in range(frames):
        target_ms = (i + 1) * interval_ms
        # Release the clock only long enough to reach this frame's timestamp,
        # then refreeze so the screenshot matches the recorded diagnostics.
        advance_held_clock(
            page,
            ASSEMBLY_CLOCK_JS,
            lambda s, target=target_ms: s["phase"] != "assembling" or s["elapsedMs"] >= target,
            label="assembly",
            step_ms=min(interval_ms, 100),
        )
        page.wait_for_timeout(40)
        diag = read_scene_diagnostics(page)
        path = out_dir / f"{prefix}-{i:03d}.png"
        page.screenshot(path=str(path), full_page=False, timeout=90000)
        paths.append(str(path.relative_to(ROOT)))
        gpu_frames.append({"frame": i, "t_ms": target_ms, **diag})
    set_capture_hold(page, assembly=False, summon=False)
    page.wait_for_function(
        """() => {
          const formed = document.querySelector('[data-head-formed]')?.getAttribute('data-head-formed') === '1';
          const conv = parseFloat(document.querySelector('[data-gpu-convergence]')?.getAttribute('data-gpu-convergence') || '0');
          const shell = parseFloat(document.querySelector('[data-gpu-shell-progress]')?.getAttribute('data-gpu-shell-progress') || '0');
          const diag = window.__RF_ASSEMBLY_DIAG__;
          const dShell = diag?.shell ?? shell;
          const dConv = diag?.convergence ?? conv;
          return formed || (dConv >= 0.95 && dShell >= 0.99);
        }""",
        timeout=120000,
    )
    final_p = read_assembly_progress(page)
    final_gpu = read_scene_diagnostics(page)
    if final_p < 0.95:
        raise RuntimeError(f"live assembly never formed: progress={final_p}")
    if float(final_gpu.get("shell") or 0) < 0.95:
        raise RuntimeError(f"GPU shell progress stuck: {final_gpu}")
    dur_ms = int(final_gpu.get("assemblyDurationMs") or 4000)
    if dur_ms < 3000:
        raise RuntimeError(f"assembly duration too short for first visit: {dur_ms}ms")
    for idx, frame in enumerate(gpu_frames[1:], start=1):
        elapsed = float(frame.get("diagElapsedMs") or frame.get("assemblyElapsedMs") or 0)
        shell = float(frame.get("shell") or 0)
        expected_shell = min(1.0, elapsed / dur_ms if dur_ms else 0)
        if elapsed > 120 and shell < 0.98 and abs(shell - expected_shell) > 0.09:
            raise RuntimeError(
                f"assembly GPU pace mismatch @ frame {idx}: shell={shell:.3f} expected~{expected_shell:.3f} elapsed={elapsed:.0f}ms",
            )
    if len(gpu_frames) >= 3:
        shell1 = float(gpu_frames[1].get("shell") or 0)
        if shell1 > 0.12:
            raise RuntimeError(f"assembly frame-1 too formed (shell={shell1:.3f}): {gpu_frames[1]}")
    mid_idx = min(9, len(gpu_frames) - 1)
    mid = gpu_frames[mid_idx]
    if float(mid.get("shell") or 0) < 0.28:
        raise RuntimeError(f"assembly mid-frame too sparse @ {mid_idx}: {mid}")
    if mid.get("phase") != "assembling" and float(mid.get("shell") or 0) < 0.95:
        raise RuntimeError(f"assembly left assembling too early @ {mid_idx}: {mid}")
    return paths, {
        "interval_ms": interval_ms,
        "encoded_fps": round(1000 / interval_ms, 3),
        "duration_ms": dur_ms,
        "sync": sync_diag,
        "frames": gpu_frames,
        "final": final_gpu,
    }


def _capture_main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    SEQ.mkdir(parents=True, exist_ok=True)
    diag_dir = OUT / "diagnostics"
    api_port = free_port()
    ui_port = free_port()
    api = f"http://127.0.0.1:{api_port}"
    ui = f"http://127.0.0.1:{ui_port}"
    env = {
        **os.environ,
        "RF_LLM_PROVIDER": "demo",
        "RF_ASTRA_API_KEY": "",
        "RF_OPERATOR_AUTH_MODE": "demo",
        "RF_OPERATOR_DEMO_BOOTSTRAP": "1",
        "RF_OPERATOR_SESSION_SECRET": "visual-fidelity-capture-secret-min-24",
    }
    api_mp = spawn_process(
        "api",
        [sys.executable, "-m", "uvicorn", "redforge.api.server:app",
         "--host", "127.0.0.1", "--port", str(api_port), "--log-level", "warning"],
        cwd=ROOT,
        env=env,
    )
    build = subprocess.run(
        ["npm", "run", "build"],
        cwd=CONSOLE,
        env={**env, "RF_API_BASE": api, "NEXT_PUBLIC_API_BASE": api},
        capture_output=True,
        text=True,
    )
    if build.returncode != 0:
        print(build.stderr[-3000:], file=sys.stderr)
        api_mp.stop()
        return 1
    ui_mp = spawn_process(
        "ui",
        ["npm", "run", "start", "--", "-p", str(ui_port), "-H", "127.0.0.1"],
        cwd=CONSOLE,
        env={**env, "RF_API_BASE": api, "NEXT_PUBLIC_API_BASE": api},
    )
    managed = [api_mp, ui_mp]
    evidence: dict = {"screenshots": {}, "sequences": {}, "metrics": {}}
    exit_code = 1
    try:
        wait_http_ok(f"{api}/api/health", api_mp.proc, predicate=lambda r: r.json().get("ok") is True)
        wait_page_ready(ui, ui_mp.proc, selector="data-entry-phase")
        import httpx
        from playwright.sync_api import sync_playwright

        manifest = httpx.get(f"{api}/api/world/manifest").json()
        evidence["metrics"]["manifest"] = {
            "agent_count": manifest.get("agent_count"),
            "gate_count": manifest.get("gate_count"),
            "node_count": len(manifest.get("nodes", [])),
            "edge_count": len(manifest.get("edges", [])),
        }
        t0 = time.perf_counter()
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            ctx = browser.new_context(viewport={"width": 720, "height": 1280}, device_scale_factor=1)

            for name, qs in PHASE_STILLS:
                page = ctx.new_page()
                page.add_init_script(
                    "sessionStorage.clear();",
                )
                page.goto(f"{ui}{qs}", wait_until="domcontentloaded", timeout=120000)
                wait_entry_marker(page, diag_dir=diag_dir)
                if "assembly=0.36" in qs:
                    page.wait_for_function(
                        """() => parseFloat(document.querySelector('[data-assembly-visual-progress]')?.getAttribute('data-assembly-visual-progress') || '0') >= 0.34""",
                        timeout=45000,
                    )
                if "assembly=1" in qs:
                    page.wait_for_function(
                        """() => {
                          const shell = parseFloat(document.querySelector('[data-gpu-shell-progress]')?.getAttribute('data-gpu-shell-progress') || '0');
                          const conv = parseFloat(document.querySelector('[data-gpu-convergence]')?.getAttribute('data-gpu-convergence') || '0');
                          return shell >= 0.98 && conv >= 0.94;
                        }""",
                        timeout=45000,
                    )
                page.wait_for_timeout(1200)
                path = OUT / f"{name}.png"
                page.screenshot(path=str(path), full_page=False, timeout=90000)
                evidence["screenshots"][name] = str(path.relative_to(ROOT))
                evidence.setdefault("gpu_diagnostics", {})[name] = read_scene_diagnostics(page)
                page.close()

            assembly_interval_ms = 200
            no_rm = (
                "sessionStorage.clear();"
                "window.__RF_DELAY_ASSEMBLY_UNTIL_ARM__=true;"
                "window.matchMedia=(q)=>({matches:false,media:q,addEventListener:()=>{},removeEventListener:()=>{},dispatchEvent:()=>true});"
            )
            page = ctx.new_page()
            page.add_init_script(no_rm)
            assembly_dir = SEQ / "assembly"
            assembly_frame_count = 32  # 6400ms first-visit assembly @ 200ms cadence
            assembly_frames, assembly_gpu = capture_live_assembly(
                page, ui, assembly_dir, "assembly", frames=assembly_frame_count, interval_ms=assembly_interval_ms,
            )
            evidence["sequences"]["assembly_frames"] = assembly_frames
            evidence["metrics"]["assembly_final_progress"] = read_assembly_progress(page)
            evidence["metrics"]["assembly_gpu"] = assembly_gpu
            assembly_mp4 = SEQ / "assembly.mp4"
            asm_vid = try_assemble_video(assembly_dir, assembly_mp4, assembly_interval_ms)
            if asm_vid:
                evidence["sequences"]["assembly_mp4"] = asm_vid["path"]
                evidence["metrics"]["assembly_video"] = asm_vid
            page.close()

            summon_interval_ms = 200
            summon_frames = 30
            page = ctx.new_page()
            page.add_init_script(no_rm + "window.__RF_SUMMON_PRE_ARM__=true;")
            summon_dir = SEQ / "summon"
            page.goto(f"{ui}/?boot=fast", wait_until="domcontentloaded", timeout=120000)
            wait_entry_marker(page, diag_dir=diag_dir)
            page.wait_for_selector('[data-entry-phase="awaiting_entry"]', state="attached", timeout=60000)
            page.wait_for_selector('[data-head-formed="1"]', state="attached", timeout=60000)
            page.wait_for_function(
                "() => typeof window.__RF_SUMMON_SET_HOLD__ === 'function'",
                timeout=15000,
            )
            # Hold before click so selector waits cannot advance the summon clock.
            page.evaluate(
                """() => {
                  window.__RF_SUMMON_PRE_ARM__ = true;
                  window.__RF_SUMMON_SET_HOLD__(true);
                  document.querySelector('[data-testid="enter-mission-control"]')?.click();
                }""",
            )
            page.wait_for_selector('[data-entry-phase="summoning"]', state="attached", timeout=45000)
            page.wait_for_function(
                "() => typeof window.__RF_SUMMON_ARM__ === 'function'",
                timeout=15000,
            )
            page.evaluate("() => { window.__RF_SUMMON_ARM__?.(); }")
            set_capture_hold(page, assembly=False, summon=True)
            page.wait_for_function(
                """() => {
                  const root = document.querySelector('main[data-entry-phase]');
                  if (!root || root.getAttribute('data-entry-phase') !== 'summoning') return false;
                  const anchor = root.getAttribute('data-summon-anchor-ms') || '';
                  const t = parseFloat(root.getAttribute('data-summon-t') || '1');
                  const dur = parseFloat(root.getAttribute('data-summon-duration-s') || '0');
                  return anchor.length > 0 && dur >= 5.5 && t < 0.12;
                }""",
                timeout=30000,
            )
            page.evaluate("() => { window.__RF_SUMMON_ARM__?.(); }")
            set_capture_hold(page, assembly=False, summon=True)
            page.wait_for_function(
                """() => {
                  const root = document.querySelector('main[data-entry-phase]');
                  return root?.getAttribute('data-entry-phase') === 'summoning'
                    && parseFloat(root.getAttribute('data-summon-t') || '1') < 0.08;
                }""",
                timeout=15000,
            )
            summon_paths: list[str] = []
            summon_diag_frames: list[dict] = []
            summon_dir.mkdir(parents=True, exist_ok=True)
            summon_duration_ms = 5600
            # The summon clock stays held between frames and is released only to
            # advance to the next target, so slow frames cannot overshoot into
            # mission_control and strand the remaining targets.
            page.wait_for_function(
                "() => typeof window.__RF_SUMMON_SEEK__ === 'function'",
                timeout=15000,
            )
            for i in range(summon_frames):
                target_ms = (i + 1) * summon_interval_ms
                target_t = min(1.0, target_ms / summon_duration_ms)
                if target_ms < summon_duration_ms:
                    page.evaluate("(t) => window.__RF_SUMMON_SEEK__?.(t)", target_t)
                    page.wait_for_timeout(80)
                    state = page.evaluate(SUMMON_CLOCK_JS)
                    if state["phase"] != "summoning":
                        raise RuntimeError(
                            f"summon left summoning before frame {i} (target t={target_t:.3f}): "
                            f"{read_scene_diagnostics(page)}",
                        )
                    if not state["anchor"] or state["t"] < target_t - 0.06:
                        raise RuntimeError(
                            f"summon seek missed frame {i} (target t={target_t:.3f}): {state}",
                        )
                else:
                    set_capture_hold(page, assembly=False, summon=False)
                    page.wait_for_function(
                        """() => document.querySelector('[data-entry-phase]')?.getAttribute('data-entry-phase') === 'mission_control'""",
                        timeout=60000,
                    )
                diag = read_scene_diagnostics(page)
                path = summon_dir / f"summon-{i:03d}.png"
                page.screenshot(path=str(path), full_page=False, timeout=90000)
                summon_paths.append(str(path.relative_to(ROOT)))
                summon_diag_frames.append({"frame": i, "t_ms": target_ms, **diag})
                hud = float(diag.get("summonHud") or 0)
                if hud > 0.04:
                    hero_visible = page.evaluate(
                        """() => {
                          const el = document.querySelector('[data-hero-chrome="1"]');
                          if (!el) return false;
                          const s = getComputedStyle(el);
                          return parseFloat(s.opacity) > 0.05 && s.visibility !== 'hidden';
                        }""",
                    )
                    if hero_visible:
                        raise RuntimeError(
                            f"summon HUD/hero overlap @ frame {i}: hud={hud:.3f} hero still visible",
                        )
            set_capture_hold(page, assembly=False, summon=False)
            page.wait_for_selector('[data-entry-phase="mission_control"]', state="attached", timeout=25000)
            overlap = summon_diag_frames[min(8, len(summon_diag_frames) - 1)]
            if overlap.get("phase") != "summoning":
                raise RuntimeError(f"summon left summoning too early @ frame 8: {overlap}")
            if float(overlap.get("summonPlanets") or 0) < 0.05:
                raise RuntimeError(f"planets not visible during overlap @ frame 8: {overlap}")
            mid_summon = summon_diag_frames[min(20, len(summon_diag_frames) - 1)]
            if mid_summon.get("phase") != "summoning":
                raise RuntimeError(f"summon ended before frame 20: {mid_summon}")
            if float(mid_summon.get("summonT") or 0) < 0.55:
                raise RuntimeError(f"summonT too low at mid capture: {mid_summon}")
            if float(mid_summon.get("summonHud") or 0) > 0.15:
                raise RuntimeError(f"HUD revealed too early @ frame 20: {mid_summon}")
            late_idx = min(26, len(summon_diag_frames) - 1)
            late_summon = summon_diag_frames[late_idx]
            if late_summon.get("phase") != "summoning":
                raise RuntimeError(f"summon left summoning before frame 26: {late_summon}")
            if float(late_summon.get("summonT") or 0) < 0.90:
                raise RuntimeError(f"summonT incomplete @ frame {late_idx}: {late_summon}")
            mc_idx = min(27, len(summon_diag_frames) - 1)
            if summon_diag_frames[mc_idx].get("phase") != "mission_control":
                raise RuntimeError(
                    f"summon did not complete by frame 27: {summon_diag_frames[mc_idx]}",
                )
            tail = summon_diag_frames[-1]
            if tail.get("phase") != "mission_control":
                raise RuntimeError(f"summon never reached mission_control @ final frame: {tail}")
            evidence["sequences"]["summon_frames"] = summon_paths
            evidence["metrics"]["summon_capture"] = {
                "interval_ms": summon_interval_ms,
                "encoded_fps": round(1000 / summon_interval_ms, 3),
                "frame_count": summon_frames,
                "expected_duration_s": summon_frames * summon_interval_ms / 1000,
                "frames": summon_diag_frames,
            }
            summon_mp4 = SEQ / "summon-pullback.mp4"
            sum_vid = try_assemble_video(summon_dir, summon_mp4, summon_interval_ms)
            if sum_vid:
                evidence["sequences"]["summon_mp4"] = sum_vid["path"]
                evidence["metrics"]["summon_video"] = sum_vid

            page = ctx.new_page()
            page.add_init_script(
                "sessionStorage.clear(); localStorage.setItem('rf-voice', '1'); "
                "window.__RF_CAPTURE_SPEAKING_HOLD__ = true;",
            )
            page.goto(f"{ui}/", wait_until="domcontentloaded", timeout=120000)
            page.wait_for_selector('[data-head-formed="1"]', state="attached", timeout=120000)
            page.wait_for_function(
                """() => {
                  const main = document.querySelector('main[data-entry-phase]');
                  const status = document.querySelector('[data-hero-status]');
                  const phase = main?.getAttribute('data-entry-phase') || '';
                  const line = (status?.getAttribute('data-hero-status') || '').toLowerCase();
                  return phase === 'speaking' && line.includes('tts');
                }""",
                timeout=90000,
            )
            speak_p = read_assembly_progress(page)
            if speak_p < 0.99:
                dump_page_diagnostics(page, "fail-speaking-progress", diag_dir)
                raise RuntimeError(f"speaking lost bust progress={speak_p}")
            page.wait_for_timeout(400)
            speak_status = page.locator("[data-hero-status]").first.get_attribute("data-hero-status") or ""
            speak_phase = page.locator("main[data-entry-phase]").first.get_attribute("data-entry-phase") or ""
            if speak_phase != "speaking":
                raise RuntimeError(f"speaking phase lost before screenshot: {speak_phase!r}")
            if page.locator('[data-audio-badge="mic-on"]').count() > 0:
                raise RuntimeError("speaking phase must not show mic-on badge")
            if "mic on" in speak_status.lower() or "mic off" in speak_status.lower():
                raise RuntimeError(f"speaking status must not mention mic: {speak_status!r}")
            if "tts" not in speak_status.lower():
                raise RuntimeError(f"speaking status must show TTS: {speak_status!r}")
            path = OUT / "phase-speaking-normal.png"
            page.screenshot(path=str(path), full_page=False, timeout=90000)
            page.evaluate("() => window.__RF_RELEASE_SPEAKING_HOLD__?.()")
            evidence["screenshots"]["phase-speaking-normal"] = str(path.relative_to(ROOT))
            evidence["metrics"]["speaking_via_tts"] = True
            evidence["metrics"]["speaking_assembly_progress"] = speak_p
            evidence["metrics"]["speaking_status_line"] = speak_status

            page = ctx.new_page()
            page.add_init_script(
                "sessionStorage.clear(); window.__RF_SIMULATE_STT__ = true; "
                "window.__RF_SIMULATE_STT_DELAY_MS = 4000; window.__RF_SIMULATE_STT_TEXT = 'yes';",
            )
            page.goto(f"{ui}/", wait_until="domcontentloaded", timeout=120000)
            page.wait_for_selector('[data-entry-phase="awaiting_entry"]', state="attached", timeout=120000)
            page.wait_for_selector('[data-head-formed="1"]', state="attached", timeout=60000)
            page.wait_for_selector('[data-testid="readiness-prompt"]', state="attached", timeout=60000)
            ptt = page.get_by_label("Push to talk")
            ptt.wait_for(state="attached", timeout=15000)
            ptt.dispatch_event("mousedown")
            page.wait_for_selector('[data-entry-phase="listening"]', state="attached", timeout=20000)
            page.wait_for_timeout(400)
            listen_status = page.locator("[data-hero-status]").first.get_attribute("data-hero-status") or ""
            if page.locator('[data-audio-badge="mic-on"]').count() < 1:
                raise RuntimeError("listening phase must show mic-on badge")
            if "listening" not in listen_status.lower():
                raise RuntimeError(f"listening status missing: {listen_status!r}")
            evidence["metrics"]["listening_via"] = "ptt_simulated_stt"
            evidence["metrics"]["stt_adapter"] = "simulated"
            evidence["metrics"]["listening_status_line"] = listen_status
            path = OUT / "phase-listening-normal.png"
            page.screenshot(path=str(path), full_page=False, timeout=90000)
            evidence["screenshots"]["phase-listening-normal"] = str(path.relative_to(ROOT))
            try:
                ptt.dispatch_event("mouseup", timeout=5000)
            except Exception:
                pass
            page.close()

            page = ctx.new_page()
            page.add_init_script("sessionStorage.clear()")
            page.goto(f"{ui}/?boot=skip", wait_until="domcontentloaded", timeout=120000)
            page.wait_for_selector('[data-testid="enter-mission-control"]', state="attached", timeout=60000)
            page.get_by_test_id("enter-mission-control").click(force=True)
            page.wait_for_selector('[data-entry-phase="mission_control"]', state="attached", timeout=45000)
            page.wait_for_timeout(2500)
            agents = [n["id"] for n in manifest["nodes"] if n.get("kind") == "agent"]
            gates = [n["id"] for n in manifest["nodes"] if n.get("kind") == "gate"]
            found_agents = sum(1 for aid in agents if page.locator(f'[data-world-node="{aid}"]').count() == 1)
            found_gates = sum(1 for gid in gates if page.locator(f'[data-world-node="{gid}"]').count() == 1)
            evidence["metrics"]["rendered"] = {
                "agents": found_agents,
                "gates": found_gates,
                "expected_agents": len(agents),
                "expected_gates": len(gates),
            }
            path = OUT / "phase-planets-manifest.png"
            page.screenshot(path=str(path), full_page=False, timeout=90000)
            evidence["screenshots"]["phase-planets-manifest"] = str(path.relative_to(ROOT))

            for tier in ("high", "low"):
                tier_page = ctx.new_page()
                tier_page.add_init_script("sessionStorage.clear();")
                tier_page.goto(f"{ui}/?boot=skip", wait_until="domcontentloaded", timeout=120000)
                tier_page.evaluate(f"() => localStorage.setItem('rf-quality', '{tier}')")
                tier_page.wait_for_selector(
                    '[data-testid="enter-mission-control"]', state="attached", timeout=60000,
                )
                tier_page.get_by_test_id("enter-mission-control").click(force=True)
                tier_page.wait_for_selector(
                    '[data-entry-phase="summoning"]', state="attached", timeout=20000,
                )
                tier_page.wait_for_selector(
                    '[data-entry-phase="mission_control"]', state="attached", timeout=60000,
                )
                page = tier_page
                page.wait_for_timeout(800)
                post_fx = tier_page.locator("[data-post-fx]").first.get_attribute("data-post-fx")
                dpr = tier_page.locator("[data-dpr-max]").first.get_attribute("data-dpr-max")
                evidence["metrics"][f"quality_{tier}"] = {"post_fx": post_fx, "dpr_max": dpr}
                tier_page.close()

            browser.close()

        evidence["metrics"]["capture_wall_ms"] = int((time.perf_counter() - t0) * 1000)
        exit_code = 0
    finally:
        for mp in managed:
            mp.stop()

    payload = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "note": "Evidence only — independent grader assigns rubric scores.",
        "evidence": evidence,
    }
    (OUT / "evidence.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    if (OUT / "rubric.json").exists():
        (OUT / "rubric.json").unlink()

    sanity = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "check_visual_sanity.py")],
        capture_output=True,
        text=True,
    )
    if sanity.stdout.strip():
        try:
            evidence["metrics"]["sanity"] = json.loads(sanity.stdout)
        except json.JSONDecodeError:
            evidence["metrics"]["sanity"] = {"raw": sanity.stdout[-2000:]}
    payload["evidence"] = evidence
    (OUT / "evidence.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(json.dumps(payload, indent=2))
    if sanity.returncode != 0:
        print(sanity.stdout, file=sys.stderr)
        print(sanity.stderr, file=sys.stderr)
        return sanity.returncode
    return exit_code


def main() -> int:
    import signal

    def _on_alarm(_signum, _frame) -> None:
        raise TimeoutError(f"capture exceeded {GLOBAL_TIMEOUT_S}s global timeout")

    if hasattr(signal, "SIGALRM"):
        signal.signal(signal.SIGALRM, _on_alarm)
        signal.alarm(GLOBAL_TIMEOUT_S)
    try:
        return _capture_main()
    except TimeoutError as exc:
        print(f"CAPTURE FAILED: {exc}", file=sys.stderr)
        return 124
    except Exception as exc:
        print(f"CAPTURE FAILED: {exc}", file=sys.stderr)
        traceback.print_exc()
        return 1
    finally:
        if hasattr(signal, "SIGALRM"):
            signal.alarm(0)


if __name__ == "__main__":
    raise SystemExit(main())
