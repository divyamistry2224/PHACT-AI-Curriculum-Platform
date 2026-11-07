"""Turns a review's revised syllabus into suggestions the faculty member can accept, decline, or edit one by one.

A review produces a proposal, not a version:
- The line diff between the input version and the model's revision is split into hunks: each run of
  removed and/or added lines between unchanged stretches. A pure addition spanning several paragraphs is
  split at blank lines, so two suggestions that add neighboring paragraphs each get their own hunk.
- The proposal is stored as "pieces": unchanged text and hunk references, in document order. Any choice of
  accepted hunks composes into a valid document (accepting all gives the model's revision; none gives the
  original).
- Each hunk is attached to the suggestion (a CEPH change or an AI recommendation) whose verbatim excerpts
  appear in it. Hunks no suggestion claims are grouped as "Other edits", so nothing is applied silently.
- When the faculty member saves, the accepted hunks (with any edits) are composed into the next version.
"""

import re

MIN_EXCERPT_CHARS = 12
CONTEXT_LINES = 2


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[#*_`>|]", " ", text or "")).strip().lower()


def _paragraphs(lines: list) -> list:
    """Split lines into groups that each start at a blank line followed by text (the first group excepted)."""
    groups = [[]]
    for i, line in enumerate(lines):
        if groups[-1] and not line.strip() and i + 1 < len(lines) and lines[i + 1].strip():
            groups.append([])
        groups[-1].append(line)
    return groups


def build(diff: list) -> tuple:
    """(pieces, hunks) from a line diff. pieces: [{op: equal, text} | {op: hunk, id}].
    hunks: [{id, before, after, beforeLines, afterLines, contextBefore, contextAfter}]."""
    runs, current = [], None
    for segment in diff:
        lines = segment["text"].split("\n")
        if segment["op"] == "equal":
            current = None
            runs.append(("equal", lines))
            continue
        if current is None:
            current = {"before": [], "after": []}
            runs.append(("change", current))
        current["before" if segment["op"] == "delete" else "after"].extend(lines)

    pieces, hunks = [], []
    for index, (kind, value) in enumerate(runs):
        if kind == "equal":
            pieces.append({"op": "equal", "text": "\n".join(value)})
            continue
        previous = runs[index - 1][1] if index > 0 and runs[index - 1][0] == "equal" else []
        following = runs[index + 1][1] if index + 1 < len(runs) and runs[index + 1][0] == "equal" else []
        parts = _paragraphs(value["after"]) if not value["before"] and value["after"] else [value["after"]]
        for n, after in enumerate(parts):
            hunk = {
                "id": f"h{len(hunks) + 1}",
                "before": "\n".join(value["before"]) if n == 0 else "",
                "after": "\n".join(after),
                "beforeLines": len(value["before"]) if n == 0 else 0,
                "afterLines": len(after),
                "contextBefore": "\n".join(previous[-CONTEXT_LINES:]) if n == 0 else "",
                "contextAfter": "\n".join(following[:CONTEXT_LINES]) if n == len(parts) - 1 else "",
            }
            hunks.append(hunk)
            pieces.append({"op": "hunk", "id": hunk["id"]})
    return pieces, hunks


def compose(pieces: list, hunks_by_id: dict, accepted: dict) -> str:
    """Rebuild the text, using each accepted hunk's new text (accepted maps hunkId -> text, possibly edited;
    an empty string removes the lines) and each other hunk's original text."""
    lines = []
    for piece in pieces:
        if piece["op"] == "equal":
            lines.extend(piece["text"].split("\n"))
            continue
        hunk = hunks_by_id[piece["id"]]
        if piece["id"] in accepted:
            text = accepted[piece["id"]]
            if text == hunk["after"]:
                lines.extend(text.split("\n") if hunk["afterLines"] else [])
            elif text:
                lines.extend(text.split("\n"))
        elif hunk["beforeLines"]:
            lines.extend(hunk["before"].split("\n"))
    return "\n".join(lines)


def assign(all_hunks: list, items: list, excerpts_of) -> tuple:
    """Attach hunks to items by their verbatim excerpts. Returns (hunkIds per item, unclaimed hunkIds)."""
    claimed, per_item = set(), []
    normalized = [(h["id"], _norm(h["after"]), _norm(h["before"])) for h in all_hunks]
    for item in items:
        ids = []
        for excerpt in excerpts_of(item) or []:
            needle = _norm(excerpt)
            if len(needle) < MIN_EXCERPT_CHARS:
                continue
            for hunk_id, after, before in normalized:
                if hunk_id not in claimed and (needle in after or needle in before):
                    ids.append(hunk_id)
                    claimed.add(hunk_id)
                    break
        per_item.append(ids)
    return per_item, [h["id"] for h in all_hunks if h["id"] not in claimed]
