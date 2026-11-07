import asyncio
import io
import json

from conftest import SYLLABUS

from phact_agents.pipeline import AnalysisRequest, analyze
from postprocess.handler import handler
from postprocess.render import render_docx, render_pdf


def _result(make_deps):
    result = asyncio.run(analyze(AnalysisRequest("job-1", "syl-1", SYLLABUS), make_deps()))
    data = result.model_dump(mode="json")
    data["revisedSyllabus"]["markdown"] += "\n## Schedule\n| Week | Topic |\n|---|---|\n| 7 | Bias → oral defence — [PHACT] |"
    return data


def test_render_outputs_are_valid_files(make_deps):
    data = _result(make_deps)
    assert render_docx(data)[:2] == b"PK"
    assert render_pdf(data)[:4] == b"%PDF"


def test_handler_writes_drafts_and_updates_job(make_deps, monkeypatch):
    data = _result(make_deps)

    class FakeS3:
        def __init__(self):
            self.puts = {}

        def get_object(self, Bucket, Key):
            return {"Body": io.BytesIO(json.dumps(data).encode())}

        def put_object(self, **kwargs):
            self.puts[kwargs["Key"]] = kwargs

    class FakeDynamo:
        def update_item(self, **kwargs):
            self.kwargs = kwargs

    monkeypatch.setenv("JOBS_TABLE", "phact-jobs")
    s3, ddb = FakeS3(), FakeDynamo()
    out = handler({"job_id": "job-1", "result_bucket": "results", "result_key": "analyses/u1/job-1/analysis.json"},
                  s3=s3, dynamodb=ddb)
    assert set(s3.puts) == {"analyses/u1/job-1/revised-syllabus-draft.docx", "analyses/u1/job-1/revised-syllabus-draft.pdf"}
    assert all(p["ServerSideEncryption"] == "aws:kms" for p in s3.puts.values())
    assert ddb.kwargs["Key"] == {"jobId": {"S": "job-1"}}
    assert ddb.kwargs["ExpressionAttributeValues"][":reviewStatus"] == {"S": "DRAFT"}
    assert out["recommendationCount"] == 2


def test_handler_skips_non_success():
    class FakeS3:
        def get_object(self, Bucket, Key):
            return {"Body": io.BytesIO(b'{"status": "BLOCKED"}')}

    assert handler({"job_id": "j", "result_bucket": "b", "result_key": "k/a.json"}, s3=FakeS3())["skipped"]
