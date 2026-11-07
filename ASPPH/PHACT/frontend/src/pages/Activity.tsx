import { useState } from "react"
import type { ApprovalStatus } from "../types"
import { ApprovalBadge, EmptyState, ErrorNote, Icon, PageHeader, Status, fmtDate, fmtDateTime, versionSourceLabel } from "../components/ui"
import { syllabusState, type AppCtx } from "../components/workspace"
import { nextPage, useSyllabusRows } from "./Dashboard"

export function Activity({ ctx }: { ctx: AppCtx }) {
  const { rows, error } = useSyllabusRows(ctx.user.userId)
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<"ALL" | ApprovalStatus>("ALL")
  const q = query.toLowerCase()
  const shown = (rows || []).filter(({ syllabus: s }) => (!q || `${s.title} ${s.subject || ""} ${s.institution || ""}`.toLowerCase().includes(q)) && (status === "ALL" || s.approvalStatus === status))

  return (
    <>
      <PageHeader eyebrow="My Syllabi" title="Your syllabi" description="Every syllabus you've uploaded, its working copy, and where it stands. Syllabi and their versions are deleted automatically 180 days after upload." action={<button className="primary" onClick={() => ctx.navigate("upload")}><Icon name="plus" size={16} /> Upload Syllabus</button>} />
      <ErrorNote>{error}</ErrorNote>
      <div className="filterbar">
        <label>Search<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Title, subject, or institution" /></label>
        <label>Approval
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="ALL">All</option><option value="NONE">Not submitted</option><option value="PENDING">Pending approval</option><option value="APPROVED">Approved</option><option value="DENIED">Denied</option>
          </select>
        </label>
        <span>{shown.length} of {rows?.length ?? 0}</span>
      </div>
      <section className="panel table-wrap">
        <table>
          <thead><tr><th>Syllabus</th><th>Uploaded</th><th>Working copy</th><th>Reviews</th><th>Status</th><th>Approval</th><th>Available until</th><th>Actions</th></tr></thead>
          <tbody>
            {shown.map((row) => {
              const s = row.syllabus
              const state = syllabusState(s, row.reviews)
              const done = row.reviews.filter((r) => r.jobStatus === "COMPLETED" && !r.undoneAt).length
              return (
                <tr key={s.syllabusId}>
                  <td><b>{s.title}</b><small>{[s.subject, s.institution].filter(Boolean).join(" · ")}</small></td>
                  <td>{fmtDate(s.createdAt)}</td>
                  <td><b>v{s.currentVersion}</b><small>{versionSourceLabel[s.currentVersionSource]}</small></td>
                  <td>{done}</td>
                  <td><Status tone={state.tone}>{state.label}</Status></td>
                  <td>
                    <ApprovalBadge status={s.approvalStatus} />
                    {s.approvalStatus === "DENIED" && s.denyReason && <small className="decision-reason bad">{s.denyReason}</small>}
                    {s.approvalStatus === "APPROVED" && s.approvalNote && <small className="decision-reason good">{s.approvalNote}</small>}
                  </td>
                  <td>{fmtDate(s.expiresAt)}</td>
                  <td>
                    <div className="table-actions">
                      <button className="small-button small" onClick={() => ctx.openSyllabus(s.syllabusId, nextPage(row))}>Open</button>
                      <button className="text-button" onClick={() => ctx.openSyllabus(s.syllabusId, "competency")}>Competency</button>
                      <button className="text-button" onClick={() => ctx.openSyllabus(s.syllabusId, "review")}>Versions</button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {rows && !shown.length && <EmptyState icon="search" title={rows.length ? "No syllabi match these filters" : "No syllabi yet"} />}
        {!rows && !error && <div className="loading">Loading…</div>}
      </section>
      <p className="form-hint">Last refreshed {fmtDateTime(new Date().toISOString())}.</p>
    </>
  )
}
