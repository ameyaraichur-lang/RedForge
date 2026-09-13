"""Release version drift guard — release.toml is the single source of truth."""
from __future__ import annotations

import json
import re
import tomllib
from importlib.metadata import version as pkg_version
from pathlib import Path

import pytest

from redforge.version import api_version, npm_version, pep440_version, release_codename

ROOT = Path(__file__).resolve().parent.parent


def test_release_toml_is_authoritative():
    data = tomllib.loads((ROOT / "release.toml").read_text(encoding="utf-8"))
    assert data["version"] == api_version()
    assert data["codename"] == release_codename()


def test_python_package_version_matches_release():
    installed = pkg_version("redforge")
    assert installed == pep440_version()


def test_console_package_json_matches_release():
    pkg = json.loads((ROOT / "console" / "package.json").read_text(encoding="utf-8"))
    assert pkg["version"] == npm_version()


def test_pyproject_declares_dynamic_version():
    text = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
    assert 'dynamic = ["version"]' in text
    assert 'version = {attr = "redforge.version.__version__"}' in text


def test_api_openapi_version_matches_release():
    from redforge.api.server import app

    assert app.version == api_version()
    assert release_codename() in (app.description or "")


@pytest.mark.parametrize("path", [
    ROOT / "console" / "package-lock.json",
])
def test_lockfiles_embed_release_version(path: Path):
    if not path.exists():
        pytest.skip(f"{path.name} missing")
    text = path.read_text(encoding="utf-8")
    assert npm_version() in text


def test_no_stale_hardcoded_versions_in_manifests():
    """Catch drift back to 0.1.0 / 1.0.0 placeholders."""
    stale = []
    for rel in ("pyproject.toml", "console/package.json", "redforge/api/server.py",
                "redforge/__init__.py"):
        text = (ROOT / rel).read_text(encoding="utf-8")
        if re.search(r'\b0\.1\.0\b', text):
            stale.append(f"{rel}: 0.1.0")
        if rel.endswith("server.py") and re.search(r'version\s*=\s*["\']1\.0\.0["\']', text):
            stale.append(f"{rel}: hardcoded 1.0.0")
    assert stale == [], stale
