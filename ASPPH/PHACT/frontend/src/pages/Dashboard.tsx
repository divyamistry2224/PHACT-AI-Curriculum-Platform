import { useEffect, useState } from "react"
import { api } from "../api"
import type { ReviewSummary, SyllabusSummary } from "../types"
import { ApprovalBadge, EmptyState, ErrorNote, Icon, PageHeader, Status, Stepper, errorText, fmtDate, fmtDateTime, type Page } from "../components/ui"
import { latestReview, pendingDecision, syllabusState, type AppCtx } from "../components/workspace"

const steps: [string, Page][] = [
  ["Upload", "upload"],
  ["Competency review", "competency"],
  ["AI recommendations", "recommendations"],
  ["Review & submit", "review"],
  ["Export", "export"],
]

interface Row {
  syllabus: SyllabusSummary
  reviews: ReviewSummary[]
}

/** Where a syllabus sits in the five-step workflow (0-based). */
export function workflowStep(row?: Row): number {
  if (!row) return 0
  const s = row.syllabus
  if (s.approvalStatus === "APPROVED" && s.approvedVersion === s.currentVersion) return 4
  if (s.approvalStatus === "PENDING") return 3
  if (latestReview(row.reviews, "MODERNIZATION")?.jobStatus === "COMPLETED") return 3
  if (latestReview(row.reviews, "COMPETENCY")?.jobStatus === "COMPLETED") return 2
  return 1
}

/** The page to open for a syllabus, given where it stands. */
export function nextPage(row: Row): Page {
  const decision = pendingDecision(row.syllabus, row.reviews)
  if (decision) return decision.reviewType === "COMPETENCY" ? "competency" : "recommendations"
  return steps[Math.min(workflowStep(row), 3)][1]
}

const MAX_DETAILS = 12

/** The caller's syllabi with their reviews (the newest few in detail). */
export function useSyllabusRows(userId: string) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState("")
  useEffect(() => {
    api.listSyllabi()
      .then((syllabi) => Promise.all(syllabi.map((s, i) => (i < MAX_DETAILS ? api.getSyllabus(s.syllabusId).then((d) => ({ syllabus: s, reviews: d.reviews })) : Promise.resolve({ syllabus: s, reviews: [] })))))
      .then(setRows)
      .catch((e) => setError(errorText(e)))
  }, [userId])
  return { rows, error }
}

function activityFeed(rows: Row[]) {
  const items: { id: string; title: string; detail: string; at: string }[] = []
  for (const { syllabus, reviews } of rows) {
    for (const r of reviews) {
      const kind = r.reviewType === "COMPETENCY" ? "Competency review" : "AI modernization review"
      if (r.completedAt && r.jobStatus === "COMPLETED") items.push({ id: `${r.reviewId}-done`, title: `${kind} suggested ${r.summary?.suggestions ?? "some"} change${r.summary?.suggestions === 1 ? "" : "s"}`, detail: syllabus.title, at: r.completedAt })
      if (r.jobStatus === "FAILED" && r.completedAt) items.push({ id: `${r.reviewId}-failed`, title: `${kind} failed`, detail: syllabus.title, at: r.completedAt })
      if (r.decidedAt && r.outputVersion) items.push({ id: `${r.reviewId}-saved`, title: `Saved version ${r.outputVersion} (${r.decision?.suggestionsAccepted ?? 0} suggestions accepted)`, detail: syllabus.title, at: r.decidedAt })
      if (r.decidedAt && !r.outputVersion && r.decision?.changesDeclined) items.push({ id: `${r.reviewId}-declined`, title: "Declined a review's suggestions", detail: syllabus.title, at: r.decidedAt })
      if (r.undoneAt) items.push({ id: `${r.reviewId}-undone`, title: `Discarded version ${r.outputVersion}`, detail: syllabus.title, at: r.undoneAt })
    }
    if (syllabus.submittedAt) items.push({ id: `${syllabus.syllabusId}-submitted`, title: `Submitted version ${syllabus.submittedVersion} for approval`, detail: syllabus.title, at: syllabus.submittedAt })
    if (syllabus.decidedAt) items.push({ id: `${syllabus.syllabusId}-decided`, title: syllabus.approvalStatus === "APPROVED" ? "Approved by an administrator" : "Revisions requested by an administrator", detail: syllabus.title, at: syllabus.decidedAt })
    items.push({ id: `${syllabus.syllabusId}-uploaded`, title: "Uploaded", detail: syllabus.title, at: syllabus.createdAt })
  }
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8)
}

