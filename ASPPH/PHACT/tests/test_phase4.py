"""Phase 4: submit, the admin queue and detail view, approve (PII scrub into KB2), reject, and KB admin."""

import json

import boto3
import pytest

from conftest import api_event, call, load_function
from test_phase3 import make_syllabus, review_and_accept, run_worker, start, syllabus_item

ADMIN = {"user": "admin-1", "groups": "admin"}


def submit(syllabus_id, user="user-1"):
    return call(load_function("submit"), api_event("POST", "/syllabi/{id}/submit", user=user, path={"id": syllabus_id}))


def admin(name, method, resource, *, path=None, body=None, query=None, who=ADMIN):
    return call(load_function(name), api_event(method, resource, path=path, body=body, query=query, **who))


def approve(syllabus_id, who=ADMIN):
    return admin("approve", "POST", "/admin/syllabi/{id}/approve", path={"id": syllabus_id}, who=who)


def reject(syllabus_id, reason="Needs a clearer assessment plan.", who=ADMIN):
    body = {"reason": reason} if reason is not None else {}
    return admin("reject", "POST", "/admin/syllabi/{id}/reject", path={"id": syllabus_id}, body=body, who=who)


def queue(status=None):
    return admin("admin_read", "GET", "/admin/queue", query={"status": status} if status else None)


def kb_object(key):
    return boto3.client("s3").get_object(Bucket="test-kb-bucket", Key=key)["Body"].read().decode()


def review_to_v2(syllabus_id):
    return review_and_accept("competency", syllabus_id)


def test_submit_puts_current_version_in_the_queue(aws):
    syllabus_id = make_syllabus()
    review_to_v2(syllabus_id)
    status, summary = submit(syllabus_id)
    assert status == 200
    assert summary["approvalStatus"] == "PENDING" and summary["submittedVersion"] == 2

    status, again = submit(syllabus_id)
    assert status == 409 and again["code"] == "ALREADY_SUBMITTED"

    status, body = queue()
    assert status == 200 and body["status"] == "PENDING"
    assert [item["syllabusId"] for item in body["items"]] == [syllabus_id]
    assert body["items"][0]["ownerEmail"] == "user-1@example.edu"


def test_only_the_owner_can_submit(aws):
    syllabus_id = make_syllabus()
    status, _ = submit(syllabus_id, user="user-2")
    assert status == 404


def test_cannot_submit_while_a_review_is_running(aws):
    syllabus_id = make_syllabus()
    start("competency", syllabus_id)
    status, body = submit(syllabus_id)
    assert status == 409 and body["code"] == "REVIEW_RUNNING"


@pytest.mark.parametrize("call_admin", [
    lambda sid: admin("admin_read", "GET", "/admin/queue", who={"user": "user-1", "groups": "faculty"}),
    lambda sid: admin("admin_read", "GET", "/admin/syllabi/{id}", path={"id": sid}, who={"user": "user-1", "groups": "faculty"}),
    lambda sid: approve(sid, who={"user": "user-1", "groups": "faculty"}),
    lambda sid: reject(sid, who={"user": "user-1", "groups": "faculty"}),
    lambda sid: admin("kb_admin", "GET", "/admin/kb", who={"user": "user-1", "groups": "faculty"}),
])
def test_admin_endpoints_reject_faculty(aws, call_admin):
    syllabus_id = make_syllabus()
    submit(syllabus_id)
    status, body = call_admin(syllabus_id)
    assert status == 403 and body["code"] == "FORBIDDEN"
    assert syllabus_item(syllabus_id)["approvalStatus"] == "PENDING"


def test_admin_detail_shows_submitted_text_diff_and_reviews(aws):
    syllabus_id = make_syllabus()
    review_id = review_to_v2(syllabus_id)
    submit(syllabus_id)
    status, body = admin("admin_read", "GET", "/admin/syllabi/{id}", path={"id": syllabus_id})
    assert status == 200
    assert body["version"] == 2 and "Community presentation" in body["text"]
    assert body["syllabus"]["ownerEmail"] == "user-1@example.edu"
    assert body["diffStats"]["linesAdded"] > 0
    assert any(seg["op"] == "insert" and "Community presentation" in seg["text"] for seg in body["diff"])
    assert [r["reviewId"] for r in body["reviews"]] == [review_id]


