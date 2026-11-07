"""Runs the PHACT backend locally: the real Lambda handlers behind a small HTTP server, with AWS replaced by
moto and the same fake Bedrock, Comprehend, and knowledge bases the unit tests use. Also serves a stand-in
Cognito sign-in endpoint. No AWS account or credentials are needed.

  pip install "moto[server]" boto3 pypdf
  python3 tests/e2e/local_api.py            # API on http://localhost:8787/v1

Then run the front end against it (from frontend/):

  VITE_DATA_MODE=live VITE_API_BASE_URL=http://localhost:8787/v1 VITE_USER_POOL_CLIENT_ID=local \\
  VITE_COGNITO_ENDPOINT=http://localhost:8787/cognito/ pnpm dev

Sign in as faculty@phact.demo or admin@phact.demo with the password Demo-Password-1. Reviews take about
ten seconds (STAGE_DELAY seconds per stage) and return canned results. Everything is in memory and is gone
when the process stops.
"""

import base64
import json
import os
import re
import sys
import threading
import time
import traceback
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[2]
MOTO_PORT = int(os.environ.get("MOTO_PORT", "5055"))
API_PORT = int(os.environ.get("API_PORT", "8787"))
STAGE_DELAY = float(os.environ.get("STAGE_DELAY", "2.5"))
PASSWORD = "Demo-Password-1"

os.environ["AWS_ENDPOINT_URL"] = f"http://localhost:{MOTO_PORT}"
sys.path.insert(0, str(ROOT / "tests"))
import conftest  # noqa: E402  (sets the test environment and puts the shared layer on the path)

import boto3  # noqa: E402
from botocore.config import Config  # noqa: E402
from moto.server import ThreadedMotoServer  # noqa: E402

USERS = {
    "faculty@phact.demo": {"sub": "local-faculty", "name": "Dr. Maya Chen", "group": "faculty"},
    "admin@phact.demo": {"sub": "local-admin", "name": "ASPPH Administrator", "group": "admin"},
}

ROUTES = [
    ("GET", "/health", "health"),
    ("POST", "/uploads", "upload"),
    ("POST", "/syllabi", "upload"),
    ("GET", "/syllabi", "faculty_read"),
    ("GET", "/syllabi/{id}", "faculty_read"),
    ("GET", "/syllabi/{id}/versions/{n}", "faculty_read"),
    ("POST", "/syllabi/{id}/competency-reviews", "start_competency_review"),
    ("POST", "/syllabi/{id}/modernization-reviews", "start_modernization_review"),
    ("POST", "/syllabi/{id}/submit", "submit"),
    ("GET", "/reviews/{id}", "get_review"),
    ("POST", "/reviews/{id}/undo", "undo_review"),
    ("POST", "/reviews/{id}/decisions", "decide_review"),
    ("GET", "/admin/queue", "admin_read"),
    ("GET", "/admin/syllabi/{id}", "admin_read"),
    ("POST", "/admin/syllabi/{id}/approve", "approve"),
    ("POST", "/admin/syllabi/{id}/reject", "reject"),
    ("POST", "/admin/syllabi/{id}/summary", "submission_summary"),
    ("GET", "/admin/kb", "kb_admin"),
    ("POST", "/admin/kb/sync", "kb_admin"),
    ("POST", "/feedback", "feedback"),
    ("GET", "/admin/feedback", "feedback"),
]
PATTERNS = [(m, r, re.compile("^" + re.sub(r"\{(\w+)\}", r"(?P<\1>[^/]+)", r) + "$"), fn) for m, r, fn in ROUTES]
FUNCTIONS = {}
QUEUES = {}
START_LOCK = threading.Lock()


# ---------------------------------------------------------------- fakes that take time, like the real services

class SlowBedrock(conftest.FakeBedrockRuntime):
    def converse(self, **kwargs):
        time.sleep(STAGE_DELAY * 2)
        return super().converse(**kwargs)


class SlowAgentRuntime(conftest.FakeAgentRuntime):
    def retrieve(self, **kwargs):
        time.sleep(STAGE_DELAY)
        return super().retrieve(**kwargs)


class AgingBedrockAgent(conftest.FakeBedrockAgent):
    """Ingestion jobs finish 8 seconds after they start."""

    def list_ingestion_jobs(self, **kwargs):
        for job in self.jobs:
            if (datetime.now(timezone.utc) - job["startedAt"]).total_seconds() > 8:
                job["status"] = "COMPLETE"
            elif job["status"] == "STARTING":
                job["status"] = "IN_PROGRESS"
        return super().list_ingestion_jobs(**kwargs)


