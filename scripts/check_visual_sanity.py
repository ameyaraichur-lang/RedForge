"""Image-level sanity checks — distinguish contour-bust structure from diffuse bokeh."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VF = ROOT / "output" / "visual-fidelity"


def _load_png(path: Path):
    try:
        from PIL import Image, ImageFilter
    except ImportError as exc:
        raise RuntimeError("Pillow required: uv pip install pillow") from exc
    return Image.open(path).convert("RGB"), ImageFilter


def _is_warm(r: int, g: int, b: int) -> bool:
    return r > g + 18 and r > b + 10


def _is_cool(r: int, g: int, b: int) -> bool:
    # Standard cool-pixel test for idle/listening frames.
    return b > r + 12 and b > g + 6


def _is_cyan_dominant(r: int, g: int, b: int) -> bool:
    """Bloom-resistant cyan shell test — blue channel leads red/green."""
    dom = max(r, g, b)
    if dom < 24:
        return False
    return b >= max(r, g) * 0.92 and (b - min(r, g)) >= 6


def _region_stats(crop, *, cyan_dominant: bool = False) -> dict:
    px = list(crop.getdata())
    n = len(px)
    if n == 0:
        return {"mean_luma": 0, "color_spread": 0, "warm_ratio": 0, "cool_ratio": 0}
    luma = [0.2126 * r + 0.7152 * g + 0.0722 * b for r, g, b in px]
    mean_luma = sum(luma) / n
    spread = (sum((x - mean_luma) ** 2 for x in luma) / n) ** 0.5
    warm = sum(1 for r, g, b in px if _is_warm(r, g, b)) / n
    cool_fn = _is_cyan_dominant if cyan_dominant else _is_cool
    cool = sum(1 for r, g, b in px if cool_fn(r, g, b)) / n
    return {"mean_luma": mean_luma, "color_spread": spread, "warm_ratio": warm, "cool_ratio": cool}


def center_stats(img) -> dict:
    w, h = img.size
    cx, cy = w // 2, h // 2
    box = (cx - w // 6, cy - h // 5, cx + w // 6, cy + h // 5)
    return _region_stats(img.crop(box))


def shell_core_separation(img) -> dict:
    """Spatial shell-vs-core check — warm face centre + cool cyan cheek flanks.

    Regions are anchored to the same band as face_amber_metrics. The earlier
    bands sat well below and outside the face: the "face" band covered the neck
    and chest, and the "cheek" bands fell outside the head entirely. That only
    read as a pass while a warm halo bled across those areas, so a correctly
    confined amber face scored near zero warmth while a halo that swamped the
    shell scored well.
    """
    w, h = img.size
    cx, cy = w // 2, h // 2
    # Brow-to-jaw band: the amber face oval sits here.
    top, bottom = cy - h // 5, cy - h // 12
    face = _region_stats(img.crop((cx - w // 12, top, cx + w // 12, bottom)))
    # Narrow bands just outboard of the face oval but still on the head, where
    # the ridge rings and ear nubs must stay cyan even while speaking.
    left = _region_stats(
        img.crop((cx - w // 7, top, cx - w // 11, bottom)),
        cyan_dominant=True,
    )
    right = _region_stats(
        img.crop((cx + w // 11, top, cx + w // 7, bottom)),
        cyan_dominant=True,
    )
    shell_cool = (left["cool_ratio"] + right["cool_ratio"]) / 2
    return {
        "face_warm_ratio": face["warm_ratio"],
        "shell_cool_ratio": shell_cool,
        "left_cool_ratio": left["cool_ratio"],
        "right_cool_ratio": right["cool_ratio"],
    }


def structural_profile(img, filt) -> dict:
    """Edge distribution metrics — bust has vertical silhouette; bokeh sphere is radially symmetric."""
    w, h = img.size
    cx = w // 2
    gray = img.convert("L")
    edges = gray.filter(filt.FIND_EDGES)
    ew, eh = edges.size
    px = edges.load()
    threshold = 28

    def band_edges(x0: int, x1: int, y0: int, y1: int) -> int:
        count = 0
        for y in range(y0, y1):
            for x in range(x0, x1):
                if px[x, y] >= threshold:
                    count += 1
        return count

    top = band_edges(cx - ew // 5, cx + ew // 5, eh // 8, eh // 3)
    mid = band_edges(cx - ew // 5, cx + ew // 5, eh // 3, 2 * eh // 3)
    bot = band_edges(cx - ew // 5, cx + ew // 5, 2 * eh // 3, 7 * eh // 8)
    total = top + mid + bot
    if total == 0:
        return {
            "edge_total": 0,
            "vertical_contrast": 0,
            "profile_asymmetry": 0,
            "center_edge_density": 0,
        }

    vertical_contrast = (max(top, mid, bot) - min(top, mid, bot)) / total
    upper_l = band_edges(cx - ew // 3, cx - ew // 12, eh // 6, eh // 2)
    upper_r = band_edges(cx + ew // 12, cx + ew // 3, eh // 6, eh // 2)
    profile_asymmetry = abs(upper_l - upper_r) / max(upper_l + upper_r, 1)
    center_area = (ew // 2) * (eh // 2)
    center_edge_density = mid / max(center_area, 1)

    return {
        "edge_total": total,
        "vertical_contrast": vertical_contrast,
        "profile_asymmetry": profile_asymmetry,
        "center_edge_density": center_edge_density,
    }


def face_amber_metrics(img) -> dict:
    """Face region must read amber (R > G > B), not magenta from blue-orange RGB mix."""
    w, h = img.size
    cx, cy = w // 2, h // 2
    crop = img.crop((cx - w // 12, cy - h // 5, cx + w // 12, cy - h // 12))
    px = [p for p in crop.getdata() if sum(p) > 36]
    n = len(px)
    if n == 0:
        return {"face_pixels": 0, "mean_r": 0, "mean_g": 0, "mean_b": 0, "r_minus_b": 0}
    mean_r = sum(r for r, g, b in px) / n
    mean_g = sum(g for r, g, b in px) / n
    mean_b = sum(b for r, g, b in px) / n
    return {
        "face_pixels": n,
        "mean_r": mean_r,
        "mean_g": mean_g,
        "mean_b": mean_b,
        "r_minus_b": mean_r - mean_b,
    }


def is_bust_structure(profile: dict, stats: dict) -> bool:
    """Heuristic: bust has vertical edge contrast + warm/cool separation; bokeh sphere lacks both."""
    if profile["edge_total"] < 120:
        return False
    if profile["vertical_contrast"] < 0.08:
        return False
    if profile["center_edge_density"] < 0.012:
        return False
    if stats["color_spread"] < 18:
        return False
    return True


def main() -> int:
    assembly_dir = VF / "sequences" / "assembly"
    frames = sorted(assembly_dir.glob("assembly-*.png"))
    assembly_start = frames[0] if frames else assembly_dir / "assembly-000.png"
    assembly_end = frames[-1] if frames else assembly_dir / "assembly-019.png"
    forced_formed = VF / "phase-formed-idle.png"
    speaking = VF / "phase-speaking-normal.png"
    listening = VF / "phase-listening-normal.png"

    missing = [str(p) for p in (assembly_start, assembly_end, forced_formed, speaking, listening) if not p.exists()]
    if missing:
        print(json.dumps({"ok": False, "error": "missing evidence", "missing": missing}, indent=2))
        return 1

    start_img, filt = _load_png(assembly_start)
    end_img, _ = _load_png(assembly_end)
    forced_img, _ = _load_png(forced_formed)
    speak_img, _ = _load_png(speaking)
    listen_img, _ = _load_png(listening)

    start = center_stats(start_img)
    end = center_stats(end_img)
    forced = center_stats(forced_img)
    speak = center_stats(speak_img)
    listen = center_stats(listen_img)
    speak_sep = shell_core_separation(speak_img)
    face_amber = face_amber_metrics(forced_img)

    start_prof = structural_profile(start_img, filt)
    end_prof = structural_profile(end_img, filt)
    forced_prof = structural_profile(forced_img, filt)
    speak_prof = structural_profile(speak_img, filt)
    listen_prof = structural_profile(listen_img, filt)

    checks = {
        # Cool shell dominance at end is expected — chroma/structure must emerge vs sparse start.
        "assembly_material_emergence": (
            end["color_spread"] > start["color_spread"] * 1.12
            and end_prof["edge_total"] >= start_prof["edge_total"] * 0.95
        ),
        "live_end_is_bust": is_bust_structure(end_prof, end),
        "forced_reference_is_bust": is_bust_structure(forced_prof, forced),
        "live_matches_forced_topology": (
            abs(end_prof["vertical_contrast"] - forced_prof["vertical_contrast"]) < 0.12
            and abs(end_prof["center_edge_density"] - forced_prof["center_edge_density"])
            < max(forced_prof["center_edge_density"] * 0.45, 0.008)
        ),
        "speaking_retains_bust": is_bust_structure(speak_prof, speak),
        "listening_retains_bust": is_bust_structure(listen_prof, listen),
        # Warm core in the face band must coexist with cool cyan shell on both flanks.
        "speaking_shell_core_separation": (
            speak_sep["face_warm_ratio"] > 0.22
            and speak_sep["shell_cool_ratio"] > 0.18
            and speak_sep["left_cool_ratio"] > 0.12
            and speak_sep["right_cool_ratio"] > 0.12
        ),
        "face_is_amber_not_magenta": (
            face_amber["face_pixels"] > 80
            and face_amber["mean_r"] > face_amber["mean_g"] > face_amber["mean_b"]
            and face_amber["r_minus_b"] > 28
        ),
    }
    ok = all(checks.values())
    out = {
        "ok": ok,
        "checks": checks,
        "metrics": {
            "assembly_start": {**start, **start_prof},
            "assembly_end": {**end, **end_prof},
            "forced_formed": {**forced, **forced_prof, **face_amber},
            "speaking": {**speak, **speak_prof, **speak_sep},
            "listening": {**listen, **listen_prof},
        },
    }
    out_path = VF / "sanity-check.json"
    out_path.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(json.dumps(out, indent=2))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
