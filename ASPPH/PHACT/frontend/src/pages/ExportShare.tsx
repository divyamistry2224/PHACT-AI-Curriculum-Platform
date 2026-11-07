import { useEffect, useState } from "react"
import { api } from "../api"
import type { CompetencyResults, ModernizationResults, ReviewSummary, SyllabusDetail, VersionText } from "../types"
import { BrandMark, ErrorNote, Icon, PageHeader, errorText, fmtDate, versionSourceLabel } from "../components/ui"
import { CourseBanner, DocumentView, SyllabusGate, latestReview, useReview, useSyllabus, type AppCtx } from "../components/workspace"
import { buildDocx, downloadBlob, type DocBlock } from "../lib/docx"
import { buildPdf } from "../lib/pdf"
import { fileSafe, markdownBlocks } from "../lib/document"

export async function downloadVersion(title: string, version: VersionText, format: "docx" | "pdf", extra: DocBlock[] = []) {
  const blocks = [...markdownBlocks(version.text), ...extra]
  const name = `${fileSafe(title)}-v${version.version}`
  if (format === "docx") downloadBlob(buildDocx(blocks), `${name}.docx`)
  else downloadBlob(await buildPdf(blocks, { title, subtitle: `Version ${version.version} \u2022 exported ${fmtDate(new Date().toISOString())}` }), `${name}.pdf`)
}

function competencyBlocks(results: CompetencyResults): DocBlock[] {
  const c = results.coverage
  return [
    { kind: "heading", text: "Appendix: CEPH competency review" },
    { kind: "note", text: `${c.addressed} addressed · ${c.partial} partially addressed · ${c.notAddressed} not addressed, of ${c.total} CEPH foundational competencies. AI-assisted grading for faculty judgment, not an accreditation decision.` },
    ...results.competencies.filter((r) => r.status !== "NOT_ADDRESSED").map((r) => ({ kind: "bullet" as const, text: `${r.code} (${r.status === "ADDRESSED" ? "addressed" : "partial"}): ${r.statement}. ${r.evidence}` })),
  ]
}

function recommendationBlocks(results: ModernizationResults): DocBlock[] {
  return [
    { kind: "heading", text: "Appendix: AI integration recommendations" },
    ...results.recommendations.flatMap((r): DocBlock[] => [
      { kind: "subheading", text: `${r.title} (${r.approach === "INTEGRATE_AI" ? "integrate AI" : "AI-resistant"})` },
      { kind: "para", text: r.recommendation },
      { kind: "note", text: `Why: ${r.rationale}${r.peerExamples.length ? ` · Peer examples: ${r.peerExamples.map((p) => `${p.title}${p.institution ? `, ${p.institution}` : ""}`).join("; ")}` : ""}` },
    ]),
  ]
}

export function ExportPage({ ctx }: { ctx: AppCtx }) {
  const state = useSyllabus(ctx.activeSyllabusId)
  return (
    <>
      <PageHeader eyebrow="Step 5 of 5" title="Export" description="Download a version of your syllabus for your course records, optionally with the competency review and AI recommendations as appendices." />
      <SyllabusGate ctx={ctx} state={state}>
        {({ syllabus, reviews }) => <ExportBody ctx={ctx} syllabus={syllabus} reviews={reviews} />}
      </SyllabusGate>
    </>
  )
}

