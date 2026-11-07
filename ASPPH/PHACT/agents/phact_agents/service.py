"""Turns an AgentCore payload into an analysis run. Kept separate from the AgentCore app so tests can call it."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Callable

from . import SCHEMA_VERSION
from .config import Settings
from .doc_check import check_document
from .evidence import BedrockKbRetriever
from .extract import extract_text
from .outputs import save_result, trigger_postprocess
from .pipeline import AnalysisRequest, Dependencies, InputTooLargeError, analyze
from .runner import StrandsRunner
from .safety import InputSafety
from .schemas import AnalysisResult

log = logging.getLogger("phact.service")


class PayloadError(ValueError):
    pass


def build_dependencies(settings: Settings) -> Dependencies:
    missing = [name for name, value in (("COMPETENCY_KB_ID", settings.competency_kb_id),
                                        ("SYLLABUS_KB_ID", settings.syllabus_kb_id)) if not value]
    if missing:
        raise RuntimeError(f"Missing environment variables: {', '.join(missing)}")
    return Dependencies(
        settings=settings,
        runner=StrandsRunner(settings),
        competency_retriever=BedrockKbRetriever(settings.competency_kb_id, settings.region, settings.corpus_version),
        syllabus_retriever=BedrockKbRetriever(settings.syllabus_kb_id, settings.region, settings.corpus_version),
        safety=InputSafety(settings),
    )


def read_syllabus(payload: dict, settings: Settings, s3=None) -> str:
    if payload.get("syllabus_text"):
        return str(payload["syllabus_text"])
    location = payload.get("syllabus_s3")
    if not location:
        raise PayloadError("Payload needs 'syllabus_text' or 'syllabus_s3': {bucket, key}.")
    import boto3

    s3 = s3 or boto3.client("s3", region_name=settings.region)
    body = s3.get_object(Bucket=location["bucket"], Key=location["key"])["Body"].read()
    return extract_text(body, location["key"])


async def handle(payload: dict, settings: Settings, deps_factory: Callable[[Settings], Dependencies] = build_dependencies,
                 s3=None, lam=None) -> dict:
    """Payload: {job_id, syllabus_id, owner_sub?, course_name?, confirm_relevance?, syllabus_text | syllabus_s3}.

    Returns {status, job_id, result_key?, postprocess_triggered, result}. `result` is the full
    AnalysisResult so a caller without S3 configured still gets the output.

    With {"mode": "check_only"} it runs only the PII scrub, guardrail and wrong-document check
    (a few seconds) so the upload screen can warn faculty before an analysis job is created.
    """
    if payload.get("mode") == "check_only":
        return await check_only(payload, settings, deps_factory, s3)

    job_id = payload.get("job_id")
    syllabus_id = payload.get("syllabus_id") or job_id
    if not job_id:
        raise PayloadError("Payload needs 'job_id'.")
    owner_sub = payload.get("owner_sub")

    try:
        text = read_syllabus(payload, settings, s3)
        result = await analyze(
            AnalysisRequest(job_id=job_id, syllabus_id=syllabus_id, syllabus_text=text,
                            course_name=payload.get("course_name"),
                            confirm_relevance=bool(payload.get("confirm_relevance"))),
            deps_factory(settings),
        )
    except (PayloadError, InputTooLargeError, ValueError) as error:
        result = _failed(job_id, syllabus_id, settings, str(error))
    except Exception:
        log.exception("Analysis failed for job %s", job_id)
        result = _failed(job_id, syllabus_id, settings, "The analysis could not be completed. Please retry.")

    key = save_result(result, owner_sub, settings, s3)
    triggered = bool(key) and result.status == "SUCCEEDED" and trigger_postprocess(
        job_id, owner_sub, syllabus_id, key, settings, lam)
    return {
        "status": result.status,
        "job_id": job_id,
        "result_key": key,
        "postprocess_triggered": triggered,
        "result": result.model_dump(mode="json"),
    }


async def check_only(payload: dict, settings: Settings, deps_factory, s3=None) -> dict:
    """Returns {status: "CHECKED" | "BLOCKED" | "FAILED", accepted, document_check?, message?}."""
    try:
        text = read_syllabus(payload, settings, s3).strip()
        if not text:
            raise PayloadError("The file has no readable text. Upload a PDF with a text layer, a DOCX or a TXT file.")
        deps = deps_factory(settings)
        protected = await asyncio.to_thread(deps.safety.protect, text[: settings.max_syllabus_chars])
        if protected.blocked_message:
            return {"status": "BLOCKED", "accepted": False, "message": protected.blocked_message}
        check = await check_document(protected.text, deps.runner, settings.check_model_id)
    except (PayloadError, ValueError) as error:
        return {"status": "FAILED", "accepted": False, "message": str(error)}
    except Exception:
        log.exception("Document check failed")
        return {"status": "FAILED", "accepted": False, "message": "The file could not be checked. Please retry."}
    return {
        "status": "CHECKED",
        "accepted": not check.blocks,
        "can_confirm": check.verdict == "NOT_PUBLIC_HEALTH",
        "message": check.message,
        "document_check": check.model_dump(mode="json"),
    }


def _failed(job_id: str, syllabus_id: str, settings: Settings, message: str) -> AnalysisResult:
    return AnalysisResult(
        schemaVersion=SCHEMA_VERSION,
        jobId=job_id,
        syllabusId=syllabus_id,
        status="FAILED",
        generatedAt=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        modelId=settings.model_id,
        corpusVersion=settings.corpus_version,
        message=message,
    )
