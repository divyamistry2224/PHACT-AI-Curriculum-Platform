"""FacultyRead function: read-only views of the caller's own syllabi.

GET /syllabi                      The caller's syllabi, newest first.
GET /syllabi/{id}                 One syllabus with its versions and reviews.
GET /syllabi/{id}/versions/{n}    The text of one version, for display, diffing, and the DOCX download.

Review polling (GET /reviews/{id}) lives in its own GetReview function.
"""

from phact import auth, db, storage
from phact.http import Gone, NotFound, int_path_param, path_param, respond, route


def list_syllabi(event):
    owner_id = auth.user_id(event)
    items = db.list_syllabi_for_owner(owner_id)
    return respond(200, {"syllabi": [db.syllabus_summary(item) for item in items]})


def get_syllabus(event):
    owner_id = auth.user_id(event)
    syllabus_id = path_param(event, "id")
    item = db.get_owned_syllabus(syllabus_id, owner_id)
    reviews = db.list_reviews_for_syllabus(syllabus_id)
    return respond(200, {
        "syllabus": db.syllabus_detail(item),
        "reviews": [db.review_summary(review) for review in reviews],
    })


def get_version(event):
    owner_id = auth.user_id(event)
    syllabus_id = path_param(event, "id")
    n = int_path_param(event, "n")
    item = db.get_owned_syllabus(syllabus_id, owner_id)
    entry = db.find_version(item, n)
    if entry is None:
        raise NotFound(f"Version {n} doesn't exist.")
    text = storage.get_text_or_none(entry["textKey"])
    if text is None:
        raise Gone()
    return respond(200, {
        "syllabusId": syllabus_id,
        "version": n,
        "source": entry["source"],
        "reviewId": entry.get("reviewId"),
        "createdAt": entry["createdAt"],
        "isCurrent": n == int(item["currentVersion"]),
        "text": text,
    })


handler = route({
    ("GET", "/syllabi"): list_syllabi,
    ("GET", "/syllabi/{id}"): get_syllabus,
    ("GET", "/syllabi/{id}/versions/{n}"): get_version,
})
