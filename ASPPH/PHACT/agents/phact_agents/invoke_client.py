"""Caller-side helper for the worker Lambda that starts an analysis on AgentCore.

Copy or import this in the worker. It needs boto3 >= 1.39 for the `bedrock-agentcore` client.
"""

from __future__ import annotations

import json
import re
import uuid


def invoke_analysis(runtime_arn: str, payload: dict, region: str = "us-east-1", client=None) -> dict:
    if client is None:
        import boto3
        from botocore.config import Config

        # Long read timeout for multi-agent runs; no SDK retries, so one job never runs twice.
        client = boto3.client("bedrock-agentcore", region_name=region,
                              config=Config(read_timeout=540, retries={"max_attempts": 0}))
    session_id = f"phact-{payload['job_id']}-{uuid.uuid4().hex}"[:256]  # 33-256 characters
    response = client.invoke_agent_runtime(
        agentRuntimeArn=runtime_arn,
        runtimeSessionId=session_id.ljust(33, "0"),
        payload=json.dumps(payload).encode("utf-8"),
        contentType="application/json",
        accept="application/json",
    )
    body = response["response"]
    raw = body.read() if hasattr(body, "read") else body
    return unwrap_response(raw)


def unwrap_response(raw) -> dict:
    """AgentCore may wrap the JSON result in a JSON string, sometimes with a ```json fence."""
    value = raw.decode("utf-8") if isinstance(raw, (bytes, bytearray)) else raw
    for _ in range(3):
        if isinstance(value, dict):
            return value
        text = str(value).strip()
        fenced = re.match(r"^```(?:json)?\s*(.*?)\s*```$", text, re.S)
        value = json.loads(fenced.group(1) if fenced else text)
    if isinstance(value, dict):
        return value
    raise ValueError("AgentCore response is not a JSON object")
