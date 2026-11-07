"""Runtime settings, read once from environment variables.

AgentCore: pass these at `agentcore launch --env KEY=VALUE`, not at configure time,
or the runtime starts without them and KB retrieval fails silently.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

DEFAULT_MODEL_ID = "us.anthropic.claude-sonnet-4-5-20250929-v1:0"
# Small, fast model for the wrong-document check; confirm access in the account.
DEFAULT_CHECK_MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0"


def _int(name: str, default: int) -> int:
    value = os.environ.get(name)
    return int(value) if value else default


@dataclass(frozen=True)
class Settings:
    region: str = "us-east-1"
    model_id: str = DEFAULT_MODEL_ID
    competency_kb_id: str | None = None
    syllabus_kb_id: str | None = None
    corpus_version: str | None = "v1"
    top_k: int = 5
    max_syllabus_chars: int = 90_000
    pii_mode: str = "comprehend"  # comprehend | regex | off
    guardrail_id: str | None = None
    guardrail_version: str = "DRAFT"
    results_bucket: str | None = None
    results_kms_key_id: str | None = None
    postprocess_function: str | None = None
    agent_max_tokens: int = 4_000
    synthesis_max_tokens: int = 10_000
    doc_check: bool = True
    check_model_id: str = DEFAULT_CHECK_MODEL_ID

    @classmethod
    def from_env(cls) -> "Settings":
        env = os.environ.get
        return cls(
            region=env("AWS_REGION") or env("AWS_DEFAULT_REGION") or "us-east-1",
            model_id=env("MODEL_ID") or DEFAULT_MODEL_ID,
            competency_kb_id=env("COMPETENCY_KB_ID"),
            syllabus_kb_id=env("SYLLABUS_KB_ID"),
            corpus_version=env("CORPUS_VERSION", "v1") or None,
            top_k=_int("KB_TOP_K", 5),
            max_syllabus_chars=_int("MAX_SYLLABUS_CHARS", 90_000),
            pii_mode=(env("PII_MODE") or "comprehend").lower(),
            guardrail_id=env("GUARDRAIL_ID"),
            guardrail_version=env("GUARDRAIL_VERSION") or "DRAFT",
            results_bucket=env("RESULTS_BUCKET"),
            results_kms_key_id=env("RESULTS_KMS_KEY_ID"),
            postprocess_function=env("POSTPROCESS_FUNCTION"),
            agent_max_tokens=_int("AGENT_MAX_TOKENS", 4_000),
            synthesis_max_tokens=_int("SYNTHESIS_MAX_TOKENS", 10_000),
            doc_check=(env("DOC_CHECK") or "on").lower() != "off",
            check_model_id=env("CHECK_MODEL_ID") or DEFAULT_CHECK_MODEL_ID,
        )
