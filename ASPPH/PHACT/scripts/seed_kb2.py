"""Seeds KB2 (approved syllabi) with the synthetic seed syllabi, through the real approval flow.

Usage:
  PHACT_FACULTY_PASSWORD=... PHACT_ADMIN_PASSWORD=... python3 scripts/seed_kb2.py [--all]

For each seed: the faculty user uploads it and submits version 1, then the admin user approves it, which
scrubs PII and copies it into KB2. Then it waits for KB2 ingestion to finish.

Seed 01 (Epidemiology) is left out by default because the review tests use it as the syllabus under review,
and a review would otherwise find its own twin as a "peer example". Pass --all to include it.

Safe to re-run: seeds already approved are skipped, and seeds left pending by an interrupted run are approved.
"""

import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from smoke_test import check, outputs, request, sign_in  # noqa: E402

SEED_DIR = Path(__file__).resolve().parents[1] / "data" / "seed-syllabi"
SEEDS = [
    ("MPH_Syllabus_01_Northeast_Epidemiology.docx", "EPID 601: Applied Epidemiologic Methods", "Epidemiology", "Harbor State University"),
    ("MPH_Syllabus_02_Southeast.docx", "PHPM 612: Program Planning and Evaluation in Community Health", "Program Planning and Evaluation", "Piedmont Metropolitan University"),
    ("MPH_Syllabus_03_Midwest.docx", "PUBH 540: Environmental and Occupational Health Risk Assessment", "Environmental Health", "North Lakes State University"),
    ("MPH_Syllabus_04_Southwest.docx", "HPM 635: Health Policy Analysis and Rural Health Systems", "Health Policy", "Mesa Valley University"),
    ("MPH_Syllabus_05_West_Pacific.docx", "BIOS 622: Applied Biostatistics and Data Visualization for Public Health", "Biostatistics", "Cascadia Pacific University"),
]
WAIT_SECONDS = 600


def upload(api: str, token: str, file_name: str, title: str, subject: str, institution: str) -> str:
    path = SEED_DIR / file_name
    status, presigned = request("POST", f"{api}/uploads", token, {"fileName": path.name, "fileSize": path.stat().st_size})
    check(f"  upload URL for {path.name}", status == 200, presigned)
    status, _ = request("PUT", presigned["uploadUrl"], raw=path.read_bytes(), headers=presigned["headers"])
    check("  file uploaded", status == 200)
    status, created = request("POST", f"{api}/syllabi", token,
                              {"title": title, "subject": subject, "institution": institution, "uploadKey": presigned["uploadKey"]})
    check("  syllabus created", status == 201, created)
    return created["syllabus"]["syllabusId"]


def wait_for_ingestion(api: str, admin_token: str, since: str) -> None:
    print("\nWaiting for KB2 ingestion (starts within about a minute of the last approval)")
    deadline = time.time() + WAIT_SECONDS
    while time.time() < deadline:
        status, body = request("GET", f"{api}/admin/kb", admin_token)
        check("KB status readable", status == 200, body)
        kb2 = next(kb for kb in body["knowledgeBases"] if kb["kb"] == "APPROVED_SYLLABI")
        job = kb2.get("lastSync") or {}
        fresh = (job.get("startedAt") or "") >= since
        print(f"      {kb2['fileCount']} file(s) in approved/, latest sync: {job.get('status', 'none') if fresh else 'not started yet'}")
        if fresh and job.get("status") == "COMPLETE":
            check(f"KB2 ingestion complete ({job['documentsIndexed']} indexed, {job['documentsFailed']} failed)", job["documentsFailed"] == 0, job)
            return
        if fresh and job.get("status") == "FAILED":
            check("KB2 ingestion", False, job)
        time.sleep(20)
    sys.exit("FAIL  KB2 ingestion did not finish within 10 minutes. Check with: python3 scripts/kb_check.py --wait")


def main():
    seeds = SEEDS if "--all" in sys.argv else SEEDS[1:]
    out = outputs()
    api, region, client_id = out["ApiUrl"], out["Region"], out["UserPoolClientId"]
    faculty_pw = os.environ.get("PHACT_FACULTY_PASSWORD") or sys.exit("Set PHACT_FACULTY_PASSWORD.")
    admin_pw = os.environ.get("PHACT_ADMIN_PASSWORD") or sys.exit("Set PHACT_ADMIN_PASSWORD.")
    faculty = sign_in(region, client_id, os.environ.get("PHACT_FACULTY_EMAIL", "faculty@phact.demo"), faculty_pw)
    admin = sign_in(region, client_id, os.environ.get("PHACT_ADMIN_EMAIL", "admin@phact.demo"), admin_pw)

    status, approved = request("GET", f"{api}/admin/queue?status=APPROVED", admin)
    check("admin can read the approved list", status == 200, approved)
    status, pending = request("GET", f"{api}/admin/queue?status=PENDING", admin)
    check("admin can read the pending queue", status == 200, pending)
    approved_titles = {item["title"] for item in approved["items"]}
    pending_by_title = {item["title"]: item["syllabusId"] for item in pending["items"]}

    started = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    changed = 0
    for file_name, title, subject, institution in seeds:
        print(f"\n{title}")
        if title in approved_titles:
            print("SKIP  already approved into KB2")
            continue
        syllabus_id = pending_by_title.get(title)
        if syllabus_id:
            print("      pending from an earlier run; approving it")
        else:
            syllabus_id = upload(api, faculty, file_name, title, subject, institution)
            status, summary = request("POST", f"{api}/syllabi/{syllabus_id}/submit", faculty, {})
            check("  submitted for approval", status == 200 and summary["approvalStatus"] == "PENDING", summary)
        status, decided = request("POST", f"{api}/admin/syllabi/{syllabus_id}/approve", admin, {})
        check("  approved into KB2 (PII scrubbed)", status == 200 and decided["approvalStatus"] == "APPROVED", decided)
        changed += 1

    if changed:
        wait_for_ingestion(api, admin, started)
    print(f"\nKB2 seeded: {changed} new, {len(seeds) - changed} already there. Modernization reviews can now cite peer examples.")


if __name__ == "__main__":
    main()
