import { useEffect, useState } from "react"
import { api } from "../api"
import type { FeedbackList } from "../types"
import { EmptyState, ErrorNote, Icon, PageHeader, errorText, fmtDateTime } from "../components/ui"

const stars = (n: number) => "★★★★★".slice(0, n) + "☆☆☆☆☆".slice(0, 5 - n)

export function AdminFeedback() {
  const [data, setData] = useState<FeedbackList | null>(null)
  const [error, setError] = useState("")
  const load = () => api.listFeedback().then(setData).catch((e) => setError(errorText(e)))
  useEffect(() => { load() }, [])
  const counts = [5, 4, 3, 2, 1].map((n) => ({ n, count: data?.items.filter((f) => f.rating === n).length || 0 }))

  return (
    <>
      <PageHeader eyebrow="ASPPH administration" title="Faculty feedback" description="Ratings and comments faculty leave on the Export page. Names and contact details are removed from comments before they're stored." action={<button className="secondary" onClick={load}><Icon name="refresh" size={14} /> Refresh</button>} />
      <ErrorNote>{error}</ErrorNote>
      <div className="stats-row compact">
        <div className="stat"><strong>{data ? data.count : "–"}</strong><span>Responses</span></div>
        <div className="stat"><strong>{data?.averageRating ?? "–"}</strong><span>Average rating (of 5)</span></div>
        <div className="stat"><strong>{data ? data.items.filter((f) => f.comment).length : "–"}</strong><span>With comments</span></div>
        <div className="stat rating-bars">
          {counts.map(({ n, count }) => (
            <div key={n}><span>{n}★</span><i><b style={{ width: `${data?.count ? (count / data.count) * 100 : 0}%` }} /></i><span>{count}</span></div>
          ))}
        </div>
      </div>
      <section className="panel table-wrap">
        <table>
          <thead><tr><th>Rating</th><th>Comment</th><th>Syllabus</th><th>From</th><th>When</th></tr></thead>
          <tbody>
            {data?.items.map((f) => (
              <tr key={f.feedbackId}>
                <td><span className="stars" aria-label={`${f.rating} of 5`}>{stars(f.rating)}</span></td>
                <td>{f.comment || <span className="muted">No comment</span>}</td>
                <td><b>{f.syllabusTitle || "Removed syllabus"}</b><small>Version {f.version}</small></td>
                <td>{f.ownerEmail || "—"}</td>
                <td>{fmtDateTime(f.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && !data.items.length && <EmptyState icon="people" title="No feedback yet">Faculty can rate PHACT from the Export page.</EmptyState>}
        {!data && !error && <div className="loading">Loading feedback…</div>}
      </section>
    </>
  )
}
