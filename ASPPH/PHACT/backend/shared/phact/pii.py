"""Permanent PII purge with Amazon Comprehend.

Every syllabus is purged once, at upload, before its text is stored: people's names, emails, phone numbers,
personal links, and ID or account numbers are replaced with labels such as "[name removed]". Nothing is kept
that could restore them, so no later step (the AI reviews, the versions they create, exports, or the shared
knowledge base) ever has them.

Kept on purpose:
- Dates and ages: a syllabus schedule is full of dates.
- Addresses: university and building addresses are fine to keep (ASPPH's call).
- Course and institution names: Comprehend doesn't treat organizations as personal data.
- Authors on reference lines (when KEEP_CITED_AUTHORS is on): textbook and article authors in a reading list
  are public, so names and links on lines that look like citations stay. Instructor and TA names, emails,
  and phones are always purged, even on those lines.

Approving a syllabus into KB2 runs the purge again as a second line of defense.
"""

import os
import re

from . import aws

KEEP_TYPES = {"DATE_TIME", "AGE", "ADDRESS"}
MIN_SCORE = 0.7
CHUNK_CHARS = 40_000  # Comprehend accepts up to 100 KB of UTF-8 per call
CITATION_KEEPABLE = {"NAME", "URL"}

LABELS = {
    "NAME": "[name removed]",
    "EMAIL": "[email removed]",
    "PHONE": "[phone removed]",
    "URL": "[link removed]",
    "USERNAME": "[username removed]",
    "PASSWORD": "[password removed]",
}

_CITATION = re.compile(
    r"\bet al\b|\bdoi\b|\bISBN\b|\b\d+(st|nd|rd|th) ed\b|\((?:[^()]*,\s*)?(19|20)\d{2}[a-z]?\)|\b(19|20)\d{2}[a-z]?\)\.",
    re.IGNORECASE,
)
_CONTACT = re.compile(r"@|\binstructor\b|\bprofessor\b|\bteaching assistant\b|\bTA\b|\bemail\b|\bphone\b|\boffice\b|\bcontact\b", re.IGNORECASE)


def keep_cited_authors() -> bool:
    return os.environ.get("PII_KEEP_CITED_AUTHORS", "true").lower() != "false"


def is_citation(line: str) -> bool:
    """A reading-list or reference line (a year in parentheses, an edition, et al., DOI, ISBN), and not a contact line."""
    return bool(_CITATION.search(line)) and not _CONTACT.search(line)


def _chunks(text: str):
    """Yield (offset, chunk) pieces split on line boundaries."""
    start = 0
    while start < len(text):
        end = min(start + CHUNK_CHARS, len(text))
        if end < len(text):
            newline = text.rfind("\n", start, end)
            if newline > start:
                end = newline + 1
        yield start, text[start:end]
        start = end


def detect(text: str) -> list:
    entities = []
    for offset, chunk in _chunks(text):
        if not chunk.strip():
            continue
        found = aws.client("comprehend").detect_pii_entities(Text=chunk, LanguageCode="en")["Entities"]
        for entity in found:
            if entity["Type"] in KEEP_TYPES or entity.get("Score", 0) < MIN_SCORE:
                continue
            entities.append({"type": entity["Type"], "begin": entity["BeginOffset"] + offset, "end": entity["EndOffset"] + offset})
    return sorted(entities, key=lambda e: e["begin"])


def _line_at(text: str, position: int) -> str:
    start = text.rfind("\n", 0, position) + 1
    end = text.find("\n", position)
    return text[start:] if end < 0 else text[start:end]


def purge(text: str) -> str:
    """Replace personal details with labels, permanently."""
    if not text:
        return text
    keep_citations = keep_cited_authors()
    out, cursor = [], 0
    for entity in detect(text):
        if entity["begin"] < cursor:
            continue  # overlapping detection
        if keep_citations and entity["type"] in CITATION_KEEPABLE and is_citation(_line_at(text, entity["begin"])):
            continue
        out.append(text[cursor:entity["begin"]])
        out.append(LABELS.get(entity["type"], f"[{entity['type'].lower().replace('_', ' ')} removed]"))
        cursor = entity["end"]
    out.append(text[cursor:])
    return "".join(out)