def setup_aws():
    ddb = boto3.client("dynamodb")
    for name, key, indexes, attrs in [
        ("test-syllabi", "syllabusId", [("byOwner", "ownerId", "createdAt"), ("adminQueue", "queueStatus", "submittedAt")], ["syllabusId", "ownerId", "createdAt", "queueStatus", "submittedAt"]),
        ("test-reviews", "reviewId", [("bySyllabus", "syllabusId", "createdAt")], ["reviewId", "syllabusId", "createdAt"]),
        ("test-feedback", "feedbackId", [("byDate", "kind", "createdAt")], ["feedbackId", "kind", "createdAt"]),
    ]:
        ddb.create_table(
            TableName=name,
            BillingMode="PAY_PER_REQUEST",
            AttributeDefinitions=[{"AttributeName": a, "AttributeType": "S"} for a in attrs],
            KeySchema=[{"AttributeName": key, "KeyType": "HASH"}],
            GlobalSecondaryIndexes=[
                {"IndexName": i, "KeySchema": [{"AttributeName": h, "KeyType": "HASH"}, {"AttributeName": r, "KeyType": "RANGE"}], "Projection": {"ProjectionType": "ALL"}}
                for i, h, r in indexes
            ],
        )
    s3 = boto3.client("s3", config=Config(s3={"addressing_style": "path"}))
    for bucket in ("test-app-bucket", "test-kb-bucket"):
        s3.create_bucket(Bucket=bucket)
        s3.put_bucket_cors(Bucket=bucket, CORSConfiguration={"CORSRules": [{"AllowedMethods": ["PUT", "GET"], "AllowedOrigins": ["*"], "AllowedHeaders": ["*"]}]})
    for path in sorted((ROOT / "data" / "ceph").glob("D2-*.md*")):
        s3.put_object(Bucket="test-kb-bucket", Key=f"ceph/{path.name}", Body=path.read_bytes())
    sqs = boto3.client("sqs")
    QUEUES["competency"] = sqs.create_queue(QueueName="competency")["QueueUrl"]
    QUEUES["modernization"] = sqs.create_queue(QueueName="modernization")["QueueUrl"]

    from phact import aws, storage

    # Path-style presigned URLs (http://localhost:5055/bucket/key), which a browser can reach.
    storage._client = boto3.client("s3", config=Config(signature_version="s3v4", s3={"addressing_style": "path"}))
    aws.set_client("bedrock-runtime", SlowBedrock())
    aws.set_client("comprehend", conftest.FakeComprehend())
    agent_runtime = SlowAgentRuntime()
    agent_runtime.peers = [
        {"content": {"text": "Students submit an annotated log of AI-suggested R code with every correction they made, graded on the quality of their verification."},
         "metadata": {"title": "BIOS 622: Applied Biostatistics and Data Visualization for Public Health", "institution": "Cascadia Pacific University", "subject": "Biostatistics", "syllabusId": "seed-05"}},
        {"content": {"text": "Teams present a rapid policy brief orally to a mock legislative staff panel; questions are unscripted."},
         "metadata": {"title": "HPM 635: Health Policy Analysis and Rural Health Systems", "institution": "Mesa Valley University", "subject": "Health Policy", "syllabusId": "seed-04"}},
    ]
    aws.set_client("bedrock-agent-runtime", agent_runtime)
    agent = AgingBedrockAgent()
    agent.start_ingestion_job(knowledgeBaseId="kb-ceph", dataSourceId="ds-ceph")
    aws.set_client("bedrock-agent", agent)

    for _, _, fn in ROUTES:
        if fn not in FUNCTIONS:
            FUNCTIONS[fn] = conftest.load_function(fn)
    FUNCTIONS["competency_worker"] = conftest.load_function("competency_worker")
    FUNCTIONS["decision_notifier"] = conftest.load_function("decision_notifier")
    FUNCTIONS["modernization_worker"] = conftest.load_function("modernization_worker")


def stream_decision(syllabus_id: str):
    """Plays the part of the Syllabi table's DynamoDB Stream: hands the decision to DecisionNotifier.
    No SES sender is configured locally, so the email is built and recorded as not sent."""
    from boto3.dynamodb.types import TypeSerializer
    from phact import db

    time.sleep(1.5)
    serialize = TypeSerializer().serialize
    new = db.get_syllabus(syllabus_id)
    image = lambda item: {k: serialize(v) for k, v in item.items()}
    record = {"eventID": "local", "eventName": "MODIFY", "dynamodb": {"SequenceNumber": "1", "OldImage": image({**new, "approvalStatus": "PENDING"}), "NewImage": image(new)}}
    FUNCTIONS["decision_notifier"].handler({"Records": [record]}, None)


