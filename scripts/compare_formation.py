"""Frame-to-frame comparison of the assembly beat against the reference video.

The single mid-assembly still in the main capture cannot show choreography —
where the particles originate, which direction they sweep, and what order the
figure builds in. This walks the forced-assembly progress parameter across the
whole beat and tiles the result against reference frames, so the two can be
read side by side.

    python scripts/compare_formation.py [--ref-only] [--ours-only]

Writes output/visual-fidelity/formation/:
    ref-montage.png      reference frames over the formation beat
    ours-montage.png     our figure at matched progress values
    compare.png          the two stacked for direct reading
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

from capture_visual_fidelity import CONSOLE, OUT, wait_entry_marker  # noqa: E402
from process_utils import (  # noqa: E402
    free_port,
    spawn_process,
    wait_http_ok,
    wait_page_ready,
)

FORM = OUT / "formation"
REF_VIDEO = Path("/Users/ameyar/Downloads/reznikov_engineering_Dct1a3Yud5K.mp4")

# The reference formation beat runs from first dust to a stable figure.
REF_START_S = 0.0
REF_END_S = 4.25
# Crop to the monitor panel so the desk, bezel and room lighting are excluded.
REF_CROP = "560:400:80:260"

TILES = 18


def extract_reference() -> list[Path]:
    """Sample the reference formation beat at even intervals."""
    if not REF_VIDEO.exists():
        raise SystemExit(f"reference video not found: {REF_VIDEO}")
    FORM.mkdir(parents=True, exist_ok=True)
    for old in FORM.glob("ref-frame-*.png"):
        old.unlink()
    out: list[Path] = []
    for i in range(TILES):
        t = REF_START_S + (REF_END_S - REF_START_S) * i / (TILES - 1)
        dst = FORM / f"ref-frame-{i:02d}.png"
        subprocess.run(
            ["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", str(REF_VIDEO),
             "-vf", f"crop={REF_CROP}", "-frames:v", "1", "-y", str(dst)],
            check=True,
        )
        out.append(dst)
    print(f"extracted {len(out)} reference frames over {REF_START_S}-{REF_END_S}s")
    return out


def capture_ours() -> list[Path]:
    """Screenshot our figure at forced assembly progress across the beat."""
    from playwright.sync_api import sync_playwright

    FORM.mkdir(parents=True, exist_ok=True)
    for old in FORM.glob("ours-frame-*.png"):
        old.unlink()

    api_port = free_port()
    ui_port = free_port()
    api = f"http://127.0.0.1:{api_port}"
    ui = f"http://127.0.0.1:{ui_port}"
    # Mirrors the env in capture_visual_fidelity so the served build matches
    # the one the evidence capture exercises. Astra stays judge-only: the key
    # is blanked and the provider is the offline demo.
    env = {
        **os.environ,
        "RF_LLM_PROVIDER": "demo",
        "RF_ASTRA_API_KEY": "",
        "RF_OPERATOR_AUTH_MODE": "demo",
        "RF_OPERATOR_DEMO_BOOTSTRAP": "1",
        "RF_OPERATOR_SESSION_SECRET": "formation-compare-secret-min-24chars",
        "RF_API_BASE": api,
        "NEXT_PUBLIC_API_BASE": api,
    }

    api_mp = spawn_process(
        "api",
        [sys.executable, "-m", "uvicorn", "redforge.api.server:app",
         "--host", "127.0.0.1", "--port", str(api_port), "--log-level", "warning"],
        cwd=ROOT,
        env=env,
    )
    ui_mp = spawn_process(
        "ui",
        ["npm", "run", "start", "--", "-p", str(ui_port), "-H", "127.0.0.1"],
        cwd=CONSOLE,
        env=env,
    )
    managed = [api_mp, ui_mp]
    out: list[Path] = []
    try:
        wait_http_ok(f"{api}/api/health", api_mp.proc,
                     predicate=lambda r: r.json().get("ok") is True)
        wait_page_ready(ui, ui_mp.proc, selector="data-entry-phase")
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            ctx = browser.new_context(viewport={"width": 720, "height": 1280},
                                      device_scale_factor=1)
            for i in range(TILES):
                prog = i / (TILES - 1)
                page = ctx.new_page()
                page.add_init_script("sessionStorage.clear();")
                page.goto(f"{ui}/?capture=1&assembly={prog:.4f}",
                          wait_until="domcontentloaded", timeout=120000)
                wait_entry_marker(page)
                # Let the forced progress settle into the GPU uniforms.
                page.wait_for_timeout(1400)
                dst = FORM / f"ours-frame-{i:02d}.png"
                page.screenshot(path=str(dst), full_page=False, timeout=90000)
                out.append(dst)
                page.close()
                print(f"  captured assembly={prog:.3f}")
            browser.close()
    finally:
        for mp in managed:
            mp.stop()
    return out


def montage(frames: list[Path], labels: list[str], dst: Path, *, crop=None, scale=0.46):
    from PIL import Image, ImageDraw

    ims = []
    for f in frames:
        im = Image.open(f).convert("RGB")
        if crop:
            im = im.crop(crop)
        ims.append(im)
    w, h = ims[0].size
    tw, th = int(w * scale), int(h * scale)
    cols = 6
    rows = (len(ims) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * tw, rows * th), (0, 0, 0))
    draw = ImageDraw.Draw(sheet)
    for i, im in enumerate(ims):
        r, c = divmod(i, cols)
        sheet.paste(im.resize((tw, th)), (c * tw, r * th))
        draw.text((c * tw + 4, r * th + 3), labels[i], fill=(0, 255, 120))
    sheet.save(dst)
    print(f"wrote {dst} {sheet.size}")
    return sheet


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref-only", action="store_true")
    ap.add_argument("--ours-only", action="store_true")
    args = ap.parse_args()

    from PIL import Image

    ref_sheet = ours_sheet = None

    if not args.ours_only:
        refs = extract_reference()
        labels = [
            f"{REF_START_S + (REF_END_S - REF_START_S) * i / (TILES - 1):.2f}s"
            for i in range(TILES)
        ]
        ref_sheet = montage(refs, labels, FORM / "ref-montage.png")

    if not args.ref_only:
        ours = capture_ours()
        labels = [f"p={i / (TILES - 1):.2f}" for i in range(TILES)]
        # Crop to the figure so tiles are comparable in scale to the reference.
        ours_sheet = montage(ours, labels, FORM / "ours-montage.png",
                             crop=(90, 250, 650, 850), scale=0.46)

    if ref_sheet is None and (FORM / "ref-montage.png").exists():
        ref_sheet = Image.open(FORM / "ref-montage.png").convert("RGB")
    if ours_sheet is None and (FORM / "ours-montage.png").exists():
        ours_sheet = Image.open(FORM / "ours-montage.png").convert("RGB")

    if ref_sheet is not None and ours_sheet is not None:
        width = max(ref_sheet.width, ours_sheet.width)
        gap = 18
        combo = Image.new("RGB", (width, ref_sheet.height + ours_sheet.height + gap),
                          (16, 16, 24))
        combo.paste(ref_sheet, (0, 0))
        combo.paste(ours_sheet, (0, ref_sheet.height + gap))
        combo.save(FORM / "compare.png")
        print(f"wrote {FORM / 'compare.png'} {combo.size}  (top: reference, bottom: ours)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
