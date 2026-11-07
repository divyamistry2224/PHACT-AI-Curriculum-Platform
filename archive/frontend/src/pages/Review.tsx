import { useEffect, useMemo, useState } from "react"
import { api } from "../api"
import type { SyllabusSection, SyllabusStatus, SyllabusVersion, SyllabusWorkflow } from "../types"
import { EmptyState, ErrorNote, Icon, PageHeader, Status, errorText, fmtDate, fmtDateTime, sentence } from "../components/ui"
import { useAnalysis, type AppCtx } from "../components/workspace"
import { downloadSyllabusPdf } from "../lib/pdf"

type Tab = "DRAFT" | "PENDING_ADMIN_REVIEW" | "APPROVED" | "REJECTED" | "ALL"
const tone: Record<SyllabusStatus, "neutral" | "good" | "warn" | "bad" | "blue"> = { DRAFT: "warn", DRAFT_READY: "warn", GENERATING: "blue", GENERATION_FAILED: "bad", PENDING_ADMIN_REVIEW: "blue", APPROVED: "good", REJECTED: "bad" }
const latest = (workflow: SyllabusWorkflow) => workflow.versions[0]
const matches = (version: SyllabusVersion, tab: Tab) => tab === "ALL" || (tab === "DRAFT" ? version.status === "DRAFT" || version.status === "DRAFT_READY" : version.status === tab)

function SyllabusDocument({ version, onEdit, editing, onSave, onCancel }: { version: SyllabusVersion; onEdit: () => void; editing: boolean; onSave: (sections: SyllabusSection[]) => Promise<void>; onCancel: () => void }) {
  const [sections, setSections] = useState(version.sections)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  useEffect(() => { setSections(version.sections) }, [version.id, version.updatedAt])
  if (editing) return <div className="syllabus-editor">
    {sections.map((section, i) => <div className="syllabus-edit-section" key={section.id}>
      <label>Section title<input value={section.title} onChange={(e) => setSections(sections.map((s, n) => n === i ? { ...s, title: e.target.value } : s))} /></label>
      <label>Content<textarea rows={5} value={section.content} onChange={(e) => setSections(sections.map((s, n) => n === i ? { ...s, content: e.target.value } : s))} /></label>
    </div>)}
    <ErrorNote>{error}</ErrorNote>
    <div className="button-row"><button className="primary" disabled={saving} onClick={async () => { setSaving(true); setError(""); try { await onSave(sections) } catch (e) { setError(errorText(e)) } finally { setSaving(false) } }}>{saving ? "Saving…" : "Save draft"}</button><button className="secondary" onClick={onCancel}>Cancel</button></div>
  </div>
  return <div className="syllabus-document">
    {version.sections.slice().sort((a, b) => a.order - b.order).map((section) => <section key={section.id}><h3>{section.title}</h3><div className="document-copy">{section.content.split("\n").map((line, i) => <p key={i}>{line || "\u00a0"}</p>)}</div></section>)}
    {(version.status === "DRAFT" || version.status === "DRAFT_READY") && <button className="secondary small" onClick={onEdit}><Icon name="edit" size={14} /> Edit draft</button>}
  </div>
}