def test_reject_needs_a_reason_and_the_faculty_member_sees_it(aws):
    syllabus_id = make_syllabus()
    submit(syllabus_id)
    status, body = reject(syllabus_id, reason=None)
    assert status == 400

    status, summary = reject(syllabus_id, reason="Add CEPH 19 assessment details.")
    assert status == 200 and summary["approvalStatus"] == "DENIED" and summary["decidedByEmail"] == "admin-1@example.edu"

    faculty_view = call(load_function("faculty_read"), api_event("GET", "/syllabi"))[1]["syllabi"][0]
    assert faculty_view["approvalStatus"] == "DENIED" and faculty_view["denyReason"] == "Add CEPH 19 assessment details."
    assert "decidedByEmail" not in faculty_view and "ownerEmail" not in faculty_view
    assert queue()[1]["items"] == []
    assert [i["syllabusId"] for i in queue("DENIED")[1]["items"]] == [syllabus_id]

    status, again = reject(syllabus_id)
    assert status == 409 and again["code"] == "NOT_PENDING"


def test_resubmit_after_denial_clears_the_reason(aws):
    syllabus_id = make_syllabus()
    submit(syllabus_id)
    reject(syllabus_id)
    status, summary = submit(syllabus_id)
    assert status == 200 and summary["approvalStatus"] == "PENDING" and "denyReason" not in summary
    assert [i["syllabusId"] for i in queue()[1]["items"]] == [syllabus_id]
    assert queue("DENIED")[1]["items"] == []


def test_approve_scrubs_pii_and_writes_kb2_document_with_metadata(aws):
    syllabus_id = make_syllabus()
    review_to_v2(syllabus_id)
    submit(syllabus_id)
    status, summary = approve(syllabus_id)
    assert status == 200
    assert summary["approvalStatus"] == "APPROVED" and summary["approvedVersion"] == 2

    document = kb_object(f"approved/{syllabus_id}.md")
    assert "Maya Chen" not in document and "maya.chen@example.edu" not in document
    assert "[name removed]" in document and "[email removed]" in document
    assert "Sep " in document or "Community presentation" in document  # dates and content survive

    meta = json.loads(kb_object(f"approved/{syllabus_id}.md.metadata.json"))["metadataAttributes"]
    assert meta["syllabusId"] == syllabus_id and meta["subject"] == "Epidemiology" and meta["version"] == 2
    assert meta["title"] == "EPID 601" and "institution" not in meta  # empty fields are left out

    status, again = approve(syllabus_id)
    assert status == 409 and again["code"] == "NOT_PENDING"
    status, resubmit = submit(syllabus_id)
    assert status == 409 and resubmit["code"] == "ALREADY_APPROVED"
    assert [i["syllabusId"] for i in queue("APPROVED")[1]["items"]] == [syllabus_id]


def test_approved_version_cannot_be_undone(aws):
    syllabus_id = make_syllabus()
    review_id = review_to_v2(syllabus_id)
    submit(syllabus_id)
    approve(syllabus_id)
    undo = load_function("undo_review")
    status, body = call(undo, api_event("POST", "/reviews/{id}/undo", path={"id": review_id}))
    assert status == 409 and body["code"] == "APPROVED"


def test_pending_version_cannot_be_undone(aws):
    syllabus_id = make_syllabus()
    review_id = review_to_v2(syllabus_id)
    submit(syllabus_id)
    undo = load_function("undo_review")
    status, body = call(undo, api_event("POST", "/reviews/{id}/undo", path={"id": review_id}))
    assert status == 409 and body["code"] == "SUBMITTED"


