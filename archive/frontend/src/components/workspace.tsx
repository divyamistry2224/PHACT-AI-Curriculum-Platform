import { useCallback, useEffect, useState } from "react"
import { api } from "../api"
import type { AnalysisJob, Citation, FacultyUser, HistoryRow, Recommendation, Syllabus } from "../types"
import { ErrorNote, Icon, ReviewBadge, errorText, fmtDate, fmtDateTime, type Page } from "./ui"

export interface AppCtx {
  user: FacultyUser
  navigate: (page: Page) => void
  toast: (message: string) => void
  activeJobId: string | null
  openJob: (jobId: string, page?: Page) => void
}

/** Loads one analysis job with its syllabus and recommendations. */
export function useAnalysis(jobId: string | null) {
  const [data, setData] = useState<{ job: AnalysisJob; syllabus: Syllabus; recommendations: Recommendation[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const reload = useCallback(() => {
    if (!jobId) {
      setData(null)
      setLoading(false)
      return
    }
    api.getAnalysis(jobId).then((d) => {
      setData(d)
      setLoading(false)
    })
  }, [jobId])
  useEffect(reload, [reload])
  const replace = (rec: Recommendation) =>
    setData((d) => (d ? { ...d, recommendations: d.recommendations.map((r) => (r.id === rec.id ? rec : r)) } : d))
  return { data, loading, reload, replace }
}

/** Course context bar with a selector for any completed analysis. */
export function CourseBanner({ ctx, syllabus, recs }: { ctx: AppCtx; syllabus: Syllabus; recs: Recommendation[] }) {
  const [rows, setRows] = useState<HistoryRow[]>([])
  useEffect(() => {
    api.listHistory(ctx.user).then((r) => setRows(r.filter((x) => x.status === "COMPLETED")))
  }, [ctx.user])
  const count = (s: Recommendation["status"]) => recs.filter((r) => r.status === s).length
  return (
    <div className="course-banner">
      <div className="banner-main">
        <div>
          <label className="course-select">
            <span className="sr-only">Course analysis</span>
            <select value={ctx.activeJobId || ""} onChange={(e) => ctx.openJob(e.target.value)}>
              {rows.map((r) => (
                <option key={r.jobId} value={r.jobId}>
                  {r.courseName} · {fmtDate(r.uploadedAt)}
                </option>
              ))}
            </select>
          </label>
          <span>
            {syllabus.subject} · Analyzed {fmtDate(syllabus.uploadedAt)} · <Icon name="lock" size={11} /> Private syllabus
          </span>
        </div>
      </div>
      <div className="banner-counts">
        <span><b>{count("DRAFT")}</b> drafts</span>
        <span><b>{count("APPROVED")}</b> approved</span>
        <span><b>{count("REJECTED")}</b> rejected</span>
      </div>
    </div>
  )
}

export function CitationCard({ c }: { c: Citation }) {
  return (
    <div className={`citation ${c.kind === "Faculty Example" ? "example" : ""}`}>
      <b>{c.title}</b>
      <p>“{c.excerpt}”</p>
      <small>
        {c.publisher} · Version {c.version}
        {c.illustrative && " · Illustrative citation (demo)"}
      </small>
    </div>
  )
}

/** The three provenance layers every recommendation must keep visibly separate. */
export function EvidenceSections({ rec }: { rec: Recommendation }) {
  const authoritative = rec.citations.filter((c) => c.kind === "Authoritative")
  const examples = rec.citations.filter((c) => c.kind === "Faculty Example")
  return (
    <div className="evidence-grid">
      <div className="evidence-col">
        <h3><span className="source-letter authoritative">A</span>Authoritative evidence</h3>
        <p className="evidence-hint">Approved educational frameworks and guidance.</p>
        {authoritative.length ? authoritative.map((c) => <CitationCard key={c.id} c={c} />) : <p className="muted small-text">No authoritative source retrieved for this item.</p>}
      </div>
      <div className="evidence-col">
        <h3><span className="source-letter faculty">F</span>Faculty-approved examples</h3>
        <p className="evidence-hint">Previously reviewed instructional approaches.</p>
        {examples.length ? examples.map((c) => <CitationCard key={c.id} c={c} />) : <p className="muted small-text">No matching faculty example was retrieved.</p>}
      </div>
    </div>
  )
}

export function RecommendationBody({ rec }: { rec: Recommendation }) {
  return (
    <>
      <div className="generated-label">
        <Icon name="spark" size={14} />
        <span><b>AI-generated recommendation</b> synthesized for this syllabus. It is a suggestion for faculty judgment, not an accreditation requirement.</span>
      </div>
      <div className="rec-section">
        <h3>Proposed activity or change</h3>
        <p>{rec.description}</p>
      </div>
      <div className="rec-section">
        <h3>Educational rationale</h3>
        <p>{rec.rationale}</p>
      </div>
      <div className="two-col">
        <div className="rec-section">
          <h3>Implementation steps</h3>
          <ol>
            {rec.implementationSteps.map((s, i) => (
              <li key={i}><span>{i + 1}</span>{s}</li>
            ))}
          </ol>
        </div>
        <div className="rec-section">
          <h3>Expected learning outcomes</h3>
          <ul>
            {rec.learningOutcomes.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      </div>
      <div className="rec-section responsible">
        <h3><Icon name="shield" size={14} /> Responsible AI considerations</h3>
        <p>{rec.responsibleAI}</p>
      </div>
      <div className="rec-section">
        <h3>Supporting sources</h3>
        <EvidenceSections rec={rec} />
      </div>
    </>
  )
}

export function RecommendationEditor({ rec, user, onSaved, onCancel }: { rec: Recommendation; user: FacultyUser; onSaved: (r: Recommendation) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState({
    title: rec.title,
    description: rec.description,
    rationale: rec.rationale,
    steps: rec.implementationSteps.join("\n"),
    outcomes: rec.learningOutcomes.join("\n"),
    responsibleAI: rec.responsibleAI,
  })
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const set = (k: keyof typeof draft) => (e: { target: { value: string } }) => setDraft({ ...draft, [k]: e.target.value })
  const save = async () => {
    setSaving(true)
    setError("")
    try {
      const saved = await api.saveRecommendation(
        {
          ...rec,
          title: draft.title,
          description: draft.description,
          rationale: draft.rationale,
          implementationSteps: draft.steps.split("\n"),
          learningOutcomes: draft.outcomes.split("\n"),
          responsibleAI: draft.responsibleAI,
        },
        user.displayName,
      )
      onSaved(saved)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="rec-editor">
      <label>Recommendation title<input value={draft.title} onChange={set("title")} /></label>
      <label>Proposed activity or change<textarea rows={3} value={draft.description} onChange={set("description")} /></label>
      <label>Educational rationale<textarea rows={3} value={draft.rationale} onChange={set("rationale")} /></label>
      <div className="form-grid">
        <label>Implementation steps <small>One per line</small><textarea rows={5} value={draft.steps} onChange={set("steps")} /></label>
        <label>Expected learning outcomes <small>One per line</small><textarea rows={5} value={draft.outcomes} onChange={set("outcomes")} /></label>
      </div>
      <label>Responsible AI considerations<textarea rows={2} value={draft.responsibleAI} onChange={set("responsibleAI")} /></label>
      <p className="form-hint">Supporting sources stay attached to the recommendation and cannot be edited here.</p>
      <ErrorNote>{error}</ErrorNote>
      <div className="card-actions">
        <button className="primary small" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save draft revision"}</button>
        <button className="secondary small" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

/** Approve, reject (with optional note), edit, or return to draft. */
export function ReviewActions({ rec, ctx, onChange, onEdit }: { rec: Recommendation; ctx: AppCtx; onChange: (r: Recommendation) => void; onEdit: () => void }) {
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote] = useState("")
  const [error, setError] = useState("")
  const run = async (fn: () => Promise<Recommendation>, message: string) => {
    setError("")
    try {
      const r = await fn()
      onChange(r)
      setRejecting(false)
      setNote("")
      ctx.toast(message)
    } catch (e) {
      setError(errorText(e))
    }
  }
  if (rec.status !== "DRAFT")
    return (
      <>
        <div className="card-actions">
          <button className="secondary small" onClick={() => run(() => api.reopenRecommendation(rec.id, ctx.user.displayName), "Returned to draft")}>
            <Icon name="refresh" size={15} /> Return to draft
          </button>
          <span>
            {rec.status === "APPROVED" ? "Approved" : "Rejected"} by {rec.reviewedBy} · {fmtDateTime(rec.reviewedAt)}
          </span>
        </div>
        <ErrorNote>{error}</ErrorNote>
      </>
    )
  return (
    <>
      {rejecting && (
        <div className="reject-box">
          <label>
            Reason for rejecting (optional)
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: not a fit for this course level" />
          </label>
          <div className="button-row">
            <button className="secondary small danger-border" onClick={() => run(() => api.reviewRecommendation(rec.id, "REJECTED", ctx.user.displayName, note), "Recommendation rejected")}>Confirm rejection</button>
            <button className="text-button" onClick={() => setRejecting(false)}>Cancel</button>
          </div>
        </div>
      )}
      <div className="card-actions">
        <button className="primary small" onClick={() => run(() => api.reviewRecommendation(rec.id, "APPROVED", ctx.user.displayName), "Recommendation approved")}>
          <Icon name="check" size={15} /> Approve
        </button>
        {!rejecting && (
          <button className="secondary small danger-border" onClick={() => setRejecting(true)}>
            <Icon name="x" size={15} /> Reject
          </button>
        )}
        <button className="secondary small" onClick={onEdit}>
          <Icon name="edit" size={15} /> Edit
        </button>
        <span>Draft · last updated {fmtDateTime(rec.updatedAt)}</span>
      </div>
      <ErrorNote>{error}</ErrorNote>
    </>
  )
}

const historyLabel = { GENERATED: "Draft generated", EDITED: "Revision saved", APPROVED: "Approved", REJECTED: "Rejected", REOPENED: "Returned to draft" }

export function ReviewHistory({ rec }: { rec: Recommendation }) {
  return (
    <ol className="history-list">
      {[...rec.history].reverse().map((h) => (
        <li key={h.id} className={h.action.toLowerCase()}>
          <span />
          <div>
            <b>{historyLabel[h.action]}</b>
            <small>{h.actor} · {fmtDateTime(h.at)}</small>
            {h.note && <p>{h.note}</p>}
          </div>
        </li>
      ))}
    </ol>
  )
}

export function RecTitleLine({ rec }: { rec: Recommendation }) {
  return (
    <div className="rec-meta">
      <ReviewBadge status={rec.status} />
      <span>{rec.activityType} · {rec.module}</span>
    </div>
  )
}
