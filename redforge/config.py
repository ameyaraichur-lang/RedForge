"""Central settings. Demo-mode-first (D3): no LLM keys required."""
from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # demo = offline scripted providers (default, D3); real = live OpenAI-compatible target
    llm_provider: str = "demo"
    # If real mode: target speaks OpenAI-compatible API
    target_base_url: str = "http://127.0.0.1:8901/v1"
    target_api_key: str = ""

    # Evidence store (D4: SQLite substitution for Postgres)
    evidence_db: str = str(Path(__file__).resolve().parent.parent / "redforge.db")

    # Canary webhook listener (M1)
    canary_host: str = "127.0.0.1"
    canary_port: int = 8902

    # Budget caps (blueprint tenet: bounded campaigns)
    budget_max_attempts: int = 500
    budget_max_tokens: int = 2_000_000
    budget_max_cost_usd: float = 25.0
    mutation_rounds_max: int = 3

    # OPA binary (real Rego path); engine falls back to pure Python when absent
    opa_path: str = str(Path(__file__).resolve().parent.parent.parent / ".tools" / "opa.exe")

    model_config = {"env_prefix": "RF_"}


settings = Settings()