def test_newer_version_can_be_approved_and_replaces_the_kb2_document(aws):
    syllabus_id = make_syllabus()
    submit(syllabus_id)
    approve(syllabus_id)
    review_to_v2(syllabus_id)
    status, summary = submit(syllabus_id)
    assert status == 200 and summary["submittedVersion"] == 2 and summary["approvedVersion"] == 1

    status, summary = approve(syllabus_id)
    assert status == 200 and summary["approvedVersion"] == 2
    keys = [o["Key"] for o in boto3.client("s3").list_objects_v2(Bucket="test-kb-bucket")["Contents"]]
    assert keys == [f"approved/{syllabus_id}.md", f"approved/{syllabus_id}.md.metadata.json"]
    assert "Community presentation" in kb_object(f"approved/{syllabus_id}.md")


def test_approve_rolls_back_if_the_kb_write_fails(aws, monkeypatch):
    syllabus_id = make_syllabus()
    submit(syllabus_id)
    from phact import storage

    def broken(*args, **kwargs):
        raise RuntimeError("S3 is down")

    monkeypatch.setattr(storage, "kb_put_text", broken)
    status, body = approve(syllabus_id)
    assert status == 500
    item = syllabus_item(syllabus_id)
    assert item["approvalStatus"] == "PENDING" and item["queueStatus"] == "PENDING"
    assert "approvedVersion" not in item and "decidedAt" not in item


def test_kb_admin_reports_counts_and_last_sync(aws):
    s3 = boto3.client("s3")
    for key in ("ceph/D2-01.md", "ceph/D2-01.md.metadata.json", "ceph/D2-02.md", "approved/a.md"):
        s3.put_object(Bucket="test-kb-bucket", Key=key, Body=b"x")

    status, body = admin("kb_admin", "POST", "/admin/kb/sync", body={"kb": "approved_syllabi"})
    assert status == 202 and body["kb"] == "APPROVED_SYLLABI"

    status, body = admin("kb_admin", "GET", "/admin/kb")
    assert status == 200
    kbs = {kb["kb"]: kb for kb in body["knowledgeBases"]}
    assert kbs["CEPH"]["fileCount"] == 2 and kbs["CEPH"]["lastSync"] is None
    assert kbs["APPROVED_SYLLABI"]["fileCount"] == 1
    assert kbs["APPROVED_SYLLABI"]["lastSync"]["status"] == "STARTING"
    assert kbs["APPROVED_SYLLABI"]["lastSync"]["documentsIndexed"] == 4
    assert kbs["APPROVED_SYLLABI"]["lastSync"]["startedAt"].endswith("Z")


def test_kb_sync_validates_and_reports_running_jobs(aws):
    from phact import aws as phact_aws

    status, body = admin("kb_admin", "POST", "/admin/kb/sync", body={"kb": "OTHER"})
    assert status == 400
    phact_aws.client("bedrock-agent").busy = True
    status, body = admin("kb_admin", "POST", "/admin/kb/sync", body={"kb": "CEPH"})
    assert status == 409 and body["code"] == "SYNC_RUNNING"


def test_queue_rejects_unknown_status(aws):
    status, _ = queue("MAYBE")
    assert status == 400


def test_approval_note_is_shown_to_faculty_and_cleared_by_a_later_plain_approval(aws):
    syllabus_id = make_syllabus()
    submit(syllabus_id)
    status, summary = admin("approve", "POST", "/admin/syllabi/{id}/approve", path={"id": syllabus_id}, body={"note": "Great use of oral defenses."})
    assert status == 200 and summary["approvalNote"] == "Great use of oral defenses."
    faculty_view = call(load_function("faculty_read"), api_event("GET", "/syllabi"))[1]["syllabi"][0]
    assert faculty_view["approvalNote"] == "Great use of oral defenses."

    review_to_v2(syllabus_id)
    submit(syllabus_id)
    status, summary = approve(syllabus_id)
    assert status == 200 and "approvalNote" not in summary and summary["approvedVersion"] == 2


