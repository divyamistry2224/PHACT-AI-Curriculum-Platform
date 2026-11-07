"""Feedback function: faculty rate PHACT from the Export page; admins read the ratings.

POST /feedback         Body {syllabusId, version?, rating (1-5), comment?}
GET  /admin/feedback   Admin only. All feedback, newest first, with the average rating

Comments are purged of personal details before they're stored, like syllabus text. Feedback isn't syllabus
content, so it doesn't expire with the syllabus; it keeps the syllabus title so it still reads sensibly after
the syllabus is gone.
"""

import os
import uuid
from datetime import datetime, timezone

from boto3.dynamodb.conditions import Key

from phact import auth, db, pii
from phact.http import BadRequest, parse_json_body, optional_str, required_str, respond, route

MAX_COMMENT = 2000
KIND = "FEEDBACK"


def table():
    return db.dynamodb().Table(os.environ["FEEDBACK_TABLE"])


def submit(event):
    owner_id = auth.user_id(event)
    body = parse_json_body(event)
    syllabus = db.get_owned_syllabus(required_str(body, "syllabusId", 100), owner_id)
    rating = body.get("rating")
    if not isinstance(rating, int) or isinstance(rating, bool) or not 1 <= rating <= 5:
        raise BadRequest("rating must be a whole number from 1 to 5.")
    version = body.get("version")
    if version is not None and (not isinstance(version, int) or version < 1):
        raise BadRequest("version must be a whole number.")
    comment = optional_str(body, "comment", MAX_COMMENT)
    item = db.without_none({
        "feedbackId": str(uuid.uuid4()),
        "kind": KIND,
        "ownerId": owner_id,
        "ownerEmail": auth.email(event),
        "syllabusId": syllabus["syllabusId"],
        "syllabusTitle": syllabus.get("title"),
        "version": version or int(syllabus["currentVersion"]),
        "rating": rating,
        "comment": pii.purge(comment) if comment else None,
        # Millisecond precision so two ratings in the same second still sort newest first.
        "createdAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
    })
    table().put_item(Item=item)
    return respond(201, public(item))


def public(item: dict) -> dict:
    return {key: item[key] for key in ("feedbackId", "syllabusId", "syllabusTitle", "version", "rating", "comment", "ownerEmail", "createdAt") if key in item}


def list_feedback(event):
    auth.require_admin(event)
    items = db._query_all(table(), IndexName="byDate", KeyConditionExpression=Key("kind").eq(KIND), ScanIndexForward=False)
    ratings = [int(i["rating"]) for i in items]
    return respond(200, {
        "items": [public(i) for i in items],
        "count": len(items),
        "averageRating": round(sum(ratings) / len(ratings), 2) if ratings else None,
    })


handler = route({
    ("POST", "/feedback"): submit,
    ("GET", "/admin/feedback"): list_feedback,
})
