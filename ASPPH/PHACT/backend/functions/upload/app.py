"""Upload function.

POST /uploads   Returns a presigned S3 URL; the browser PUTs the file straight to S3 (with progress).
POST /syllabi   Creates a syllabus from an uploaded file or pasted text: extracts the text, stores it as
                version 1, and returns it so the faculty member can confirm it was read correctly.
"""

import os
import re
import uuid

from extract import ExtractionError, extract_text, normalize
from phact import auth, db, guardrails, pii, storage
from phact.http import BadRequest, Forbidden, optional_str, parse_json_body, required_str, respond, route

FILE_TYPES = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
MAX_FILE_BYTES = 10 * 1024 * 1024
MIN_TEXT_CHARS = 80
MAX_TEXT_CHARS = 200_000
URL_EXPIRY_SECONDS = 900


def _safe_file_name(value) -> str:
    if not isinstance(value, str) or not value.strip():
        raise BadRequest("fileName is required.")
    name = os.path.basename(value.strip().replace("\\", "/"))
    name = re.sub(r"[^A-Za-z0-9._ -]", "_", name)[:150]
    if not name or name.startswith("."):
        raise BadRequest("fileName is not valid.")
    return name


def presign_upload(event):
    owner_id = auth.user_id(event)
    body = parse_json_body(event)
    file_name = _safe_file_name(body.get("fileName"))
    extension = os.path.splitext(file_name)[1].lower()
    if extension not in FILE_TYPES:
        raise BadRequest("Upload a PDF or DOCX file, or paste the text instead.", code="UNSUPPORTED_TYPE")
    size = body.get("fileSize")
    if isinstance(size, int) and size > MAX_FILE_BYTES:
        raise BadRequest("This file is larger than 10 MB. Upload a smaller file or paste the text instead.", code="TOO_LARGE")

    upload_id = str(uuid.uuid4())
    key = storage.upload_key(owner_id, upload_id, file_name)
    content_type = FILE_TYPES[extension]
    return respond(200, {
        "uploadId": upload_id,
        "uploadKey": key,
        "uploadUrl": storage.presign_put(key, content_type, URL_EXPIRY_SECONDS),
        "method": "PUT",
        "headers": {"Content-Type": content_type},
        "maxBytes": MAX_FILE_BYTES,
        "expiresInSeconds": URL_EXPIRY_SECONDS,
    })


def _text_from_upload(owner_id: str, upload_key) -> tuple:
    if not isinstance(upload_key, str) or not upload_key.startswith(storage.upload_prefix(owner_id)):
        raise Forbidden("That upload doesn't belong to you.")
    extension = os.path.splitext(upload_key)[1].lower()
    if extension not in FILE_TYPES:
        raise BadRequest("Upload a PDF or DOCX file, or paste the text instead.", code="UNSUPPORTED_TYPE")
    meta = storage.head(upload_key)
    if meta is None:
        raise BadRequest("We couldn't find the uploaded file. Please upload it again.", code="UPLOAD_MISSING")
    if meta["ContentLength"] > MAX_FILE_BYTES:
        raise BadRequest("This file is larger than 10 MB. Upload a smaller file or paste the text instead.", code="TOO_LARGE")
    try:
        text = extract_text(storage.get_bytes(upload_key), extension)
    except ExtractionError as exc:
        raise BadRequest(str(exc), code="EXTRACTION_FAILED") from exc
    return text, extension.lstrip(".").upper()


def create_syllabus(event):
    owner_id = auth.user_id(event)
    body = parse_json_body(event)
    title = required_str(body, "title", 200)
    subject = optional_str(body, "subject", 100)
    institution = optional_str(body, "institution", 200)
    description = optional_str(body, "description", 2000)
    upload_key = body.get("uploadKey")
    pasted = body.get("text")

    if bool(upload_key) == bool(pasted):
        raise BadRequest("Provide either an uploaded file or pasted text, but not both.")

    if upload_key:
        text, source_type = _text_from_upload(owner_id, upload_key)
    else:
        if not isinstance(pasted, str):
            raise BadRequest("text must be a string.")
        text, source_type = normalize(pasted), "PASTE"

    if len(text) < MIN_TEXT_CHARS:
        raise BadRequest(
            "We could only read a few characters from this syllabus. If it's a scanned PDF, paste the text instead.",
            code="TOO_SHORT",
        )
    if len(text) > MAX_TEXT_CHARS:
        raise BadRequest("This syllabus is too long to analyze. Remove appendices and try again.", code="TOO_LONG")
    if guardrails.input_blocked(text):
        raise BadRequest(
            "This doesn't look like a course syllabus, so PHACT can't review it. Upload a syllabus or paste its text.",
            code="OFF_TOPIC",
        )

    # Personal details are purged before anything is stored, and the original file is deleted, so no copy
    # with them survives (see phact/pii.py for what's removed and what's kept).
    text = pii.purge(text)
    description = pii.purge(description) if description else None
    if upload_key:
        storage.delete(upload_key)

    syllabus_id = str(uuid.uuid4())
    text_key = storage.version_key(owner_id, syllabus_id, "upload")
    storage.put_text(text_key, text)

    now = db.now_iso()
    item = {
        "syllabusId": syllabus_id,
        "ownerId": owner_id,
        "ownerEmail": auth.email(event),
        "title": title,
        "subject": subject,
        "institution": institution,
        "description": description,
        "sourceType": source_type,
        "currentVersion": 1,
        "versions": [{"n": 1, "textKey": text_key, "source": "UPLOAD", "createdAt": now}],
        "approvalStatus": "NONE",
        "createdAt": now,
        "updatedAt": now,
        "expiresAt": db.expiry_epoch(),
    }
    db.create_syllabus(item)
    return respond(201, {"syllabus": db.syllabus_detail(item), "extractedText": text})


handler = route({
    ("POST", "/uploads"): presign_upload,
    ("POST", "/syllabi"): create_syllabus,
})