def test_feedback_is_stored_purged_and_listed_for_admins(aws):
    syllabus_id = make_syllabus()
    fb = load_function("feedback")
    status, item = call(fb, api_event("POST", "/feedback", body={"syllabusId": syllabus_id, "rating": 4, "comment": "Great. Ask Maya Chen about it."}))
    assert status == 201 and item["rating"] == 4 and item["version"] == 1 and item["syllabusTitle"] == "EPID 601"
    assert item["comment"] == "Great. Ask [name removed] about it."
    import time; time.sleep(0.01)
    call(fb, api_event("POST", "/feedback", body={"syllabusId": syllabus_id, "rating": 2}))

    status, body = call(fb, api_event("GET", "/admin/feedback", user="admin-1", groups="admin"))
    assert status == 200 and body["count"] == 2 and body["averageRating"] == 3.0
    assert body["items"][0]["rating"] == 2  # newest first
    assert call(fb, api_event("GET", "/admin/feedback"))[0] == 403


@pytest.mark.parametrize("body", [{"rating": 0}, {"rating": 6}, {"rating": "5"}, {"rating": True}, {}])
def test_feedback_validates_rating(aws, body):
    syllabus_id = make_syllabus()
    status, _ = call(load_function("feedback"), api_event("POST", "/feedback", body={"syllabusId": syllabus_id, **body}))
    assert status == 400


def test_feedback_only_on_your_own_syllabus(aws):
    syllabus_id = make_syllabus()
    status, _ = call(load_function("feedback"), api_event("POST", "/feedback", user="user-2", body={"syllabusId": syllabus_id, "rating": 5}))
    assert status == 404



def test_admin_summary_is_generated_once_and_cached(aws):
    from phact import aws as phact_aws

    syllabus_id = make_syllabus()
    review_to_v2(syllabus_id)
    submit(syllabus_id)
    fake = phact_aws.client("bedrock-runtime")
    calls_before = len(fake.converse_calls)
    status, body = admin("submission_summary", "POST", "/admin/syllabi/{id}/summary", path={"id": syllabus_id})
    assert status == 200 and body["version"] == 2 and not body["cached"] and "community presentation" in body["text"]
    facts = fake.converse_calls[-1]["messages"][0]["content"][0]["text"]
    assert "Accepted: Added a community presentation." in facts and "Maya" not in facts
    assert "Students brief" not in facts  # the model gets recorded facts, not the syllabus text
    status, again = admin("submission_summary", "POST", "/admin/syllabi/{id}/summary", path={"id": syllabus_id})
    assert again["cached"] and len(fake.converse_calls) == calls_before + 1
    _, detail = admin("admin_read", "GET", "/admin/syllabi/{id}", path={"id": syllabus_id})
    assert detail["summary"]["text"] == body["text"]


def test_admin_summary_without_reviews_needs_no_model(aws):
    from phact import aws as phact_aws

    syllabus_id = make_syllabus()
    submit(syllabus_id)
    status, body = admin("submission_summary", "POST", "/admin/syllabi/{id}/summary", path={"id": syllabus_id})
    assert status == 200 and "as uploaded" in body["text"]
    assert not phact_aws.client("bedrock-runtime").converse_calls
    assert admin("submission_summary", "POST", "/admin/syllabi/{id}/summary", path={"id": syllabus_id}, who={"user": "user-1", "groups": "faculty"})[0] == 403


# ---------------------------------------------------------------- decision emails

class FakeSES:
    def __init__(self, error=None):
        self.sent, self.error = [], error

    def send_email(self, **kwargs):
        if self.error:
            from botocore.exceptions import ClientError

            raise ClientError({"Error": {"Code": self.error, "Message": "Email address is not verified."}}, "SendEmail")
        self.sent.append(kwargs)
        return {"MessageId": "msg-1"}


def stream_event(syllabus_id, old_status="PENDING"):
    from boto3.dynamodb.types import TypeSerializer

    serialize = TypeSerializer().serialize
    new = syllabus_item(syllabus_id)
    old = {**new, "approvalStatus": old_status}
    image = lambda item: {k: serialize(v) for k, v in item.items()}
    return {"Records": [{"eventID": "1", "eventName": "MODIFY", "dynamodb": {"SequenceNumber": "100", "OldImage": image(old), "NewImage": image(new)}}]}


