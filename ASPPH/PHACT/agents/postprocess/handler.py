"""Post-processing Lambda: analysis JSON in S3 -> draft DOCX/PDF in S3 -> job metadata in DynamoDB.

Event (sent by the AgentCore runtime, InvocationType=Event):
    {"job_id", "owner_sub", "syllabus_id", "result_bucket", "result_key"}

Environment:
    OUTPUTS_BUCKET      where the draft files go (default: result_bucket)
    OUTPUTS_KMS_KEY_ID  optional KMS key for SSE-KMS
    JOBS_TABLE          optional DynamoDB table to update; skipped when unset
    JOBS_TABLE_KEY      partition key attribute name (default: jobId)
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone

try:  # Lambda runs this file as a top-level module; tests import it as a package.
    from render import render_docx, render_pdf
except ImportError:  # pragma: no cover
    from .render import render_docx, render_pdf

DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def handler(event, context=None, s3=None, dynamodb=None):
    import boto3

    s3 = s3 or boto3.client("s3")
    bucket, key = event["result_bucket"], event["result_key"]
    result = json.loads(s3.get_object(Bucket=bucket, Key=key)["Body"].read())
    if result.get("status") != "SUCCEEDED":
        return {"skipped": True, "reason": f"status {result.get('status')}"}

    outputs_bucket = os.environ.get("OUTPUTS_BUCKET") or bucket
    extra = {"ServerSideEncryption": "aws:kms"}
    if os.environ.get("OUTPUTS_KMS_KEY_ID"):
        extra["SSEKMSKeyId"] = os.environ["OUTPUTS_KMS_KEY_ID"]
    prefix = key.rsplit("/", 1)[0]
    docx_key, pdf_key = f"{prefix}/revised-syllabus-draft.docx", f"{prefix}/revised-syllabus-draft.pdf"
    s3.put_object(Bucket=outputs_bucket, Key=docx_key, Body=render_docx(result), ContentType=DOCX_TYPE, **extra)
    s3.put_object(Bucket=outputs_bucket, Key=pdf_key, Body=render_pdf(result), ContentType="application/pdf", **extra)

    metadata = {
        "status": "COMPLETED",
        "reviewStatus": "DRAFT",
        "resultKey": key,
        "draftDocxKey": docx_key,
        "draftPdfKey": pdf_key,
        "recommendationCount": len(result.get("recommendations", [])),
        "mappingCount": len(result.get("competencyMappings", [])),
        "warningCount": len(result.get("warnings", [])),
        "corpusVersion": result.get("corpusVersion"),
        "completedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    table = os.environ.get("JOBS_TABLE")
    if table:
        dynamodb = dynamodb or boto3.client("dynamodb")
        names = {f"#{k}": k for k in metadata}
        values = {f":{k}": _attr(v) for k, v in metadata.items()}
        dynamodb.update_item(
            TableName=table,
            Key={os.environ.get("JOBS_TABLE_KEY", "jobId"): {"S": event["job_id"]}},
            UpdateExpression="SET " + ", ".join(f"#{k} = :{k}" for k in metadata),
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
        )
    return {"job_id": event["job_id"], "outputs_bucket": outputs_bucket, **metadata}


def _attr(value):
    if value is None:
        return {"NULL": True}
    if isinstance(value, (int, float)):
        return {"N": str(value)}
    return {"S": str(value)}
