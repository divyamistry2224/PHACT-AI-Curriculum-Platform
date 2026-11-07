"""Test setup: mocked AWS (moto), the shared layer on the import path, and helpers to load each
function's app.py under a unique module name (every function has a file called app.py)."""

import importlib.util
import json
import os
import sys
import uuid
from pathlib import Path

import boto3
import pytest
from moto import mock_aws

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend" / "shared"))

os.environ.update({
    "AWS_DEFAULT_REGION": "us-east-1",
    "AWS_ACCESS_KEY_ID": "testing",
    "AWS_SECRET_ACCESS_KEY": "testing",
    "SYLLABI_TABLE": "test-syllabi",
    "REVIEWS_TABLE": "test-reviews",
    "APP_BUCKET": "test-app-bucket",
    "ALLOWED_ORIGIN": "*",
    "MODEL_ID": "us.anthropic.test-model",
    "GUARDRAIL_ID": "test-guardrail",
    "GUARDRAIL_VERSION": "DRAFT",
    "CEPH_KB_ID": "kb-ceph",
    "SYLLABI_KB_ID": "kb-syllabi",
    "CEPH_DS_ID": "ds-ceph",
    "SYLLABI_DS_ID": "ds-syllabi",
    "KB_BUCKET": "test-kb-bucket",
    "FEEDBACK_TABLE": "test-feedback",
})

FIXTURES = ROOT / "tests" / "fixtures"
SEEDS = ROOT / "data" / "seed-syllabi"


