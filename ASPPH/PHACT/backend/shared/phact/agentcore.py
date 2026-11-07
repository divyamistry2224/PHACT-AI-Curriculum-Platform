"""AgentCore transport for the existing queued review lifecycle."""

import json
import os
import uuid

from . import aws
from .errors import ContentBlocked, ReviewFailed


def configured():
    return bool(os.environ.get("AGENTCORE_RUNTIME_ARN", "").strip())


def analyze(review, syllabus, text, sources, context):
    payload = {
        "job_id": review["reviewId"],
        "syllabus_id": syllabus["syllabusId"],
        "owner_sub": syllabus["ownerId"],
        "course_name": syllabus.get("title", ""),
        "syllabus_text": text,
        "review_type": review["reviewType"],
        "guidance": context.get("guidance", ""),
        "declined": context.get("declined", []),
        "competency_reference": sources if review["reviewType"] == "COMPETENCY" else [],
    }
    response = aws.client("bedrock-agentcore").invoke_agent_runtime(
        agentRuntimeArn=os.environ["AGENTCORE_RUNTIME_ARN"].strip(),
        runtimeSessionId=f"phact-{uuid.uuid4().hex}",
        payload=json.dumps(payload).encode(),
        contentType="application/json", accept="application/json",
    )
    body = response["response"]
    try:
        value = body.read() if hasattr(body, "read") else body
    finally:
        if hasattr(body, "close"):
            body.close()
    for _ in range(3):
        if isinstance(value, dict):
            break
        value = json.loads(value)
    if not isinstance(value, dict):
        raise ReviewFailed("The analysis service returned an invalid response. Please retry.")
    result = value.get("result") or {}
    if value.get("status") in ("BLOCKED", "REJECTED"):
        raise ContentBlocked("The analysis service could not review this syllabus. Check its content and try again.")
    if (value.get("status") != "SUCCEEDED" or result.get("status") != "SUCCEEDED"
            or result.get("jobId") != review["reviewId"]
            or result.get("syllabusId") != syllabus["syllabusId"]):
        raise ReviewFailed("The analysis service could not complete this review. Please retry.")
    output = result.get("samReview")
    key = "competencies" if review["reviewType"] == "COMPETENCY" else "recommendations"
    if (not isinstance(output, dict) or not isinstance(output.get(key), list)
            or not isinstance(output.get("revisedSyllabus"), str)):
        raise ReviewFailed("The analysis service needs the current review integration. Update its runtime and retry.")
    if review["reviewType"] == "COMPETENCY":
        rows = output["competencies"]
        codes = {f"D2-{n}" for n in range(1, 23)}
        if (len(rows) != 22 or any(not isinstance(row, dict) for row in rows)
                or {row.get("code") for row in rows} != codes
                or any(row.get("status") not in {"ADDRESSED", "PARTIAL", "NOT_ADDRESSED"} for row in rows)
                or not isinstance(output.get("changes"), list)):
            raise ReviewFailed("The analysis service returned incomplete competency grades. Please retry.")
        return output, sources
    # Only runtime-recorded faculty examples can resolve a model citation.
    peers = [{"id": item["id"], "title": item.get("title", ""),
              "institution": item.get("publisher", ""), "snippet": item.get("excerpt", "")}
             for item in result.get("evidence", [])
             if isinstance(item, dict) and item.get("kind") == "Faculty Example" and item.get("id")]
    return output, peers
