"""Retrieval from the two knowledge bases.

KB1 (CEPH): every grading needs all 22 competencies, so retrieval asks for more results than there are
documents, filtered to the CEPH framework, and fails loudly if any competency is missing.

KB2 (approved syllabi): peer examples similar to the syllabus under review, never including the syllabus
itself. Prefers the same subject and falls back to any subject when there aren't enough matches.
"""

import logging
import os
import re

from botocore.exceptions import ClientError

from . import aws
from .errors import ReviewFailed

logger = logging.getLogger()

CEPH_COUNT = 22
QUERY_MAX_CHARS = 1000


def _retrieve(kb_id: str, query: str, count: int, search_filter=None) -> list:
    config = {"numberOfResults": count}
    if search_filter:
        config["filter"] = search_filter
    response = aws.client("bedrock-agent-runtime").retrieve(
        knowledgeBaseId=kb_id,
        retrievalQuery={"text": query[:QUERY_MAX_CHARS]},
        retrievalConfiguration={"vectorSearchConfiguration": config},
    )
    return response.get("retrievalResults", [])


def _line_value(text: str, label_pattern: str):
    match = re.search(rf"^{label_pattern}\s*(.+)$", text, flags=re.MULTILINE)
    return match.group(1).strip() if match else None


def ceph_competencies() -> list:
    """All 22 CEPH competencies, ordered D2-1 to D2-22, each {code, number, domain, statement, interpretation}."""
    results = _retrieve(
        os.environ["CEPH_KB_ID"],
        "CEPH MPH foundational competencies and their assessment requirements",
        50,
        {"equals": {"key": "framework", "value": "CEPH"}},
    )
    competencies = {}
    for result in results:
        meta = result.get("metadata", {})
        text = result.get("content", {}).get("text", "")
        if not meta.get("number"):
            continue
        number = int(float(meta["number"]))
        competencies[number] = {
            "code": f"D2-{number}",
            "number": number,
            "domain": meta.get("domain") or _line_value(text, r"Domain:"),
            "statement": _line_value(text, rf"Competency {number}:") or "",
            "interpretation": _line_value(text, r"CEPH interpretation:") or "",
        }
    if sorted(competencies) != list(range(1, CEPH_COUNT + 1)):
        logger.error("KB1 returned competencies %s", sorted(competencies))
        raise ReviewFailed("The CEPH competency library is incomplete right now, so the review can't run. Please tell an administrator.")
    return [competencies[n] for n in range(1, CEPH_COUNT + 1)]


def _peer_query(syllabus: dict, text: str) -> str:
    parts = [syllabus.get("title") or "", syllabus.get("subject") or "", syllabus.get("description") or ""]
    outcomes = re.search(r"(learning (outcomes|objectives)|course objectives).{0,700}", text, flags=re.IGNORECASE | re.DOTALL)
    parts.append(outcomes.group(0) if outcomes else text[:700])
    return " ".join(p for p in parts if p).strip()


def peer_examples(syllabus: dict, text: str, limit: int = 5) -> list:
    """Up to `limit` excerpts from approved syllabi, each {id: P1.., title, institution, subject, snippet, syllabusId}."""
    kb_id = os.environ["SYLLABI_KB_ID"]
    query = _peer_query(syllabus, text)
    not_self = {"notEquals": {"key": "syllabusId", "value": syllabus["syllabusId"]}}
    filters = [not_self]
    if syllabus.get("subject"):
        filters.insert(0, {"andAll": [not_self, {"equals": {"key": "subject", "value": syllabus["subject"]}}]})

    results = []
    try:
        for search_filter in filters:
            results = _retrieve(kb_id, query, limit, search_filter)
            if len(results) >= 2:
                break
    except ClientError as exc:
        # An empty or never-synced KB2 should not stop a review; it just means no peer examples yet.
        logger.warning("KB2 retrieval failed (%s); continuing without peer examples", exc.response.get("Error", {}).get("Code"))
        return []

    examples = []
    for index, result in enumerate(results, start=1):
        meta = result.get("metadata", {})
        examples.append({
            "id": f"P{index}",
            "title": meta.get("title") or "Approved syllabus",
            "institution": meta.get("institution") or "",
            "subject": meta.get("subject") or "",
            "syllabusId": meta.get("syllabusId") or "",
            "snippet": result.get("content", {}).get("text", "").strip(),
        })
    return examples
