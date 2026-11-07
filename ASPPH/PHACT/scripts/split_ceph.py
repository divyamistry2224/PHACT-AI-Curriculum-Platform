"""Split the CEPH MPH foundational competencies PDF into one Markdown file per competency, plus the
.metadata.json file Bedrock Knowledge Bases read for each document.

Run once, proofread the output, and commit data/ceph/. deploy.sh uploads the committed files; it never
re-parses the PDF, because these files are the ground truth for every grade the app produces.

  pip install pdfplumber
  python3 scripts/split_ceph.py

How it reads the PDF: the document is a two-column table (competency | CEPH interpretation) with
section headings between groups of rows. The table's horizontal rules mark row boundaries, so every
word is assigned to the row band it falls in and to the column it sits in. A band with no competency
number continues the previous competency (that happens when a row breaks across pages).
"""

import json
import re
import sys
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "ceph-source" / "CEPH competency guidelines.pdf"
OUT = ROOT / "data" / "ceph"
COLUMN_SPLIT_X = 300  # the vertical rule between the two columns sits at x = 301
HEADER_WORDS = {"MPH FOUNDATIONAL COMPETENCIES", "COMPETENCY INTERPRETATION"}


def _lines(words) -> str:
    """Join words into text, keeping reading order (top to bottom, then left to right)."""
    rows = {}
    for word in sorted(words, key=lambda w: (round(w["top"]), w["x0"])):
        rows.setdefault(round(word["top"]), []).append(word["text"])
    text = " ".join(" ".join(parts) for _, parts in sorted(rows.items()))
    text = re.sub(r"\s+", " ", text).replace(" ,", ",")
    # Rejoin words the PDF broke across lines after a hyphen or slash ("non- academic", "adaptation/ tailoring").
    text = re.sub(r"(\w)([-/]) (\w)", r"\1\2\3", text)
    return text.strip()


def _bands(page):
    rules = sorted({round(r["top"], 1) for r in page.rects if r["height"] < 2 and r["width"] > 100})
    edges = [0.0, *rules, float(page.height)]
    return [(edges[i], edges[i + 1]) for i in range(len(edges) - 1) if edges[i + 1] - edges[i] > 2]


def parse(pdf_path: Path) -> list:
    competencies, domain = [], None
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            words = page.extract_words(extra_attrs=["fontname"])
            for top, bottom in _bands(page):
                band = [w for w in words if top <= (w["top"] + w["bottom"]) / 2 < bottom]
                if not band:
                    continue
                if all("Bold" in w["fontname"] for w in band):
                    heading = _lines(band)
                    if heading not in HEADER_WORDS and not any(h in heading for h in HEADER_WORDS):
                        domain = heading
                    continue
                left = _lines([w for w in band if w["x0"] < COLUMN_SPLIT_X])
                right = _lines([w for w in band if w["x0"] >= COLUMN_SPLIT_X])
                match = re.match(r"^(\d{1,2})\.\s+(.*)$", left)
                if match:
                    competencies.append({
                        "number": int(match.group(1)),
                        "domain": domain,
                        "statement": match.group(2).strip(),
                        "interpretation": right,
                    })
                elif competencies and (left or right):
                    # A row that continues across a page break, or a stray text block repeated below the
                    # table: append only text the previous competency doesn't already contain.
                    previous = competencies[-1]
                    extra = right or left
                    if extra and extra not in previous["interpretation"]:
                        previous["interpretation"] = f"{previous['interpretation']} {extra}".strip()
    return competencies


def validate(competencies: list) -> None:
    numbers = [c["number"] for c in competencies]
    if numbers != list(range(1, 23)):
        sys.exit(f"Expected competencies 1 to 22 in order, got {numbers}")
    for c in competencies:
        if not c["statement"] or not c["interpretation"] or not c["domain"]:
            sys.exit(f"Competency {c['number']} is missing text: {c}")


def write(competencies: list) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("D2-*"):
        old.unlink()
    for c in competencies:
        code = f"D2-{c['number']}"
        name = f"D2-{c['number']:02d}.md"
        (OUT / name).write_text(
            f"# CEPH MPH Foundational Competency {code}\n\n"
            f"Framework: CEPH Accreditation Criteria, MPH foundational competencies (criterion D2)\n"
            f"Domain: {c['domain']}\n"
            f"Competency {c['number']}: {c['statement']}\n\n"
            f"CEPH interpretation: {c['interpretation']}\n",
            encoding="utf-8",
        )
        (OUT / f"{name}.metadata.json").write_text(
            json.dumps({"metadataAttributes": {"framework": "CEPH", "code": code, "number": c["number"], "domain": c["domain"]}}, indent=2) + "\n",
            encoding="utf-8",
        )
    (OUT / "competencies.json").write_text(json.dumps(competencies, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    parsed = parse(SOURCE)
    validate(parsed)
    write(parsed)
    print(f"Wrote {len(parsed)} competencies to {OUT.relative_to(ROOT)}/")
