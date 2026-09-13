"""LLM provider adapters (Azure OpenAI Astra Responses API, etc.)."""
from .astra_client import AstraClient, extract_output_text

__all__ = ["AstraClient", "extract_output_text"]
