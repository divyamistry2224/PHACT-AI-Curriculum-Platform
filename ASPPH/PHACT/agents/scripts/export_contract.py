"""Write contracts/analysis.schema.json (and a structural example) from the Pydantic models.

Re-run after changing phact_agents/schemas.py so the frontend and backend stay in sync.
"""

import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "tests")]

from conftest import SYLLABUS, FakeRetriever, ScriptedRunner  # noqa: E402

from phact_agents.config import Settings  # noqa: E402
from phact_agents.pipeline import AnalysisRequest, Dependencies, analyze  # noqa: E402
from phact_agents.safety import InputSafety  # noqa: E402
from phact_agents.schemas import AnalysisResult  # noqa: E402

CONTRACTS = ROOT.parent / "contracts"


def main() -> None:
    CONTRACTS.mkdir(exist_ok=True)
    schema = AnalysisResult.model_json_schema()
    schema["$id"] = "phact/analysis.schema.json"
    schema["description"] = "PHACT analysis result returned by the AgentCore runtime (generated from phact_agents/schemas.py)."
    (CONTRACTS / "analysis.schema.json").write_text(json.dumps(schema, indent=1) + "\n", "utf-8")

    settings = Settings(pii_mode="regex", model_id="example-model-id")
    deps = Dependencies(settings, ScriptedRunner(delay=0), FakeRetriever("competency"), FakeRetriever("syllabus"),
                        InputSafety(settings))
    example = asyncio.run(analyze(AnalysisRequest("job_example", "syllabus_example", SYLLABUS, "EPID 601"), deps))
    data = example.model_dump(mode="json")
    data["generatedAt"] = "2026-11-04T12:00:00+00:00"
    data["timingsMs"] = {"safety": 5, "agent1_competency": 21000, "agent2_syllabus": 18000, "agent3_synthesis": 30000, "total": 51005}
    (CONTRACTS / "analysis.example.json").write_text(json.dumps(data, indent=1) + "\n", "utf-8")
    print("wrote", CONTRACTS / "analysis.schema.json", "and analysis.example.json (placeholder content, not a real analysis)")


if __name__ == "__main__":
    main()
