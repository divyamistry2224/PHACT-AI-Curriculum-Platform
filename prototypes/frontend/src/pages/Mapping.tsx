import { Fragment, useEffect, useState } from "react"
import { api } from "../api"
import type { CompetencyMapping } from "../types"
import { EmptyState, Icon, PageHeader, Status } from "../components/ui"
import { CourseBanner, useAnalysis, type AppCtx } from "../components/workspace"
import { JobGate } from "./Recommendations"

const tone = { "Strong Alignment": "good", "Partial Alignment": "warn", "Gap Identified": "bad" } as const

export function Mapping({ ctx }: { ctx: AppCtx }) {
  const analysis = useAnalysis(ctx.activeJobId)
  const [rows, setRows] = useState<CompetencyMapping[]>([])
  const [filter, setFilter] = useState<"All" | CompetencyMapping["alignment"]>("All")
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState<string[]>([])
  useEffect(() => {
    if (ctx.activeJobId) api.getCompetencyMappings(ctx.activeJobId).then(setRows)
    api.getConfirmedMappings(ctx.user).then(setConfirmed)
  }, [ctx.activeJobId, ctx.user.id])
  const q = query.toLowerCase()
  const shown = rows.filter((r) => (filter === "All" || r.alignment === filter) && (!q || `${r.objective} ${r.competency} ${r.gap}`.toLowerCase().includes(q)))
  const count = (a: CompetencyMapping["alignment"]) => rows.filter((r) => r.alignment === a).length

  return (
    <>
      <PageHeader
        eyebrow="Step 3 of 6"
        title="Competency mapping insights"
        description="How your course learning objectives align with CEPH foundational competencies. Suggested alignments are drafts for your judgment, not accreditation determinations."
        action={<button className="primary" onClick={() => ctx.navigate("review")}>Continue to Review <Icon name="arrow" size={15} /></button>}
      />
      <JobGate ctx={ctx} analysis={analysis}>
        {analysis.data && <CourseBanner ctx={ctx} syllabus={analysis.data.syllabus} recs={analysis.data.recommendations} />}
        <div className="stats-row compact">
          <div className="stat"><strong>{rows.length}</strong><span>Objectives mapped</span></div>
          <div className="stat"><strong>{count("Strong Alignment")}</strong><span>Strong alignment</span></div>
          <div className="stat"><strong>{count("Partial Alignment")}</strong><span>Partial alignment</span></div>
          <div className="stat"><strong>{count("Gap Identified")}</strong><span>Gaps identified</span></div>
        </div>
        <div className="filterbar">
          <label>
            Alignment
            <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
              <option>All</option>
              <option>Strong Alignment</option>
              <option>Partial Alignment</option>
              <option>Gap Identified</option>
            </select>
          </label>
          <label>
            Search
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Objective or competency" />
          </label>
          <span>{shown.length} of {rows.length} objectives</span>
        </div>
        <section className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Course learning objective</th>
                <th>Matched CEPH competency</th>
                <th>Alignment</th>
                <th>Identified gap</th>
                <th>Suggested improvement</th>
                <th>Source</th>
                <th><span className="sr-only">Details</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <Fragment key={r.id}>
                  <tr className={open === r.id ? "expanded" : ""}>
                    <td><b>{r.objective}</b></td>
                    <td>{r.competency}</td>
                    <td><Status tone={tone[r.alignment]}>{r.alignment}</Status></td>
                    <td>{r.gap}</td>
                    <td>{r.improvement}</td>
                    <td><small>{r.source}</small></td>
                    <td>
                      <button className="text-button" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                        {open === r.id ? "Hide" : "Why?"}
                      </button>
                    </td>
                  </tr>
                  {open === r.id && (
                    <tr className="expanded detail-row">
                      <td colSpan={7}>
                        <div className="row-detail">
                          <span>How this alignment was determined</span>
                          <p>{r.reasoning}</p>
                          <p className="muted">PHACT compared the objective's wording and assessed skills with retrieved competency language. Confirm the alignment against your full course design.</p>
                          <button className={confirmed.includes(r.id) ? "secondary small" : "primary small"} onClick={async () => setConfirmed(await api.confirmCompetencyMapping(ctx.user, r.id, !confirmed.includes(r.id)))}>
                            {confirmed.includes(r.id) ? "Remove confirmation" : "Confirm mapping"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          {!shown.length && <EmptyState title="No objectives match these filters" />}
        </section>
      </JobGate>
    </>
  )
}
