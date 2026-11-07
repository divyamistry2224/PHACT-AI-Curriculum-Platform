"""Checks both knowledge bases after a deploy.

  python3 scripts/kb_check.py          report the latest ingestion job for each KB, then test retrieval
  python3 scripts/kb_check.py --wait   wait for running ingestion jobs to finish first (up to 10 minutes)

Ingestion statistics alone can look healthy while documents are silently missing, so the check ends with a
real retrieval against KB1 that must return all 22 CEPH competencies. Once KB2 has ingested anything, it also
retrieves from KB2 and lists the approved syllabi it finds.
"""

import json
import sys
import time
from pathlib import Path

import boto3

ROOT = Path(__file__).resolve().parents[1]
RUNNING = {"STARTING", "IN_PROGRESS", "STOPPING"}


def outputs() -> dict:
    path = ROOT / ".phact" / "outputs.json"
    if not path.exists():
        sys.exit("Missing .phact/outputs.json. Run ./scripts/deploy.sh first.")
    return {o["OutputKey"]: o["OutputValue"] for o in json.loads(path.read_text())}


def latest_job(agent, kb_id: str, ds_id: str):
    jobs = agent.list_ingestion_jobs(
        knowledgeBaseId=kb_id,
        dataSourceId=ds_id,
        sortBy={"attribute": "STARTED_AT", "order": "DESCENDING"},
        maxResults=1,
    )["ingestionJobSummaries"]
    return jobs[0] if jobs else None


def report(agent, name: str, kb_id: str, ds_id: str, wait: bool) -> bool:
    deadline = time.time() + 600
    job = latest_job(agent, kb_id, ds_id)
    while wait and job and job["status"] in RUNNING and time.time() < deadline:
        print(f"      {name}: {job['status']}, waiting...")
        time.sleep(15)
        job = latest_job(agent, kb_id, ds_id)
    if not job:
        print(f"INFO  {name}: no ingestion jobs yet (expected for KB2 until the first approval)")
        return True
    stats = job.get("statistics", {})
    print(
        f"{'PASS' if job['status'] == 'COMPLETE' else 'INFO'}  {name}: {job['status']} | scanned {stats.get('numberOfDocumentsScanned', 0)}, "
        f"new {stats.get('numberOfNewDocumentsIndexed', 0)}, modified {stats.get('numberOfModifiedDocumentsIndexed', 0)}, "
        f"deleted {stats.get('numberOfDocumentsDeleted', 0)}, failed {stats.get('numberOfDocumentsFailed', 0)}"
    )
    if job["status"] == "FAILED" or stats.get("numberOfDocumentsFailed"):
        detail = agent.get_ingestion_job(knowledgeBaseId=kb_id, dataSourceId=ds_id, ingestionJobId=job["ingestionJobId"])
        for reason in detail["ingestionJob"].get("failureReasons", [])[:5]:
            print(f"      reason: {reason}")
        return False
    return True


def main():
    wait = "--wait" in sys.argv
    out = outputs()
    region = out["Region"]
    agent = boto3.client("bedrock-agent", region_name=region)

    ok = report(agent, "KB1 (CEPH)", out["CephKnowledgeBaseId"], out["CephDataSourceId"], wait)
    ok = report(agent, "KB2 (approved syllabi)", out["SyllabiKnowledgeBaseId"], out["SyllabiDataSourceId"], wait) and ok

    runtime = boto3.client("bedrock-agent-runtime", region_name=region)
    results = runtime.retrieve(
        knowledgeBaseId=out["CephKnowledgeBaseId"],
        retrievalQuery={"text": "MPH foundational competency assessment requirements"},
        retrievalConfiguration={
            "vectorSearchConfiguration": {
                "numberOfResults": 50,
                "filter": {"equals": {"key": "framework", "value": "CEPH"}},
            }
        },
    )["retrievalResults"]
    codes = sorted({r.get("metadata", {}).get("code") for r in results if r.get("metadata", {}).get("code")}, key=lambda c: int(c.split("-")[1]))
    if len(codes) == 22:
        print("PASS  KB1 retrieval returns all 22 CEPH competencies")
    else:
        print(f"FAIL  KB1 retrieval returned {len(codes)} of 22 competencies: {codes}")
        ok = False

    if latest_job(agent, out["SyllabiKnowledgeBaseId"], out["SyllabiDataSourceId"]):
        results = runtime.retrieve(
            knowledgeBaseId=out["SyllabiKnowledgeBaseId"],
            retrievalQuery={"text": "MPH course assessment, learning outcomes, and use of technology"},
            retrievalConfiguration={"vectorSearchConfiguration": {"numberOfResults": 20}},
        )["retrievalResults"]
        titles = sorted({r.get("metadata", {}).get("title", "(no title)") for r in results})
        if titles:
            print(f"PASS  KB2 retrieval finds {len(titles)} approved syllabi:")
            for title in titles:
                print(f"      {title}")
        else:
            print("FAIL  KB2 has ingested documents but retrieval found none")
            ok = False

    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
