"""Target Asset Catalogue — 10 target classes (blueprint 'Target Catalogue' sheet)."""
from ..schemas import Interface, TargetClass, TargetSpec

# id, class, interface, default packs, safety notes, criticality
TARGET_CATALOGUE: list[TargetSpec] = [
    TargetSpec(id="TGT-01", name="Customer-facing chatbot (CSP care copilot)",
               target_class=TargetClass.CHATBOT, interface=Interface.MODEL_API,
               packs=["PIN", "EXF", "OUT", "HAL"],
               prod_safety_notes="Prod testing rate-capped; G1 for content-safety packs", asset_criticality=4),
    TargetSpec(id="TGT-02", name="Employee copilot (M365-style intranet assistant)",
               target_class=TargetClass.EMPLOYEE_COPILOT, interface=Interface.AGENT_ENDPOINT,
               packs=["PIN", "EXF", "AGE", "MEM"],
               prod_safety_notes="Canary-seeded intranet docs", asset_criticality=4),
    TargetSpec(id="TGT-03", name="RAG knowledge app (policy/KB search)",
               target_class=TargetClass.RAG_APP, interface=Interface.RAG_API,
               packs=["PIN", "EXF", "MEM"],
               prod_safety_notes="Staging corpus with canaries first", asset_criticality=3),
    TargetSpec(id="TGT-04", name="Tool-calling agent (ticketing/CRM)",
               target_class=TargetClass.TOOL_AGENT, interface=Interface.TOOL_SCHEMA,
               packs=["PIN", "AGE", "CON"],
               prod_safety_notes="Sandbox tenant with simulated tools", asset_criticality=4),
    TargetSpec(id="TGT-05", name="Multi-agent workflow (A2A orchestrator)",
               target_class=TargetClass.MULTI_AGENT, interface=Interface.AGENT_ENDPOINT,
               packs=["PIN", "AGE", "MEM"],
               prod_safety_notes="Isolated workflow replica", asset_criticality=5),
    TargetSpec(id="TGT-06", name="Coding assistant (IDE copilot)",
               target_class=TargetClass.CODING_ASSISTANT, interface=Interface.MODEL_API,
               packs=["PIN", "OUT", "SUP"],
               prod_safety_notes="Fork sandbox repo only", asset_criticality=3),
    TargetSpec(id="TGT-07", name="Voice AI agent (IVR replacement)",
               target_class=TargetClass.VOICE_AGENT, interface=Interface.MODEL_API,
               packs=["PIN", "EXF", "HAL"],
               prod_safety_notes="Synthetic voice, test numbers only", asset_criticality=3),
    TargetSpec(id="TGT-08", name="AI gateway / guardrail firewall",
               target_class=TargetClass.AI_GATEWAY, interface=Interface.MODEL_API,
               packs=["PIN", "CON"],
               prod_safety_notes="Bypass proven with benign probes + canary payload", asset_criticality=4),
    TargetSpec(id="TGT-09", name="Fine-tuned proprietary model endpoint",
               target_class=TargetClass.FINETUNED_MODEL, interface=Interface.MODEL_API,
               packs=["EXF", "HAL", "CON"],
               prod_safety_notes="Quota-budgeted; extraction via canaries", asset_criticality=3),
    TargetSpec(id="TGT-10", name="Agentic process automation (AI-driven RPA)",
               target_class=TargetClass.AGENTIC_RPA, interface=Interface.AGENT_ENDPOINT,
               packs=["PIN", "AGE", "MEM"],
               prod_safety_notes="Shadow tenant; never production BSS writes", asset_criticality=5),
]


def demo_target() -> TargetSpec:
    """The Tier-1 demo target: a local deliberately-vulnerable app (M1)."""
    return TargetSpec(
        id="TGT-DEMO", name="RedForge vulnerable demo copilot",
        target_class=TargetClass.EMPLOYEE_COPILOT, interface=Interface.MODEL_API,
        packs=["PIN", "EXF", "OUT", "AGE", "MEM", "CON", "HAL", "SUP"],
        prod_safety_notes="Local fixture — seeded flaw per pack (M1 gate)", asset_criticality=2)


def campaign_target() -> TargetSpec:
    """Target spec for live campaigns (always the demo fixture unless extended)."""
    return demo_target()