def notify(syllabus_id, ses=None, sender="", old_status="PENDING", monkeypatch=None):
    from phact import aws as phact_aws

    if ses is not None:
        phact_aws.set_client("ses", ses)
    monkeypatch.setenv("SENDER_EMAIL", sender)
    monkeypatch.setenv("APP_URL", "https://d111.cloudfront.net")
    return load_function("decision_notifier").handler(stream_event(syllabus_id, old_status), None)


def test_denial_email_is_sent_through_ses_and_recorded(aws, monkeypatch):
    syllabus_id = make_syllabus()
    submit(syllabus_id)
    reject(syllabus_id, reason="Add a rubric for the oral defense.")
    ses = FakeSES()
    assert notify(syllabus_id, ses, sender="phact@aspph.example", monkeypatch=monkeypatch) == {"batchItemFailures": []}
    email = ses.sent[0]
    assert email["Source"] == "phact@aspph.example" and email["Destination"] == {"ToAddresses": ["user-1@example.edu"]}
    assert email["Message"]["Subject"]["Data"] == "Revisions requested: EPID 601"
    body = email["Message"]["Body"]["Text"]["Data"]
    assert "Feedback: Add a rubric for the oral defense." in body and "https://d111.cloudfront.net" in body and "—" not in body
    note = syllabus_item(syllabus_id)["notification"]
    assert note["status"] == "SENT" and note["decision"] == "DENIED" and note["to"] == "user-1@example.edu"
    _, detail = admin("admin_read", "GET", "/admin/syllabi/{id}", path={"id": syllabus_id})
    assert detail["syllabus"]["notification"]["status"] == "SENT"


def test_without_a_sender_the_email_is_built_but_not_sent(aws, monkeypatch):
    syllabus_id = make_syllabus()
    submit(syllabus_id)
    approve(syllabus_id)
    ses = FakeSES()
    notify(syllabus_id, ses, sender="", monkeypatch=monkeypatch)
    assert not ses.sent
    note = syllabus_item(syllabus_id)["notification"]
    assert note["status"] == "NOT_SENT" and "No verified SES sender" in note["detail"] and note["decision"] == "APPROVED"


def test_ses_sandbox_rejection_is_recorded_not_retried(aws, monkeypatch):
    syllabus_id = make_syllabus()
    submit(syllabus_id)
    approve(syllabus_id)
    result = notify(syllabus_id, FakeSES(error="MessageRejected"), sender="phact@aspph.example", monkeypatch=monkeypatch)
    assert result == {"batchItemFailures": []}
    note = syllabus_item(syllabus_id)["notification"]
    assert note["status"] == "NOT_SENT" and "not verified" in note["detail"]


def test_transient_ses_errors_are_retried(aws, monkeypatch):
    syllabus_id = make_syllabus()
    submit(syllabus_id)
    approve(syllabus_id)
    result = notify(syllabus_id, FakeSES(error="Throttling"), sender="phact@aspph.example", monkeypatch=monkeypatch)
    assert result == {"batchItemFailures": [{"itemIdentifier": "100"}]}
    assert "notification" not in syllabus_item(syllabus_id)


def test_only_pending_to_decided_transitions_send(aws, monkeypatch):
    syllabus_id = make_syllabus()
    submit(syllabus_id)
    approve(syllabus_id)
    ses = FakeSES()
    notify(syllabus_id, ses, sender="phact@aspph.example", old_status="APPROVED", monkeypatch=monkeypatch)
    assert not ses.sent and "notification" not in syllabus_item(syllabus_id)


def test_a_stale_event_does_not_overwrite_a_newer_decision(aws, monkeypatch):
    syllabus_id = make_syllabus()
    submit(syllabus_id)
    reject(syllabus_id)
    stale = stream_event(syllabus_id)
    submit(syllabus_id)  # resubmitted before the email was processed
    from phact import aws as phact_aws

    phact_aws.set_client("ses", FakeSES())
    monkeypatch.setenv("SENDER_EMAIL", "phact@aspph.example")
    load_function("decision_notifier").handler(stale, None)
    assert "notification" not in syllabus_item(syllabus_id)
