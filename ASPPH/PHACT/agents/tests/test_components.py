import asyncio
import io
import json
from pathlib import Path

import pytest
from conftest import SYLLABUS, ScriptedRunner

from phact_agents.config import Settings
from phact_agents.evidence import BedrockKbRetriever, Chunk, EvidenceStore, LocalCorpusRetriever, make_search_tool
from phact_agents.invoke_client import invoke_analysis, unwrap_response
from phact_agents.safety import InputSafety, regex_scrub
from phact_agents.service import handle

DATA = Path(__file__).resolve().parents[3] / "Data"


def test_regex_scrub():
    text, n = regex_scrub("Mail a.b@uni.edu or call (617) 555-0100; SSN 123-45-6789; week 12 | Nov 17")
    assert n == 3 and "uni.edu" not in text and "555" not in text and "Nov 17" in text


def test_comprehend_redacts_selected_types_only():
    class FakeComprehend:
        def detect_pii_entities(self, Text, LanguageCode):
            start = Text.index("Maya")
            date = Text.index("Sep 1")
            return {"Entities": [
                {"Type": "NAME", "Score": 0.99, "BeginOffset": start, "EndOffset": start + 9},
                {"Type": "DATE_TIME", "Score": 0.99, "BeginOffset": date, "EndOffset": date + 5},
            ]}

    safety = InputSafety(Settings(pii_mode="comprehend"), comprehend=FakeComprehend())
    text, n = safety.scrub("Instructor Maya Chen teaches on Sep 1.")
    assert text == "Instructor [NAME] teaches on Sep 1." and n == 1


def test_evidence_store_dedupes_and_numbers():
    store = EvidenceStore("C", "competency")
    chunk = Chunk("text", "src", "Title", "Pub", "v1", 2, 0.5)
    assert store.add(chunk).evidence_id == "C1"
    assert store.add(chunk).evidence_id == "C1"
    assert store.add(Chunk("other", "src", "Title", "Pub", "v1", 3, 0.4)).evidence_id == "C2"


def test_search_tool_returns_ids_and_records_evidence():
    class R:
        def retrieve(self, q, k):
            return [Chunk("passage", "s", "T", "P", "v1", 1, 0.9), Chunk("   ", "s", "T", "P", "v1", 2, 0.1)]

    store = EvidenceStore("S", "syllabus")
    search = make_search_tool("search_approved_syllabi", "doc", R(), store, 3)
    payload = json.loads(search("q"))
    assert [r["evidence_id"] for r in payload["results"]] == ["S1"] and "S1" in store
    assert search.__name__ == "search_approved_syllabi" and search.__doc__ == "doc"


def test_bedrock_retriever_filters_active_version_and_reads_metadata():
    class FakeClient:
        def retrieve(self, **kwargs):
            self.kwargs = kwargs
            return {"retrievalResults": [{
                "content": {"text": "4. Interpret results"},
                "location": {"s3Location": {"uri": "s3://b/competency/v1/ceph/p001.txt"}},
                "metadata": {"source_id": "ceph", "title": "CEPH", "page": 1.0, "corpus_version": "v1"},
                "score": 0.7,
            }]}

    client = FakeClient()
    chunks = BedrockKbRetriever("kb", "us-east-1", "v1", client=client).retrieve("q", 4)
    flt = client.kwargs["retrievalConfiguration"]["vectorSearchConfiguration"]["filter"]
    assert {c["equals"]["key"] for c in flt["andAll"]} == {"status", "corpus_version"}
    assert chunks[0].title == "CEPH" and chunks[0].page == 1 and chunks[0].source_id == "ceph"


def test_unwrap_handles_double_wrapped_and_fenced_json():
    inner = {"status": "SUCCEEDED"}
    assert unwrap_response(json.dumps(inner).encode()) == inner
    assert unwrap_response(json.dumps(json.dumps(inner)).encode()) == inner
    assert unwrap_response(json.dumps("```json\n" + json.dumps(inner) + "\n```")) == inner