function ExportBody({ ctx, syllabus, reviews }: { ctx: AppCtx; syllabus: SyllabusDetail; reviews: ReviewSummary[] }) {
  const [n, setN] = useState(syllabus.approvedVersion || syllabus.currentVersion)
  const [version, setVersion] = useState<VersionText | null>(null)
  const [error, setError] = useState("")
  const [opts, setOpts] = useState({ competency: true, recommendations: true })
  const competency = useReview(latestReview(reviews, "COMPETENCY")?.jobStatus === "COMPLETED" ? latestReview(reviews, "COMPETENCY")!.reviewId : null).review
  const modernization = useReview(latestReview(reviews, "MODERNIZATION")?.jobStatus === "COMPLETED" ? latestReview(reviews, "MODERNIZATION")!.reviewId : null).review
  useEffect(() => {
    setError("")
    api.getVersion(syllabus.syllabusId, n).then(setVersion).catch((e) => setError(errorText(e)))
  }, [syllabus.syllabusId, n])

  const extra: DocBlock[] = [
    ...(opts.competency && competency?.results ? competencyBlocks(competency.results as CompetencyResults) : []),
    ...(opts.recommendations && modernization?.results ? recommendationBlocks(modernization.results as ModernizationResults) : []),
    { kind: "note", text: `Prepared with PHACT · ${syllabus.title}, version ${n} · exported ${fmtDate(new Date().toISOString())} by ${ctx.user.name}` },
  ]
  const [exporting, setExporting] = useState<"docx" | "pdf" | null>(null)
  const download = async (format: "docx" | "pdf") => {
    if (!version) return
    setExporting(format)
    try {
      await downloadVersion(syllabus.title, version, format, extra)
      ctx.toast(`${format.toUpperCase()} downloaded`)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setExporting(null)
    }
  }

  return (
    <>
      <CourseBanner ctx={ctx} syllabus={syllabus} />
      <ErrorNote>{error}</ErrorNote>
      <div className="export-grid">
        <section className="panel">
          <div className="section-heading"><span>01</span><div><h2>Choose a version</h2><p>{syllabus.title}</p></div></div>
          <div className="selection-list">
            {[...syllabus.versions].reverse().map((v) => (
              <label key={v.n}>
                <input type="radio" name="version" checked={n === v.n} onChange={() => setN(v.n)} />
                <div>
                  <b>Version {v.n}{v.n === syllabus.currentVersion ? " · working copy" : ""}{v.n === syllabus.approvedVersion ? " · approved" : ""}</b>
                  <small>{versionSourceLabel[v.source]} · {fmtDate(v.createdAt)}</small>
                </div>
              </label>
            ))}
          </div>
          <div className="export-options">
            <label><input type="checkbox" checked={opts.competency && Boolean(competency?.results)} disabled={!competency?.results} onChange={(e) => setOpts({ ...opts, competency: e.target.checked })} /> Include the CEPH competency review {!competency?.results && <small className="muted">(none yet)</small>}</label>
            <label><input type="checkbox" checked={opts.recommendations && Boolean(modernization?.results)} disabled={!modernization?.results} onChange={(e) => setOpts({ ...opts, recommendations: e.target.checked })} /> Include the AI recommendations {!modernization?.results && <small className="muted">(none yet)</small>}</label>
          </div>
          <div className="button-row">
            <button className="primary" disabled={!version || Boolean(exporting)} onClick={() => download("docx")}><Icon name="file" size={16} /> {exporting === "docx" ? "Preparing…" : "Export DOCX"}</button>
            <button className="secondary" disabled={!version || Boolean(exporting)} onClick={() => download("pdf")}><Icon name="download" size={16} /> {exporting === "pdf" ? "Preparing…" : "Export PDF"}</button>
          </div>
          <p className="form-hint">Files are built in your browser from the stored version; nothing else is sent anywhere.</p>
        </section>
        <aside className="panel export-preview">
          <div className="paper">
            <div className="paper-head"><BrandMark /> <span>Version {n}</span></div>
            <h2>{syllabus.title}</h2>
            <p>Prepared for {ctx.user.name} · {fmtDate(new Date().toISOString())}</p>
            {version ? <div className="export-text"><DocumentView text={version.text.slice(0, 2500)} /></div> : <p className="muted">Loading…</p>}
          </div>
        </aside>
      </div>
      <FeedbackPanel ctx={ctx} syllabusId={syllabus.syllabusId} version={n} />
    </>
  )
}

function FeedbackPanel({ ctx, syllabusId, version }: { ctx: AppCtx; syllabusId: string; version: number }) {
  const [rating, setRating] = useState(0)
  const [hover, setHover] = useState(0)
  const [comment, setComment] = useState("")
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const send = async () => {
    if (!rating) return setError("Choose a rating from 1 to 5 stars.")
    setBusy(true)
    setError("")
    try {
      await api.submitFeedback({ syllabusId, version, rating, comment: comment.trim() || undefined })
      setSent(true)
      ctx.toast("Thanks for your feedback")
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  if (sent) return <section className="panel feedback-panel"><div className="feedback-thanks"><Icon name="check" /><div><b>Thanks for your feedback.</b><p>It goes to the ASPPH team to improve PHACT.</p></div></div></section>
  return (
    <section className="panel feedback-panel">
      <div className="section-heading"><span>02</span><div><h2>How useful was PHACT for this syllabus?</h2><p>Your rating and comments go to the ASPPH team. Names and contact details are removed from comments.</p></div></div>
      <div className="star-rating" role="radiogroup" aria-label="Rating" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((value) => (
          <button key={value} type="button" role="radio" aria-checked={rating === value} aria-label={`${value} star${value > 1 ? "s" : ""}`} className={(hover || rating) >= value ? "on" : ""} onMouseEnter={() => setHover(value)} onClick={() => setRating(value)}>★</button>
        ))}
        <span>{["", "Not useful", "Slightly useful", "Somewhat useful", "Very useful", "Extremely useful"][hover || rating]}</span>
      </div>
      <label>Comments (optional)<textarea rows={3} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="What worked well? What would make PHACT more useful?" /></label>
      <ErrorNote>{error}</ErrorNote>
      <div className="button-row"><button className="primary" disabled={busy} onClick={send}>{busy ? "Sending…" : "Send feedback"}</button></div>
    </section>
  )
}
