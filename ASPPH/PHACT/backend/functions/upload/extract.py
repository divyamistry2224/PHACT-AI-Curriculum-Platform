"""Text extraction for uploaded syllabi.

PDF uses pypdf (pure Python). DOCX is read with the standard library (zipfile + ElementTree), so the
function needs no compiled dependencies. DOCX output keeps structure as Markdown: headings become "#"
lines, list paragraphs become "- " items, and tables become Markdown tables, which helps the model see
the schedule and grading breakdowns as tables rather than run-on text.
"""

import io
import re
import zipfile
from xml.etree import ElementTree

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


class ExtractionError(Exception):
    """Raised with a message that is safe to show the user."""


def extract_text(data: bytes, extension: str) -> str:
    if extension == ".pdf":
        raw = _pdf_text(data)
    elif extension == ".docx":
        raw = _docx_text(data)
    else:
        raise ExtractionError("Upload a PDF or DOCX file, or paste the text instead.")
    return normalize(raw)


def normalize(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
    lines = [line.rstrip() for line in text.split("\n")]
    text = "\n".join(lines)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _pdf_text(data: bytes) -> str:
    from pypdf import PdfReader

    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            try:
                reader.decrypt("")
            except Exception as exc:
                raise ExtractionError("This PDF is password-protected. Remove the password or paste the text instead.") from exc
        pages = [page.extract_text() or "" for page in reader.pages]
    except ExtractionError:
        raise
    except Exception as exc:
        raise ExtractionError("We couldn't read this PDF. Try exporting it again, or paste the text instead.") from exc
    return "\n\n".join(pages)


def _docx_text(data: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            document = archive.read("word/document.xml")
        root = ElementTree.fromstring(document)
    except (zipfile.BadZipFile, KeyError, ElementTree.ParseError) as exc:
        raise ExtractionError("We couldn't read this DOCX file. Try saving it again, or paste the text instead.") from exc

    body = root.find(f"{W}body")
    if body is None:
        raise ExtractionError("This DOCX file has no readable content.")

    lines = []
    for block in body:
        if block.tag == f"{W}p":
            lines.append(_paragraph(block))
        elif block.tag == f"{W}tbl":
            lines.append("")
            lines.extend(_table(block))
            lines.append("")
    return "\n".join(lines)


def _run_text(paragraph) -> str:
    parts = []
    for node in paragraph.iter():
        if node.tag == f"{W}t":
            parts.append(node.text or "")
        elif node.tag == f"{W}tab":
            parts.append("\t")
        elif node.tag in (f"{W}br", f"{W}cr"):
            parts.append("\n")
    return "".join(parts)


def _paragraph(paragraph) -> str:
    text = _run_text(paragraph)
    if not text.strip():
        return ""
    style = paragraph.find(f"{W}pPr/{W}pStyle")
    style_name = (style.get(f"{W}val") or "").lower() if style is not None else ""
    if style_name == "title":
        return f"# {text.strip()}"
    heading = re.match(r"heading\s*(\d)", style_name)
    if heading:
        level = min(int(heading.group(1)) + 1, 4)
        return f"{'#' * level} {text.strip()}"
    if paragraph.find(f"{W}pPr/{W}numPr") is not None or style_name.startswith("list"):
        return f"- {text.strip()}"
    return text


def _table(table) -> list:
    rows = []
    for row in table.findall(f"{W}tr"):
        cells = []
        for cell in row.findall(f"{W}tc"):
            cell_text = " ".join(_run_text(p).strip() for p in cell.findall(f"{W}p") if _run_text(p).strip())
            cells.append(cell_text.replace("|", "/").replace("\n", " "))
        if any(cells):
            rows.append(cells)
    if not rows:
        return []
    width = max(len(r) for r in rows)
    lines = []
    for index, cells in enumerate(rows):
        padded = cells + [""] * (width - len(cells))
        lines.append("| " + " | ".join(padded) + " |")
        if index == 0:
            lines.append("| " + " | ".join(["---"] * width) + " |")
    return lines
