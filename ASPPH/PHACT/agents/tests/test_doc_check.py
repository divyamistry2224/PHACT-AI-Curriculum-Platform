import asyncio

from conftest import RESUME, SYLLABUS, ScriptedRunner

from phact_agents.config import Settings
from phact_agents.doc_check import DocumentCheck, check_document
from phact_agents.pipeline import AnalysisRequest, analyze
from phact_agents.service import handle

SPECIALISTS = {"competency_agent", "approved_syllabus_agent", "curriculum_transformation_agent"}

CS_SYLLABUS = SYLLABUS.replace("EPID 601: Applied Epidemiologic Methods", "CS 5800: Algorithms") \
    .replace("School of Public Health", "Khoury College of Computer Sciences") \
    .replace("epidemiologic reasoning and applied methods for investigating health patterns in populations",
             "graph algorithms, dynamic programming and complexity") \
    .replace("incidence, prevalence and risk ratios", "running times") \
    .replace("a de-identified public health dataset", "a benchmark dataset")


def classifier(**kwargs):
    base = dict(is_syllabus=True, is_public_health=True, document_type="course syllabus", confidence=0.9, reason="r")
    return DocumentCheck(**{**base, **kwargs})


def analyze_with(make_deps, runner, text=SYLLABUS, **request):
    return asyncio.run(analyze(AnalysisRequest("job-1", "syl-1", text, **request), make_deps(runner=runner)))


def test_short_or_unstructured_text_is_rejected_without_a_model_call():
    runner = ScriptedRunner(delay=0)
    result = asyncio.run(check_document("Meeting notes: discuss budget.", runner))
    assert result.verdict == "NOT_A_SYLLABUS" and result.method == "heuristic"
    assert runner.calls == {}


def test_classifier_rejects_a_resume_and_no_agent_runs(make_deps):
    runner = ScriptedRunner(delay=0, doc_check=classifier(is_syllabus=False, document_type="resume",
                                                          reason="It lists jobs and skills."))
    result = analyze_with(make_deps, runner, RESUME + "\nCourse credits: 3. Final project, 30% weight.")
    assert result.status == "REJECTED"
    assert result.documentCheck.verdict == "NOT_A_SYLLABUS"
    assert result.message.startswith("This file looks like a resume, not a course syllabus.")
    assert not SPECIALISTS & set(runner.calls)


def test_classifier_uses_the_small_check_model(make_deps):
    runner = ScriptedRunner(delay=0)
    analyze_with(make_deps, runner)
    assert runner.calls["document_check"]["model_id"] == Settings().check_model_id
    assert runner.calls["competency_agent"]["model_id"] is None


def test_non_public_health_syllabus_needs_confirmation(make_deps):
    runner = ScriptedRunner(delay=0, doc_check=classifier(is_public_health=False))
    rejected = analyze_with(make_deps, runner, CS_SYLLABUS)
    assert rejected.status == "REJECTED" and rejected.documentCheck.verdict == "NOT_PUBLIC_HEALTH"

    runner = ScriptedRunner(delay=0, doc_check=classifier(is_public_health=False))
    confirmed = analyze_with(make_deps, runner, CS_SYLLABUS, confirm_relevance=True)
    assert confirmed.status == "SUCCEEDED"
    assert any("does not appear to be a public health course" in w for w in confirmed.warnings)


def test_low_confidence_passes_with_a_warning(make_deps):
    result = analyze_with(make_deps, ScriptedRunner(delay=0, doc_check=classifier(is_syllabus=False, confidence=0.4)))
    assert result.status == "SUCCEEDED" and result.documentCheck.verdict == "UNCERTAIN"
    assert any("could not confirm" in w for w in result.warnings)


def test_classifier_failure_falls_back_to_heuristics():
    syllabus = asyncio.run(check_document(SYLLABUS, ScriptedRunner(delay=0, fail={"document_check"})))
    assert syllabus.verdict == "OK" and syllabus.method == "heuristic_fallback"
    cs = asyncio.run(check_document(CS_SYLLABUS, ScriptedRunner(delay=0, fail={"document_check"})))
    assert cs.verdict == "NOT_PUBLIC_HEALTH"


def test_check_only_mode_runs_no_analysis(make_deps):
    runner = ScriptedRunner(delay=0, doc_check=classifier(is_syllabus=False, document_type="research article"))
    out = asyncio.run(handle({"mode": "check_only", "syllabus_text": SYLLABUS}, Settings(pii_mode="regex"),
                             deps_factory=lambda s: make_deps(s=s, runner=runner)))
    assert out["status"] == "CHECKED" and out["accepted"] is False and out["can_confirm"] is False
    assert out["message"].startswith("This file looks like a research article")
    assert set(runner.calls) == {"document_check"}
    assert "test.person@example.edu" not in runner.calls["document_check"]["prompt"]


def test_check_can_be_switched_off(make_deps, settings):
    s = Settings(**{**settings.__dict__, "doc_check": False})
    runner = ScriptedRunner(delay=0)
    result = asyncio.run(analyze(AnalysisRequest("j", "s", SYLLABUS), make_deps(runner=runner, s=s)))
    assert result.status == "SUCCEEDED" and result.documentCheck is None and "document_check" not in runner.calls
