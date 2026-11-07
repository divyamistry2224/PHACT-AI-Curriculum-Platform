"""S3 access and key layout for the app bucket.

Every object in the app bucket is one professor's working data, kept in their own folder:
  faculty/{ownerId}/uploads/{uploadId}/{fileName}                    original file uploaded by the browser
  faculty/{ownerId}/syllabi/{syllabusId}/versions/{label}.md         one version's text; label is "upload" or the reviewId
  faculty/{ownerId}/syllabi/{syllabusId}/results/{reviewId}.json     a review's results
ownerId is the professor's Cognito user ID (sub). Version files are named by what created them, not by
version number, because undo deletes the newest version and the next review reuses its number.

The whole bucket expires after RETENTION_DAYS (a lifecycle rule), matching the DynamoDB TTL on the records.
Approved syllabi are copied to the separate KB source bucket, which never expires:
  approved/{syllabusId}.md                  the approved version, PII scrubbed
  approved/{syllabusId}.md.metadata.json    filter fields for KB2 (syllabusId, title, subject, institution, ...)
"""

import os

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

_client = None


def s3():
    """S3 client using SigV4, which presigned URLs need for KMS-encrypted buckets."""
    global _client
    if _client is None:
        _client = boto3.client("s3", config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}))
    return _client


def app_bucket() -> str:
    return os.environ["APP_BUCKET"]


def owner_prefix(owner_id: str) -> str:
    return f"faculty/{owner_id}/"


def upload_prefix(owner_id: str) -> str:
    return f"{owner_prefix(owner_id)}uploads/"


def upload_key(owner_id: str, upload_id: str, file_name: str) -> str:
    return f"{upload_prefix(owner_id)}{upload_id}/{file_name}"


def version_key(owner_id: str, syllabus_id: str, label: str) -> str:
    return f"{owner_prefix(owner_id)}syllabi/{syllabus_id}/versions/{label}.md"


def results_key(owner_id: str, syllabus_id: str, review_id: str) -> str:
    return f"{owner_prefix(owner_id)}syllabi/{syllabus_id}/results/{review_id}.json"


def presign_put(key: str, content_type: str, expires_in: int = 900) -> str:
    return s3().generate_presigned_url(
        "put_object",
        Params={"Bucket": app_bucket(), "Key": key, "ContentType": content_type},
        ExpiresIn=expires_in,
    )


def head(key: str):
    """Object metadata, or None if the object doesn't exist."""
    try:
        return s3().head_object(Bucket=app_bucket(), Key=key)
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
            return None
        raise


def get_bytes(key: str) -> bytes:
    return s3().get_object(Bucket=app_bucket(), Key=key)["Body"].read()


def get_text(key: str) -> str:
    return get_bytes(key).decode("utf-8")


def get_text_or_none(key: str):
    """The object's text, or None if it no longer exists (for example, removed by the expiry rule)."""
    try:
        return get_text(key)
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
            return None
        raise


def put_text(key: str, text: str, content_type: str = "text/markdown; charset=utf-8") -> None:
    s3().put_object(Bucket=app_bucket(), Key=key, Body=text.encode("utf-8"), ContentType=content_type)


def delete(key: str) -> None:
    s3().delete_object(Bucket=app_bucket(), Key=key)


# ---------- KB source bucket (approved/ feeds KB2, ceph/ feeds KB1; never expires) ----------

def kb_bucket() -> str:
    return os.environ["KB_BUCKET"]


def approved_key(syllabus_id: str) -> str:
    """One file per syllabus: approving a newer version replaces the older one in KB2."""
    return f"approved/{syllabus_id}.md"


def kb_put_text(key: str, text: str, content_type: str = "text/markdown; charset=utf-8") -> None:
    s3().put_object(Bucket=kb_bucket(), Key=key, Body=text.encode("utf-8"), ContentType=content_type)


def kb_document_count(prefix: str) -> int:
    """Documents under a prefix, not counting their .metadata.json sidecar files."""
    count = 0
    for page in s3().get_paginator("list_objects_v2").paginate(Bucket=kb_bucket(), Prefix=prefix):
        count += sum(1 for obj in page.get("Contents", []) if not obj["Key"].endswith(".metadata.json"))
    return count
