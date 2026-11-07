"""Build, upload, ingest and query the PHACT knowledge-base corpora.

    python -m phact_rag prepare                 # Data/ -> build/<version>/<kb>/<source>/pNNN.txt + .metadata.json
    python -m phact_rag upload --bucket B       # build/ -> s3://B/<kb>/<version>/...
    python -m phact_rag sync --kb-id K --data-source-id D
    python -m phact_rag query "AI disclosure policy" --kb syllabus [--kb-id K | --local]

Each page becomes its own S3 object with a Bedrock metadata sidecar, so a citation can
name its source title and page. Only sources with `ingest` != false in the manifest are built.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from phact_agents.extract import docx_text, pdf_pages  # noqa: E402
from phact_agents.safety import regex_scrub  # noqa: E402

MANIFEST = HERE / "source_manifest.json"
BUILD = HERE.parent / "build"
MIN_PAGE_CHARS = 40


def load_manifest(path: Path = MANIFEST) -> dict:
    manifest = json.loads(path.read_text("utf-8"))
    manifest["_data_root"] = (path.parent / manifest["data_root"]).resolve()
    return manifest


def prepare(manifest: dict, out_root: Path = BUILD) -> dict:
    version = manifest["corpus_version"]
    out = out_root / version
    report = {"corpus_version": version, "built": [], "skipped": [], "empty_pages": [], "redactions": 0}
    for source in manifest["sources"]:
        path = manifest["_data_root"] / source["path"]
        if source.get("ingest") is False:
            report["skipped"].append({"source_id": source["source_id"], "reason": source.get("note", "ingest=false")})
            continue
        if not path.exists():
            report["skipped"].append({"source_id": source["source_id"], "reason": f"missing file {source['path']}"})
            continue
        data = path.read_bytes()
        pages = pdf_pages(data) if path.suffix.lower() == ".pdf" else [docx_text(data)]
        source_dir = out / source["kb"] / source["source_id"]
        source_dir.mkdir(parents=True, exist_ok=True)
        written = 0
        for number, text in enumerate(pages, start=1):
            if len(text.strip()) < MIN_PAGE_CHARS:
                report["empty_pages"].append({"source_id": source["source_id"], "page": number})
                continue
            text, redacted = regex_scrub(text)
            report["redactions"] += redacted
            page_file = source_dir / f"p{number:03d}.txt"
            page_file.write_text(f"{source['title']} (page {number})\n\n{text}\n", "utf-8")
            page_file.with_name(page_file.name + ".metadata.json").write_text(json.dumps({
                "metadataAttributes": {
                    "source_id": source["source_id"],
                    "title": source["title"],
                    "publisher": source["publisher"],
                    "source_type": source["source_type"],
                    "framework": source.get("framework") or "NONE",
                    "kb": source["kb"],
                    "corpus_version": version,
                    "status": "ACTIVE",
                    "page": number,
                }
            }, ensure_ascii=False, indent=1), "utf-8")
            written += 1
        report["built"].append({"source_id": source["source_id"], "kb": source["kb"], "pages": written})
    # The report stays outside the KB prefixes so it is never ingested.
    (out_root / f"report-{version}.json").write_text(json.dumps(report, indent=1), "utf-8")
    return report


def upload(bucket: str, version: str, kms_key_id: str | None, region: str, out_root: Path = BUILD) -> int:
    import boto3

    s3 = boto3.client("s3", region_name=region)
    extra = {"ServerSideEncryption": "aws:kms", **({"SSEKMSKeyId": kms_key_id} if kms_key_id else {})}
    count = 0
    for file in sorted((out_root / version).rglob("*")):
        if not file.is_file():
            continue
        kb, *rest = file.relative_to(out_root / version).parts
        key = "/".join([kb, version, *rest])  # e.g. competency/v1/ceph-mph-foundational/p001.txt
        content_type = "application/json" if file.name.endswith(".json") else "text/plain; charset=utf-8"
        s3.upload_file(str(file), bucket, key, ExtraArgs={**extra, "ContentType": content_type})
        count += 1
    return count


def sync(kb_id: str, data_source_id: str, region: str, timeout_s: int = 900) -> dict:
    import boto3

    agent = boto3.client("bedrock-agent", region_name=region)
    job = agent.start_ingestion_job(knowledgeBaseId=kb_id, dataSourceId=data_source_id)["ingestionJob"]
    deadline = time.time() + timeout_s
    while job["status"] not in {"COMPLETE", "FAILED", "STOPPED"} and time.time() < deadline:
        time.sleep(10)
        job = agent.get_ingestion_job(knowledgeBaseId=kb_id, dataSourceId=data_source_id,
                                      ingestionJobId=job["ingestionJobId"])["ingestionJob"]
        print(f"  {job['status']} {job.get('statistics', {})}", flush=True)
    return job


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="phact_rag", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--region", default="us-east-1")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("prepare")
    up = sub.add_parser("upload")
    up.add_argument("--bucket", required=True)
    up.add_argument("--kms-key-id")
    sy = sub.add_parser("sync")
    sy.add_argument("--kb-id", required=True)
    sy.add_argument("--data-source-id", required=True)
    qu = sub.add_parser("query")
    qu.add_argument("text")
    qu.add_argument("--kb", choices=["competency", "syllabus"], required=True)
    qu.add_argument("--kb-id")
    qu.add_argument("--local", action="store_true", help="BM25 over the local build instead of Bedrock")
    qu.add_argument("--top-k", type=int, default=5)
    args = parser.parse_args(argv)
    sys.stdout.reconfigure(encoding="utf-8")

    manifest = load_manifest()
    if args.command == "prepare":
        report = prepare(manifest)
        for item in report["built"]:
            print(f"built   {item['kb']:<10} {item['pages']:3d} pages  {item['source_id']}")
        for item in report["skipped"]:
            print(f"skipped {item['source_id']}: {item['reason']}")
        print(f"empty pages: {len(report['empty_pages'])}, regex redactions: {report['redactions']}")
    elif args.command == "upload":
        print(f"uploaded {upload(args.bucket, manifest['corpus_version'], args.kms_key_id, args.region)} objects")
    elif args.command == "sync":
        job = sync(args.kb_id, args.data_source_id, args.region)
        print(json.dumps({k: job.get(k) for k in ("status", "statistics", "failureReasons")}, default=str, indent=1))
        return 0 if job["status"] == "COMPLETE" else 1
    elif args.command == "query":
        from phact_agents.evidence import BedrockKbRetriever, LocalCorpusRetriever

        if args.local:
            retriever = LocalCorpusRetriever(BUILD / manifest["corpus_version"] / args.kb)
        elif args.kb_id:
            retriever = BedrockKbRetriever(args.kb_id, args.region, manifest["corpus_version"])
        else:
            parser.error("query needs --kb-id or --local")
        for chunk in retriever.retrieve(args.text, args.top_k):
            print(f"[{chunk.score:.3f}] {chunk.title} p.{chunk.page}\n    {chunk.text[:220].replace(chr(10), ' ')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
