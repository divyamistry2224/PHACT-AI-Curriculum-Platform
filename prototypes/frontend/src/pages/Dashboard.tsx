import { useEffect, useState } from "react"
import { api } from "../api"
import type { DashboardData, HistoryRow } from "../types"
import { EmptyState, Icon, ModerationBadge, PageHeader, Status, Stepper, fmtDate, fmtDateTime, type Page } from "../components/ui"
import type { AppCtx } from "../components/workspace"

const steps: [string, Page][] = [
  ["Upload", "upload"],
  ["Recommendations", "recommendations"],
  ["Map", "mapping"],
  ["Review", "review"],
  ["Export", "export"],
  ["Share", "export"],
]

/** Where the working course sits in the six-step workflow (0-based). */
function workflowStep(row?: HistoryRow): number {
  if (!row || row.status !== "COMPLETED") return 0
  if (row.drafts) return 3
  if (row.approved) return 4
  return 3
}

export function courseState(r: HistoryRow): { label: string; tone: "good" | "warn" | "neutral" | "bad" | "blue" } {
  if (r.status === "FAILED") return { label: "Analysis failed", tone: "bad" }
  if (r.status !== "COMPLETED") return { label: "Analyzing", tone: "blue" }
  if (r.drafts) return { label: "Pending review", tone: "warn" }
  if (r.approved) return { label: "Approved", tone: "good" }
  return { label: "No approved items", tone: "neutral" }
}

export function openRow(ctx: AppCtx, r: HistoryRow) {
  if (r.status === "COMPLETED") ctx.openJob(r.jobId, r.drafts ? "review" : "recommendations")
  else ctx.openJob(r.jobId, "progress")
}

export function Dashboard({ ctx }: { ctx: AppCtx }) {
  const [data, setData] = useState<DashboardData | null>(null)
  useEffect(() => {
    api.getDashboard(ctx.user).then(setData)
  }, [ctx.user])
  const first = ctx.user.displayName.replace(/^Dr\.\s*/, "").split(" ")[0]
  const hour = new Date().getHours()
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"
  const stats = data?.stats
  const active = data?.history.find((r) => r.jobId === ctx.activeJobId) || data?.history[0]
  return (
    <>
      <PageHeader
        eyebrow={new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        title={`${greeting}, ${first}.`}
        description="Continue reviewing your course recommendations or begin a new syllabus analysis."
        action={
          <button className="primary" onClick={() => ctx.navigate("upload")}>
            <Icon name="plus" size={16} /> Analyze New Syllabus
          </button>
        }
      />
      <section className="panel stepper-panel">
        <div className="stepper-head">
          <h2>Course workflow</h2>
          <span>{active ? active.courseName : "No course analyzed yet"}</span>
        </div>
        <Stepper current={workflowStep(active)} steps={steps.map(([label, target]) => ({ label, onSelect: () => ctx.navigate(target) }))} />
      </section>
      <div className="stats-row">
        {([
          ["Syllabi analyzed", stats?.syllabi],
          ["Recommendations", stats?.recommendations],
          ["Pending review", stats?.pending],
          ["Approved", stats?.approved],
          ["Shared", stats?.shared],
        ] as const).map(([label, value]) => (
          <div className="stat" key={label}>
            <strong>{value ?? "–"}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className="dashboard-grid">
        <div className="dashboard-main">
        <section className="panel recent-courses">
          <div className="panel-head">
            <h2>Your courses</h2>
            <button className="link-arrow" onClick={() => ctx.navigate("activity")}>
              View all <Icon name="arrow" size={14} />
            </button>
          </div>
          {data && !data.history.length && (
            <EmptyState title="No analyses yet" action={<button className="primary small" onClick={() => ctx.navigate("upload")}>Analyze a syllabus</button>}>
              Upload a syllabus to receive draft recommendations.
            </EmptyState>
          )}
          <ul className="course-list">
            {data?.history.map((r) => {
              const state = courseState(r)
              return (
                <li key={r.jobId}>
                  <button className="course-row" onClick={() => openRow(ctx, r)}>
                    <span className="course-main">
                      <b>{r.courseName}</b>
                      <small>
                        {r.status === "COMPLETED" ? `${r.recommendationCount} recommendations` : r.subject} · Updated {fmtDate(r.lastModified)}
                      </small>
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
          <div className="panel-head">
            <h2>Recent activity</h2>
          </div>
          {data && !data.activity.length && <p className="muted">No activity yet.</p>}
          <div className="timeline">
            {data?.activity.map((a) => (
              <div key={a.id}>
                <span />
                <p>
                  <b>{a.title}</b>
                  <small>{a.detail} · {fmtDateTime(a.at)}</small>
                </p>
              </div>
            ))}
          </div>
        </section>
        </div>
        <aside className="panel queue-panel">
          <div className="queue-block">
            <h2>Awaiting your review</h2>
            <p className="queue-hint">Private to you. Drafts cannot be exported or shared until you approve them.</p>
            {data && !data.pending.length && <p className="queue-empty">You're all caught up.</p>}
            {data?.pending.map((r) => (
              <button key={r.id} className="queue-item" onClick={() => ctx.openJob(r.jobId, "review")}>
                <b>{r.title}</b>
                <small>{r.courseName}</small>
              </button>
            ))}
            {!!data?.stats.pending && (
              <button className="link-arrow" onClick={() => ctx.navigate("review")}>Open Review & Approval <Icon name="arrow" size={14} /></button>
            )}
          </div>
          <div className="queue-block community">
            <h2>Community contributions</h2>
            <p className="queue-hint">Approved items you chose to share. Each one is moderated before it becomes available to other faculty.</p>
            {data && !data.contributions.length && <p className="queue-empty">You haven't shared any resources yet.</p>}
            {data?.contributions.slice(0, 3).map((c) => (
              <div key={c.id} className="queue-item static">
                <ModerationBadge status={c.moderationStatus} />
                <b>{c.title}</b>
                <small>Submitted {fmtDate(c.submittedAt)}</small>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </>
  )
}
