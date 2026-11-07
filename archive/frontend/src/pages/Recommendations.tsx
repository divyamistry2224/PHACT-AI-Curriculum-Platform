import { useState, type ReactNode } from "react"
import type { Citation, ReviewStatus } from "../types"
import { EmptyState, Icon, PageHeader } from "../components/ui"
import { CourseBanner, RecTitleLine, RecommendationBody, RecommendationEditor, ReviewActions, useAnalysis, type AppCtx } from "../components/workspace"

/** Shared guard for pages that need a completed analysis. */
export function JobGate({ ctx, analysis, children }: { ctx: AppCtx; analysis: ReturnType<typeof useAnalysis>; children: ReactNode }) {
  if (analysis.loading) return <div className="loading">Loading analysis…</div>
  if (!analysis.data)
    return (
      <div className="panel">
        <EmptyState title="No course analysis yet" action={<button className="primary small" onClick={() => ctx.navigate("upload")}>Analyze a syllabus</button>}>
          Upload a syllabus to receive draft recommendations and competency mapping.
        </EmptyState>
      </div>
    )
  if (analysis.data.job.status !== "COMPLETED")
    return (
      <div className="panel">
        <EmptyState icon="clock" title={`${analysis.data.syllabus.courseName} is ${analysis.data.job.status === "FAILED" ? "not analyzed" : "still processing"}`} action={<button className="primary small" onClick={() => ctx.navigate("progress")}>View analysis status</button>}>
          Results appear here once the analysis completes.
        </EmptyState>
      </div>
    )
  return <>{children}</>
}

export function Recommendations({ ctx }: { ctx: AppCtx }) {
  const analysis = useAnalysis(ctx.activeJobId)
  const [filter, setFilter] = useState<ReviewStatus | "ALL">("ALL")
  const [open, setOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const recs = analysis.data?.recommendations || []
  const shown = recs.filter((r) => filter === "ALL" || r.status === filter)
  const expanded = open ?? shown[0]?.id
  const citations = [...new Map(recs.flatMap((r) => r.citations).map((c) => [c.id, c])).values()]

  return (
    <>
      <PageHeader
        eyebrow="Step 2 of 6"
        title="AI integration recommendations"
        description="Draft suggestions synthesized for your syllabus, each grounded in cited sources. Edit, accept, or reject them. Nothing is final until you approve it."
        action={<button className="secondary" onClick={() => ctx.navigate("mapping")}>Competency Mapping <Icon name="arrow" size={15} /></button>}
      />
      <JobGate ctx={ctx} analysis={analysis}>
        {analysis.data && <CourseBanner ctx={ctx} syllabus={analysis.data.syllabus} recs={recs} />}
        <div className="filterbar">
          <div className="tabs small">
            {(["ALL", "DRAFT", "APPROVED", "REJECTED"] as const).map((s) => (
              <button key={s} className={filter === s ? "active" : ""} onClick={() => setFilter(s)}>
                {s === "ALL" ? "All" : s[0] + s.slice(1).toLowerCase()}
                <span>{s === "ALL" ? recs.length : recs.filter((r) => r.status === s).length}</span>
              </button>
            ))}
          </div>
          <span>{shown.length} shown</span>
        </div>
        <div className="recommendation-layout">
          <div className="recommendation-list">
            {!shown.length && <div className="panel"><EmptyState title="No recommendations in this view" /></div>}
            {shown.map((rec, i) => (
              <article className="panel recommendation-card" key={rec.id}>
                <button className="rec-head" aria-expanded={expanded === rec.id} onClick={() => setOpen(expanded === rec.id ? "" : rec.id)}>
                  <span className="rec-number">{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <RecTitleLine rec={rec} />
                    <h2>{rec.title}</h2>
                    <p>{rec.description}</p>
                  </div>
                  <Icon name="chevron" />
                </button>
                {expanded === rec.id && (
                  <div className="rec-body">
                    {editing === rec.id ? (
                      <RecommendationEditor
                        rec={rec}
                        user={ctx.user}
                        onCancel={() => setEditing(null)}
                        onSaved={(r) => {
                          analysis.replace(r)
                          setEditing(null)
                          ctx.toast("Draft revision saved")
                        }}
                      />
                    ) : (
                      <>
                        <RecommendationBody rec={rec} />
                        <ReviewActions rec={rec} ctx={ctx} onChange={analysis.replace} onEdit={() => setEditing(rec.id)} />
                      </>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
          <SourcesPanel citations={citations} />
        </div>
      </JobGate>
    </>
  )
}

function SourcesPanel({ citations }: { citations: Citation[] }) {
  return (
    <aside className="panel sources-panel">
      <p className="eyebrow">Where this comes from</p>
      <h2>Retrieved sources</h2>
      {citations.map((c) => (
        <div key={c.id} className={`source-item ${c.kind === "Authoritative" ? "authoritative" : "faculty"}`}>
          <span>{c.kind === "Authoritative" ? "A" : "F"}</span>
          <div>
            <b>{c.title}</b>
            <small>{c.kind === "Authoritative" ? "Authoritative resource" : "Faculty-approved example"} · v{c.version}</small>
          </div>
        </div>
      ))}
      <p className="source-note">
        <b>A</b> Authoritative curriculum resources such as accreditation criteria and ASPPH guidance. <b>F</b> Teaching examples reviewed and published by faculty. Demo citations are illustrative.
      </p>
    </aside>
  )
}
