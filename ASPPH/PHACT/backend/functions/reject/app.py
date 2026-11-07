"""Reject function: an admin denies a pending submission with a reason the faculty member will see.

POST /admin/syllabi/{id}/reject   Body {reason}

Nothing is written to the knowledge base. If an earlier version of this syllabus was approved, that
approval stands and stays in KB2.
"""

from botocore.exceptions import ClientError

from phact import auth, db
from phact.http import Conflict, Gone, NotFound, parse_json_body, path_param, required_str, respond, route

MAX_REASON = 2000


def reject(event):
    admin_id = auth.require_admin(event)
    syllabus_id = path_param(event, "id")
    reason = required_str(parse_json_body(event), "reason", MAX_REASON)
    item = db.get_syllabus(syllabus_id)
    if not item or not item.get("submittedVersion"):
        raise NotFound("Submission not found.")
    if db.is_expired(item):
        raise Gone()

    now = db.now_iso()
    try:
        updated = db.syllabi_table().update_item(
            Key={"syllabusId": syllabus_id},
            UpdateExpression=(
                "SET approvalStatus = :denied, queueStatus = :denied, denyReason = :reason, decidedAt = :now, "
                "decidedBy = :admin, decidedByEmail = :email, updatedAt = :now"
            ),
            ConditionExpression="approvalStatus = :pending",
            ExpressionAttributeValues={
                ":denied": "DENIED",
                ":pending": "PENDING",
                ":reason": reason,
                ":now": now,
                ":admin": admin_id,
                ":email": auth.email(event) or "unknown",
            },
            ReturnValues="ALL_NEW",
        )["Attributes"]
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            raise Conflict("This submission isn't waiting for approval. Refresh the queue.", code="NOT_PENDING") from exc
        raise
    return respond(200, db.admin_summary(updated))


handler = route({("POST", "/admin/syllabi/{id}/reject"): reject})
