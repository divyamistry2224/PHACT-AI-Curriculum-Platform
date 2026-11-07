"""Line-level diff between two versions of a syllabus, computed in code rather than trusted to the model."""

from difflib import SequenceMatcher


def line_diff(old: str, new: str) -> list:
    """Segments of {op: equal | insert | delete, text}, in reading order. A replaced block becomes a delete
    followed by an insert, which is how the front end renders it (struck through, then highlighted)."""
    a, b = old.splitlines(), new.splitlines()
    segments = []

    def add(op, lines):
        if not lines:
            return
        text = "\n".join(lines)
        if segments and segments[-1]["op"] == op:
            segments[-1]["text"] += "\n" + text
        else:
            segments.append({"op": op, "text": text})

    for tag, i1, i2, j1, j2 in SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if tag == "equal":
            add("equal", a[i1:i2])
        else:
            add("delete", a[i1:i2])
            add("insert", b[j1:j2])
    return segments


def stats(segments: list) -> dict:
    lines = lambda op: sum(s["text"].count("\n") + 1 for s in segments if s["op"] == op)
    return {"linesAdded": lines("insert"), "linesRemoved": lines("delete")}
