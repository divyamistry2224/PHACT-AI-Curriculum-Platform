import asyncio
import json
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from phact_agents.config import Settings  # noqa: E402
from phact_agents.doc_check import DocumentCheck  # noqa: E402
from phact_agents.evidence import Chunk  # noqa: E402
from phact_agents.pipeline import Dependencies  # noqa: E402
from phact_agents.safety import InputSafety  # noqa: E402
from phact_agents.schemas import (  # noqa: E402
    CompetencyFindings,
    SyllabusExampleFindings,
    SynthesisOutput,
)

SYLLABUS = """EPID 601: Applied Epidemiologic Methods
School of Public Health | Fall 2026 | 3 graduate credits
Instructor: Dr. Test Person | test.person@example.edu | 617-555-0100
Course description
This course introduces epidemiologic reasoning and applied methods for investigating health patterns in populations.
Learning outcomes
- Calculate and interpret incidence, prevalence and risk ratios.
- Analyze a de-identified public health dataset using reproducible code.
Assessment and grading
Weekly problem sets 30% | Critical appraisal memo 15% | Midterm exam 20% | Final analysis report 35%
Weekly schedule
Week 7 | Bias and measurement error | Critical appraisal memo due
Final analysis report (2,500-3,000 words plus reproducible code)."""

RESUME = """Jordan Smith - Data Analyst
Experience: Data Analyst, Acme Corp, 2022-2025. Built dashboards in Tableau and SQL; reduced reporting time.
Education: BS Statistics, State University, 2022. Skills: Python, SQL, Tableau, Excel, stakeholder communication.
Projects: churn prediction model; sales forecasting; automated weekly KPI emails for the leadership team.
References available on request. Volunteer: food bank coordinator, 2019-2022; mentor for first-year students."""


class FakeRetriever:
    def __init__(self, kb: str):
        self.kb = kb
        self.queries: list[str] = []

    def retrieve(self, query, top_k):
        self.queries.append(query)
        if self.kb == "competency":
            return [
                Chunk("4. Interpret results of data analysis for public health research, policy or practice.",
                      "ceph-mph-foundational", "CEPH MPH Foundational Competencies", "CEPH", "v1", 1, 0.91),
                Chunk("3. Analyze quantitative and qualitative data using biostatistics, informatics ...",
                      "ceph-mph-foundational", "CEPH MPH Foundational Competencies", "CEPH", "v1", 1, 0.85),
            ]
        return [Chunk("Students may use generative AI for brainstorming if disclosed in a methods note.",
                      "mph-syllabus-02-southeast", "MPH Sample Syllabus 02", "Synthetic", "v1", 1, 0.8)]


class ScriptedRunner:
    """Stands in for Strands: calls the search tool like an agent would, then returns canned output."""

    def __init__(self, delay: float = 0.2, fail: set[str] | None = None, doc_check: DocumentCheck | None = None):
        self.delay = delay
        self.fail = fail or set()
        self.doc_check = doc_check or DocumentCheck(is_syllabus=True, is_public_health=True,
                                                    document_type="course syllabus", confidence=0.95, reason="ok")
        self.calls: dict[str, dict] = {}

    async def run(self, *, name, system_prompt, prompt, tools, output_model, max_tokens, model_id=None):
        start = time.perf_counter()
        self.calls[name] = {"prompt": prompt, "start": start, "tools": [t.__name__ for t in tools], "model_id": model_id}
        if name in self.fail:
            raise RuntimeError(f"{name} exploded")
        if output_model is DocumentCheck:
            return self.doc_check
        await asyncio.sleep(self.delay)
        results = json.loads(tools[0]("course objectives")) if tools else None
        ids = [r["evidence_id"] for r in (results or {}).get("results", [])]
        self.calls[name]["end"] = time.perf_counter()
        if output_model is CompetencyFindings:
            return CompetencyFindings.model_validate({
                "mappings": [{
                    "objective": "Calculate and interpret incidence, prevalence and risk ratios.",
                    "competency": "CEPH MPH Foundational Competency 4: Interpret results of data analysis",
                    "alignment": "Partial Alignment", "gap": "No policy translation task",
                    "improvement": "Add a policy brief", "reasoning": "Synthesis",
                    "evidence_ids": [ids[0], "C99"],
                }],
                "workforce_notes": [],
            })
        if output_model is SyllabusExampleFindings:
            return SyllabusExampleFindings.model_validate({"patterns": [{
                "pattern": "AI disclosure methods note", "applies_to": "Final analysis report",
                "adaptation": "Require a methods note", "evidence_ids": ids,
            }]})
        assert output_model is SynthesisOutput
        assert "<evidence_catalogue>" in prompt and ('"C1"' in prompt or '"S1"' in prompt)
        return SynthesisOutput.model_validate({
            "recommendations": [
                {"title": "AI-assisted code review with disclosure", "module": "Final analysis report",
                 "activity_type": "Assignment redesign", "integration_type": "AI_ASSISTED",
                 "description": "d", "rationale": "r", "implementation_steps": ["s1"],
                 "learning_outcomes": ["o1"], "responsible_ai": "Disclose and verify",
                 "evidence_ids": ["C1", "S1"]},
                {"title": "Oral defence of appraisal memo", "module": "Week 7",
                 "activity_type": "Assessment", "integration_type": "AI_RESISTANT",
                 "description": "d", "rationale": "r", "implementation_steps": [],
                 "learning_outcomes": [], "responsible_ai": "n/a", "evidence_ids": ["Z9"]},
            ],
            "revised_syllabus": {"title": "EPID 601 (revised draft)", "change_summary": ["Week 7: oral defence"],
                                 "markdown": "# EPID 601\n- [PHACT] Oral defence\nContact: leak@example.edu"},
        })


@pytest.fixture
def settings():
    return Settings(pii_mode="regex", competency_kb_id="kb-c", syllabus_kb_id="kb-s")


@pytest.fixture
def make_deps(settings):
    def factory(runner=None, safety=None, s=None):
        s = s or settings
        return Dependencies(
            settings=s,
            runner=runner or ScriptedRunner(),
            competency_retriever=FakeRetriever("competency"),
            syllabus_retriever=FakeRetriever("syllabus"),
            safety=safety or InputSafety(s),
        )
    return factory
