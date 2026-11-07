"""DynamoDB access for the Syllabi and Reviews tables, plus the response shapes the front end receives.

Syllabi item (one per uploaded syllabus; holds the working copy and its submission):
  syllabusId (PK), ownerId, ownerEmail, title, subject, institution, description, sourceType, fileKey,
  currentVersion, versions[{n, textKey, source, reviewId?, createdAt}], activeReviewId, activeReviewAt, pendingReviewId,
  approvalStatus, submittedVersion, submittedAt, decidedBy, decidedByEmail, decidedAt, denyReason,
  approvedVersion, approvedAt, approvalNote, queueStatus, createdAt, updatedAt, expiresAt
  queueStatus mirrors approvalStatus (PENDING | APPROVED | DENIED) but only once a syllabus is submitted.
  GSI byOwner (ownerId, createdAt); GSI adminQueue (queueStatus, submittedAt), sparse

Reviews item (one per review run):
  reviewId (PK), syllabusId, ownerId, reviewType, jobStatus, stage, inputVersion, outputVersion,
  resultKey, summary, errorMessage, createdAt, startedAt, completedAt, undoneAt, decidedAt, decision,
  acceptedSuggestions, acceptedHunks, declinedSuggestions, guidance, declinedContext, expiresAt
  GSI bySyllabus (syllabusId, createdAt)

Retention: a syllabus and everything in it lives RETENTION_DAYS (default 180) from its original upload.
expiresAt (epoch seconds) drives DynamoDB TTL; its reviews copy the syllabus's expiresAt so they expire
together. TTL can delete items a day or two late, so reads also treat anything past expiresAt as gone.
"""

import os
import time
from datetime import datetime, timedelta, timezone

import boto3
from boto3.dynamodb.conditions import Key

from .http import Gone, NotFound

_resource = None


def dynamodb():
    global _resource
    if _resource is None:
        _resource = boto3.resource("dynamodb")
    return _resource


def syllabi_table():
    return dynamodb().Table(os.environ["SYLLABI_TABLE"])


def reviews_table():
    return dynamodb().Table(os.environ["REVIEWS_TABLE"])


def _iso(moment: datetime) -> str:
    return moment.isoformat(timespec="seconds").replace("+00:00", "Z")


def now_iso() -> str:
    return _iso(datetime.now(timezone.utc))


def retention_days() -> int:
    return int(os.environ.get("RETENTION_DAYS", "180"))


def expiry_epoch(created: datetime = None) -> int:
    """When a new syllabus (and everything in it) expires, as epoch seconds for DynamoDB TTL."""
    created = created or datetime.now(timezone.utc)
    return int((created + timedelta(days=retention_days())).timestamp())


def is_expired(item: dict) -> bool:
    expires_at = item.get("expiresAt")
    return expires_at is not None and int(expires_at) <= time.time()


def expires_at_iso(item: dict):
    expires_at = item.get("expiresAt")
    return _iso(datetime.fromtimestamp(int(expires_at), tz=timezone.utc)) if expires_at is not None else None


def without_none(item: dict) -> dict:
    return {key: value for key, value in item.items() if value is not None}


def _query_all(table, **kwargs) -> list:
    items = []
    while True:
        page = table.query(**kwargs)
        items.extend(page.get("Items", []))
        if "LastEvaluatedKey" not in page:
            return items
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]


# ---------- Syllabi ----------

def create_syllabus(item: dict) -> None:
    syllabi_table().put_item(Item=without_none(item), ConditionExpression="attribute_not_exists(syllabusId)")


def get_syllabus(syllabus_id: str):
    return syllabi_table().get_item(Key={"syllabusId": syllabus_id}, ConsistentRead=True).get("Item")


def get_owned_syllabus(syllabus_id: str, owner_id: str) -> dict:
    """The syllabus if the caller owns it. Returns 404 rather than 403 for someone else's syllabus,
    so the API never confirms that another faculty member's syllabus exists."""
    item = get_syllabus(syllabus_id)
    if not item or item.get("ownerId") != owner_id:
        raise NotFound("Syllabus not found.")
    if is_expired(item):
        raise Gone(f"This syllabus was removed {retention_days()} days after it was uploaded.")
    return item


def list_syllabi_for_owner(owner_id: str) -> list:
    items = _query_all(
        syllabi_table(),
        IndexName="byOwner",
        KeyConditionExpression=Key("ownerId").eq(owner_id),
        ScanIndexForward=False,
    )
    return [item for item in items if not is_expired(item)]


