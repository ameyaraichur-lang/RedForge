"""Force demo/offline providers for milestone gates — never paid Astra or real targets.

Call ``apply_gate_demo_env()`` before importing ``redforge.config.settings`` so
local ``.env`` cannot influence gate runners or authoritative E2E producers.
"""
from __future__ import annotations

import os
from typing import Mapping

# Env vars override pydantic-settings ``.env`` file values.
_GATE_DEMO_ENV: dict[str, str] = {
    "RF_LLM_PROVIDER": "demo",
    "RF_JUDGE_PROVIDER": "demo",
    "RF_TARGET_PROVIDER": "demo",
    "RF_ASTRA_API_KEY": "",
    "RF_TARGET_API_KEY": "",
    "RF_OPERATOR_AUTH_MODE": "demo",
    "RF_OPERATOR_DEMO_BOOTSTRAP": "1",
}


def apply_gate_demo_env() -> None:
    """Pin milestone runners to offline demo providers."""
    for key, value in _GATE_DEMO_ENV.items():
        os.environ[key] = value


def gate_demo_env() -> Mapping[str, str]:
    """Return a copy suitable for subprocess ``env=`` injection."""
    merged = os.environ.copy()
    merged.update(_GATE_DEMO_ENV)
    return merged
