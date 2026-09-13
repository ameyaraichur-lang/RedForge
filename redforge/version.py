"""Authoritative release version derived from release.toml at repo root."""
from __future__ import annotations

import tomllib
from functools import lru_cache
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
_RELEASE_FILE = _REPO_ROOT / "release.toml"


@lru_cache(maxsize=1)
def _load_release() -> dict[str, str]:
    data = tomllib.loads(_RELEASE_FILE.read_text(encoding="utf-8"))
    version = str(data["version"]).strip()
    codename = str(data["codename"]).strip()
    if not version or not codename:
        raise ValueError(f"invalid release.toml: {data!r}")
    return {"version": version, "codename": codename}


def pep440_version() -> str:
    """PEP 440 version with local segment, e.g. 0.8.0+m8.ritual."""
    rel = _load_release()
    local = rel["codename"].replace("-", ".")
    return f"{rel['version']}+{local}"


def npm_version() -> str:
    """npm semver pre-release, e.g. 0.8.0-m8-ritual."""
    rel = _load_release()
    return f"{rel['version']}-{rel['codename']}"


def api_version() -> str:
    """Public API / OpenAPI version (base semver only)."""
    return _load_release()["version"]


def release_codename() -> str:
    return _load_release()["codename"]


__version__ = pep440_version()
