"""Swarm Execution DAG / Campaign Engine (M4).

- mutator: bounded payload transforms for mutation rounds 2-3 (tenet T3).
- runner:  CampaignEngine executing the 15-node blueprint DAG end-to-end
           (mission control -> recon -> strategist -> operators/judge/mutator
           -> chain-builder -> verifier -> scorer) under hard budget caps and
           G1 gate interrupts (tenet T5).
"""
from .mutator import MUTATIONS, mutate
from .runner import CampaignEngine, CampaignResult, run_demo_campaign

__all__ = ["MUTATIONS", "mutate", "CampaignEngine", "CampaignResult",
           "run_demo_campaign"]
