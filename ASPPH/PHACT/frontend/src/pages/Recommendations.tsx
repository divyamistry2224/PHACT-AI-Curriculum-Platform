import { useState } from "react"
import type { ModernizationResults, PeerExample, RecommendationApproach, RecommendationCategory, ReviewSummary, SyllabusDetail } from "../types"
import { EmptyState, ErrorNote, Icon, Kind, PageHeader, Status, fmtDateTime, sentence } from "../components/ui"
import { CourseBanner, DiffView, RunContext, RunReviewButton, RunningNotice, SyllabusGate, declinedCount, latestFailure, latestReview, useReview, useSyllabus, type AppCtx } from "../components/workspace"
import { SuggestionReview, type SuggestionGroup } from "../components/suggestions"

const approachLabel: Record<RecommendationApproach, string> = { INTEGRATE_AI: "Integrate AI", AI_RESISTANT: "AI-resistant" }
const categoryLabel: Record<RecommendationCategory, string> = { TEACHING_METHODS: "Teaching methods", ASSESSMENT_TOOLS: "Assessment tools", CONTENT_ENHANCEMENT: "Content enhancement" }

export function Recommendations({ ctx }: { ctx: AppCtx }) {
  const state = useSyllabus(ctx.activeSyllabusId)
  return (
    <>
      <PageHeader
        eyebrow="Step 3 of 5"
        title="AI integration recommendations"
        description="Ways to bring AI into your course responsibly, or to make assessments AI-resistant, grounded in syllabi other faculty have had approved. PHACT applies them in a new version that you keep or discard."
        action={<button className="secondary" onClick={() => ctx.navigate("review")}>Review & Submit <Icon name="arrow" size={15} /></button>}
      />
      <SyllabusGate ctx={ctx} state={state}>
        {({ syllabus, reviews }) => <RecommendationsBody ctx={ctx} syllabus={syllabus} reviews={reviews} reload={state.reload} />}
      </SyllabusGate>
    </>
  )
}

