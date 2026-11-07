import asyncio

import pytest
from conftest import SYLLABUS, ScriptedRunner

from phact_agents.config import Settings
from phact_agents.pipeline import AnalysisRequest, InputTooLargeError, analyze
from phact_agents.safety import BLOCKED_MESSAGE, InputSafety


def run(deps, text=SYLLABUS):
    return asyncio.run(analyze(AnalysisRequest("job-1", "syl-1", text, "EPID 601"), deps))


def test_agents_1_and_2_run_concurrently(make_deps):
    runner = ScriptedRunner(delay=0.3)
    run(make_deps(runner=runner))
    a1, a2 = runner.calls["competency_agent"], runner.calls["approved_syllabus_agent"]
    assert a2["start"] < a1["end"] and a1["start"] < a2["end"]
    assert runner.calls["curriculum_transformation_agent"]["start"] >= max(a1["end"], a2["end"])


def test_each_agent_gets_only_its_own_kb_tool(make_deps):
    runner = ScriptedRunner(delay=0)
    run(make_deps(runner=runner))
    assert runner.calls["competency_agent"]["tools"] == ["search_competency_guidelines"]
    assert runner.calls["approved_syllabus_agent"]["tools"] == ["search_approved_syllabi"]
    assert runner.calls["curriculum_transformation_agent"]["tools"] == []


def test_citations_are_resolved_by_code_and_fake_ids_dropped(make_deps):
    result = run(make_deps())
    assert result.status == "SUCCEEDED"
    grounded, ungrounded = result.recommendations
    assert [c.id for c in grounded.citations] == ["C1", "S1"]
    assert grounded.citations[0].title == "CEPH MPH Foundational Competencies"
    assert grounded.citations[1].kind == "Faculty Example"
    assert grounded.grounded and not ungrounded.grounded and ungrounded.citations == []
    assert any("Z9" in w for w in result.warnings)
    mapping = result.competencyMappings[0]
    assert [c.id for c in mapping.citations] == ["C1"]  # C99 was never retrieved
    assert any("C99" in w for w in result.warnings)
    assert mapping.source == "CEPH MPH Foundational Competencies (p. 1)"


def test_pii_is_removed_before_any_agent_sees_the_syllabus(make_deps):
    runner = ScriptedRunner(delay=0)
    result = run(make_deps(runner=runner))
    for call in runner.calls.values():
        assert "test.person@example.edu" not in call["prompt"]
        assert "617-555-0100" not in call["prompt"]
    assert result.piiRedactions == 2
    assert "leak@example.edu" not in result.revisedSyllabus.markdown


def test_guardrail_block_stops_before_agents(make_deps, settings):
    class BlockingRuntime:
        def apply_guardrail(self, **kwargs):
            assert kwargs["source"] == "INPUT"
            return {"action": "GUARDRAIL_INTERVENED"}

    s = Settings(**{**settings.__dict__, "guardrail_id": "gr-1"})
    runner = ScriptedRunner(delay=0)
    result = run(make_deps(runner=runner, s=s, safety=InputSafety(s, bedrock_runtime=BlockingRuntime())))
    assert result.status == "BLOCKED" and result.message == BLOCKED_MESSAGE
    assert runner.calls == {}


def test_one_failed_specialist_is_a_warning(make_deps):
    result = run(make_deps(runner=ScriptedRunner(delay=0, fail={"approved_syllabus_agent"})))
    assert result.status == "SUCCEEDED"
    assert any("Approved syllabus agent failed" in w for w in result.warnings)
    assert [c.id for c in result.recommendations[0].citations] == ["C1"]  # S1 was never retrieved


def test_both_specialists_failing_raises(make_deps):
    with pytest.raises(RuntimeError):
        run(make_deps(runner=ScriptedRunner(delay=0, fail={"competency_agent", "approved_syllabus_agent"})))


def test_oversized_input_is_rejected(make_deps, settings):
    s = Settings(**{**settings.__dict__, "max_syllabus_chars": 50})
    with pytest.raises(InputTooLargeError):
        run(make_deps(s=s))
