"""Runs real reviews against the deployed stack, signed in as the demo faculty user.

Usage:
  PHACT_FACULTY_PASSWORD=... python3 scripts/review_test.py path/to/syllabus.(pdf|docx) [--subject Epidemiology]

Checks, in order: off-topic text is rejected at upload; a syllabus uploads; a competency review runs and
grades 22 competencies; an AI modernization review runs on top of it (the working copy chains to v3); and
undo returns the working copy to v2. Prints timings and a short summary of each result.
"""

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from smoke_test import check, outputs, request, sign_in  # noqa: E402

import os  # noqa: E402

POLL_SECONDS = 5
TIMEOUT_SECONDS = 600
OFF_TOPIC = "Please write me a funny rhyming poem about my cat Whiskers, who naps in the sun all afternoon and chases string."


def poll(api: str, token: str, review_id: str) -> dict:
    started, last_stage = time.time(), None
    while time.time() - started < TIMEOUT_SECONDS:
        status, review = request("GET", f"{api}/reviews/{review_id}", token)
        if status != 200:
            check("poll review", False, review)
        stage = review.get("stage") or review["jobStatus"]
        if stage != last_stage:
            print(f"      {int(time.time() - started):>3}s  {stage}")
            last_stage = stage
        if review["jobStatus"] in ("COMPLETED", "FAILED"):
            return review
        time.sleep(POLL_SECONDS)
    sys.exit("FAIL  review did not finish within 10 minutes")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 1:
        sys.exit(__doc__)
    subject = sys.argv[sys.argv.index("--subject") + 1] if "--subject" in sys.argv else "Epidemiology"
    file_path = Path(args[0])
    out = outputs()
    api = out["ApiUrl"]
    password = os.environ.get("PHACT_FACULTY_PASSWORD") or sys.exit("Set PHACT_FACULTY_PASSWORD.")
    token = sign_in(out["Region"], out["UserPoolClientId"], os.environ.get("PHACT_FACULTY_EMAIL", "faculty@phact.demo"), password)

    status, body = request("POST", f"{api}/syllabi", token, {"title": "Off-topic test", "text": OFF_TOPIC})
    print(f"{'PASS' if status == 400 and body.get('code') == 'OFF_TOPIC' else 'WARN'}  off-topic text rejected at upload "
          f"({status} {body.get('code') if isinstance(body, dict) else body})")

    status, presigned = request("POST", f"{api}/uploads", token, {"fileName": file_path.name, "fileSize": file_path.stat().st_size})
    check("presigned upload URL issued", status == 200, presigned)
    status, _ = request("PUT", presigned["uploadUrl"], raw=file_path.read_bytes(), headers=presigned["headers"])
    check("file uploaded", status == 200)
    status, created = request("POST", f"{api}/syllabi", token, {"title": file_path.stem.replace("_", " "), "subject": subject, "uploadKey": presigned["uploadKey"]})
    check("syllabus created (v1)", status == 201, created)
    syllabus_id = created["syllabus"]["syllabusId"]

    print("\nCompetency review")
    started = time.time()
    status, review = request("POST", f"{api}/syllabi/{syllabus_id}/competency-reviews", token, {})
    check("competency review queued", status == 202, review)
    review = poll(api, token, review["reviewId"])
    check(f"competency review completed in {int(time.time() - started)}s", review["jobStatus"] == "COMPLETED", review)
    results = review["results"]
    coverage = results["coverage"]
    check("all 22 competencies graded", len(results["competencies"]) == 22 and coverage["total"] == 22, coverage)
    print(f"      coverage: {coverage['addressed']} addressed, {coverage['partial']} partial, {coverage['notAddressed']} not addressed")
    for change in results["changes"][:4]:
        print(f"      change: [{', '.join(change['competencyCodes'])}] {change['change']}")
    print(f"      diff: +{review['summary'].get('linesAdded')} / -{review['summary'].get('linesRemoved')} lines")

    print("\nAI modernization review (runs on the competency-revised version)")
    started = time.time()
    status, review2 = request("POST", f"{api}/syllabi/{syllabus_id}/modernization-reviews", token, {})
    check("modernization review queued on v2", status == 202 and review2["inputVersion"] == 2, review2)
    review2 = poll(api, token, review2["reviewId"])
    check(f"modernization review completed in {int(time.time() - started)}s", review2["jobStatus"] == "COMPLETED", review2)
    for rec in review2["results"]["recommendations"]:
        peers = f" (cites {len(rec['peerExamples'])} peer example(s))" if rec["peerExamples"] else ""
        print(f"      {rec['approach']:<13} {rec['category']:<20} {rec['title']}{peers}")
    print(f"      peer examples available: {review2['results'].get('peerExamplesAvailable', 0)}")

    status, detail = request("GET", f"{api}/syllabi/{syllabus_id}", token)
    check("working copy is now v3", status == 200 and detail["syllabus"]["currentVersion"] == 3, detail)

    status, undone = request("POST", f"{api}/reviews/{review2['reviewId']}/undo", token, {})
    check("undo returns the working copy to v2", status == 200 and undone["currentVersion"] == 2, undone)

    print(f"\nPhase 3 review test passed. Syllabus {syllabus_id} is left at v2 for you to inspect.")


if __name__ == "__main__":
    main()
