"""AdminRead function: the approval queue and the submission detail view. Admin group only.

GET /admin/queue?status=PENDING|APPROVED|DENIED   Submissions with that status (default PENDING, oldest first)
GET /admin/syllabi/{id}                           The submitted version's text, its changes since the
                                                  original upload, and the reviews that produced them
"""

from phact import auth, db, storage
from phact.diff import line_diff, stats
from phact.http import BadRequest, Gone, NotFound, path_param, respond, route


def queue_item(item: dict) -> dict:
    return db.without_none({
        "syllabusId": item["syllabusId"],
        "title": item.get("title"),
        "subject": item.get("subject"),
        "institution": item.get("institution"),
        "ownerEmail": item.get("ownerEmail"),
        "approvalStatus": item.get("approvalStatus"),
        "submittedVersion": item.get("submittedVersion"),
        "submittedAt": item.get("submittedAt"),
        "decidedAt": item.get("decidedAt"),
        "decidedByEmail": item.get("decidedByEmail"),
        "denyReason": item.get("denyReason"),
        "approvedVersion": item.get("approvedVersion"),
    })


def list_queue(event):
    auth.require_admin(event)
    status = ((event.get("queryStringParameters") or {}).get("status") or "PENDING").upper()
    if status not in db.QUEUE_STATUSES:
        raise BadRequest("status must be PENDING, APPROVED, or DENIED.")
    return respond(200, {"status": status, "items": [queue_item(item) for item in db.queue_items(status)]})


def _version_text(item: dict, n: int) -> str:
    entry = db.find_version(item, n)
    text = storage.get_text_or_none(entry["textKey"]) if entry else None
    if text is None:
        raise Gone("This version is no longer available.")
    return text


def get_submission(event):
    auth.require_admin(event)
    item = db.get_syllabus(path_param(event, "id"))
    if not item or not item.get("submittedVersion"):
        raise NotFound("Submission not found.")
    if db.is_expired(item):
        raise Gone()

    submitted = int(item["submittedVersion"])
    text = _version_text(item, submitted)
    original = text if submitted == 1 else _version_text(item, 1)
    diff = line_diff(original, text)
    reviews = [
        db.review_summary(review)
        for review in db.list_reviews_for_syllabus(item["syllabusId"])
        if review.get("jobStatus") == "COMPLETED" and review.get("outputVersion") and not review.get("undoneAt")
    ]
    cached = item.get("submissionSummary") or {}
    return respond(200, {
        "syllabus": db.admin_summary(item),
        "summary": cached if int(cached.get("version", 0)) == submitted else None,
        "version": submitted,
        "text": text,
        "diff": diff,
        "diffStats": stats(diff),
        "reviews": reviews,
    })


handler = route({
    ("GET", "/admin/queue"): list_queue,
    ("GET", "/admin/syllabi/{id}"): get_submission,
})
