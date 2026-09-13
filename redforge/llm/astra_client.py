"""Azure OpenAI Responses API client for the GPT Astra deployment."""
from __future__ import annotations

import httpx

from redforge.config import settings


def extract_output_text(response: dict) -> str:
    """Pull assistant text from a Responses API payload."""
    parts: list[str] = []
    for item in response.get("output") or []:
        if item.get("type") != "message":
            continue
        for block in item.get("content") or []:
            if block.get("type") == "output_text" and block.get("text"):
                parts.append(str(block["text"]))
    return "\n".join(parts).strip()


class AstraClient:
    """Thin httpx wrapper for Azure OpenAI /openai/responses."""

    def __init__(
        self,
        *,
        endpoint: str | None = None,
        api_key: str | None = None,
        api_version: str | None = None,
        deployment: str | None = None,
    ) -> None:
        self.endpoint = (endpoint or settings.astra_endpoint).rstrip("/")
        self.api_key = api_key if api_key is not None else settings.astra_api_key
        self.api_version = api_version or settings.astra_api_version
        self.deployment = deployment or settings.astra_deployment

    @property
    def configured(self) -> bool:
        return bool(self.api_key and self.endpoint and self.deployment)

    @property
    def url(self) -> str:
        return f"{self.endpoint}/openai/responses?api-version={self.api_version}"

    def complete(
        self,
        *,
        input: str | list[dict],
        instructions: str | None = None,
        max_output_tokens: int = 256,
        timeout: float = 60.0,
    ) -> dict:
        if not self.configured:
            raise RuntimeError("Astra client is not configured (RF_ASTRA_API_KEY required)")

        body: dict = {
            "model": self.deployment,
            "input": input,
            "max_output_tokens": max_output_tokens,
        }
        if instructions:
            body["instructions"] = instructions

        headers = {"api-key": self.api_key, "Content-Type": "application/json"}
        r = httpx.post(self.url, headers=headers, json=body, timeout=timeout)
        r.raise_for_status()
        return r.json()

    def complete_text(self, **kwargs) -> str:
        return extract_output_text(self.complete(**kwargs))
