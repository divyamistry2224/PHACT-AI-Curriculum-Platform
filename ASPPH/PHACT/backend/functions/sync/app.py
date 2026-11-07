"""Sync function: starts Knowledge Base ingestion when files change in the KB source bucket.

Triggered by the sync SQS queue, which receives the bucket's S3 events. SQS collects events for up to
about 60 seconds, so a burst (the first CEPH upload is 44 files) becomes one ingestion job per KB.

Bedrock runs only one ingestion job per data source at a time. If one is already running, the messages
for that KB are reported as failed, SQS redelivers them after the visibility timeout, and the retry
starts a fresh job that picks up anything the running job missed.
"""

import json
import logging
import os
from urllib.parse import unquote_plus

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))

RETRY_LATER = {"ConflictException", "ThrottlingException", "ServiceQuotaExceededException"}

_client = None


def bedrock_agent():
    global _client
    if _client is None:
        _client = boto3.client("bedrock-agent")
    return _client


def knowledge_bases() -> dict:
    """S3 key prefix -> (knowledge base ID, data source ID)."""
    return {
        "ceph/": (os.environ["CEPH_KB_ID"], os.environ["CEPH_DS_ID"]),
        "approved/": (os.environ["SYLLABI_KB_ID"], os.environ["SYLLABI_DS_ID"]),
    }


def object_keys(message_body: str) -> list:
    """Object keys from one S3 event notification. S3 also sends a one-time s3:TestEvent, which has none."""
    notification = json.loads(message_body)
    if notification.get("Event") == "s3:TestEvent":
        return []
    return [unquote_plus(record["s3"]["object"]["key"]) for record in notification.get("Records", [])]


def handler(event, context):
    targets = knowledge_bases()
    messages_by_kb = {}
    for record in event.get("Records", []):
        try:
            keys = object_keys(record["body"])
        except (ValueError, KeyError, TypeError):
            logger.warning("Skipping a message that isn't an S3 event: %s", record.get("messageId"))
            continue
        for key in keys:
            for prefix, kb in targets.items():
                if key.startswith(prefix):
                    messages_by_kb.setdefault(kb, set()).add(record["messageId"])

    failed = set()
    for (kb_id, data_source_id), message_ids in messages_by_kb.items():
        try:
            job = bedrock_agent().start_ingestion_job(
                knowledgeBaseId=kb_id,
                dataSourceId=data_source_id,
                description=f"Triggered by {len(message_ids)} S3 event message(s)",
            )
            logger.info("Started ingestion job %s for knowledge base %s", job["ingestionJob"]["ingestionJobId"], kb_id)
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code")
            if code not in RETRY_LATER:
                raise
            logger.info("Knowledge base %s is busy (%s); SQS will retry these messages later", kb_id, code)
            failed |= message_ids

    return {"batchItemFailures": [{"itemIdentifier": message_id} for message_id in sorted(failed)]}
