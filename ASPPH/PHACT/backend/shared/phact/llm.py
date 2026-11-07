"""Claude on Bedrock through the Converse API.

Structured results come back through a forced tool call: the model must "call" a tool whose input schema
is the result shape, which is far more reliable than asking for JSON in free text.
"""

import logging
import os

from . import aws
from .errors import ReviewFailed

logger = logging.getLogger()


def call_tool(system: str, user_text: str, tool_name: str, description: str, schema: dict, max_tokens: int = 16000) -> dict:
    response = aws.client("bedrock-runtime").converse(
        modelId=os.environ["MODEL_ID"],
        system=[{"text": system}],
        messages=[{"role": "user", "content": [{"text": user_text}]}],
        toolConfig={
            "tools": [{"toolSpec": {"name": tool_name, "description": description, "inputSchema": {"json": schema}}}],
            "toolChoice": {"tool": {"name": tool_name}},
        },
        inferenceConfig={"maxTokens": max_tokens},
    )
    usage = response.get("usage", {})
    logger.info("Model call %s: stop=%s input_tokens=%s output_tokens=%s latency_ms=%s",
                tool_name, response.get("stopReason"), usage.get("inputTokens"), usage.get("outputTokens"),
                response.get("metrics", {}).get("latencyMs"))

    if response.get("stopReason") == "max_tokens":
        raise ReviewFailed("This syllabus is too long to revise in one pass. Remove appendices or long policy sections and try again.")
    for block in response.get("output", {}).get("message", {}).get("content", []):
        tool_use = block.get("toolUse")
        if tool_use and tool_use.get("name") == tool_name:
            return tool_use.get("input") or {}
    raise ReviewFailed("The review didn't produce a usable result. Please run it again.")
