"""Phase 1: upload, syllabus creation, and faculty reads."""

import boto3

from conftest import FIXTURES, SEEDS, api_event, call, load_function

PASTED = (
    "PUBH 500: Introduction to Public Health\n\nLearning outcomes\n- Describe core functions of public health.\n"
    "- Apply basic epidemiologic measures to a community health problem.\n"
)


def test_health():
    health = load_function("health")
    status, body = call(health, api_event("GET", "/health", groups=None))
    assert status == 200 and body["status"] == "ok"


def test_presign_rejects_unsupported_type(aws):
    upload = load_function("upload")
    status, body = call(upload, api_event("POST", "/uploads", body={"fileName": "notes.txt"}))
    assert status == 400 and body["code"] == "UNSUPPORTED_TYPE"


def test_presign_returns_owner_scoped_key(aws):
    upload = load_function("upload")
    status, body = call(upload, api_event("POST", "/uploads", body={"fileName": "../../EPID 601.docx"}))
    assert status == 200
    assert body["uploadKey"].startswith("faculty/user-1/uploads/")
    assert body["uploadKey"].endswith("/EPID 601.docx")
    assert "X-Amz-Signature" in body["uploadUrl"]


def test_create_from_pasted_text_then_read_back(aws):
    upload = load_function("upload")
    status, body = call(upload, api_event("POST", "/syllabi", body={"title": "PUBH 500", "subject": "Community Health", "text": PASTED}))
    assert status == 201
    syllabus = body["syllabus"]
    assert syllabus["currentVersion"] == 1 and syllabus["sourceType"] == "PASTE"
    assert syllabus["versions"] == [{"n": 1, "source": "UPLOAD", "createdAt": syllabus["createdAt"]}]
    assert "textKey" not in str(body)

    read = load_function("faculty_read")
    status, listing = call(read, api_event("GET", "/syllabi"))
    assert status == 200 and [s["syllabusId"] for s in listing["syllabi"]] == [syllabus["syllabusId"]]

    status, version = call(read, api_event("GET", "/syllabi/{id}/versions/{n}", path={"id": syllabus["syllabusId"], "n": "1"}))
    assert status == 200 and version["isCurrent"] and version["text"].startswith("PUBH 500")


def test_create_from_uploaded_docx(aws):
    upload = load_function("upload")
    _, presigned = call(upload, api_event("POST", "/uploads", body={"fileName": "epi.docx"}))
    data = (SEEDS / "MPH_Syllabus_01_Northeast_Epidemiology.docx").read_bytes()
    boto3.client("s3").put_object(Bucket="test-app-bucket", Key=presigned["uploadKey"], Body=data)

    status, body = call(upload, api_event("POST", "/syllabi", body={"title": "EPID 601", "uploadKey": presigned["uploadKey"]}))
    assert status == 201
    assert body["syllabus"]["sourceType"] == "DOCX"
    assert "# EPID 601: Applied Epidemiologic Methods" in body["extractedText"]
    assert "| Assessment | Weight |" in body["extractedText"]


def test_create_from_uploaded_pdf(aws):
    upload = load_function("upload")
    _, presigned = call(upload, api_event("POST", "/uploads", body={"fileName": "hpm635.pdf"}))
    data = (FIXTURES / "MPH_Syllabus_04_Southwest.pdf").read_bytes()  # synthetic seed 04, printed to PDF
    boto3.client("s3").put_object(Bucket="test-app-bucket", Key=presigned["uploadKey"], Body=data)

    status, body = call(upload, api_event("POST", "/syllabi", body={"title": "HPM 635", "uploadKey": presigned["uploadKey"]}))
    assert status == 201 and body["syllabus"]["sourceType"] == "PDF"
    assert "Health Policy Analysis and Rural Health Systems" in body["extractedText"]


