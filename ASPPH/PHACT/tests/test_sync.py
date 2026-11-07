"""Sync function: batching S3 events into one ingestion job per knowledge base, and retry on conflict."""

import json
import os

import pytest
from botocore.exceptions import ClientError

from conftest import load_function


class FakeBedrockAgent:
    def __init__(self, busy=()):
        self.busy = set(busy)
        self.started = []

    def start_ingestion_job(self, knowledgeBaseId, dataSourceId, description):
        if knowledgeBaseId in self.busy:
            raise ClientError({"Error": {"Code": "ConflictException", "Message": "busy"}}, "StartIngestionJob")
        self.started.append(knowledgeBaseId)
        return {"ingestionJob": {"ingestionJobId": f"job-{len(self.started)}"}}


def s3_message(message_id, *keys):
    body = {"Records": [{"s3": {"object": {"key": key}}} for key in keys]}
    return {"messageId": message_id, "body": json.dumps(body)}


@pytest.fixture
def sync():
    os.environ.update({"CEPH_KB_ID": "kb-ceph", "CEPH_DS_ID": "ds-ceph", "SYLLABI_KB_ID": "kb-syl", "SYLLABI_DS_ID": "ds-syl"})
    return load_function("sync")


def test_burst_of_ceph_files_starts_one_job(sync):
    fake = FakeBedrockAgent()
    sync._client = fake
    records = [s3_message(f"m{i}", f"ceph/D2-{i:02d}.md") for i in range(1, 23)]
    result = sync.handler({"Records": records}, None)
    assert fake.started == ["kb-ceph"]
    assert result == {"batchItemFailures": []}


def test_each_prefix_routes_to_its_own_kb(sync):
    fake = FakeBedrockAgent()
    sync._client = fake
    sync.handler({"Records": [s3_message("a", "ceph/D2-01.md"), s3_message("b", "approved/abc.md")]}, None)
    assert sorted(fake.started) == ["kb-ceph", "kb-syl"]


def test_busy_kb_messages_are_retried_and_others_succeed(sync):
    fake = FakeBedrockAgent(busy={"kb-syl"})
    sync._client = fake
    result = sync.handler({"Records": [s3_message("a", "ceph/D2-01.md"), s3_message("b", "approved/abc.md")]}, None)
    assert fake.started == ["kb-ceph"]
    assert result == {"batchItemFailures": [{"itemIdentifier": "b"}]}


def test_s3_test_event_and_unrelated_keys_are_ignored(sync):
    fake = FakeBedrockAgent()
    sync._client = fake
    test_event = {"messageId": "t", "body": json.dumps({"Event": "s3:TestEvent"})}
    result = sync.handler({"Records": [test_event, s3_message("x", "other/file.txt")]}, None)
    assert fake.started == [] and result == {"batchItemFailures": []}


def test_url_encoded_keys_are_decoded(sync):
    fake = FakeBedrockAgent()
    sync._client = fake
    sync.handler({"Records": [s3_message("a", "approved/my+file%281%29.md")]}, None)
    assert fake.started == ["kb-syl"]
