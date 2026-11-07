"""Text extraction for PDF, DOCX and plain text, shared by the runtime and corpus preparation."""

from __future__ import annotations

import io
from pathlib import Path


def pdf_pages(data: bytes) -> list[str]:
    from pypdf import PdfReader

    return [(page.extract_text() or "").strip() for page in PdfReader(io.BytesIO(data)).pages]


def docx_text(data: bytes) -> str:
    """Paragraphs and tables in document order, tables as `a | b | c` rows."""
    import docx
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    document = docx.Document(io.BytesIO(data))
    lines: list[str] = []
    for element in document.element.body.iterchildren():
        tag = element.tag.rsplit("}", 1)[-1]
        if tag == "p":
            paragraph = Paragraph(element, document)
            text = paragraph.text.strip()
            if not text:
                continue
            style = (paragraph.style.name or "").lower() if paragraph.style is not None else ""
            if style.startswith("heading") or style == "title":
                lines.append(f"\n## {text}")
            elif "list" in style:
                lines.append(f"- {text}")
            else:
                lines.append(text)
        elif tag == "tbl":
            for row in Table(element, document).rows:
                cells = list(dict.fromkeys(cell.text.strip() for cell in row.cells))  # merged cells repeat
                lines.append(" | ".join(cells))
            lines.append("")
    return "\n".join(lines).strip()


def extract_text(data: bytes, filename: str) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix == ".pdf":
        return "\n\n".join(page for page in pdf_pages(data) if page)
    if suffix == ".docx":
        return docx_text(data)
    if suffix in {".txt", ".md"}:
        return data.decode("utf-8", errors="replace")
    raise ValueError(f"Unsupported syllabus file type: {suffix or 'none'} (use PDF, DOCX or TXT)")
