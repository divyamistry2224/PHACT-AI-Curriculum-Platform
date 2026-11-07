"""Queued reviews keep ownership, safety checks and faculty decisions through AgentCore."""
import io
import json

import pytest

from conftest import load_function
from test_phase3 import make_syllabus, start, run_worker, get_review, decide, syllabus_item
from phact import aws as clients, agentcore


class Runtime:
    def __init__(self, status="SUCCEEDED", wrong_job=False, incomplete=False):
        self.status, self.wrong_job, self.incomplete = status, wrong_job, incomplete
        self.calls = []

    def invoke_agent_runtime(self, **kwargs):
        payload = json.loads(kwargs["payload"])
        self.calls.append(payload)
        sentence = "Students brief a community board and explain the uncertainty in their findings."
        revised = payload["syllabus_text"] + "\n\n## Community assessment\n" + sentence + "\n"
        if payload["review_type"] == "COMPETENCY":
            output = {
                "competencies": [{"code": f"D2-{n}", "status": "PARTIAL", "evidence": "Original assignments", "rationale": "Needs assessment."} for n in range(1, 23)],
                "changes": [{"section": "Assessment", "change": "Add a community briefing", "reason": "Practice communication", "competencyCodes": ["D2-19"], "excerpts": [sentence]}],
            }
            if self.incomplete:
                output["competencies"].pop()
        else:
            output = {"recommendations": [{"title": "Community briefing", "category": "ASSESSMENT_TOOLS", "approach": "AI_RESISTANT", "target": "Final assessment", "recommendation": "Brief a community board", "rationale": "Check understanding", "peerExampleIds": ["S1", "S99"], "excerpts": [sentence]}]}
        output["revisedSyllabus"] = revised
        result = {"status": self.status, "jobId": "other" if self.wrong_job else payload["job_id"], "syllabusId": payload["syllabus_id"], "samReview": output,
                  "evidence": [{"id": "S1", "kind": "Faculty Example", "title": "Reviewed syllabus", "publisher": "Public Health School", "excerpt": "Oral assessment"}]}
        return {"response": io.BytesIO(json.dumps({"status": self.status, "result": result}).encode())}


@pytest.mark.parametrize("kind", ["competency", "modernization"])
def test_queue_remote_review_and_faculty_decision(aws, monkeypatch, kind):
    runtime = Runtime()
    clients.set_client("bedrock-agentcore", runtime)
    monkeypatch.setenv("AGENTCORE_RUNTIME_ARN", "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/phact-abcdefghij")
    sid = make_syllabus()
    worker = load_function(kind + "_worker")
    monkeypatch.setattr(worker.SPEC, "analyze", lambda *args: pytest.fail("Local generation must not run"))
    if kind == "modernization":
        monkeypatch.setattr(worker.SPEC, "retrieve", lambda *args: pytest.fail("Runtime owns peer retrieval"))
    _, review = start(kind, sid)
    run_worker(kind + "_worker", review["reviewId"])
    _, polled = get_review(review["reviewId"])
    assert polled["jobStatus"] == "COMPLETED", polled
    assert syllabus_item(sid)["currentVersion"] == 1
    payload = runtime.calls[0]
    assert payload["owner_sub"] == "user-1" and payload["syllabus_id"] == sid
    assert payload["job_id"] == review["reviewId"] and "Maya Chen" not in payload["syllabus_text"]
    if kind == "competency":
        assert len(payload["competency_reference"]) == 22
        assert polled["results"]["coverage"]["partial"] == 22
    else:
        assert len(polled["results"]["recommendations"][0]["peerExamples"]) == 1
    status, saved = decide(review["reviewId"])
    assert status == 200 and saved["syllabus"]["currentVersion"] == 2


@pytest.mark.parametrize("options", [{"status": "BLOCKED"}, {"status": "REJECTED"}, {"status": "FAILED"}, {"wrong_job": True}, {"incomplete": True}])
def test_remote_failure_releases_lock_without_saving(aws, monkeypatch, options):
    clients.set_client("bedrock-agentcore", Runtime(**options))
    monkeypatch.setenv("AGENTCORE_RUNTIME_ARN", "runtime")
    sid = make_syllabus()
    _, review = start("competency", sid)
    run_worker("competency_worker", review["reviewId"])
    _, polled = get_review(review["reviewId"])
    assert polled["jobStatus"] == "FAILED"
    item = syllabus_item(sid)
    assert item["currentVersion"] == 1 and not item.get("activeReviewId") and not item.get("pendingReviewId")


def test_transport_passes_only_stored_owner_and_guidance(aws, monkeypatch):
    runtime = Runtime()
    clients.set_client("bedrock-agentcore", runtime)
    monkeypatch.setenv("AGENTCORE_RUNTIME_ARN", "runtime")
    review = {"reviewId": "r1", "reviewType": "MODERNIZATION"}
    syllabus = {"syllabusId": "s1", "ownerId": "stored-owner", "title": "Course"}
    agentcore.analyze(review, syllabus, "safe text", [], {"guidance": "Leave week 1 alone", "declined": ["Old suggestion"]})
    assert runtime.calls[0]["owner_sub"] == "stored-owner"
    assert runtime.calls[0]["guidance"] == "Leave week 1 alone"
    assert runtime.calls[0]["declined"] == ["Old suggestion"]