def test_cannot_claim_someone_elses_upload(aws):
    upload = load_function("upload")
    status, body = call(upload, api_event("POST", "/syllabi", body={"title": "x", "uploadKey": "faculty/user-2/uploads/abc/file.pdf"}))
    assert status == 403
    status, body = call(upload, api_event("POST", "/syllabi", body={"title": "x", "uploadKey": "faculty/user-1/syllabi/abc/versions/upload.md"}))
    assert status == 403


def test_requires_exactly_one_source(aws):
    upload = load_function("upload")
    status, _ = call(upload, api_event("POST", "/syllabi", body={"title": "x"}))
    assert status == 400
    status, _ = call(upload, api_event("POST", "/syllabi", body={"title": "x", "text": PASTED, "uploadKey": "faculty/user-1/uploads/a/b.pdf"}))
    assert status == 400


def test_rejects_too_short_text(aws):
    upload = load_function("upload")
    status, body = call(upload, api_event("POST", "/syllabi", body={"title": "x", "text": "too short"}))
    assert status == 400 and body["code"] == "TOO_SHORT"


def test_other_faculty_cannot_read_syllabus(aws):
    upload = load_function("upload")
    _, body = call(upload, api_event("POST", "/syllabi", body={"title": "PUBH 500", "text": PASTED}))
    read = load_function("faculty_read")
    status, _ = call(read, api_event("GET", "/syllabi/{id}", user="user-2", path={"id": body["syllabus"]["syllabusId"]}))
    assert status == 404


def test_new_syllabus_expires_after_retention_period(aws):
    import time

    upload = load_function("upload")
    _, body = call(upload, api_event("POST", "/syllabi", body={"title": "PUBH 500", "text": PASTED}))
    item = boto3.resource("dynamodb").Table("test-syllabi").get_item(Key={"syllabusId": body["syllabus"]["syllabusId"]})["Item"]
    days = (int(item["expiresAt"]) - time.time()) / 86400
    assert 179.9 < days <= 180
    assert body["syllabus"]["expiresAt"].endswith("Z")
    assert item["versions"][0]["textKey"].startswith("faculty/user-1/syllabi/")


def test_expired_syllabus_is_hidden_before_ttl_deletes_it(aws):
    upload = load_function("upload")
    _, body = call(upload, api_event("POST", "/syllabi", body={"title": "PUBH 500", "text": PASTED}))
    syllabus_id = body["syllabus"]["syllabusId"]
    boto3.resource("dynamodb").Table("test-syllabi").update_item(
        Key={"syllabusId": syllabus_id}, UpdateExpression="SET expiresAt = :past", ExpressionAttributeValues={":past": 1}
    )
    read = load_function("faculty_read")
    _, listing = call(read, api_event("GET", "/syllabi"))
    assert listing["syllabi"] == []
    status, error = call(read, api_event("GET", "/syllabi/{id}", path={"id": syllabus_id}))
    assert status == 410 and error["code"] == "EXPIRED"


def test_version_file_removed_by_lifecycle_returns_410(aws):
    upload = load_function("upload")
    _, body = call(upload, api_event("POST", "/syllabi", body={"title": "PUBH 500", "text": PASTED}))
    syllabus_id = body["syllabus"]["syllabusId"]
    key = boto3.resource("dynamodb").Table("test-syllabi").get_item(Key={"syllabusId": syllabus_id})["Item"]["versions"][0]["textKey"]
    boto3.client("s3").delete_object(Bucket="test-app-bucket", Key=key)
    read = load_function("faculty_read")
    status, error = call(read, api_event("GET", "/syllabi/{id}/versions/{n}", path={"id": syllabus_id, "n": "1"}))
    assert status == 410


def test_groups_claim_shapes():
    from phact import auth

    for raw, expected in [("admin", {"admin"}), ("admin,faculty", {"admin", "faculty"}), ("[admin faculty]", {"admin", "faculty"})]:
        assert auth.groups({"requestContext": {"authorizer": {"claims": {"cognito:groups": raw}}}}) == expected