export function Dashboard({ ctx }: { ctx: AppCtx }) {
  const { rows, error } = useSyllabusRows(ctx.user.userId)
  const first = ctx.user.name.replace(/^Dr\.\s*/, "").split(" ")[0]
  const hour = new Date().getHours()
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"
  const active = rows?.find((r) => r.syllabus.syllabusId === ctx.activeSyllabusId) || rows?.[0]
  const awaiting = (rows || []).filter((r) => pendingDecision(r.syllabus, r.reviews))
  const submitted = (rows || []).filter((r) => r.syllabus.approvalStatus !== "NONE")
  const reviewsDone = (rows || []).reduce((n, r) => n + r.reviews.filter((x) => x.jobStatus === "COMPLETED" && !x.undoneAt).length, 0)
  const stats: [string, number | undefined][] = [
    ["Syllabi", rows?.length],
    ["Reviews completed", rows ? reviewsDone : undefined],
    ["Awaiting your decision", rows ? awaiting.length : undefined],
    ["Pending approval", rows?.filter((r) => r.syllabus.approvalStatus === "PENDING").length],
    ["Approved", rows?.filter((r) => r.syllabus.approvedVersion).length],
  ]
  const open = (row: Row, page?: Page) => ctx.openSyllabus(row.syllabus.syllabusId, page || nextPage(row))

  return (
    <>
      <PageHeader
        eyebrow={new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        title={`${greeting}, ${first}.`}
        description="Continue with a syllabus or upload a new one for CEPH competency grading and AI-era recommendations."
        action={<button className="primary" onClick={() => ctx.navigate("upload")}><Icon name="plus" size={16} /> Upload Syllabus</button>}
      />
      <ErrorNote>{error}</ErrorNote>
      <section className="panel stepper-panel">
        <div className="stepper-head">
          <h2>Course workflow</h2>
          <span>{active ? active.syllabus.title : "No syllabus uploaded yet"}</span>
        </div>
        <Stepper current={workflowStep(active)} steps={steps.map(([label, target]) => ({ label, onSelect: () => (active ? open(active, target) : ctx.navigate("upload")) }))} />
      </section>
      <div className="stats-row">
        {stats.map(([label, value]) => (
          <div className="stat" key={label}><strong>{value ?? "–"}</strong><span>{label}</span></div>
        ))}
      </div>
      <div className="dashboard-grid">
        <div className="dashboard-main">
          <section className="panel recent-courses">
            <div className="panel-head">
              <h2>Your syllabi</h2>
              <button className="link-arrow" onClick={() => ctx.navigate("activity")}>View all <Icon name="arrow" size={14} /></button>
            </div>
            {rows && !rows.length && (
              <EmptyState title="No syllabi yet" action={<button className="primary small" onClick={() => ctx.navigate("upload")}>Upload a syllabus</button>}>
                Upload a syllabus to get a CEPH competency review and AI-era recommendations.
              </EmptyState>
            )}
            <ul className="course-list">
              {rows?.slice(0, 6).map((row) => {
                const state = syllabusState(row.syllabus, row.reviews)
                return (
                  <li key={row.syllabus.syllabusId}>
                    <button className="course-row" onClick={() => open(row)}>
                      <span className="course-main">
                        <b>{row.syllabus.title}</b>
                        <small>{row.syllabus.subject ? `${row.syllabus.subject} · ` : ""}Working copy v{row.syllabus.currentVersion} · Updated {fmtDate(row.syllabus.updatedAt)}</small>
                      </span>
                      <Status tone={state.tone}>{state.label}</Status>
                      <Icon name="arrow" size={16} />
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
          <section className="panel activity-feed">
            <div className="panel-head"><h2>Recent activity</h2></div>
            {rows && !rows.length && <p className="muted">No activity yet.</p>}
            <div className="timeline">
              {rows && activityFeed(rows).map((a) => (
                <div key={a.id}><span /><p><b>{a.title}</b><small>{a.detail} · {fmtDateTime(a.at)}</small></p></div>
              ))}
            </div>
          </section>
        </div>
        <aside className="panel queue-panel">
          <div className="queue-block">
            <h2>Awaiting your decision</h2>
            <p className="queue-hint">A review made suggestions. Accept, decline, or edit each one to create your next version.</p>
            {rows && !awaiting.length && <p className="queue-empty">You're all caught up.</p>}
            {awaiting.map((row) => {
              const review = pendingDecision(row.syllabus, row.reviews)!
              return (
                <button key={row.syllabus.syllabusId} className="queue-item" onClick={() => open(row)}>
                  <b>{review.summary?.suggestions ?? ""} suggestion{review.summary?.suggestions === 1 ? "" : "s"} from the {review.reviewType === "COMPETENCY" ? "competency review" : "AI recommendations"}</b>
                  <small>{row.syllabus.title}</small>
                </button>
              )
            })}
          </div>
          <div className="queue-block community">
            <h2>Approval status</h2>
            <p className="queue-hint">Submitted syllabi. Approved versions join the shared library of peer examples.</p>
            {rows && !submitted.length && <p className="queue-empty">Nothing submitted yet.</p>}
            {submitted.slice(0, 4).map((row) => (
              <button key={row.syllabus.syllabusId} className="queue-item" onClick={() => open(row, "review")}>
                <ApprovalBadge status={row.syllabus.approvalStatus} />
                <b>{row.syllabus.title}</b>
                <small>Version {row.syllabus.submittedVersion} · submitted {fmtDate(row.syllabus.submittedAt)}</small>
                {row.syllabus.approvalStatus === "DENIED" && row.syllabus.denyReason && <small className="decision-reason bad">Feedback: {row.syllabus.denyReason}</small>}
                {row.syllabus.approvalStatus === "APPROVED" && row.syllabus.approvalNote && <small className="decision-reason good">Note: {row.syllabus.approvalNote}</small>}
              </button>
            ))}
          </div>
        </aside>
      </div>
    </>
  )
}
