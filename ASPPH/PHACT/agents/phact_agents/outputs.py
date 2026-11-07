"""Persist the analysis JSON to S3 and hand it to the post-processing Lambda."""

from __future__ import annotations

import json

from .config import Settings
from .schemas import AnalysisResult


def result_key(owner_sub: str | None, job_id: str) -> str:
    return f"analyses/{owner_sub or 'unassigned'}/{job_id}/analysis.json"


def save_result(result: AnalysisResult, owner_sub: str | None, settings: Settings, s3=None) -> str | None:
    if not settings.results_bucket:
        return None
    import boto3

    s3 = s3 or boto3.client("s3", region_name=settings.region)
    key = result_key(owner_sub, result.jobId)
    extra = {"ServerSideEncryption": "aws:kms"}
    if settings.results_kms_key_id:
        extra["SSEKMSKeyId"] = settings.results_kms_key_id
    s3.put_object(
        Bucket=settings.results_bucket,
        Key=key,
        Body=result.model_dump_json(indent=1).encode("utf-8"),
        ContentType="application/json",
        **extra,
    )
    return key


def trigger_postprocess(job_id: str, owner_sub: str | None, syllabus_id: str, key: str, settings: Settings, lam=None) -> bool:
    """Asynchronous (Event) invoke; the Lambda receives a pointer, not the result body."""
    if not settings.postprocess_function or not settings.results_bucket:
        return False
    import boto3

    lam = lam or boto3.client("lambda", region_name=settings.region)
    lam.invoke(
        FunctionName=settings.postprocess_function,
        InvocationType="Event",
        Payload=json.dumps({
            "job_id": job_id,
            "owner_sub": owner_sub,
            "syllabus_id": syllabus_id,
            "result_bucket": settings.results_bucket,
            "result_key": key,
        }).encode("utf-8"),
    )
    return True
