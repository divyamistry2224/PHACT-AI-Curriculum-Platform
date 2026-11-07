import { useEffect, useState } from "react"
import { api } from "../api"
import type { HistoryRow, JobStatus } from "../types"
import { EmptyState, Icon, JobBadge, PageHeader, Status, fmtDate, fmtDateTime } from "../components/ui"
import type { AppCtx } from "../components/workspace"
import { courseState } from "./Dashboard"

export function Activity({ ctx }: { ctx: AppCtx }) {
  const [rows, setRows] = useState<HistoryRow[] | null>(null)
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<"ALL" | JobStatus | "NEEDS_REVIEW">("ALL")
  const load = () => api.listHistory(ctx.user).then(setRows)
  useEffect(() => {
    load()
  }, [ctx.user])
  const q = query.toLowerCase()
  const shown = (rows || []).filter(
    (r) => (!q || `${r.courseName} ${r.subject}`.toLowerCase().includes(q)) && (status === "ALL" || (status === "NEEDS_REVIEW" ? r.drafts > 0 : r.status === status)),
  )
  const retry = async (r: HistoryRow) => {
    await api.retryJob(r.jobId)
    ctx.openJob(r.jobId, "progress")
  }

  return (
    <>
      <PageHeader
        eyebrow="My Activity"
        title="Your course analyses"
        description="Reopen previous analyses, continue saved drafts, and track what you have approved."
        action={<button className="primary" onClick={() => ctx.navigate("upload")}><Icon name="plus" size={16} /> Analyze New Syllabus</button>}
      />
      <div className="filterbar">
        <label>
          Search
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Course or subject" />
        </label>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="ALL">All analyses</option>
            <option value="NEEDS_REVIEW">Needs review</option>
            <option value="COMPLETED">Completed</option>
            <option value="RUNNING">Analyzing</option>
            <option value="QUEUED">Queued</option>
            <option value="FAILED">Failed</option>
          </select>
        </label>
        <span>{shown.length} of {rows?.length ?? 0}</span>
      </div>
      <section className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Course</th>
              <th>Uploaded</th>
              <th>Analysis status</th>
              <th>Recommendations</th>
              <th>Review status</th>
              <th>Last modified</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const state = courseState(r)
              return (
                <tr key={r.jobId}>
                  <td><b>{r.courseName}</b><small>{r.subject}</small></td>
                  <td>{fmtDate(r.uploadedAt)}</td>
                  <td><JobBadge status={r.status} /></td>
                  <td>{r.status === "COMPLETED" ? <><b>{r.recommendationCount}</b><small>{r.approved} approved · {r.drafts} draft · {r.rejected} rejected</small></> : "—"}</td>
                  <td><Status tone={state.tone}>{state.label}</Status></td>
                  <td>{fmtDateTime(r.lastModified)}</td>
                  <td>
                    <div className="table-actions">
                      {r.status === "COMPLETED" && (
                        <>
                          <button className="small-button small" onClick={() => ctx.openJob(r.jobId, r.drafts ? "review" : "recommendations")}>{r.drafts ? "Continue review" : "Open"}</button>
                          <button className="text-button" onClick={() => ctx.openJob(r.jobId, "mapping")}>Mapping</button>
                          {r.approved > 0 && <button className="text-button" onClick={() => ctx.openJob(r.jobId, "export")}>Export</button>}
                        </>
                      )}
                      {(r.status === "RUNNING" || r.status === "QUEUED") && <button className="small-button small" onClick={() => ctx.openJob(r.jobId, "progress")}>View status</button>}
                      {r.status === "FAILED" && (
                        <>
                          <button className="small-button small" onClick={() => retry(r)}><Icon name="refresh" size={14} /> Retry</button>
                          <button className="text-button" onClick={() => ctx.openJob(r.jobId, "progress")}>Details</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {rows && !shown.length && <EmptyState icon="search" title="No analyses match these filters" />}
      </section>
    </>
  )
}
