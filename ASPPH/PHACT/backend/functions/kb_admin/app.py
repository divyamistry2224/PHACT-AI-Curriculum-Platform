"""KbAdmin function: knowledge base status and manual sync. Admin group only.

GET  /admin/kb        Each knowledge base with its document count and latest ingestion job
POST /admin/kb/sync   Body {kb: CEPH | APPROVED_SYLLABI}. Starts ingestion now

Syncs normally start on their own when files change (S3 event -> sync queue -> Sync function). The manual
sync is for recovery, for example after a failed ingestion job.
"""

import os

from botocore.exceptions import ClientError

from phact import auth, aws, storage
from phact.http import BadRequest, Conflict, parse_json_body, required_str, respond, route

KNOWLEDGE_BASES = {
    "CEPH": {"name": "CEPH competencies (KB1)", "kb": "CEPH_KB_ID", "ds": "CEPH_DS_ID", "prefix": "ceph/"},
    "APPROVED_SYLLABI": {"name": "Approved syllabi (KB2)", "kb": "SYLLABI_KB_ID", "ds": "SYLLABI_DS_ID", "prefix": "approved/"},
}


def _iso(value):
    return value.isoformat(timespec="seconds").replace("+00:00", "Z") if hasattr(value, "isoformat") else value


def last_sync(kb_id: str, ds_id: str):
    jobs = aws.client("bedrock-agent").list_ingestion_jobs(
        knowledgeBaseId=kb_id,
        dataSourceId=ds_id,
        sortBy={"attribute": "STARTED_AT", "order": "DESCENDING"},
        maxResults=1,
    ).get("ingestionJobSummaries", [])
    if not jobs:
        return None
    job, stats = jobs[0], jobs[0].get("statistics", {})
    return {
        "ingestionJobId": job["ingestionJobId"],
        "status": job["status"],
        "startedAt": _iso(job.get("startedAt")),
        "updatedAt": _iso(job.get("updatedAt")),
        "documentsScanned": stats.get("numberOfDocumentsScanned", 0),
        "documentsIndexed": stats.get("numberOfNewDocumentsIndexed", 0) + stats.get("numberOfModifiedDocumentsIndexed", 0),
        "documentsDeleted": stats.get("numberOfDocumentsDeleted", 0),
        "documentsFailed": stats.get("numberOfDocumentsFailed", 0),
    }


def list_kbs(event):
    auth.require_admin(event)
    items = []
    for key, kb in KNOWLEDGE_BASES.items():
        kb_id, ds_id = os.environ[kb["kb"]], os.environ[kb["ds"]]
        items.append({
            "kb": key,
            "name": kb["name"],
            "knowledgeBaseId": kb_id,
            "fileCount": storage.kb_document_count(kb["prefix"]),
            "lastSync": last_sync(kb_id, ds_id),
        })
    return respond(200, {"knowledgeBases": items})


def start_sync(event):
    auth.require_admin(event)
    key = required_str(parse_json_body(event), "kb", 40).upper()
    if key not in KNOWLEDGE_BASES:
        raise BadRequest("kb must be CEPH or APPROVED_SYLLABI.")
    kb = KNOWLEDGE_BASES[key]
    try:
        job = aws.client("bedrock-agent").start_ingestion_job(
            knowledgeBaseId=os.environ[kb["kb"]],
            dataSourceId=os.environ[kb["ds"]],
            description="Started by an admin",
        )["ingestionJob"]
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "ConflictException":
            raise Conflict("A sync is already running for this knowledge base. Check back in a minute.", code="SYNC_RUNNING") from exc
        raise
    return respond(202, {"kb": key, "ingestionJobId": job["ingestionJobId"], "status": job["status"]})


handler = route({
    ("GET", "/admin/kb"): list_kbs,
    ("POST", "/admin/kb/sync"): start_sync,
})
