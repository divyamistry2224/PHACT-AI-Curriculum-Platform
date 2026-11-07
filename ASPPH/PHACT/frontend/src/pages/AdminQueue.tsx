import { useEffect, useMemo, useState } from "react"
import { api } from "../api"
import type { AdminSubmission, QueueItem, QueueStatus, SubmissionSummary } from "../types"
import { ApprovalBadge, EmptyState, ErrorNote, Icon, PageHeader, errorText, fmtDate, fmtDateTime } from "../components/ui"
import { DiffView, DocumentView, type AppCtx } from "../components/workspace"

const TABS: { status: QueueStatus; label: string }[] = [
  { status: "PENDING", label: "Pending review" },
  { status: "APPROVED", label: "Approved" },
  { status: "DENIED", label: "Denied" },
]

export function AdminApprovals({ ctx }: { ctx: AppCtx }) {
  const [queues, setQueues] = useState<Record<QueueStatus, QueueItem[]> | null>(null)
  const [tab, setTab] = useState<QueueStatus>("PENDING")
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [error, setError] = useState("")
  const load = async () => {
    try {
      const [PENDING, APPROVED, DENIED] = await Promise.all(TABS.map((t) => api.listQueue(t.status)))
      setQueues({ PENDING, APPROVED, DENIED })
      setError("")
    } catch (e) {
      setError(errorText(e))
    }
  }
  useEffect(() => { load() }, [ctx.user.userId])
  const items = queues?.[tab] || []
  const shown = useMemo(() => {
    const q = query.toLowerCase()
    return items.filter((i) => !q || `${i.title} ${i.subject || ""} ${i.institution || ""} ${i.ownerEmail || ""}`.toLowerCase().includes(q))
  }, [items, query])
  const current = shown.find((i) => i.syllabusId === selected) || shown[0]

  return (
    <>
      <PageHeader eyebrow="ASPPH administration" title="Final syllabus approvals" description="Review complete syllabi faculty have submitted. Approving one scrubs personal details and adds it to the shared library that grounds peer examples. Denying one sends your notes back to the faculty member." />
      <ErrorNote>{error}</ErrorNote>
      <div className="tabs syllabus-tabs">
        {TABS.map((t) => <button key={t.status} className={tab === t.status ? "active" : ""} onClick={() => { setTab(t.status); setSelected(null) }}>{t.label} <span>{queues?.[t.status].length ?? "–"}</span></button>)}
      </div>
      <div className="filterbar"><label>Search submissions<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Title, subject, institution, or email" /></label><button className="secondary small" onClick={load}><Icon name="refresh" size={14} /> Refresh</button></div>
      {queues && !shown.length && <section className="panel"><EmptyState icon="check" title={tab === "PENDING" ? "No submissions waiting for review" : "No submissions in this view"} /></section>}
      {!queues && !error && <div className="loading">Loading submissions…</div>}
      {shown.length > 0 && (
        <div className="review-layout syllabus-review-layout">
          <div className="panel review-list">
            {shown.map((i) => (
              <button key={i.syllabusId} className={current?.syllabusId === i.syllabusId ? "active" : ""} onClick={() => setSelected(i.syllabusId)}>
                <div><ApprovalBadge status={i.approvalStatus} /><h3>{i.title}</h3><p>{i.ownerEmail} · Version {i.submittedVersion} · {fmtDate(i.decidedAt || i.submittedAt)}</p></div>
                <Icon name="arrow" />
              </button>
            ))}
          </div>
          {current && <SubmissionDetail key={`${current.syllabusId}-${current.approvalStatus}`} ctx={ctx} item={current} onDecided={load} />}
        </div>
      )}
    </>
  )
}

