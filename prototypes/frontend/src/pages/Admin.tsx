import { Fragment, useEffect, useState } from "react"
import { api } from "../api"
import type { KnowledgeSource, ModerationStatus, Recommendation, SharedContribution, SyncStatus } from "../types"
import { EmptyState, ErrorNote, Icon, Kind, ModerationBadge, PageHeader, Status, errorText, fmtDate, fmtDateTime, sentence, type Tone } from "../components/ui"
import { EvidenceSections, type AppCtx } from "../components/workspace"

const ingestionTone: Record<KnowledgeSource["ingestionStatus"], Tone> = { INDEXED: "good", INDEXING: "blue", PENDING: "warn", FAILED: "bad" }
const approvalTone: Record<KnowledgeSource["approvalStatus"], Tone> = { ACTIVE: "good", PUBLISHED: "good", RETIRED: "neutral", SUPERSEDED: "neutral" }
const syncLabel: Record<SyncStatus["state"], string> = { IDLE: "Not yet synchronized", REQUESTED: "Synchronization requested", IN_PROGRESS: "Synchronizing knowledge base", COMPLETED: "Knowledge base up to date" }

/** Polls sync state while a synchronization is running. */
function useSync(onDone: () => void) {
  const [sync, setSync] = useState<SyncStatus | null>(null)
  const busy = sync?.state === "REQUESTED" || sync?.state === "IN_PROGRESS"
  useEffect(() => {
    api.getSyncStatus().then(setSync)
  }, [])
  useEffect(() => {
    if (!busy) return
    const t = setInterval(async () => {
      const s = await api.getSyncStatus()
      setSync(s)
      onDone()
    }, 700)
    return () => clearInterval(t)
  }, [busy])
  return { sync, setSync, busy }
}