def test_invoke_client_session_id_and_payload():
    class FakeAgentCore:
        def invoke_agent_runtime(self, **kwargs):
            self.kwargs = kwargs
            return {"response": io.BytesIO(json.dumps({"status": "SUCCEEDED"}).encode())}

    client = FakeAgentCore()
    assert invoke_analysis("arn:runtime", {"job_id": "j1"}, client=client) == {"status": "SUCCEEDED"}
    assert 33 <= len(client.kwargs["runtimeSessionId"]) <= 256
    assert json.loads(client.kwargs["payload"]) == {"job_id": "j1"}


def test_service_saves_result_and_triggers_postprocess(make_deps):
    class FakeS3:
        def put_object(self, **kwargs):
            self.put = kwargs

    class FakeLambda:
        def invoke(self, **kwargs):
            self.kwargs = kwargs

    settings = Settings(pii_mode="regex", results_bucket="results", postprocess_function="phact-postprocess")
    s3, lam = FakeS3(), FakeLambda()
    out = asyncio.run(handle({"job_id": "j1", "syllabus_id": "s1", "owner_sub": "u1", "syllabus_text": SYLLABUS},
                             settings, deps_factory=lambda s: make_deps(s=s), s3=s3, lam=lam))
    assert out["status"] == "SUCCEEDED" and out["result_key"] == "analyses/u1/j1/analysis.json"
    assert s3.put["ServerSideEncryption"] == "aws:kms"
    assert lam.kwargs["InvocationType"] == "Event"
    assert json.loads(lam.kwargs["Payload"])["result_key"] == out["result_key"]


def test_service_reports_failure_without_raising(make_deps):
    settings = Settings(pii_mode="regex")
    out = asyncio.run(handle({"job_id": "j2"}, settings, deps_factory=lambda s: make_deps(s=s)))
    assert out["status"] == "FAILED" and "syllabus_text" in out["result"]["message"]
    out = asyncio.run(handle({"job_id": "j3", "syllabus_text": SYLLABUS}, settings,
                             deps_factory=lambda s: make_deps(s=s, runner=ScriptedRunner(
                                 delay=0, fail={"competency_agent", "approved_syllabus_agent"}))))
    assert out["status"] == "FAILED" and out["result"]["message"] == "The analysis could not be completed. Please retry."


@pytest.mark.skipif(not DATA.exists(), reason="ASPPH/Data not checked out")
def test_docx_extraction_keeps_tables_and_headings():
    from phact_agents.extract import extract_text

    path = DATA / "Approved Syllabi/Synthetic/MPH_Syllabus_01_Northeast_Epidemiology.docx"
    text = extract_text(path.read_bytes(), path.name)
    assert "## Learning outcomes" in text
    assert "7 | Oct 13 | Bias and measurement error | Critical appraisal memo due" in text


@pytest.mark.skipif(not DATA.exists(), reason="ASPPH/Data not checked out")
def test_prepare_builds_pages_with_metadata(tmp_path):
    from phact_rag.__main__ import load_manifest, prepare

    manifest = load_manifest()
    manifest["sources"] = [s for s in manifest["sources"] if s["source_id"] in {"ceph-mph-foundational", "mph-syllabus-01-epidemiology"}]
    report = prepare(manifest, tmp_path)
    assert report["built"] == [{"source_id": "ceph-mph-foundational", "kb": "competency", "pages": 4}]
    assert report["skipped"][0]["source_id"] == "mph-syllabus-01-epidemiology"
    meta = json.loads((tmp_path / "v1/competency/ceph-mph-foundational/p001.txt.metadata.json").read_text("utf-8"))
    assert meta["metadataAttributes"].items() >= {"status": "ACTIVE", "page": 1, "corpus_version": "v1"}.items()
    hits = LocalCorpusRetriever(tmp_path / "v1/competency").retrieve("interpret results of data analysis", 2)
    assert hits and hits[0].source_id == "ceph-mph-foundational"
