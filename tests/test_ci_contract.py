"""CI safety contracts — paid providers must stay offline in automated runs."""
from redforge.config import effective_judge_provider, effective_target_provider, settings


def test_pytest_autouse_forces_demo_providers():
    assert settings.llm_provider == "demo"
    assert settings.target_provider == ""
    assert settings.judge_provider == ""
    assert settings.astra_api_key == ""
    assert effective_target_provider() == "demo"
    assert effective_judge_provider() == "demo"
