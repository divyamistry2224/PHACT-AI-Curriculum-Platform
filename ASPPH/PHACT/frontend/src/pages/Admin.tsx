import { useCallback, useEffect, useState } from "react"
import { api } from "../api"
import type { IngestionStatus, KnowledgeBase, KnowledgeBaseKey, QueueItem } from "../types"
import { EmptyState, ErrorNote, Icon, Kind, PageHeader, Status, errorText, fmtDate, fmtDateTime, sentence, type Tone } from "../components/ui"
import type { AppCtx } from "../components/workspace"

const RUNNING: IngestionStatus[] = ["STARTING", "IN_PROGRESS", "STOPPING"]
const syncTone: Record<IngestionStatus, Tone> = { STARTING: "blue", IN_PROGRESS: "blue", COMPLETE: "good", FAILED: "bad", STOPPING: "warn", STOPPED: "neutral" }
const POLL_MS = 5000

const about: Record<KnowledgeBaseKey, { kind: "Authoritative" | "Faculty Example"; title: string; text: string }> = {
  CEPH: { kind: "Authoritative", title: "Curriculum standards", text: "The 22 CEPH foundational competencies, one document each. Every competency review is graded against these. Updated by redeploying the CEPH files." },
  APPROVED_SYLLABI: { kind: "Faculty Example", title: "Approved faculty syllabi", text: "Syllabi you approved, with personal details removed. AI recommendations cite these as peer examples. Approving a newer version replaces the older one." },
}

export function KnowledgeAdmin({ ctx }: { ctx: AppCtx }) {
  const [kbs, setKbs] = useState<KnowledgeBase[] | null>(null)
  const [approved, setApproved] = useState<QueueItem[]>([])
  const [error, setError] = useState("")
  const [starting, setStarting] = useState<KnowledgeBaseKey | null>(null)
  const load = useCallback(async () => {
    try {
      setKbs(await api.listKnowledgeBases())
      setError("")
    } catch (e) {
      setError(errorText(e))
    }
  }, [])
  useEffect(() => {
    load()
    api.listQueue("APPROVED").then(setApproved).catch(() => setApproved([]))
  }, [load])
  const busy = kbs?.some((kb) => kb.lastSync && RUNNING.includes(kb.lastSync.status))
  useEffect(() => {
    if (!busy) return
    const timer = setInterval(load, POLL_MS)
    return () => clearInterval(timer)
  }, [busy, load])

  const sync = async (kb: KnowledgeBaseKey) => {
    setStarting(kb)
    setError("")
    try {
      await api.syncKnowledgeBase(kb)
      ctx.toast("Sync started")
      await load()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setStarting(null)
    }
  }

  return (
    <>
      <PageHeader eyebrow="ASPPH administration" title="Knowledge management" description="The two knowledge bases that ground every review. They sync automatically when files change; use Sync now to recover from a failed sync." action={<button className="secondary" onClick={load}><Icon name="refresh" size={14} /> Refresh</button>} />
      <ErrorNote>{error}</ErrorNote>
      {!kbs && !error && <div className="loading">Loading knowledge bases…</div>}
      <div className="kb-grid">
        {kbs?.map((kb) => {
          const job = kb.lastSync
          const running = job ? RUNNING.includes(job.status) : false
          return (
            <section key={kb.kb} className="panel kb-card">
              <Kind type={about[kb.kb].kind}>{about[kb.kb].title}</Kind>
              <h2>{kb.name}</h2>
              <p className="muted">{about[kb.kb].text}</p>
              <div className="kb-stats">
                <div><strong>{kb.fileCount}</strong><span>Documents</span></div>
                <div><strong>{job ? job.documentsIndexed : "–"}</strong><span>Indexed last sync</span></div>
                <div><strong>{job ? job.documentsFailed : "–"}</strong><span>Failed last sync</span></div>
              </div>
              <div className="kb-sync">
                {job ? <Status tone={syncTone[job.status]}>{running ? "Syncing" : sentence(job.status)}</Status> : <Status>Never synced</Status>}
                <small>{job ? `Started ${fmtDateTime(job.startedAt)}` : "Syncs start when the first file arrives."}</small>
                <button className="secondary small" disabled={running || starting === kb.kb} onClick={() => sync(kb.kb)}><Icon name="refresh" size={14} /> {running ? "Syncing…" : "Sync now"}</button>
              </div>
            </section>
          )
        })}
      </div>
      <section className="panel table-wrap">
        <div className="panel-head"><h2>Approved syllabi in the shared library</h2></div>
        <table>
          <thead><tr><th>Syllabus</th><th>Institution</th><th>Approved version</th><th>Approved</th><th>Approved by</th></tr></thead>
          <tbody>
            {approved.map((i) => (
              <tr key={i.syllabusId}>
                <td><b>{i.title}</b><small>{i.subject}</small></td>
                <td>{i.institution || "—"}</td>
                <td>v{i.approvedVersion ?? i.submittedVersion}</td>
                <td>{fmtDate(i.decidedAt)}</td>
                <td>{i.decidedByEmail || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!approved.length && <EmptyState icon="library" title="No approved syllabi listed">Approved syllabi appear here for 180 days after their upload. Their scrubbed copies stay in the knowledge base permanently.</EmptyState>}
      </section>
    </>
  )
}
