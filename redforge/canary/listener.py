"""Honeytoken webhook listener: a hit proves data left the target boundary (M1)."""
import datetime as dt

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel

from .generator import CANARY_RE


class Hit(BaseModel):
    token: str
    payload: str | None = None


def create_app() -> FastAPI:
    """App factory; each app carries a fresh in-memory hit store (test isolation)."""
    app = FastAPI(title="AI-RedForge Canary Listener", version="0.1.0")
    app.state.hits = []

    @app.post("/canary/hit")
    async def record_hit(body: Hit, request: Request) -> dict:
        """Out-of-band beacon: someone touched our honeytoken and it phoned home."""
        if not CANARY_RE.fullmatch(body.token):
            raise HTTPException(status_code=400, detail="token does not match canary format")
        app.state.hits.append(
            {
                "token": body.token,
                "ts": dt.datetime.now(dt.timezone.utc).isoformat(),
                "payload": body.payload,
                "source_ip": request.client.host if request.client else "",
            }
        )
        return {"recorded": True, "count": len(app.state.hits)}

    @app.get("/canary/hits")
    async def list_hits() -> dict:
        return {"hits": list(app.state.hits)}

    @app.get("/canary/hits/{token}")
    async def hits_for(token: str) -> dict:
        if not CANARY_RE.fullmatch(token):
            raise HTTPException(status_code=400, detail="invalid canary token")
        return {"hits": [h for h in app.state.hits if h["token"] == token]}

    @app.delete("/canary/hits")
    async def clear_hits() -> dict:
        cleared = len(app.state.hits)
        app.state.hits.clear()
        return {"cleared": True, "count": cleared}

    return app


app = create_app()


def run_listener(host: str | None = None, port: int | None = None) -> None:
    """Manual-use entrypoint (uvicorn); tests exercise the app via ASGITransport."""
    import uvicorn

    from redforge.config import settings

    uvicorn.run(
        app,
        host=host if host is not None else settings.canary_host,
        port=port if port is not None else settings.canary_port,
    )