QUEUE_STATUSES = ("PENDING", "APPROVED", "DENIED")


def queue_items(status: str) -> list:
    """Submissions with this approval status. Pending ones come oldest first (the order to work through
    them); decided ones newest first. queueStatus exists only on submitted syllabi, so the index stays small."""
    items = _query_all(
        syllabi_table(),
        IndexName="adminQueue",
        KeyConditionExpression=Key("queueStatus").eq(status),
        ScanIndexForward=status == "PENDING",
    )
    return [item for item in items if not is_expired(item)]


def find_version(item: dict, n: int):
    for entry in item.get("versions", []):
        if int(entry["n"]) == int(n):
            return entry
    return None


def current_version_entry(item: dict) -> dict:
    return find_version(item, item["currentVersion"])


# ---------- Reviews ----------

def get_review(review_id: str):
    return reviews_table().get_item(Key={"reviewId": review_id}, ConsistentRead=True).get("Item")


def list_reviews_for_syllabus(syllabus_id: str) -> list:
    items = _query_all(
        reviews_table(),
        IndexName="bySyllabus",
        KeyConditionExpression=Key("syllabusId").eq(syllabus_id),
        ScanIndexForward=False,
    )
    return [item for item in items if not is_expired(item)]


# ---------- Response shapes ----------

def syllabus_summary(item: dict) -> dict:
    """What list views need. Never includes S3 keys."""
    current = current_version_entry(item) or {}
    return without_none({
        "syllabusId": item["syllabusId"],
        "title": item.get("title"),
        "subject": item.get("subject"),
        "institution": item.get("institution"),
        "description": item.get("description"),
        "sourceType": item.get("sourceType"),
        "currentVersion": item.get("currentVersion"),
        "currentVersionSource": current.get("source"),
        "versionCount": len(item.get("versions", [])),
        "reviewRunning": bool(item.get("activeReviewId")),
        "activeReviewId": item.get("activeReviewId"),
        "pendingReviewId": item.get("pendingReviewId"),
        "approvalStatus": item.get("approvalStatus", "NONE"),
        "submittedVersion": item.get("submittedVersion"),
        "submittedAt": item.get("submittedAt"),
        "decidedAt": item.get("decidedAt"),
        "denyReason": item.get("denyReason"),
        "approvedVersion": item.get("approvedVersion"),
        "approvedAt": item.get("approvedAt"),
        "approvalNote": item.get("approvalNote"),
        "createdAt": item.get("createdAt"),
        "updatedAt": item.get("updatedAt"),
        "expiresAt": expires_at_iso(item),
    })


def admin_summary(item: dict) -> dict:
    """The syllabus summary plus who submitted it and who decided. Only admin endpoints return this."""
    return without_none({
        **syllabus_summary(item),
        "ownerEmail": item.get("ownerEmail"),
        "decidedByEmail": item.get("decidedByEmail"),
        # Email status for the latest decision (written by DecisionNotifier); shown only for that decision.
        "notification": item.get("notification") if (item.get("notification") or {}).get("decision") == item.get("approvalStatus") else None,
    })


def syllabus_detail(item: dict) -> dict:
    detail = syllabus_summary(item)
    detail["versions"] = [
        without_none({"n": v["n"], "source": v["source"], "reviewId": v.get("reviewId"), "createdAt": v["createdAt"]})
        for v in item.get("versions", [])
    ]
    return detail


def review_summary(item: dict) -> dict:
    return without_none({
        "reviewId": item["reviewId"],
        "syllabusId": item.get("syllabusId"),
        "reviewType": item.get("reviewType"),
        "jobStatus": item.get("jobStatus"),
        "stage": item.get("stage"),
        "inputVersion": item.get("inputVersion"),
        "outputVersion": item.get("outputVersion"),
        "summary": item.get("summary"),
        "errorMessage": item.get("errorMessage"),
        "createdAt": item.get("createdAt"),
        "startedAt": item.get("startedAt"),
        "completedAt": item.get("completedAt"),
        "undoneAt": item.get("undoneAt"),
        "decidedAt": item.get("decidedAt"),
        "decision": item.get("decision"),
        "acceptedHunks": item.get("acceptedHunks"),
        "acceptedSuggestions": item.get("acceptedSuggestions"),
        "guidance": item.get("guidance"),
        "declinedContext": item.get("declinedContext"),
    })
