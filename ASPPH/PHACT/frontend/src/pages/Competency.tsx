import { Fragment, useState } from "react"
import type { CompetencyResults, CompetencyStatus, SyllabusDetail, ReviewSummary } from "../types"
import { EmptyState, ErrorNote, Icon, Kind, PageHeader, Status, fmtDateTime } from "../components/ui"
import { CourseBanner, DiffView, RunContext, RunReviewButton, RunningNotice, SyllabusGate, declinedCount, latestFailure, latestReview, useReview, useSyllabus, type AppCtx } from "../components/workspace"
import { SuggestionReview, type SuggestionGroup } from "../components/suggestions"

const tone = { ADDRESSED: "good", PARTIAL: "warn", NOT_ADDRESSED: "bad" } as const
const label: Record<CompetencyStatus, string> = { ADDRESSED: "Addressed", PARTIAL: "Partial", NOT_ADDRESSED: "Not addressed" }

export function Competency({ ctx }: { ctx: AppCtx }) {
  const state = useSyllabus(ctx.activeSyllabusId)
  return (
    <>
      <PageHeader
        eyebrow="Step 2 of 5"
        title="CEPH competency review"
        description="How your syllabus covers the 22 CEPH foundational competencies, with the changes PHACT made to strengthen a few that fit your course. Grades are guidance for your judgment, not accreditation decisions."
        action={<button className="secondary" onClick={() => ctx.navigate("recommendations")}>AI Recommendations <Icon name="arrow" size={15} /></button>}
      />
      <SyllabusGate ctx={ctx} state={state}>
        {({ syllabus, reviews }) => <CompetencyBody ctx={ctx} syllabus={syllabus} reviews={reviews} reload={state.reload} />}
      </SyllabusGate>
    </>
  )
}

function groups(results: CompetencyResults): SuggestionGroup[] {
  const list: SuggestionGroup[] = results.changes.map((change, i) => ({
    key: `c${i}`,
    title: change.change,
    subtitle: [change.section, change.reason].filter(Boolean).join(" · "),
    badges: <div className="tag-list">{change.competencyCodes.map((code) => <span key={code}>{code}</span>)}</div>,
    hunkIds: change.hunkIds || [],
  }))
  if (results.otherHunkIds?.length) list.push({ key: "other", title: "Other edits", subtitle: "Changes the review made that aren't tied to one suggestion above", hunkIds: results.otherHunkIds })
  return list
}

function CompetencyBody({ ctx, syllabus, reviews, reload }: { ctx: AppCtx; syllabus: SyllabusDetail; reviews: ReviewSummary[]; reload: () => void }) {
  const latest = latestReview(reviews, "COMPETENCY")
  const failure = latestFailure(reviews, "COMPETENCY")
  const { review, error } = useReview(latest?.jobStatus === "COMPLETED" ? latest.reviewId : null)
  const [filter, setFilter] = useState<"ALL" | CompetencyStatus>("ALL")
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState<string | null>(null)
  const results = review?.results as CompetencyResults | undefined

  const runButton = <RunReviewButton ctx={ctx} syllabus={syllabus} type="COMPETENCY" declinedCount={declinedCount(reviews, "COMPETENCY")} label={latest ? `Run again on version ${syllabus.currentVersion}` : "Run competency review"} primary={!latest} />
  const header = <CourseBanner ctx={ctx} syllabus={syllabus} right={latest?.jobStatus === "COMPLETED" ? <span>Reviewed version {latest.inputVersion} · {fmtDateTime(latest.completedAt)}</span> : undefined} />

  if (!latest || latest.jobStatus !== "COMPLETED")
    return (
      <>
        {header}
        <RunningNotice ctx={ctx} syllabus={syllabus} />
        {!syllabus.reviewRunning && (
          <div className="panel">
            <EmptyState icon="map" title="No competency review yet" action={runButton}>
              {failure ? <>The last attempt failed: {failure.errorMessage} </> : null}
              PHACT grades version {syllabus.currentVersion} against all 22 CEPH competencies and proposes a revised version for you to keep or discard.
            </EmptyState>
          </div>
        )}
      </>
    )

  const rows = results?.competencies || []
  const q = query.toLowerCase()
  const shown = rows.filter((r) => (filter === "ALL" || r.status === filter) && (!q || `${r.code} ${r.statement} ${r.domain} ${r.evidence}`.toLowerCase().includes(q)))

  return (
    <>
      {header}
      <RunningNotice ctx={ctx} syllabus={syllabus} />
      <RunContext review={latest} />
      <ErrorNote>{error}</ErrorNote>
      {!results && !error && <div className="loading">Loading results…</div>}
      {results && (
        <>
          <div className="stats-row compact">
            <div className="stat"><strong>{results.coverage.addressed}</strong><span>Addressed</span></div>
            <div className="stat"><strong>{results.coverage.partial}</strong><span>Partially addressed</span></div>
            <div className="stat"><strong>{results.coverage.notAddressed}</strong><span>Not addressed</span></div>
            <div className="stat"><strong>{results.coverage.total}</strong><span>CEPH competencies</span></div>
          </div>
          <p className="form-hint">CEPH competencies are meant to be covered across a whole MPH program, not by one course, so many will be "not addressed" for any single syllabus.</p>
          <h2 className="section-title">Suggested changes</h2>
          <SuggestionReview ctx={ctx} syllabus={syllabus} review={latest} hunks={results.hunks || []} groups={groups(results)} onSaved={reload} />
          <h2 className="section-title">How your syllabus covers each competency</h2>
          <div className="filterbar">
            <label>Status
              <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
                <option value="ALL">All</option><option value="ADDRESSED">Addressed</option><option value="PARTIAL">Partial</option><option value="NOT_ADDRESSED">Not addressed</option>
              </select>
            </label>
            <label>Search<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Competency, domain, or evidence" /></label>
            <span>{shown.length} of {rows.length} competencies</span>
          </div>
          <section className="panel table-wrap">
            <table>
              <thead><tr><th>CEPH competency</th><th>Status</th><th>Evidence in your syllabus</th><th>Rationale</th><th><span className="sr-only">Details</span></th></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <Fragment key={r.code}>
                    <tr className={open === r.code ? "expanded" : ""}>
                      <td><b>{r.code}. {r.statement}</b><small>{r.domain}</small></td>
                      <td><Status tone={tone[r.status]}>{label[r.status]}</Status></td>
                      <td>{r.evidence || <span className="muted">None found</span>}</td>
                      <td>{r.rationale}</td>
                      <td><button className="text-button" onClick={() => setOpen(open === r.code ? null : r.code)} aria-expanded={open === r.code}>{open === r.code ? "Hide" : "CEPH text"}</button></td>
                    </tr>
                    {open === r.code && (
                      <tr className="expanded detail-row">
                        <td colSpan={5}>
                          <div className="row-detail">
                            <Kind type="Authoritative">CEPH 2024 Accreditation Criteria, Competency {r.number}</Kind>
                            <p><b>{r.statement}</b></p>
                            <p>{r.cephInterpretation}</p>
                            <p className="muted">Retrieved from the CEPH knowledge base, not written by the AI.</p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
            {!shown.length && <EmptyState title="No competencies match these filters" />}
          </section>
          <DiffView diff={results.diff} title={`All proposed changes to version ${latest.inputVersion} in one view`} />
        </>
      )}
      <div className="page-actions">{runButton}<button className="primary" onClick={() => ctx.navigate("recommendations")}>Continue to AI Recommendations <Icon name="arrow" size={15} /></button></div>
    </>
  )
}
