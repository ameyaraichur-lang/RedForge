"""Deterministic ID generation for reproducible demo campaigns."""
from __future__ import annotations

import random
import uuid


class RunIds:
    """Hex suffix generator for RF-* artifact ids.

    When ``seed`` is set, ids are reproducible for a fixed campaign configuration.
    When ``seed`` is None, ids use cryptographically random uuid4 (production).
    """

    def __init__(self, seed: int | None = None) -> None:
        self.seed = seed
        self._rng = random.Random(seed) if seed is not None else None

    def hex8(self) -> str:
        if self._rng is None:
            return uuid.uuid4().hex[:8]
        return f"{self._rng.getrandbits(32):08x}"
