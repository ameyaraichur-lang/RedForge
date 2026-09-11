"""Canary framework (M1): mint honeytokens, seed corpora, and prove exfiltration."""
from .detector import check_and_prove, hits, prove_exfiltration, scan
from .generator import CANARY_RE, make_canary, seed_corpus, substitute
from .listener import app, create_app, run_listener

__all__ = [
    "CANARY_RE", "make_canary", "seed_corpus", "substitute",
    "app", "create_app", "run_listener",
    "check_and_prove", "hits", "prove_exfiltration", "scan",
]
