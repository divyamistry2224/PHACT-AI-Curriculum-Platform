"""Approve function: an admin approves a pending submission into the shared knowledge base (KB2).

POST /admin/syllabi/{id}/approve   Body {note?}: optional comments the faculty member sees as approvalNote

1. Purge PII from the submitted version again with Amazon Comprehend (it was purged at upload; this is a
   second line of defense). Nothing has changed yet, so a failure here leaves it pending.
2. Record the decision with a conditional write, so two admins can't decide the same submission differently.
3. Write the scrubbed text and its metadata to approved/ in the KB source bucket. The S3 event starts KB2
   ingestion through the sync queue within about a minute. If the write fails, the decision is rolled back.

KB2 holds one document per syllabus, so approving a newer version replaces the older one.
"""

import json
import logging

from botocore.exceptions import ClientError

from phact import auth, db, pii, storage
from phact.http import Conflict, Gone, NotFound, optional_str, parse_json_body, path_param, respond, route

logger = logging.getLogger()

MAX_NOTE = 2000


def metadata(item: dict, version: int, approved_at: str) -> dict:
    """KB2 filter fields. kb.peer_examples filters on syllabusId and subject and shows title and institution."""
    attributes = {
        "syllabusId": item["syllabusId"],
        "title": item.get("title"),
        "subject": item.get("subject"),
        "institution": item.get("institution"),
        "version": version,
        "approvedAt": approved_at,
    }
    return {"metadataAttributes": {key: value for key, value in attributes.items() if value not in (None, "")}}


def _decide(syllabus_id: str, version: int, admin_id: str, admin_email, now: str, note) -> dict:
    values = {
        ":approved": "APPROVED",
        ":pending": "PENDING",
        ":version": version,
        ":now": now,
        ":admin": admin_id,
        ":email": admin_email or "unknown",
    }
    sets = [
        "approvalStatus = :approved", "queueStatus = :approved", "decidedAt = :now", "decidedBy = :admin",
        "decidedByEmail = :email", "approvedVersion = :version", "approvedAt = :now", "updatedAt = :now",
    ]
    removes = ["denyReason"]
    if note:
        sets.append("approvalNote = :note")
        values[":note"] = note
    else:
        removes.append("approvalNote")  # a note from an earlier approval doesn't carry over
    try:
        return db.syllabi_table().update_item(
            Key={"syllabusId": syllabus_id},
            UpdateExpression=f"SET {', '.join(sets)} REMOVE {', '.join(removes)}",
            ConditionExpression="approvalStatus = :pending AND submittedVersion = :version",
            ExpressionAttributeValues=values,
            ReturnValues="ALL_NEW",
        )["Attributes"]
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            raise Conflict("Another admin already decided this submission. Refresh the queue.", code="NOT_PENDING") from exc
        raise


def _roll_back(before: dict) -> None:
    """Put the submission back in the queue, restoring any earlier approval it replaced."""
    values = {":pending": "PENDING", ":approved": "APPROVED"}
    sets = ["approvalStatus = :pending", "queueStatus = :pending"]
    removes = ["decidedAt", "decidedBy", "decidedByEmail"]
    if before.get("approvedVersion") is not None:
        sets += ["approvedVersion = :prevVersion", "approvedAt = :prevAt"]
        values.update({":prevVersion": before["approvedVersion"], ":prevAt": before.get("approvedAt", "")})
    else:
        removes += ["approvedVersion", "approvedAt"]
    if before.get("approvalNote"):
        sets.append("approvalNote = :prevNote")
        values[":prevNote"] = before["approvalNote"]
    else:
        removes.append("approvalNote")
    db.syllabi_table().update_item(
        Key={"syllabusId": before["syllabusId"]},
        UpdateExpression=f"SET {', '.join(sets)} REMOVE {', '.join(removes)}",
        ConditionExpression="approvalStatus = :approved",
        ExpressionAttributeValues=values,
    )


def approve(event):
    admin_id = auth.require_admin(event)
    syllabus_id = path_param(event, "id")
    item = db.get_syllabus(syllabus_id)
    if not item or not item.get("submittedVersion"):
        raise NotFound("Submission not found.")
    if db.is_expired(item):
        raise Gone()
    if item.get("approvalStatus") != "PENDING":
        raise Conflict("This submission isn't waiting for approval.", code="NOT_PENDING")

    version = int(item["submittedVersion"])
    entry = db.find_version(item, version)
    text = storage.get_text_or_none(entry["textKey"]) if entry else None
    if text is None:
        raise Gone("The submitted version is no longer available.")
    note = optional_str(parse_json_body(event), "note", MAX_NOTE)
    scrubbed = pii.purge(text)  # second pass; the text was already purged at upload

    now = db.now_iso()
    updated = _decide(syllabus_id, version, admin_id, auth.email(event), now, note)
    key = storage.approved_key(syllabus_id)
    try:
        # Metadata first, so it's in place when the document's S3 event starts ingestion.
        storage.kb_put_text(f"{key}.metadata.json", json.dumps(metadata(item, version, now)), content_type="application/json")
        storage.kb_put_text(key, scrubbed)
    except Exception:
        logger.exception("Couldn't write approved syllabus %s to the KB bucket; rolling back", syllabus_id)
        _roll_back(item)
        raise
    logger.info("Approved syllabus %s v%s into KB2", syllabus_id, version)
    return respond(200, db.admin_summary(updated))


handler = route({("POST", "/admin/syllabi/{id}/approve"): approve})
