import { useEffect, useMemo, useState } from "react"
import { api } from "../api"
import type { SyllabusStatus, SyllabusWorkflow } from "../types"
import { EmptyState, ErrorNote, Icon, PageHeader, Status, errorText, fmtDate, fmtDateTime, sentence } from "../components/ui"
import type { AppCtx } from "../components/workspace"

type AdminTab = "PENDING_ADMIN_REVIEW" | "APPROVED" | "REJECTED" | "ALL"
const tone: Record<SyllabusStatus, "neutral" | "good" | "warn" | "bad" | "blue"> = { DRAFT: "warn", DRAFT_READY: "warn", GENERATING: "blue", GENERATION_FAILED: "bad", PENDING_ADMIN_REVIEW: "blue", APPROVED: "good", REJECTED: "bad" }
const latest = (w: SyllabusWorkflow) => w.versions[0]

function AdminDocument({ workflow }: { workflow: SyllabusWorkflow }) {
  const version = latest(workflow)
  return <div className="syllabus-document admin-document">{version.sections.slice().sort((a, b) => a.order - b.order).map((section) => <section key={section.id}><h3>{section.title}</h3><div className="document-copy">{section.content.split("\n").map((line, i) => <p key={i}>{line || "\u00a0"}</p>)}</div></section>)}</div>
}

export function AdminApprovals({ ctx }: { ctx: AppCtx }) {
  const [workflows, setWorkflows] = useState<SyllabusWorkflow[]>([])
  const [tab, setTab] = useState<AdminTab>("PENDING_ADMIN_REVIEW")
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [reason, setReason] = useState("")
  const [action, setAction] = useState<"APPROVED" | "REJECTED" | null>(null)
  const [error, setError] = useState("")
  const load = () => api.listSyllabusWorkflows(ctx.user, "admin").then(setWorkflows)
  useEffect(() => { load() }, [ctx.user.id])
  const shown = useMemo(() => workflows.filter((w) => { const v = latest(w); const tabMatch = tab === "ALL" || v.status === tab; const q = query.toLowerCase(); return tabMatch && (!q || `${w.syllabus.courseName} ${w.syllabus.subject} ${w.syllabus.facultyId}`.toLowerCase().includes(q)) }), [workflows, tab, query])
  const current = shown.find((w) => w.syllabus.id === selected) || shown[0]
  const version = current && latest(current)
  const submission = current?.submissions.find((s) => s.syllabusVersionId === version?.id)
  const count = (t: AdminTab) => workflows.filter((w) => { const v = latest(w); return t === "ALL" || v.status === t }).length
  const decide = async () => {
    if (!submission || !action) return
    if (action === "REJECTED" && !reason.trim()) { setError("A rejection reason is required."); return }
    setError("")
    try { await api.decideSyllabus(ctx.user, submission.id, action, reason); setAction(null); setReason(""); await load(); ctx.toast(action === "APPROVED" ? "Syllabus approved" : "Syllabus rejected") } catch (e) { setError(errorText(e)) }
  }
  return <>
    <PageHeader eyebrow="ASPPH administration" title="Final syllabus approvals" description="Review complete faculty-submitted syllabus documents. Administrative decisions apply to the submitted version, not individual AI recommendations." />
    <div className="tabs syllabus-tabs">{(["PENDING_ADMIN_REVIEW", "APPROVED", "REJECTED", "ALL"] as const).map((t) => <button key={t} className={tab === t ? "active" : ""} onClick={() => { setTab(t); setSelected(null) }}>{t === "PENDING_ADMIN_REVIEW" ? "Pending reviews" : t === "ALL" ? "Review history" : sentence(t)} <span>{count(t)}</span></button>)}</div>
    <div className="filterbar"><label>Search submissions<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Course or subject" /></label></div>
    {!shown.length && <section className="panel"><EmptyState icon="check" title="No syllabus submissions match this view" /></section>}
    {shown.length > 0 && <div className="review-layout syllabus-review-layout">
      <div className="panel review-list">{shown.map((w) => { const v = latest(w); return <button key={w.syllabus.id} className={current?.syllabus.id === w.syllabus.id ? "active" : ""} onClick={() => setSelected(w.syllabus.id)}><div><Status tone={tone[v.status]}>{sentence(v.status)}</Status><h3>{w.syllabus.courseName}</h3><p>Faculty ID: {w.syllabus.facultyId} · Version {v.versionNumber} · {fmtDate(v.submittedAt || v.updatedAt)}</p></div><Icon name="arrow" /></button> })}</div>
      {current && version && <section className="panel review-detail syllabus-detail">
        <div className="review-detail-head"><div><Status tone={tone[version.status]}>{sentence(version.status)}</Status><h2>{current.syllabus.courseName}</h2><p className="muted">{current.syllabus.subject} · Version {version.versionNumber} · Submitted {fmtDateTime(version.submittedAt)}</p></div></div>
        <dl className="plain-dl"><div><dt>Faculty</dt><dd>{current.syllabus.facultyId}</dd></div><div><dt>Submission</dt><dd>{submission ? fmtDateTime(submission.submittedAt) : "Historical record"}</dd></div><div><dt>Recommendations incorporated</dt><dd>{version.appliedRecommendationIds.length}</dd></div><div><dt>Confirmed mappings</dt><dd>{version.confirmedMappingIds.length}</dd></div></dl>
        {current.decisions[0] && <div className={`decision-panel ${current.decisions[0].decision === "APPROVED" ? "approved" : "rejected"}`}><b>{current.decisions[0].decision === "APPROVED" ? "Approved" : "Rejected"} by {current.decisions[0].reviewerName}</b><p>{fmtDateTime(current.decisions[0].reviewedAt)}</p>{current.decisions[0].reason && <p><strong>Feedback:</strong> {current.decisions[0].reason}</p>}</div>}
        <h3 className="document-section-title">Submitted syllabus</h3><AdminDocument workflow={current} />
        <div className="comparison-panel"><div className="section-heading"><span>Compare</span><div><h2>Original source</h2><p>Detailed PDF diffing is not claimed when extraction is unavailable.</p></div></div><pre>{current.syllabus.extractedText}</pre></div>
        {submission?.status === "PENDING_ADMIN_REVIEW" && <div className="approval-actions"><button className="primary" onClick={() => setAction("APPROVED")}><Icon name="check" size={15} /> Approve syllabus</button><button className="secondary danger-border" onClick={() => setAction("REJECTED")}><Icon name="x" size={15} /> Reject syllabus</button></div>}
        {action && <div className="decision-dialog"><h3>{action === "APPROVED" ? "Approve syllabus" : "Reject syllabus"}</h3><p>Decision for {current.syllabus.courseName}, version {version.versionNumber}.</p><label>{action === "REJECTED" ? "Rejection reason (required)" : "Approval comments (optional)"}<textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={action === "REJECTED" ? "Explain what faculty should revise." : "Optional note for the faculty member."} /></label><ErrorNote>{error}</ErrorNote><div className="button-row"><button className="primary" onClick={decide}>Confirm {action === "APPROVED" ? "approval" : "rejection"}</button><button className="secondary" onClick={() => { setAction(null); setReason(""); setError("") }}>Cancel</button></div></div>}
        <div className="version-history"><h3>Version history</h3>{current.versions.map((v) => <div key={v.id}><Status tone={tone[v.status]}>{sentence(v.status)}</Status><span>Version {v.versionNumber} · {fmtDateTime(v.createdAt)}</span></div>)}</div>
      </section>}
    </div>}
  </>
}

export { Moderation as CommunityModeration } from "./Admin"
