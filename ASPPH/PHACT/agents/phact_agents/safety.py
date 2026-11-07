"""Input protection: PII scrub before any model call, then an input-only Bedrock Guardrail.

The Technical document rules out guardrails on agent output (Strands replaces the
whole response when an output guardrail intervenes), so the guardrail runs here on input.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .config import Settings

BLOCKED_MESSAGE = (
    "PHACT can only help with public health course design. Your syllabus was not analysed because "
    "part of it matched a blocked topic. Please remove unrelated content and try again."
)

# Comprehend types we redact. DATE_TIME, URL and AGE stay: course schedules and
# reading links depend on them and they do not identify a student.
REDACT_TYPES = {
    "NAME", "EMAIL", "PHONE", "ADDRESS", "SSN", "USERNAME", "PASSWORD",
    "CREDIT_DEBIT_NUMBER", "BANK_ACCOUNT_NUMBER", "PASSPORT_NUMBER", "DRIVER_ID", "IP_ADDRESS",
}
MIN_SCORE = 0.8
COMPREHEND_CHUNK_CHARS = 20_000  # DetectPiiEntities accepts up to 100 KB of UTF-8

_PATTERNS = [
    ("EMAIL", re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")),
    ("PHONE", re.compile(r"(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?!\d)")),
    ("SSN", re.compile(r"(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)")),
]


def regex_scrub(text: str) -> tuple[str, int]:
    count = 0
    for label, pattern in _PATTERNS:
        text, n = pattern.subn(f"[{label}]", text)
        count += n
    return text, count


@dataclass
class SafetyResult:
    text: str
    redactions: int
    blocked_message: str | None = None


class InputSafety:
    def __init__(self, settings: Settings, comprehend=None, bedrock_runtime=None):
        self.settings = settings
        self._comprehend = comprehend
        self._bedrock_runtime = bedrock_runtime

    def _client(self, name: str):
        import boto3

        return boto3.client(name, region_name=self.settings.region)

    def scrub(self, text: str) -> tuple[str, int]:
        if self.settings.pii_mode == "off":
            return text, 0
        text, count = regex_scrub(text)
        if self.settings.pii_mode != "comprehend":
            return text, count
        comprehend = self._comprehend or self._client("comprehend")
        pieces = []
        for chunk in _split(text, COMPREHEND_CHUNK_CHARS):
            entities = comprehend.detect_pii_entities(Text=chunk, LanguageCode="en")["Entities"]
            spans = sorted(
                (e for e in entities if e["Type"] in REDACT_TYPES and e["Score"] >= MIN_SCORE),
                key=lambda e: e["BeginOffset"],
                reverse=True,
            )
            for entity in spans:
                chunk = chunk[: entity["BeginOffset"]] + f"[{entity['Type']}]" + chunk[entity["EndOffset"] :]
            count += len(spans)
            pieces.append(chunk)
        return "".join(pieces), count

    def check_input(self, text: str) -> str | None:
        """Return a user-facing message when the guardrail blocks the input, else None."""
        if not self.settings.guardrail_id:
            return None
        runtime = self._bedrock_runtime or self._client("bedrock-runtime")
        response = runtime.apply_guardrail(
            guardrailIdentifier=self.settings.guardrail_id,
            guardrailVersion=self.settings.guardrail_version,
            source="INPUT",
            content=[{"text": {"text": text}}],
        )
        return BLOCKED_MESSAGE if response.get("action") == "GUARDRAIL_INTERVENED" else None

    def protect(self, text: str) -> SafetyResult:
        scrubbed, redactions = self.scrub(text)
        return SafetyResult(scrubbed, redactions, self.check_input(scrubbed))


def _split(text: str, size: int) -> list[str]:
    """Split on line boundaries so an entity is rarely cut in half."""
    chunks, current = [], ""
    for line in text.splitlines(keepends=True):
        if current and len(current) + len(line) > size:
            chunks.append(current)
            current = ""
        current += line
    if current:
        chunks.append(current)
    return chunks or [""]