function RecommendationsBody({ ctx, syllabus, reviews, reload }: { ctx: AppCtx; syllabus: SyllabusDetail; reviews: ReviewSummary[]; reload: () => void }) {
  const latest = latestReview(reviews, "MODERNIZATION")
  const failure = latestFailure(reviews, "MODERNIZATION")
  const { review, error } = useReview(latest?.jobStatus === "COMPLETED" ? latest.reviewId : null)
  const [filter, setFilter] = useState<"ALL" | RecommendationApproach>("ALL")
  const results = review?.results as ModernizationResults | undefined

  const runButton = <RunReviewButton ctx={ctx} syllabus={syllabus} type="MODERNIZATION" declinedCount={declinedCount(reviews, "MODERNIZATION")} label={latest ? `Run again on version ${syllabus.currentVersion}` : `Get recommendations for version ${syllabus.currentVersion}`} primary={!latest} />
  const header = <CourseBanner ctx={ctx} syllabus={syllabus} right={latest?.jobStatus === "COMPLETED" ? <span>Reviewed version {latest.inputVersion} · {fmtDateTime(latest.completedAt)}</span> : undefined} />

  if (!latest || latest.jobStatus !== "COMPLETED")
    return (
      <>
        {header}
        <RunningNotice ctx={ctx} syllabus={syllabus} />
        {!syllabus.reviewRunning && (
          <div className="panel">
            <EmptyState icon="idea" title="No AI recommendations yet" action={runButton}>
              {failure ? <>The last attempt failed: {failure.errorMessage} </> : null}
              PHACT reviews version {syllabus.currentVersion} for AI-era teaching and assessment, citing approved peer syllabi where they help.
            </EmptyState>
          </div>
        )}
      </>
    )

  const recs = results?.recommendations || []
  const shown = recs.map((rec, index) => ({ rec, index })).filter(({ rec }) => filter === "ALL" || rec.approach === filter)
  const peers = [...new Map(recs.flatMap((r) => r.peerExamples).map((p) => [`${p.title}|${p.institution}`, p])).values()]

  return (
    <>
      {header}
      <RunningNotice ctx={ctx} syllabus={syllabus} />
      <RunContext review={latest} />
      <ErrorNote>{error}</ErrorNote>
      {!results && !error && <div className="loading">Loading recommendations…</div>}
      {results && (
        <>
          <div className="filterbar">
            <div className="tabs small">
              {(["ALL", "INTEGRATE_AI", "AI_RESISTANT"] as const).map((key) => (
                <button key={key} className={filter === key ? "active" : ""} onClick={() => setFilter(key)}>
                  {key === "ALL" ? "All" : approachLabel[key]}
                  <span>{key === "ALL" ? recs.length : recs.filter((r) => r.approach === key).length}</span>
                </button>
              ))}
            </div>
            <span>{shown.length} shown</span>
          </div>
          <div className="recommendation-layout">
            <div className="recommendation-list">
              {!shown.length && <div className="panel"><EmptyState title="No recommendations in this view" /></div>}
              {shown.length > 0 && <SuggestionReview ctx={ctx} syllabus={syllabus} review={latest} hunks={results.hunks || []} groups={groupsFor(results, shown.map((x) => x.index), filter === "ALL")} onSaved={reload} />}
            </div>
            <aside className="panel sources-panel">
              <p className="eyebrow">Where this comes from</p>
              <h2>Approved peer syllabi</h2>
              {peers.map((p) => (
                <div key={`${p.title}|${p.institution}`} className="source-item faculty"><span>F</span><div><b>{p.title}</b><small>{p.institution || "Approved syllabus"}</small></div></div>
              ))}
              {!peers.length && <p className="muted small-text">None cited.</p>}
              <p className="source-note">{results.peerExamplesAvailable} approved syllabi were retrieved as candidates. Only excerpts PHACT actually retrieved can be cited; contact details were removed before approval.</p>
            </aside>
          </div>
          <DiffView diff={results.diff} title={`All proposed changes to version ${latest.inputVersion} in one view`} />
        </>
      )}
      <div className="page-actions">{runButton}<button className="primary" onClick={() => ctx.navigate("review")}>Continue to Review & Submit <Icon name="arrow" size={15} /></button></div>
    </>
  )
}

function groupsFor(results: ModernizationResults, indexes: number[], includeOther: boolean): SuggestionGroup[] {
  const list: SuggestionGroup[] = indexes.map((index) => {
    const rec = results.recommendations[index]
    return {
      key: `r${index}`,
      title: rec.title,
      subtitle: rec.target,
      badges: <><Status tone={rec.approach === "INTEGRATE_AI" ? "blue" : "warn"}>{approachLabel[rec.approach]}</Status><span>{categoryLabel[rec.category] || sentence(rec.category)}</span></>,
      details: (
        <div className="suggestion-details">
          <p>{rec.recommendation}</p>
          <p className="muted"><b>Why:</b> {rec.rationale}</p>
          {rec.peerExamples.length > 0 && <div className="evidence-col">{rec.peerExamples.map((p, i) => <PeerCard key={i} peer={p} />)}</div>}
        </div>
      ),
      hunkIds: rec.hunkIds || [],
    }
  })
  if (includeOther && results.otherHunkIds?.length) list.push({ key: "other", title: "Other edits", subtitle: "Changes the review made that aren't tied to one recommendation", hunkIds: results.otherHunkIds })
  return list
}

function PeerCard({ peer }: { peer: PeerExample }) {
  return (
    <div className="citation example">
      <Kind type="Faculty Example">Approved peer syllabus</Kind>
      <b>{peer.title}</b>
      <p>“{peer.snippet.length > 420 ? `${peer.snippet.slice(0, 420)}…` : peer.snippet}”</p>
      <small>{peer.institution}</small>
    </div>
  )
}
