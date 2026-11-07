"""Bedrock Guardrail checks, run with the standalone ApplyGuardrail API on input and output.

Calling the guardrail separately (rather than attaching it to the model call) gives two things:
  - Long text is checked in chunks, which keeps each call inside Bedrock's per-request text limits.
  - On output, PII masking returns the masked text instead of replacing the whole answer.

Only a BLOCKED action counts as a block. A result that only masked PII (ANONYMIZED) passes, with the masked
text returned for output checks.
"""

import logging
import os

from . import aws

logger = logging.getLogger()

CHUNK_CHARS = 8000
SEPARATOR = "\n⟦PHACT-SEP⟧\n"


def _configured() -> bool:
    return bool(os.environ.get("GUARDRAIL_ID"))


def _chunks(text: str, size: int = CHUNK_CHARS) -> list:
    """Split on line boundaries into pieces of at most `size` characters (a single longer line is cut)."""
    chunks, current = [], ""
    for line in text.splitlines(keepends=True):
        while len(line) > size:
            if current:
                chunks.append(current)
                current = ""
            chunks.append(line[:size])
            line = line[size:]
        if len(current) + len(line) > size:
            chunks.append(current)
            current = ""
        current += line
    if current:
        chunks.append(current)
    return chunks or [""]


def _blocked(node) -> bool:
    """True if any assessment anywhere in the response has action BLOCKED."""
    if isinstance(node, dict):
        if node.get("action") == "BLOCKED":
            return True
        return any(_blocked(value) for value in node.values())
    if isinstance(node, list):
        return any(_blocked(item) for item in node)
    return False


def apply(text: str, source: str) -> tuple:
    """Run the guardrail over `text`. Returns (blocked, text_after_masking)."""
    if not _configured() or not text.strip():
        return False, text
    pieces = []
    for chunk in _chunks(text):
        if not chunk.strip():
            pieces.append(chunk)
            continue
        response = aws.client("bedrock-runtime").apply_guardrail(
            guardrailIdentifier=os.environ["GUARDRAIL_ID"],
            guardrailVersion=os.environ.get("GUARDRAIL_VERSION", "DRAFT"),
            source=source,
            content=[{"text": {"text": chunk}}],
        )
        if response.get("action") != "GUARDRAIL_INTERVENED":
            pieces.append(chunk)
            continue
        if _blocked(response.get("assessments", [])):
            logger.info("Guardrail blocked %s content", source)
            return True, None
        masked = "".join(output.get("text", "") for output in response.get("outputs", []))
        pieces.append(masked or chunk)
    return False, "".join(pieces)


def input_blocked(text: str) -> bool:
    blocked, _ = apply(text, "INPUT")
    return blocked


def mask_output(text: str):
    """Masked text, or None if the guardrail blocked it."""
    blocked, masked = apply(text, "OUTPUT")
    return None if blocked else masked


def mask_output_strings(strings: list):
    """Check many short strings in as few calls as possible. Returns the masked list, or None if blocked."""
    if not strings:
        return []
    masked = mask_output(SEPARATOR.join(strings))
    if masked is None:
        return None
    parts = masked.split(SEPARATOR)
    # If masking ever disturbed a separator, keep the originals rather than misalign fields.
    return parts if len(parts) == len(strings) else strings