export function Review({ ctx }: { ctx: AppCtx }) {
  const analysis = useAnalysis(ctx.activeJobId)
  const [workflows, setWorkflows] = useState<SyllabusWorkflow[]>([])
  const [tab, setTab] = useState<Tab>("DRAFT")
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState("")
  const load = () => api.listSyllabusWorkflows(ctx.user).then(setWorkflows)
  useEffect(() => { load() }, [ctx.user.id])
  const shown = useMemo(() => workflows.filter((w) => latest(w) && matches(latest(w), tab)), [workflows, tab])
  const current = shown.find((w) => w.syllabus.id === selected) || shown[0]
  const version = current && latest(current)
  const decision = current?.decisions[0]
  const activeSyllabus = analysis.data?.syllabus
  const hasCurrentDraft = activeSyllabus && workflows.some((w) => w.syllabus.id === activeSyllabus.id)
  const count = (t: Tab) => workflows.filter((w) => latest(w) && matches(latest(w), t)).length
  const generate = async () => {
    if (!activeSyllabus) return
    setError("")
    try { await api.generateSyllabus(ctx.user, activeSyllabus.id); await load(); setTab("DRAFT"); ctx.toast("Revised syllabus draft generated") } catch (e) { setError(errorText(e)) }
  }
  const save = async (sections: SyllabusSection[]) => {
    if (!version) return
    await api.saveSyllabusDraft(ctx.user, version.id, sections)
    await load(); setEditing(false); ctx.toast("Syllabus draft saved")
  }
  const submit = async () => {
    if (!version || !confirm(`Submit ${current?.syllabus.courseName} version ${version.versionNumber} for administrative review?`)) return
    setError("")
    try { await api.submitSyllabus(ctx.user, version.id); await load(); ctx.toast("Submitted for administrative review") } catch (e) { setError(errorText(e)) }
  }
  const revise = async () => {
    if (!version) return
    try { const next = await api.createRevision(ctx.user, version.id); await load(); setSelected(current?.syllabus.id || null); setTab("DRAFT"); ctx.toast(`Version ${next.versionNumber} created for revision`) } catch (e) { setError(errorText(e)) }
  }

  return <>
    <PageHeader eyebrow="Step 4 of 6" title="Review & approval" description="Review finalized syllabus drafts, submit them for administrative approval, and track decisions." action={activeSyllabus && !hasCurrentDraft ? <button className="primary" onClick={generate}><Icon name="spark" size={15} /> Generate Revised Syllabus</button> : undefined} />
    <ErrorNote>{error}</ErrorNote>
    <div className="tabs syllabus-tabs">{(["DRAFT", "PENDING_ADMIN_REVIEW", "APPROVED", "REJECTED", "ALL"] as const).map((t) => <button key={t} className={tab === t ? "active" : ""} onClick={() => { setTab(t); setSelected(null); setEditing(false) }}>{t === "DRAFT" ? "Drafts" : t === "PENDING_ADMIN_REVIEW" ? "Pending review" : sentence(t)} <span>{count(t)}</span></button>)}</div>
    {!shown.length && <section className="panel"><EmptyState icon="file" title={tab === "DRAFT" ? "No revised syllabus drafts yet" : "No syllabus versions in this view"}>{activeSyllabus ? "Generate a revised syllabus from your accepted recommendations and confirmed mappings." : "Complete a syllabus analysis first."}</EmptyState></section>}
    {shown.length > 0 && <div className="review-layout syllabus-review-layout">
      <div className="panel review-list">{shown.map((w) => { const v = latest(w); return <button key={w.syllabus.id} className={current?.syllabus.id === w.syllabus.id ? "active" : ""} onClick={() => { setSelected(w.syllabus.id); setEditing(false) }}><div><Status tone={tone[v.status]}>{sentence(v.status)}</Status><h3>{w.syllabus.courseName}</h3><p>{w.syllabus.subject} · Version {v.versionNumber} · Updated {fmtDate(v.updatedAt)}</p></div><Icon name="arrow" /></button> })}</div>
      {current && version && <section className="panel review-detail syllabus-detail">
        <div className="review-detail-head"><div><Status tone={tone[version.status]}>{sentence(version.status)}</Status><h2>{current.syllabus.courseName}</h2><p className="muted">{current.syllabus.subject} · Version {version.versionNumber} · Last updated {fmtDateTime(version.updatedAt)}</p></div></div>
        {decision && <div className={`decision-panel ${decision.decision === "APPROVED" ? "approved" : "rejected"}`}><b>{decision.decision === "APPROVED" ? "Administrator approved this syllabus" : "Administrator requested a revision"}</b><p>{decision.reviewerName} · {fmtDateTime(decision.reviewedAt)}</p>{decision.reason && <p><strong>Feedback:</strong> {decision.reason}</p>}</div>}
        <div className="document-actions">{(version.status === "DRAFT" || version.status === "DRAFT_READY") && !editing && <><button className="secondary small" onClick={() => setEditing(true)}>Edit draft</button><button className="secondary small" onClick={() => downloadSyllabusPdf(version, current.syllabus.courseName)}>Download PDF</button><button className="primary small" onClick={submit}>Submit for Admin Review</button></>}{version.status === "REJECTED" && <button className="primary small" onClick={revise}>Revise & Resubmit</button>}{version.status === "APPROVED" && <><button className="secondary small" onClick={() => downloadSyllabusPdf(version, current.syllabus.courseName)}>Download PDF</button><button className="secondary small" onClick={() => ctx.navigate("export")}>Export approved version</button></>}</div>
        <SyllabusDocument version={version} editing={editing} onEdit={() => setEditing(true)} onCancel={() => setEditing(false)} onSave={save} />
        <div className="comparison-panel"><div className="section-heading"><span>Compare</span><div><h2>Original vs revised</h2><p>Original source content is shown without claiming to have computed PDF-level differences.</p></div></div><div className="comparison-grid"><div><h3>Original syllabus</h3><pre>{current.syllabus.extractedText}</pre></div><div><h3>Revised version</h3><pre>{version.sections.map((s) => `${s.title}\n${s.content}`).join("\n\n")}</pre></div></div><p className="small-text muted">Applied recommendations: {version.appliedRecommendationIds.length} · Confirmed mappings: {version.confirmedMappingIds.length}</p></div>
        <div className="version-history"><h3>Version history</h3>{current.versions.map((v) => <div key={v.id}><Status tone={tone[v.status]}>{sentence(v.status)}</Status><span>Version {v.versionNumber} · {fmtDateTime(v.createdAt)}</span>{current.decisions.find((d) => d.syllabusVersionId === v.id) && <small>{current.decisions.find((d) => d.syllabusVersionId === v.id)?.reviewerName}</small>}</div>)}</div>
      </section>}
    </div>}
  </>
}