export function KnowledgeAdmin({ ctx }: { ctx: AppCtx }) {
  const [sources, setSources] = useState<KnowledgeSource[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [type, setType] = useState<"All" | KnowledgeSource["sourceType"]>("All")
  const [status, setStatus] = useState("All statuses")
  const [open, setOpen] = useState<string | null>(null)
  const [error, setError] = useState("")
  const load = () => api.listKnowledgeSources("admin").then(setSources)
  const { sync, setSync, busy } = useSync(load)
  useEffect(() => {
    load()
    api.listContributions().then((c) => setPendingCount(c.filter((x) => x.moderationStatus === "PENDING_MODERATION" || x.moderationStatus === "SUBMITTED").length))
  }, [])

  const run = async (fn: () => Promise<unknown>, message: string) => {
    setError("")
    try {
      await fn()
      await load()
      setSync(await api.getSyncStatus())
      ctx.toast(message)
    } catch (e) {
      setError(errorText(e))
    }
  }

  const shown = sources.filter(
    (s) => (type === "All" || s.sourceType === type) && (status === "All statuses" || s.ingestionStatus === status || s.approvalStatus === status),
  )
  const n = (fn: (s: KnowledgeSource) => boolean) => sources.filter(fn).length

  return (
    <>
      <PageHeader
        eyebrow="ASPPH administration"
        title="Knowledge management"
        description="Maintain the sources that ground every recommendation. Changes are applied through backend synchronization requests; the browser never accesses storage or indexing services directly."
        action={pendingCount > 0 && <button className="secondary" onClick={() => ctx.navigate("moderation")}><Icon name="people" size={16} /> {pendingCount} submission{pendingCount > 1 ? "s" : ""} to moderate</button>}
      />
      <div className="admin-status">
        <div>
          <span className={`pulse ${busy ? "busy" : ""}`} />
          <div>
            <b>{sync ? syncLabel[sync.state] : "Checking…"}</b>
            <p>{busy ? "Indexing approved changes for retrieval…" : `Last completed ${fmtDateTime(sync?.completedAt)}`}</p>
          </div>
          <button className="primary small" disabled={busy} onClick={() => run(api.requestSync, "Synchronization requested")}>
            <Icon name="refresh" size={14} /> {busy ? "Synchronizing" : "Request sync"}
          </button>
        </div>
        <div><b>{n((s) => s.ingestionStatus === "INDEXED" && (s.approvalStatus === "ACTIVE" || s.approvalStatus === "PUBLISHED"))}</b><span>Available for retrieval</span></div>
        <div><b>{n((s) => s.ingestionStatus === "PENDING" || s.ingestionStatus === "INDEXING")}</b><span>Awaiting sync</span></div>
        <div><b>{n((s) => s.ingestionStatus === "FAILED")}</b><span>Ingestion failures</span></div>
      </div>
      <div className="bucket-guide">
        <div>
          <p className="eyebrow">Authoritative data source</p>
          <h3>Curriculum standards and guidance</h3>
          <p>Official and curated documents such as CEPH criteria and ASPPH guidance. Added by administrators only.</p>
        </div>
        <div>
          <p className="eyebrow">Community context source</p>
          <h3>Faculty-approved teaching examples</h3>
          <p>Only moderated community contributions are published here. AI-generated output is never added automatically.</p>
        </div>
      </div>
      <div className="filterbar">
        <div className="tabs small">
          {(["All", "Authoritative", "Faculty Example"] as const).map((t) => (
            <button key={t} className={type === t ? "active" : ""} onClick={() => setType(t)}>
              {t === "All" ? "All sources" : t === "Authoritative" ? "Authoritative" : "Community"}
              <span>{t === "All" ? sources.length : n((s) => s.sourceType === t)}</span>
            </button>
          ))}
        </div>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {["All statuses", "INDEXED", "PENDING", "INDEXING", "FAILED", "ACTIVE", "PUBLISHED", "RETIRED", "SUPERSEDED"].map((s) => <option key={s} value={s}>{s === "All statuses" ? s : sentence(s)}</option>)}
          </select>
        </label>
      </div>
      <ErrorNote>{error}</ErrorNote>
      <section className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Type</th>
              <th>Version</th>
              <th>Publication</th>
              <th>Ingestion</th>
              <th>Updated</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => (
              <Fragment key={s.id}>
                <tr className={open === s.id ? "expanded" : ""}>
                  <td>
                    <button className="cell-link" onClick={() => setOpen(open === s.id ? null : s.id)} aria-expanded={open === s.id}>
                      <b>{s.title}</b>
                    </button>
                    <small>{s.category} · {s.publisher}</small>
                  </td>
                  <td><Kind type={s.sourceType}>{s.sourceType === "Authoritative" ? "Authoritative" : "Community"}</Kind></td>
                  <td>{s.version}</td>
                  <td><Status tone={approvalTone[s.approvalStatus]}>{sentence(s.approvalStatus)}</Status></td>
                  <td><Status tone={ingestionTone[s.ingestionStatus]}>{sentence(s.ingestionStatus)}</Status></td>
                  <td>{fmtDate(s.updatedAt)}</td>
                  <td>
                    <div className="table-actions">
                      {s.ingestionStatus === "FAILED" && (
                        <button className="small-button small" onClick={() => run(() => api.retrySourceIngestion(s.id), "Ingestion retry requested")}><Icon name="refresh" size={14} /> Retry</button>
                      )}
                      {(s.approvalStatus === "ACTIVE" || s.approvalStatus === "PUBLISHED") && (
                        <button className="text-button danger" onClick={() => run(() => api.updateSourceStatus(s.id, "RETIRED"), "Source marked retired. Sync to apply.")}>Retire</button>
                      )}
                      {(s.approvalStatus === "RETIRED" || s.approvalStatus === "SUPERSEDED") && (
                        <button className="text-button" onClick={() => run(() => api.updateSourceStatus(s.id, s.sourceType === "Authoritative" ? "ACTIVE" : "PUBLISHED"), "Source restored. Sync to apply.")}>Restore</button>
                      )}
                    </div>
                  </td>
                </tr>
                {open === s.id && (
                  <tr className="expanded detail-row">
                    <td colSpan={7}>
                      <div className="row-detail">
                        <span>Source metadata</span>
                        <p>{s.summary}</p>
                        <p>Object reference: <code>{s.s3Key}</code></p>
                        <p>Competencies: {s.competencies.join(", ") || "None listed"}</p>
                        {s.ingestionStatus === "FAILED" && <p className="danger">{s.body}</p>}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {!shown.length && <EmptyState icon="search" title="No sources match these filters" />}
      </section>
    </>
  )
}

const pipeline: { label: string; statuses: ModerationStatus[] }[] = [
  { label: "Submitted", statuses: ["SUBMITTED"] },
  { label: "Pending moderation", statuses: ["PENDING_MODERATION"] },
  { label: "Approved", statuses: ["APPROVED"] },
  { label: "Indexing", statuses: ["INDEXING", "INDEX_FAILED"] },
  { label: "Published", statuses: ["PUBLISHED"] },
]
const tabs: { id: string; label: string; statuses: ModerationStatus[] }[] = [
  { id: "pending", label: "Needs moderation", statuses: ["SUBMITTED", "PENDING_MODERATION"] },
  { id: "publishing", label: "Approved & indexing", statuses: ["APPROVED", "INDEXING", "INDEX_FAILED"] },
  { id: "published", label: "Published", statuses: ["PUBLISHED"] },
  { id: "rejected", label: "Rejected", statuses: ["REJECTED"] },
]

export function Moderation({ ctx }: { ctx: AppCtx }) {
  const [items, setItems] = useState<SharedContribution[]>([])
  const [tab, setTab] = useState(tabs[0].id)
  const [selected, setSelected] = useState<string | null>(null)
  const [rec, setRec] = useState<Recommendation | null>(null)
  const [reason, setReason] = useState("")
  const [rejecting, setRejecting] = useState(false)
  const [error, setError] = useState("")
  const load = () => api.listContributions().then(setItems)
  useEffect(() => {
    load()
  }, [])
  const indexing = items.some((c) => c.moderationStatus === "INDEXING")
  useEffect(() => {
    if (!indexing) return
    const t = setInterval(load, 700)
    return () => clearInterval(t)
  }, [indexing])

  const current = tabs.find((t) => t.id === tab)!
  const list = items.filter((c) => current.statuses.includes(c.moderationStatus))
  const item = list.find((c) => c.id === selected) || list[0]
  useEffect(() => {
    setRec(null)
    setRejecting(false)
    setReason("")
    setError("")
    if (item) api.getRecommendation(item.recommendationId).then(setRec)
  }, [item?.id])

  const run = async (fn: () => Promise<unknown>, message: string) => {
    setError("")
    try {
      await fn()
      await load()
      ctx.toast(message)
    } catch (e) {
      setError(errorText(e))
    }
  }
  const stage = item ? pipeline.findIndex((p) => p.statuses.includes(item.moderationStatus)) : -1

  return (
    <>
      <PageHeader eyebrow="ASPPH administration" title="Community moderation" description="Review faculty-submitted resources before they become shared knowledge. Only published resources are indexed and available for future retrieval as faculty examples." />
      <div className="tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "active" : ""}
            onClick={() => {
              setTab(t.id)
              setSelected(null)
            }}
          >
            {t.label}
            <span>{items.filter((c) => t.statuses.includes(c.moderationStatus)).length}</span>
          </button>
        ))}
      </div>
      <div className="review-layout">
        <div className="panel review-list">
          {!list.length && <EmptyState icon="check" title="Nothing in this queue" />}
          {list.map((c) => (
            <button key={c.id} className={item?.id === c.id ? "active" : ""} onClick={() => setSelected(c.id)}>
              <div>
                <ModerationBadge status={c.moderationStatus} />
                <h3>{c.title}</h3>
                <p>{c.submittedBy} · {c.courseSubject} · {fmtDate(c.submittedAt)}</p>
              </div>
              <Icon name="arrow" />
            </button>
          ))}
        </div>
        {item && (
          <section className="panel review-detail">
            <div className="moderation-steps">
              {pipeline.map((p, i) => (
                <span key={p.label} className={item.moderationStatus === "REJECTED" ? "" : i <= stage ? "active" : ""}>
                  <i>{i < stage || item.moderationStatus === "PUBLISHED" ? <Icon name="check" size={11} /> : i + 1}</i>
                  {p.label}
                </span>
              ))}
            </div>
            <div className="review-detail-head">
              <div>
                <ModerationBadge status={item.moderationStatus} />
                <h2>{item.title}</h2>
              </div>
            </div>
            <dl className="plain-dl">
              <div><dt>Contributor</dt><dd>{item.submittedBy}</dd></div>
              <div><dt>Course subject</dt><dd>{item.courseSubject}</dd></div>
              <div><dt>Submitted</dt><dd>{fmtDateTime(item.submittedAt)}</dd></div>
              {item.reviewedBy && <div><dt>Moderated by</dt><dd>{item.reviewedBy}</dd></div>}
              {item.publishedAt && <div><dt>Published</dt><dd>{fmtDateTime(item.publishedAt)}</dd></div>}
            </dl>
            <div className="moderation-checks">
              <div><Icon name="check" /><div><b>Faculty approval</b><small>Recommendation approved by {rec?.reviewedBy || item.submittedBy}{rec?.reviewedAt ? ` on ${fmtDate(rec.reviewedAt)}` : ""}</small></div></div>
              <div><Icon name="check" /><div><b>Explicit sharing consent</b><small>Recorded {fmtDateTime(item.consentAt)}</small></div></div>
              <div>{item.sanitization === "PASSED" ? <Icon name="check" /> : <Icon name="alert" />}<div><b>Privacy screening</b><small>{item.sanitization === "PASSED" ? "No personal information detected" : "Manual privacy review needed"}</small></div></div>
            </div>
            <div className="rec-section">
              <h3>Submitted description</h3>
              <p>{item.description}</p>
            </div>
            {rec && (
              <div className="rec-section">
                <h3>Approved recommendation content</h3>
                <p><b>{rec.title}.</b> {rec.description}</p>
                <EvidenceSections rec={rec} />
              </div>
            )}
            {item.moderationStatus === "REJECTED" && item.rejectionReason && (
              <div className="reject-box"><b>Reason returned to contributor</b><p>{item.rejectionReason}</p></div>
            )}
            {item.moderationStatus === "INDEX_FAILED" && <ErrorNote>Indexing failed. The resource is approved but not yet available for retrieval. Retry publishing.</ErrorNote>}
            {item.moderationStatus === "INDEXING" && <p className="indexing-note"><span className="pulse busy" /> Publishing to the community knowledge source and synchronizing…</p>}
            {item.moderationStatus === "PUBLISHED" && <p className="indexing-note"><Icon name="check" size={15} /> Published and indexed. Available to faculty as a faculty-approved example.</p>}
            {rejecting && (
              <label className="reject-box">
                Explanation for the contributor (required)
                <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: please remove institution-specific details" />
              </label>
            )}
            <ErrorNote>{error}</ErrorNote>
            <div className="approval-actions">
              {(item.moderationStatus === "PENDING_MODERATION" || item.moderationStatus === "SUBMITTED") &&
                (rejecting ? (
                  <>
                    <button className="text-button" onClick={() => setRejecting(false)}>Cancel</button>
                    <button className="secondary danger-border" onClick={() => run(() => api.moderateContribution(item.id, "reject", ctx.user.displayName, reason), "Submission rejected")}>Confirm rejection</button>
                  </>
                ) : (
                  <>
                    <button className="secondary danger-border" onClick={() => setRejecting(true)}><Icon name="x" size={15} /> Reject</button>
                    <button className="primary" onClick={() => run(() => api.moderateContribution(item.id, "approve", ctx.user.displayName), "Submission approved")}><Icon name="check" size={15} /> Approve</button>
                  </>
                ))}
              {item.moderationStatus === "APPROVED" && (
                <button className="primary" onClick={() => run(() => api.queueIndexing(item.id), "Publishing and indexing started")}>Publish and index</button>
              )}
              {item.moderationStatus === "INDEX_FAILED" && (
                <button className="primary" onClick={() => run(() => api.queueIndexing(item.id), "Indexing retry started")}><Icon name="refresh" size={15} /> Retry indexing</button>
              )}
            </div>
          </section>
        )}
      </div>
    </>
  )
}
