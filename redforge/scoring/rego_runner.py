"""OPA subprocess bridge with silent pure-Python fallback.

The blueprint tenet is that only OPA/policy derives severity and scores
authoritatively; when the OPA binary is missing or a query fails, the engine
falls back silently to the Python mirrors (severity.derive_severity /
catalog.scorecard.compute_score) and stamps ``"source"`` so callers can tell
which path produced a result.

Subprocess safety (Git Bash on Windows mangles shell quoting): OPA is always
invoked with a list-argv, never a shell string; the JSON input is written to a
temp file with ``json.dump``.
"""
import json
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from redforge.catalog.scorecard import compute_score
from redforge.config import settings
from redforge.schemas import Severity

from .severity import derive_severity

REGO_DIR = Path(__file__).resolve().parent / "rego"

__all__ = ["SourcedSeverity", "opa_available", "opa_eval",
           "score_via_opa", "severity_via_opa"]


class SourcedSeverity(str):
    """A Severity value that also carries its derivation source.

    Severity is a str-enum, so this str subclass compares equal to the plain
    ``Severity`` members (``severity_via_opa(...) == Severity.CRITICAL``)
    while exposing ``.source`` ("opa" | "python-fallback").
    """

    __slots__ = ("severity", "source")

    def __new__(cls, severity: Severity, source: str) -> "SourcedSeverity":
        obj = super().__new__(cls, severity.value)
        obj.severity = severity
        obj.source = source
        return obj

    def __repr__(self) -> str:  # pragma: no cover - debugging nicety
        return f"SourcedSeverity({self.severity.value!r}, source={self.source!r})"


def opa_available() -> bool:
    """True when the configured OPA binary exists on disk."""
    return Path(settings.opa_path).is_file()


def opa_eval(query: str, input_data: dict) -> Any:
    """Evaluate a Rego query against ``input_data`` with the bundled policy.

    Raises RuntimeError on non-zero exit (with the stderr tail) or when the
    query produces no result (undefined rule).
    """
    with tempfile.NamedTemporaryFile(
        "w", suffix=".json", delete=False, encoding="utf-8"
    ) as handle:
        json.dump(input_data, handle)
        input_path = Path(handle.name)
    try:
        proc = subprocess.run(
            [
                settings.opa_path,
                "eval",
                "--format=json",
                "--data", str(REGO_DIR),
                "--input", str(input_path),
                query,
            ],
            capture_output=True,
            text=True,
            timeout=60,
        )
    finally:
        input_path.unlink(missing_ok=True)

    if proc.returncode != 0:
        tail = "\n".join((proc.stderr or "").strip().splitlines()[-10:])
        raise RuntimeError(
            f"OPA eval failed (exit {proc.returncode}): {tail}"
        )
    result = json.loads(proc.stdout).get("result") or []
    if not result:
        raise RuntimeError(f"OPA query {query!r} returned no result (undefined rule)")
    return result[0]["expressions"][0]["value"]


def score_via_opa(actuals: dict[str, float]) -> dict:
    """Scorecard via the OPA policy; silent Python fallback on any failure.

    Returns ``{"total": <1dp>, "band": ..., "contributions": ..., "source":
    "opa" | "python-fallback"}``. OPA returns the raw total; this runner does
    the 1-decimal rounding exactly like compute_score.
    """
    try:
        if not opa_available():
            raise RuntimeError(f"OPA binary not found at {settings.opa_path}")
        value = opa_eval("data.redforge.score", {"actuals": actuals})
        return {
            "total": round(value["total"], 1),
            "band": value["band"],
            "contributions": value.get("contributions"),
            "source": "opa",
        }
    except Exception:
        fallback = compute_score(actuals)  # silent fallback (tenet: never block)
        return {
            "total": fallback["total"],
            "band": fallback["band"],
            "contributions": fallback["contributions"],
            "source": "python-fallback",
        }


def severity_via_opa(pack: str, confidence: float, criticality: int = 1) -> Severity:
    """Severity via the OPA policy; silent fallback to derive_severity.

    Returns a value that equals the ``Severity`` member and additionally
    carries ``.source`` ("opa" | "python-fallback") — see SourcedSeverity.
    """
    try:
        if not opa_available():
            raise RuntimeError(f"OPA binary not found at {settings.opa_path}")
        value = opa_eval(
            "data.redforge.severity",
            {"pack": pack, "confidence": confidence, "criticality": criticality},
        )
        return SourcedSeverity(Severity(value["severity"]), "opa")
    except Exception:
        return SourcedSeverity(
            derive_severity(pack, confidence, criticality), "python-fallback"
        )
