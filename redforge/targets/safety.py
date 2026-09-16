"""Turn a target's declared criticality into caps that actually bind.

``TargetSpec.asset_criticality`` and ``prod_safety_notes`` were documentation:
the catalogue says TGT-05 is criticality 5 and must run against an isolated
replica, and nothing read either field. A campaign against the most critical
asset in the catalogue could request the same 500 attempts as the local fixture.

Criticality raises the blast radius of being wrong, so it lowers the ceiling.
Caps are clamped, never raised — a caller asking for less than the ceiling
keeps their smaller number.
"""
from __future__ import annotations

from dataclasses import dataclass

from redforge.schemas.campaign import BudgetCaps, TargetSpec


@dataclass(frozen=True)
class CriticalityCeiling:
    max_attempts: int
    max_tokens: int
    max_cost_usd: float
    deadline_minutes: int


#: asset_criticality (1-5) -> ceiling. 1-2 is a lab or fixture; 5 is an asset
#: whose failure is a business event, tested in the smallest increments.
CEILINGS: dict[int, CriticalityCeiling] = {
    1: CriticalityCeiling(500, 2_000_000, 25.0, 60),
    2: CriticalityCeiling(500, 2_000_000, 25.0, 60),
    3: CriticalityCeiling(250, 1_000_000, 15.0, 45),
    4: CriticalityCeiling(120, 400_000, 8.0, 30),
    5: CriticalityCeiling(60, 200_000, 4.0, 20),
}


def ceiling_for(criticality: int) -> CriticalityCeiling:
    """Ceiling for a criticality level, clamped into the declared 1-5 range."""
    level = max(1, min(5, int(criticality)))
    return CEILINGS[level]


def caps_for_target(spec: TargetSpec, caps: BudgetCaps | None = None) -> BudgetCaps:
    """Clamp ``caps`` to what this target's criticality permits."""
    requested = caps or BudgetCaps()
    limit = ceiling_for(spec.asset_criticality)
    return BudgetCaps(
        max_attempts=min(requested.max_attempts, limit.max_attempts),
        max_tokens=min(requested.max_tokens, limit.max_tokens),
        max_cost_usd=min(requested.max_cost_usd, limit.max_cost_usd),
        deadline_minutes=min(requested.deadline_minutes, limit.deadline_minutes),
    )


def clamped_fields(spec: TargetSpec, caps: BudgetCaps) -> dict[str, tuple]:
    """Which caps this target's criticality actually reduced, for the audit
    trail — a silent clamp looks like the operator's own number."""
    applied = caps_for_target(spec, caps)
    changed: dict[str, tuple] = {}
    for field in ("max_attempts", "max_tokens", "max_cost_usd", "deadline_minutes"):
        before, after = getattr(caps, field), getattr(applied, field)
        if before != after:
            changed[field] = (before, after)
    return changed


def safety_briefing(spec: TargetSpec) -> str:
    """The operating constraint recorded for this asset, for events, the
    dossier and the operator transcript."""
    notes = (spec.prod_safety_notes or "").strip()
    limit = ceiling_for(spec.asset_criticality)
    prefix = (f"{spec.id} criticality {spec.asset_criticality}/5 — caps "
              f"ceiling {limit.max_attempts} attempts / "
              f"{limit.deadline_minutes} min")
    return f"{prefix}. Operating constraint: {notes}" if notes else f"{prefix}."