def load_function(name: str):
    """Import backend/functions/<name>/app.py fresh, with that function's folder on the path."""
    folder = ROOT / "backend" / "functions" / name
    sys.path.insert(0, str(folder))
    try:
        for local in ("extract",):
            sys.modules.pop(local, None)
        spec = importlib.util.spec_from_file_location(f"fn_{name}_{uuid.uuid4().hex}", folder / "app.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        sys.path.remove(str(folder))


def _reset_clients():
    from phact import aws, db, storage

    db._resource = None
    storage._client = None
    aws.reset()


@pytest.fixture
def aws():
    with mock_aws():
        _reset_clients()
        ddb = boto3.client("dynamodb", region_name="us-east-1")
        ddb.create_table(
            TableName="test-syllabi",
            BillingMode="PAY_PER_REQUEST",
            AttributeDefinitions=[
                {"AttributeName": "syllabusId", "AttributeType": "S"},
                {"AttributeName": "ownerId", "AttributeType": "S"},
                {"AttributeName": "createdAt", "AttributeType": "S"},
                {"AttributeName": "queueStatus", "AttributeType": "S"},
                {"AttributeName": "submittedAt", "AttributeType": "S"},
            ],
            KeySchema=[{"AttributeName": "syllabusId", "KeyType": "HASH"}],
            GlobalSecondaryIndexes=[
                {
                    "IndexName": "byOwner",
                    "KeySchema": [
                        {"AttributeName": "ownerId", "KeyType": "HASH"},
                        {"AttributeName": "createdAt", "KeyType": "RANGE"},
                    ],
                    "Projection": {"ProjectionType": "ALL"},
                },
                {
                    "IndexName": "adminQueue",
                    "KeySchema": [
                        {"AttributeName": "queueStatus", "KeyType": "HASH"},
                        {"AttributeName": "submittedAt", "KeyType": "RANGE"},
                    ],
                    "Projection": {"ProjectionType": "ALL"},
                },
            ],
        )
        ddb.create_table(
            TableName="test-reviews",
            BillingMode="PAY_PER_REQUEST",
            AttributeDefinitions=[
                {"AttributeName": "reviewId", "AttributeType": "S"},
                {"AttributeName": "syllabusId", "AttributeType": "S"},
                {"AttributeName": "createdAt", "AttributeType": "S"},
            ],
            KeySchema=[{"AttributeName": "reviewId", "KeyType": "HASH"}],
            GlobalSecondaryIndexes=[
                {
                    "IndexName": "bySyllabus",
                    "KeySchema": [
                        {"AttributeName": "syllabusId", "KeyType": "HASH"},
                        {"AttributeName": "createdAt", "KeyType": "RANGE"},
                    ],
                    "Projection": {"ProjectionType": "ALL"},
                },
            ],
        )
        ddb.create_table(
            TableName="test-feedback",
            BillingMode="PAY_PER_REQUEST",
            AttributeDefinitions=[{"AttributeName": a, "AttributeType": "S"} for a in ("feedbackId", "kind", "createdAt")],
            KeySchema=[{"AttributeName": "feedbackId", "KeyType": "HASH"}],
            GlobalSecondaryIndexes=[{"IndexName": "byDate", "KeySchema": [{"AttributeName": "kind", "KeyType": "HASH"}, {"AttributeName": "createdAt", "KeyType": "RANGE"}], "Projection": {"ProjectionType": "ALL"}}],
        )
        boto3.client("s3", region_name="us-east-1").create_bucket(Bucket="test-app-bucket")
        boto3.client("s3", region_name="us-east-1").create_bucket(Bucket="test-kb-bucket")
        queue_url = boto3.client("sqs", region_name="us-east-1").create_queue(QueueName="test-reviews")["QueueUrl"]
        os.environ["REVIEW_QUEUE_URL"] = queue_url
        from phact import aws as phact_aws

        phact_aws.set_client("bedrock-runtime", FakeBedrockRuntime())
        phact_aws.set_client("comprehend", FakeComprehend())
        phact_aws.set_client("bedrock-agent-runtime", FakeAgentRuntime())
        phact_aws.set_client("bedrock-agent", FakeBedrockAgent())
        yield
        _reset_clients()


# ---------------------------------------------------------------- fakes for Bedrock and Comprehend

import re as _re

CEPH_DIR = ROOT / "data" / "ceph"


class FakeBedrockRuntime:
    """Guardrail: blocks text containing BLOCKME; masks emails in OUTPUT. Converse: returns `tool_output`,
    or by default grades every competency and appends a section to the syllabus it was given."""

    def __init__(self):
        self.tool_output = None
        self.converse_calls = []
        self.guardrail_calls = []

    def apply_guardrail(self, guardrailIdentifier, guardrailVersion, source, content):
        text = content[0]["text"]["text"]
        self.guardrail_calls.append((source, text))
        if "BLOCKME" in text:
            return {"action": "GUARDRAIL_INTERVENED", "outputs": [{"text": "blocked"}],
                    "assessments": [{"topicPolicy": {"topics": [{"name": "Creative writing", "action": "BLOCKED"}]}}]}
        if source == "OUTPUT" and _re.search(r"[\w.]+@[\w.]+", text):
            masked = _re.sub(r"[\w.]+@[\w.]+\.\w+", "{EMAIL}", text)
            return {"action": "GUARDRAIL_INTERVENED", "outputs": [{"text": masked}],
                    "assessments": [{"sensitiveInformationPolicy": {"piiEntities": [{"type": "EMAIL", "action": "ANONYMIZED"}]}}]}
        return {"action": "NONE", "outputs": [], "assessments": []}

    def converse(self, **kwargs):
        self.converse_calls.append(kwargs)
        tool = kwargs["toolConfig"]["tools"][0]["toolSpec"]["name"]
        user = kwargs["messages"][0]["content"][0]["text"]
        if tool == "submit_summary":
            output = self.tool_output or {"summary": "The faculty member accepted a community presentation for CEPH 19 and an oral defense."}
            return {"stopReason": "tool_use", "usage": {}, "metrics": {}, "output": {"message": {"content": [{"toolUse": {"name": tool, "input": output}}]}}}
        syllabus = _re.search(r"<syllabus[^>]*>\n(.*)\n</syllabus>", user, _re.DOTALL).group(1)
        output = self.tool_output
        if output is None:
            revised = syllabus + "\n\n## Community presentation\nStudents brief a community board, coordinated by the instructor.\n\n## Oral defense\nEach student defends one design decision in a ten-minute conversation.\n"
            if tool == "submit_competency_review":
                output = {
                    "competencies": [{"code": f"D2-{n}", "status": "ADDRESSED" if n in (1, 3, 4) else "NOT_ADDRESSED",
                                      "evidence": "Weeks 2-6" if n in (1, 3, 4) else "", "rationale": "Test rationale."} for n in range(1, 23)],
                    "changes": [
                        {"section": "Assignments", "change": "Added a community presentation.", "reason": "CEPH 19.", "competencyCodes": ["D2-19", "D2-99"],
                         "excerpts": ["Students brief a community board, coordinated by the instructor."]},
                        {"section": "Assessment", "change": "Added an oral defense.", "reason": "CEPH 18.", "competencyCodes": ["D2-18"],
                         "excerpts": ["Each student defends one design decision in a ten-minute conversation."]},
                    ],
                    "revisedSyllabus": revised,
                }
            else:
                output = {
                    "recommendations": [
                        {"title": "Audit AI-drafted code", "category": "TEACHING_METHODS", "approach": "INTEGRATE_AI", "target": "Week 13",
                         "recommendation": "Students audit AI code.", "rationale": "Verification skills.", "peerExampleIds": ["P1", "P9"],
                         "excerpts": ["Students brief a community board, coordinated by the instructor."]},
                        {"title": "Oral defense", "category": "ASSESSMENT_TOOLS", "approach": "AI_RESISTANT", "target": "Final report",
                         "recommendation": "Add a short oral defense.", "rationale": "Checks understanding.", "peerExampleIds": [],
                         "excerpts": ["Each student defends one design decision in a ten-minute conversation."]},
                    ],
                    "revisedSyllabus": revised,
                }
        return {"stopReason": "tool_use", "usage": {}, "metrics": {},
                "output": {"message": {"content": [{"toolUse": {"name": tool, "input": output}}]}}}


class FakeComprehend:
    """Finds emails and the fictional instructor name used in the seed syllabi."""

    def detect_pii_entities(self, Text, LanguageCode):
        entities = []
        for match in _re.finditer(r"[\w.]+@[\w.]+\.\w+", Text):
            entities.append({"Type": "EMAIL", "BeginOffset": match.start(), "EndOffset": match.end(), "Score": 0.99})
        for match in _re.finditer(r"Maya Chen", Text):
            entities.append({"Type": "NAME", "BeginOffset": match.start(), "EndOffset": match.end(), "Score": 0.95})
        for match in _re.finditer(r"Sep \d+", Text):
            entities.append({"Type": "DATE_TIME", "BeginOffset": match.start(), "EndOffset": match.end(), "Score": 0.99})
        return {"Entities": entities}


class FakeAgentRuntime:
    """KB1 returns the real committed CEPH files; KB2 returns `peers`."""

    def __init__(self):
        self.peers = []
        self.calls = []

    def retrieve(self, knowledgeBaseId, retrievalQuery, retrievalConfiguration):
        self.calls.append((knowledgeBaseId, retrievalConfiguration))
        if knowledgeBaseId == "kb-ceph":
            results = []
            for path in sorted(CEPH_DIR.glob("D2-*.md")):
                meta = json.loads((CEPH_DIR / f"{path.name}.metadata.json").read_text())["metadataAttributes"]
                results.append({"content": {"text": path.read_text()}, "metadata": {**meta, "number": float(meta["number"])}})
            return {"retrievalResults": results}
        return {"retrievalResults": self.peers}


class FakeBedrockAgent:
    """Ingestion jobs: records starts; set `busy` to make the next start fail like a running job would."""

    def __init__(self):
        self.jobs = []
        self.busy = False

    def start_ingestion_job(self, knowledgeBaseId, dataSourceId, description=""):
        if self.busy:
            from botocore.exceptions import ClientError

            raise ClientError({"Error": {"Code": "ConflictException", "Message": "busy"}}, "StartIngestionJob")
        from datetime import datetime, timezone

        job = {"ingestionJobId": f"job-{len(self.jobs) + 1}", "knowledgeBaseId": knowledgeBaseId, "dataSourceId": dataSourceId,
               "status": "STARTING", "startedAt": datetime.now(timezone.utc), "updatedAt": datetime.now(timezone.utc),
               "statistics": {"numberOfDocumentsScanned": 4, "numberOfNewDocumentsIndexed": 3, "numberOfModifiedDocumentsIndexed": 1}}
        self.jobs.append(job)
        return {"ingestionJob": job}

    def list_ingestion_jobs(self, knowledgeBaseId, dataSourceId, sortBy, maxResults):
        jobs = [j for j in reversed(self.jobs) if j["knowledgeBaseId"] == knowledgeBaseId]
        return {"ingestionJobSummaries": jobs[:maxResults]}


class Ctx:
    aws_request_id = "test-request"


def api_event(method: str, resource: str, *, user="user-1", groups="faculty", body=None, path=None, query=None) -> dict:
    claims = {"sub": user, "email": f"{user}@example.edu"}
    if groups:
        claims["cognito:groups"] = groups
    return {
        "httpMethod": method,
        "resource": resource,
        "pathParameters": path or {},
        "queryStringParameters": query,
        "body": json.dumps(body) if body is not None else None,
        "requestContext": {"authorizer": {"claims": claims}},
    }


def call(module, event) -> tuple:
    response = module.handler(event, Ctx())
    return response["statusCode"], json.loads(response["body"])
