"""Run the three-agent analysis on one syllabus file from a laptop or Cloud9.

Needs AWS credentials with Bedrock model access. Retrieval uses the real KBs
(COMPETENCY_KB_ID / SYLLABUS_KB_ID) unless --local-kb is given, which searches the
corpus built by `python -m phact_rag prepare` instead.

    python scripts/run_local.py "../../Data/Approved Syllabi/Synthetic/MPH_Syllabus_01_Northeast_Epidemiology.docx" --local-kb --render
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from dataclasses import replace
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from phact_agents.config import Settings  # noqa: E402
from phact_agents.evidence import LocalCorpusRetriever  # noqa: E402
from phact_agents.extract import extract_text  # noqa: E402
from phact_agents.pipeline import AnalysisRequest, analyze  # noqa: E402
from phact_agents.service import build_dependencies  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("syllabus", type=Path)
    parser.add_argument("--local-kb", action="store_true", help="BM25 over build/<version>/ instead of Bedrock KBs")
    parser.add_argument("--pii", choices=["comprehend", "regex", "off"], help="override PII_MODE")
    parser.add_argument("--out", type=Path, default=ROOT / "build" / "local-run")
    parser.add_argument("--render", action="store_true", help="also write the draft DOCX and PDF")
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    settings = Settings.from_env()
    if args.pii:
        settings = replace(settings, pii_mode=args.pii)
    if args.local_kb:
        settings = replace(settings, competency_kb_id="local", syllabus_kb_id="local")
    deps = build_dependencies(settings)
    if args.local_kb:
        corpus = ROOT / "build" / (settings.corpus_version or "v1")
        deps.competency_retriever = LocalCorpusRetriever(corpus / "competency")
        deps.syllabus_retriever = LocalCorpusRetriever(corpus / "syllabus")

    text = extract_text(args.syllabus.read_bytes(), args.syllabus.name)
    result = asyncio.run(analyze(AnalysisRequest("local-job", args.syllabus.stem, text, args.syllabus.stem), deps))

    args.out.mkdir(parents=True, exist_ok=True)
    data = result.model_dump(mode="json")
    (args.out / "analysis.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), "utf-8")
    if args.render and result.status == "SUCCEEDED":
        from postprocess.render import render_docx, render_pdf

        (args.out / "revised-syllabus-draft.docx").write_bytes(render_docx(data))
        (args.out / "revised-syllabus-draft.pdf").write_bytes(render_pdf(data))

    print(f"status={result.status} recommendations={len(result.recommendations)} "
          f"mappings={len(result.competencyMappings)} evidence={len(result.evidence)} "
          f"pii_redactions={result.piiRedactions}")
    print("timings (ms):", result.timingsMs)
    for warning in result.warnings:
        print("warning:", warning)
    print("written to", args.out)
    return 0 if result.status == "SUCCEEDED" else 1


if __name__ == "__main__":
    raise SystemExit(main())