function SubmissionDetail({ ctx, item, onDecided }: { ctx: AppCtx; item: QueueItem; onDecided: () => void }) {
  const [detail, setDetail] = useState<AdminSubmission | null>(null)
  const [action, setAction] = useState<"APPROVE" | "DENY" | null>(null)
  const [notes, setNotes] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api.getSubmission(item.syllabusId).then(setDetail).catch((e) => setError(errorText(e)))
  }, [item.syllabusId])
  // The decision email is recorded a few seconds after the decision; check back briefly until it appears.
  const awaitingEmail = item.approvalStatus !== "PENDING" && detail !== null && !detail.syllabus.notification
  const [emailChecks, setEmailChecks] = useState(0)
  useEffect(() => {
    if (!awaitingEmail || emailChecks >= 6) return
    const timer = setTimeout(() => {
      api.getSubmission(item.syllabusId).then(setDetail).catch(() => undefined)
      setEmailChecks((n) => n + 1)
    }, 2500)
    return () => clearTimeout(timer)
  }, [awaitingEmail, emailChecks, item.syllabusId])

  const decide = async () => {
    if (!action) return
    if (action === "DENY" && !notes.trim()) return setError("Add notes for the faculty member explaining what to revise.")
    setBusy(true)
    setError("")
    try {
      if (action === "APPROVE") await api.approveSubmission(item.syllabusId, notes.trim() || undefined)
      else await api.rejectSubmission(item.syllabusId, notes.trim())
      ctx.toast(action === "APPROVE" ? "Approved and added to the shared library" : "Denied; your notes were sent to the faculty member")
      setAction(null)
      setNotes("")
      onDecided()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const s = detail?.syllabus
  return (
    <section className="panel review-detail syllabus-detail">
      <div className="review-detail-head"><div><ApprovalBadge status={item.approvalStatus} /><h2>{item.title}</h2><p className="muted">{[item.subject, item.institution].filter(Boolean).join(" · ")}{item.subject || item.institution ? " · " : ""}Version {item.submittedVersion} · Submitted {fmtDateTime(item.submittedAt)}</p></div></div>
      <ErrorNote>{error}</ErrorNote>
      {detail && (
        <dl className="plain-dl">
          <div><dt>Faculty</dt><dd>{s?.ownerEmail || "—"}</dd></div>
          <div><dt>Changes since upload</dt><dd>+{detail.diffStats.linesAdded} / −{detail.diffStats.linesRemoved} lines</dd></div>
          <div><dt>Reviews behind it</dt><dd>{detail.reviews.filter((r) => r.reviewType === "COMPETENCY").length} competency · {detail.reviews.filter((r) => r.reviewType === "MODERNIZATION").length} AI modernization</dd></div>
          {s?.approvedVersion && item.approvalStatus !== "APPROVED" && <div><dt>Previously approved</dt><dd>Version {s.approvedVersion} ({fmtDate(s.approvedAt)})</dd></div>}
        </dl>
      )}
      {item.approvalStatus === "APPROVED" && <div className="decision-panel approved"><b>Approved by {item.decidedByEmail}</b><p>{fmtDateTime(item.decidedAt)}. A PII-scrubbed copy is in the shared library (KB2).</p>{s?.approvalNote && <p><strong>Note to faculty:</strong> {s.approvalNote}</p>}<EmailStatus detail={detail} waiting={awaitingEmail && emailChecks < 6} /></div>}
      {item.approvalStatus === "DENIED" && <div className="decision-panel rejected"><b>Denied by {item.decidedByEmail}</b><p>{fmtDateTime(item.decidedAt)}</p>{item.denyReason && <p><strong>Notes to faculty:</strong> {item.denyReason}</p>}<EmailStatus detail={detail} waiting={awaitingEmail && emailChecks < 6} /></div>}
      {item.approvalStatus === "PENDING" && !action && (
        <div className="approval-actions">
          <button className="primary" onClick={() => setAction("APPROVE")}><Icon name="check" size={15} /> Approve syllabus</button>
          <button className="secondary danger-border" onClick={() => setAction("DENY")}><Icon name="x" size={15} /> Deny and request revisions</button>
        </div>
      )}
      {action && (
        <div className="decision-dialog">
          <h3>{action === "APPROVE" ? "Approve syllabus" : "Deny and request revisions"}</h3>
          <p>{action === "APPROVE" ? `Version ${item.submittedVersion} of ${item.title} will have personal details removed and join the shared library within a few minutes.` : `The faculty member sees your notes and can revise and resubmit.`}</p>
          <label>{action === "DENY" ? "Notes to the faculty member (required)" : "Note to the faculty member (optional)"}
            <textarea rows={4} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={action === "DENY" ? "Explain what needs moderation or revision before this can be approved." : "Optional feedback, for example what stood out."} />
          </label>
          <div className="button-row">
            <button className="primary" disabled={busy} onClick={decide}>{busy ? "Saving…" : action === "APPROVE" ? "Confirm approval" : "Confirm denial"}</button>
            <button className="secondary" disabled={busy} onClick={() => { setAction(null); setNotes(""); setError("") }}>Cancel</button>
          </div>
        </div>
      )}
      {detail && <ChangeSummary detail={detail} />}
      <h3 className="document-section-title">Submitted syllabus (version {item.submittedVersion})</h3>
      {detail ? <DocumentView text={detail.text} /> : !error && <div className="loading">Loading submission…</div>}
      {detail && detail.version > 1 && <DiffView diff={detail.diff} title="Changes since the original upload" />}
    </section>
  )
}

/** AI-written summary of what changed (generated once per submitted version), with the exact accepted list under it. */
function ChangeSummary({ detail }: { detail: AdminSubmission }) {
  const [summary, setSummary] = useState<SubmissionSummary | null>(detail.summary)
  const [error, setError] = useState("")
  const syllabusId = detail.syllabus.syllabusId
  useEffect(() => {
    if (detail.summary) return
    let cancelled = false
    api.summarizeSubmission(syllabusId).then((s) => !cancelled && setSummary(s)).catch((e) => !cancelled && setError(errorText(e)))
    return () => { cancelled = true }
  }, [syllabusId, detail.summary])
  const reviews = detail.reviews.filter((r) => r.acceptedSuggestions?.length)
  return (
    <section className="change-summary">
      <div className="change-summary-head"><h3>Summary of changes</h3><span className="ai-label"><Icon name="spark" size={13} /> AI-written from the faculty member's recorded decisions</span></div>
      {summary ? <p>{summary.text}</p> : error ? <p className="muted">{error}</p> : <p className="muted">Writing a summary of the changes…</p>}
      {reviews.length > 0 && (
        <details>
          <summary>Accepted suggestions ({reviews.reduce((n, r) => n + (r.acceptedSuggestions?.length || 0), 0)})</summary>
          {reviews.map((r) => (
            <div key={r.reviewId} className="accepted-list">
              <b>{r.reviewType === "COMPETENCY" ? "CEPH competency review" : "AI integration review"} → version {r.outputVersion}{r.decision?.suggestionsDeclined ? ` (${r.decision.suggestionsDeclined} declined)` : ""}</b>
              <ul>{r.acceptedSuggestions!.map((a, i) => <li key={i}>{a.title}{a.edited && <em> (edited by faculty)</em>}{a.reason && <small>{a.reason}</small>}</li>)}</ul>
            </div>
          ))}
        </details>
      )}
    </section>
  )
}

function EmailStatus({ detail, waiting }: { detail: AdminSubmission | null; waiting: boolean }) {
  const note = detail?.syllabus.notification
  if (!note) return waiting ? <p className="email-status"><Icon name="clock" size={13} /> Emailing the faculty member…</p> : null
  return (
    <p className={`email-status ${note.status === "SENT" ? "sent" : "not-sent"}`}>
      <Icon name={note.status === "SENT" ? "check" : "info"} size={13} />
      {note.status === "SENT" ? <>Email sent to {note.to} {fmtDateTime(note.at)}</> : <>Email to {note.to || "the faculty member"} not sent: {note.detail}</>}
    </p>
  )
}
