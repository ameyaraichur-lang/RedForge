"""Central settings. Demo-mode-first (D3): no LLM keys required."""
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Legacy alias when RF_JUDGE_PROVIDER is unset: RF_LLM_PROVIDER selects the judge.
    # astra here means Astra LLM judge only — never a campaign attack target.
    # demo = offline heuristics (default, D3)
    # astra = Azure OpenAI Responses API (GPT Astra deployment) for LLM validation
    # real = OpenAI-compatible /chat/completions judge (and optionally target)
    llm_provider: str = "demo"

    # Explicit selectors (preferred). Empty -> fall back as documented below.
    # target: demo | real only (astra is rejected — judge-only)
    # judge: demo | astra | real
    target_provider: str = ""
    judge_provider: str = ""

    # OpenAI-compatible red-team target (real mode)
    target_base_url: str = "http://127.0.0.1:8901/v1"
    target_api_key: str = ""

    # Azure OpenAI GPT Astra — Responses API (api-version 2025-04-01-preview)
    astra_endpoint: str = "https://dev-agentic.openai.azure.com"
    astra_api_version: str = "2025-04-01-preview"
    astra_api_key: str = ""
    astra_deployment: str = "gpt-6-astra"

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

    # Operator auth: demo (labeled bootstrap) | secure (credentials + signed sessions)
    operator_auth_mode: str = "demo"  # demo | secure
    operator_session_secret: str = ""  # required for secure mode
    operator_session_ttl_minutes: int = 30
    operator_demo_bootstrap: bool = False  # demo mode only; must be explicitly enabled
    operator_allow_plain_passwords: bool = False  # test/dev only for secure users JSON
    # JSON array: [{"username":"op","password_hash":"pbkdf2:...","role":"operator"}]
    operator_secure_users: str = ""
    # OIDC/JWKS extension (optional external IdP)
    operator_oidc_jwks_url: str = ""
    operator_oidc_audience: str = ""
    operator_oidc_issuer: str = ""

    # Operator voice gateway (server-side proxy — keys never in browser)
    operator_voice_mode: str = "simulated"  # simulated | openai_compat
    operator_voice_stt_url: str = "http://127.0.0.1:9000/v1/audio/transcriptions"
    operator_voice_tts_url: str = "http://127.0.0.1:9000/v1/audio/speech"
    operator_voice_api_key: str = ""
    operator_voice_model_stt: str = "whisper-1"
    operator_voice_model_tts: str = "tts-1"
    operator_voice_timeout_s: float = 30.0
    operator_voice_max_audio_bytes: int = 5_242_880  # 5 MiB
    operator_voice_max_duration_s: int = 30
    operator_voice_allowed_mime: str = "audio/webm,audio/wav,audio/ogg,audio/mpeg"

    # Durable operator stores (confirmation JTIs + tamper-evident audit chain)
    operator_db: str = str(Path(__file__).resolve().parent.parent / "output" / "live" / "operator.db")
    operator_audit_signing_key: str = ""  # required in secure mode
    operator_confirm_jti_retention_hours: int = 48

    model_config = SettingsConfigDict(
        env_prefix="RF_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()


def effective_target_provider() -> str:
    """Campaign attack target: demo or real OpenAI-compatible — never Astra."""
    explicit = settings.target_provider.strip().lower()
    if explicit and explicit != "astra":
        return explicit
    legacy = settings.llm_provider.strip().lower()
    if legacy == "real":
        return "real"
    return "demo"


def effective_judge_provider() -> str:
    """LLM validation/judge provider: demo, astra, or real."""
    explicit = settings.judge_provider.strip().lower()
    if explicit:
        return explicit
    legacy = settings.llm_provider.strip().lower()
    return legacy or "demo"