def run_workers():
    """Plays the part of the SQS triggers: each queued review runs in its own thread."""
    sqs = boto3.client("sqs")
    while True:
        for kind, url in QUEUES.items():
            for message in sqs.receive_message(QueueUrl=url, MaxNumberOfMessages=5, WaitTimeSeconds=0).get("Messages", []):
                sqs.delete_message(QueueUrl=url, ReceiptHandle=message["ReceiptHandle"])
                worker = FUNCTIONS[f"{kind}_worker"]
                threading.Thread(target=worker.handler, args=({"Records": [{"body": message["Body"]}]}, None), daemon=True).start()
        time.sleep(0.5)


# ---------------------------------------------------------------- stand-in Cognito

def b64(data: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip("=")


def make_token(email: str) -> str:
    user = USERS[email]
    claims = {"sub": user["sub"], "email": email, "name": user["name"], "cognito:groups": [user["group"]], "exp": int(time.time()) + 3600}
    return f"{b64({'alg': 'none'})}.{b64(claims)}.local"


def claims_from(token: str):
    try:
        payload = token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except (IndexError, ValueError):
        return None
    if claims.get("exp", 0) < time.time():
        return None
    # API Gateway's REST authorizer passes groups as one string.
    return {**claims, "cognito:groups": ",".join(claims.get("cognito:groups", []))}


def cognito(body: dict):
    params = body.get("AuthParameters", {})
    if body.get("AuthFlow") == "REFRESH_TOKEN_AUTH":
        email = params.get("REFRESH_TOKEN", "").removeprefix("refresh:")
        if email not in USERS:
            return 400, {"__type": "NotAuthorizedException", "message": "Invalid refresh token."}
        return 200, {"AuthenticationResult": {"IdToken": make_token(email), "ExpiresIn": 3600}}
    email = params.get("USERNAME", "").lower()
    if email not in USERS or params.get("PASSWORD") != PASSWORD:
        return 400, {"__type": "NotAuthorizedException", "message": "Incorrect username or password."}
    return 200, {"AuthenticationResult": {"IdToken": make_token(email), "RefreshToken": f"refresh:{email}", "ExpiresIn": 3600}}


# ---------------------------------------------------------------- HTTP

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        if os.environ.get("VERBOSE"):
            super().log_message(fmt, *args)

    def send(self, status: int, body, headers=None):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Amz-Target")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send(204, b"")

    def do_GET(self):
        self.handle_api("GET")

    def do_POST(self):
        self.handle_api("POST")

    def handle_api(self, method: str):
        url = urlparse(self.path)
        raw = self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode() or None
        if url.path.startswith("/cognito"):
            status, body = cognito(json.loads(raw or "{}"))
            return self.send(status, body, {"Content-Type": "application/x-amz-json-1.1"})
        path = url.path.removeprefix("/v1")
        for m, resource, pattern, fn in PATTERNS:
            match = pattern.match(path)
            if m == method and match:
                break
        else:
            return self.send(403, {"message": "Missing Authentication Token"})
        claims = None
        if resource != "/health":
            claims = claims_from(self.headers.get("Authorization", ""))
            if not claims:
                return self.send(401, {"message": "Unauthorized"})
        event = {
            "httpMethod": method,
            "resource": resource,
            "pathParameters": match.groupdict() or None,
            "queryStringParameters": {k: v[0] for k, v in parse_qs(url.query).items()} or None,
            "body": raw,
            "requestContext": {"authorizer": {"claims": claims or {}}},
        }
        try:
            if fn.startswith("start_"):
                with START_LOCK:
                    os.environ["REVIEW_QUEUE_URL"] = QUEUES["competency" if "competency" in fn else "modernization"]
                    response = FUNCTIONS[fn].handler(event, conftest.Ctx())
            else:
                response = FUNCTIONS[fn].handler(event, conftest.Ctx())
        except Exception:
            traceback.print_exc()
            return self.send(500, {"code": "INTERNAL", "message": "Local harness error."})
        if fn in ("approve", "reject") and response["statusCode"] == 200:
            threading.Thread(target=stream_decision, args=(match.groupdict()["id"],), daemon=True).start()
        self.send(response["statusCode"], response["body"].encode(), {"Content-Type": "application/json"})


def main():
    moto = ThreadedMotoServer(port=MOTO_PORT, verbose=False)
    moto.start()
    setup_aws()
    threading.Thread(target=run_workers, daemon=True).start()
    server = ThreadingHTTPServer(("0.0.0.0", API_PORT), Handler)
    print(f"PHACT local API on http://localhost:{API_PORT}/v1 (stand-in Cognito at /cognito/, moto on :{MOTO_PORT})", flush=True)
    try:
        server.serve_forever()
    finally:
        moto.stop()


if __name__ == "__main__":
    main()
