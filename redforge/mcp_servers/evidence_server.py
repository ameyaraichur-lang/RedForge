"""MCP server: evidence store access.

The evidence subsystem (redforge.evidence) is imported LAZILY inside every
tool: if it is ever absent the tools return a clear error dict instead of
raising, so this server stays registrable in any install state. The store is
opened per call against settings.evidence_db; writes are idempotent upserts
keyed by artifact id (canonical EvidenceStore protocol).

Run: ``python -m redforge.mcp_servers.evidence_server`` (stdio).
"""
from __future__ import annotations

from fastmcp import FastMCP
from pydantic import BaseModel

from redforge.config import settings

mcp = FastMCP("redforge-evidence")

_NOT_BUILT = {"error": "evidence module not built yet (redforge.evidence.store.EvidenceStore unavailable)"}


def _open_store():
    """Lazy-import and open the evidence store, or raise ImportError."""
    from redforge.evidence.store import EvidenceStore  # noqa: PLC0415 - lazy on purpose

    return EvidenceStore(settings.evidence_db)


def _dump(entry) -> dict:
    return entry.model_dump(mode="json") if isinstance(entry, BaseModel) else entry


def _status(value: str):
    """Coerce a status string ("Candidate"|"Confirmed"|"Voided") or return None."""
    if not value:
        return None
    from redforge.schemas import FindingStatus  # noqa: PLC0415

    try:
        return FindingStatus(value)
    except ValueError:
        return None


@mcp.tool
def counts() -> dict:
    """Aggregate artifact counts from the evidence store.

    Returns {"attempts": n, "transcripts": n, "verdicts": n, "findings": n}.
    """
    try:
        store = _open_store()
        return store.counts()
    except ImportError:
        return dict(_NOT_BUILT)
    except Exception as exc:
        return {"error": f"{type(exc).__name__}: {exc}"}


@mcp.tool
def list_findings(status: str = "", campaign_id: str = "") -> dict:
    """List recorded findings, optionally filtered by status and campaign id.

    Returns {"count": n, "findings": [finding dicts]}.
    """
    try:
        store = _open_store()
        result = store.list_findings(status=_status(status),
                                     campaign_id=campaign_id or None)
    except ImportError:
        return dict(_NOT_BUILT)
    except Exception as exc:
        return {"error": f"{type(exc).__name__}: {exc}"}
    findings = [_dump(f) for f in result]
    return {"count": len(findings), "findings": findings}


@mcp.tool
def record_finding(finding_json: str) -> dict:
    """Record one Finding (JSON body of the redforge Finding schema) to the store.

    Returns {"ok": true, "finding": {...}} or {"ok": false, "error": ...}.
    """
    try:
        from redforge.schemas import Finding

        finding = Finding.model_validate_json(finding_json)
    except ImportError:
        return dict(_NOT_BUILT)
    except Exception as exc:
        return {"ok": False, "error": f"invalid Finding JSON: {exc}"}
    try:
        store = _open_store()
        store.record_finding(finding)
    except ImportError:
        return dict(_NOT_BUILT)
    except Exception as exc:
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
    return {"ok": True, "finding": finding.model_dump(mode="json")}


@mcp.tool
def get_finding(finding_id: str) -> dict:
    """Fetch one finding by id (e.g. RF-F-0001) from the evidence store."""
    try:
        store = _open_store()
        result = store.get_finding(finding_id)
    except ImportError:
        return dict(_NOT_BUILT)
    except Exception as exc:
        return {"error": f"{type(exc).__name__}: {exc}"}
    if result is None:
        return {"error": f"finding {finding_id!r} not found"}
    return _dump(result)


if __name__ == "__main__":
    mcp.run()
