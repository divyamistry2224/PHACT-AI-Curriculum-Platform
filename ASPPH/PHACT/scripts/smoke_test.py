"""End-to-end check of a deployed stack, signed in as the demo faculty user.

Usage:
  PHACT_FACULTY_PASSWORD=... python3 scripts/smoke_test.py path/to/syllabus.(pdf|docx)

Reads .phact/outputs.json (written by deploy.sh). Uses only boto3 and the standard library.
"""

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

import boto3

ROOT = Path(__file__).resolve().parents[1]


def outputs() -> dict:
    path = ROOT / ".phact" / "outputs.json"
    if not path.exists():
        sys.exit("Missing .phact/outputs.json. Run ./scripts/deploy.sh first.")
    return {o["OutputKey"]: o["OutputValue"] for o in json.loads(path.read_text())}


def sign_in(region: str, client_id: str, email: str, password: str) -> str:
    result = boto3.client("cognito-idp", region_name=region).initiate_auth(
        ClientId=client_id,
        AuthFlow="USER_PASSWORD_AUTH",
        AuthParameters={"USERNAME": email, "PASSWORD": password},
    )
    return result["AuthenticationResult"]["IdToken"]


def request(method: str, url: str, token: str = None, body=None, raw: bytes = None, headers=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    hdrs = dict(headers or {})
    if token:
        hdrs["Authorization"] = token
    if body is not None:
        hdrs["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            text = resp.read().decode() or "{}"
            return resp.status, (json.loads(text) if text.startswith("{") else text)
    except urllib.error.HTTPError as err:
        text = err.read().decode()
        return err.code, (json.loads(text) if text.startswith("{") else text)


def check(label: str, condition: bool, detail=None):
    print(f"{'PASS' if condition else 'FAIL'}  {label}")
    if not condition:
        if detail is not None:
            print(json.dumps(detail, indent=2) if not isinstance(detail, str) else detail)
        sys.exit(1)


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    file_path = Path(sys.argv[1])
    out = outputs()
    api, region = out["ApiUrl"], out["Region"]
    email = os.environ.get("PHACT_FACULTY_EMAIL", "faculty@phact.demo")
    password = os.environ.get("PHACT_FACULTY_PASSWORD") or sys.exit("Set PHACT_FACULTY_PASSWORD.")

    status, _ = request("GET", f"{api}/health")
    check("health endpoint responds", status == 200)

    status, body = request("GET", f"{api}/syllabi")
    check("API rejects requests without a token", status == 401, body)

    token = sign_in(region, out["UserPoolClientId"], email, password)
    check("faculty user signs in", bool(token))

    status, presigned = request("POST", f"{api}/uploads", token, {"fileName": file_path.name, "fileSize": file_path.stat().st_size})
    check("presigned upload URL issued", status == 200, presigned)

    status, _ = request("PUT", presigned["uploadUrl"], raw=file_path.read_bytes(), headers=presigned["headers"])
    check("file uploaded straight to S3", status == 200)

    status, created = request("POST", f"{api}/syllabi", token, {
        "title": file_path.stem.replace("_", " "),
        "subject": "Smoke test",
        "uploadKey": presigned["uploadKey"],
    })
    check("syllabus created from upload", status == 201, created)
    syllabus_id = created["syllabus"]["syllabusId"]
    print(f"      extracted {len(created['extractedText'])} characters; first line: {created['extractedText'].splitlines()[0]!r}")

    status, listing = request("GET", f"{api}/syllabi", token)
    check("syllabus appears in the dashboard list", status == 200 and any(s["syllabusId"] == syllabus_id for s in listing["syllabi"]), listing)

    status, detail = request("GET", f"{api}/syllabi/{syllabus_id}", token)
    check("syllabus detail loads with version 1", status == 200 and detail["syllabus"]["currentVersion"] == 1, detail)

    status, version = request("GET", f"{api}/syllabi/{syllabus_id}/versions/1", token)
    check("version 1 text loads", status == 200 and version["text"] == created["extractedText"], version)

    print("\nPhase 1 smoke test passed.")


if __name__ == "__main__":
    main()
