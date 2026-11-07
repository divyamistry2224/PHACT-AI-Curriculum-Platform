"""Checks the approval flow against the deployed stack, without adding anything to KB2.

Usage:
  PHACT_FACULTY_PASSWORD=... PHACT_ADMIN_PASSWORD=... python3 scripts/approval_test.py path/to/syllabus.(pdf|docx)

Checks: faculty can't reach admin endpoints; submit and double-submit; the admin queue and detail view;
reject needs a reason, and the faculty member sees it; resubmit; the KB status page. It finishes by rejecting
its own submission so nothing is left pending. Approval itself is exercised by seed_kb2.py.
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from smoke_test import check, outputs, request, sign_in  # noqa: E402


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    file_path = Path(sys.argv[1])
    out = outputs()
    api, region, client_id = out["ApiUrl"], out["Region"], out["UserPoolClientId"]
    faculty_pw = os.environ.get("PHACT_FACULTY_PASSWORD") or sys.exit("Set PHACT_FACULTY_PASSWORD.")
    admin_pw = os.environ.get("PHACT_ADMIN_PASSWORD") or sys.exit("Set PHACT_ADMIN_PASSWORD.")
    faculty = sign_in(region, client_id, os.environ.get("PHACT_FACULTY_EMAIL", "faculty@phact.demo"), faculty_pw)
    admin = sign_in(region, client_id, os.environ.get("PHACT_ADMIN_EMAIL", "admin@phact.demo"), admin_pw)

    status, body = request("GET", f"{api}/admin/queue", faculty)
    if status == 403 and isinstance(body, dict) and "code" not in body:
        sys.exit("FAIL  /admin/queue doesn't exist on the deployed API. Phase 4 isn't deployed yet: run ./scripts/deploy.sh.")
    check("faculty user gets 403 FORBIDDEN on the admin queue", status == 403 and body.get("code") == "FORBIDDEN", body)

    status, presigned = request("POST", f"{api}/uploads", faculty, {"fileName": file_path.name, "fileSize": file_path.stat().st_size})
    check("presigned upload URL issued", status == 200, presigned)
    status, _ = request("PUT", presigned["uploadUrl"], raw=file_path.read_bytes(), headers=presigned["headers"])
    check("file uploaded", status == 200)
    status, created = request("POST", f"{api}/syllabi", faculty,
                              {"title": f"Approval test: {file_path.stem}", "subject": "Approval test", "uploadKey": presigned["uploadKey"]})
    check("syllabus created (v1)", status == 201, created)
    syllabus_id = created["syllabus"]["syllabusId"]

    status, summary = request("POST", f"{api}/syllabi/{syllabus_id}/submit", faculty, {})
    check("submitted (PENDING, v1)", status == 200 and summary["approvalStatus"] == "PENDING" and summary["submittedVersion"] == 1, summary)
    status, body = request("POST", f"{api}/syllabi/{syllabus_id}/submit", faculty, {})
    check("second submit refused (409 ALREADY_SUBMITTED)", status == 409 and body.get("code") == "ALREADY_SUBMITTED", body)

    status, queue = request("GET", f"{api}/admin/queue", admin)
    check("submission is in the admin queue", status == 200 and any(i["syllabusId"] == syllabus_id for i in queue["items"]), queue)
    status, detail = request("GET", f"{api}/admin/syllabi/{syllabus_id}", admin)
    check("admin detail has text and submitter", status == 200 and len(detail["text"]) > 500 and detail["syllabus"].get("ownerEmail"), detail)

    status, body = request("POST", f"{api}/admin/syllabi/{syllabus_id}/reject", admin, {})
    check("reject without a reason refused (400)", status == 400, body)
    reason = "Approval test: please add an assessment rubric for the final project."
    status, summary = request("POST", f"{api}/admin/syllabi/{syllabus_id}/reject", admin, {"reason": reason})
    check("rejected with a reason (DENIED)", status == 200 and summary["approvalStatus"] == "DENIED", summary)

    status, mine = request("GET", f"{api}/syllabi/{syllabus_id}", faculty)
    seen = mine.get("syllabus", {}) if isinstance(mine, dict) else {}
    check("faculty sees DENIED and the reason", status == 200 and seen.get("denyReason") == reason, mine)

    status, summary = request("POST", f"{api}/syllabi/{syllabus_id}/submit", faculty, {})
    check("resubmitted after denial", status == 200 and summary["approvalStatus"] == "PENDING" and "denyReason" not in summary, summary)

    status, kbs = request("GET", f"{api}/admin/kb", admin)
    check("KB status page readable", status == 200 and len(kbs["knowledgeBases"]) == 2, kbs)
    for kb in kbs["knowledgeBases"]:
        job = kb.get("lastSync") or {}
        print(f"      {kb['name']}: {kb['fileCount']} file(s), last sync {job.get('status', 'never')} {job.get('startedAt', '')}")

    status, summary = request("POST", f"{api}/admin/syllabi/{syllabus_id}/reject", admin, {"reason": "Approval test cleanup."})
    check("cleanup: test submission rejected so the queue stays clean", status == 200, summary)
    print("\nPhase 4 approval test passed.")


if __name__ == "__main__":
    main()
