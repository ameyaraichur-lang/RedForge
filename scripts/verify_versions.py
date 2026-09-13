#!/usr/bin/env python3
"""Verify release.toml drives Python, Node, and API versions (exit 0/1)."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from redforge.version import api_version, npm_version, pep440_version, release_codename  # noqa: E402


def main() -> int:
    errors: list[str] = []

    pkg = json.loads((ROOT / "console" / "package.json").read_text(encoding="utf-8"))
    if pkg["version"] != npm_version():
        errors.append(f"console/package.json version {pkg['version']!r} != {npm_version()!r}")

    proc = subprocess.run(
        [sys.executable, "-m", "pytest", "tests/test_version.py", "-q", "--tb=no"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        errors.append(f"tests/test_version.py failed:\n{proc.stdout}\n{proc.stderr}")

    print(f"release: {api_version()} ({release_codename()})")
    print(f"python:  {pep440_version()}")
    print(f"npm:     {npm_version()}")

    if errors:
        print("FAIL")
        for err in errors:
            print(err)
        return 1

    print("PASS: versions aligned")
    return 0


if __name__ == "__main__":
    sys.exit(main())
