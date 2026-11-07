"""Submit function: a faculty member sends their current working copy to the admin approval queue.

POST /syllabi/{id}/submit

The submitted version is frozen for review: the faculty member can keep running reviews (which create newer
versions), but they can't undo the submitted version while it's pending. One submission is pending at a time.
After a denial they can submit again; after an approval they can submit a newer version, which replaces the
older one in the shared knowledge base if it's approved too.
"""

import time

from botocore.exceptions import ClientError

from phact import auth, db
from phact.http import Conflict, path_param, respond, route
from phact.reviews import LOCK_STALE_SECONDS


def submit(event):
    owner_id = auth.user_id(event)
    syllabus_id = path_param(event, "id")
    syllabus = db.get_owned_syllabus(syllabus_id, owner_id)
    version = int(syllabus["currentVersion"])
    status = syllabus.get("approvalStatus", "NONE")

    if status == "PENDING":
        raise Conflict("This syllabus is already waiting for admin approval.", code="ALREADY_SUBMITTED")
    if status == "APPROVED" and int(syllabus.get("approvedVersion", 0)) == version:
        raise Conflict(f"Version {version} is already approved. Run a review to create a newer version first.", code="ALREADY_APPROVED")

    now, epoch = db.now_iso(), int(time.time())
    try:
        updated = db.syllabi_table().update_item(
            Key={"syllabusId": syllabus_id},
            UpdateExpression=(
                "SET approvalStatus = :pending, queueStatus = :pending, submittedVersion = :version, "
                "submittedAt = :now, updatedAt = :now REMOVE denyReason, decidedAt, decidedBy, decidedByEmail"
            ),
            ConditionExpression=(
                "ownerId = :owner AND currentVersion = :version "
                "AND (attribute_not_exists(approvalStatus) OR approvalStatus <> :pending) "
                "AND (attribute_not_exists(activeReviewId) OR activeReviewAt < :stale)"
            ),
            ExpressionAttributeValues={
                ":pending": "PENDING",
                ":version": version,
                ":now": now,
                ":owner": owner_id,
                ":stale": epoch - LOCK_STALE_SECONDS,
            },
            ReturnValues="ALL_NEW",
        )["Attributes"]
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            # The checks above passed, so the likely cause is a review that's running or just changed the version.
            raise Conflict("A review is running or just finished. Wait for it, then submit again.", code="REVIEW_RUNNING") from exc
        raise
    return respond(200, db.syllabus_summary(updated))


handler = route({("POST", "/syllabi/{id}/submit"): submit})
