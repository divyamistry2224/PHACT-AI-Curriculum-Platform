import { useEffect, useState } from "react"
import { api } from "../api"
import type { ReviewSummary, SyllabusDetail, VersionText } from "../types"
import { ErrorNote, Icon, PageHeader, Status, errorText, fmtDateTime, versionSourceLabel } from "../components/ui"
import { CourseBanner, DiffView, DocumentView, RunningNotice, SyllabusGate, pendingDecision, useSyllabus, type AppCtx } from "../components/workspace"
import { lineDiff } from "../lib/diff"
import { downloadVersion } from "./ExportShare"

export function Review({ ctx }: { ctx: AppCtx }) {
  const state = useSyllabus(ctx.activeSyllabusId)
  return (
    <>
      <PageHeader eyebrow="Step 4 of 5" title="Review & submit" description="Read your working copy, compare it with what you uploaded, and submit it for ASPPH approval. Approved syllabi join the shared library that grounds peer examples for other faculty." />
      <SyllabusGate ctx={ctx} state={state}>
        {({ syllabus, reviews }) => <ReviewBody ctx={ctx} syllabus={syllabus} reviews={reviews} reload={state.reload} />}
      </SyllabusGate>
    </>
  )
}

function ReviewBody({ ctx, syllabus, reviews, reload }: { ctx: AppCtx; syllabus: SyllabusDetail; reviews: ReviewSummary[]; reload: () => void }) {
  const [viewing, setViewing] = useState(syllabus.currentVersion)
  const [version, setVersion] = useState<VersionText | null>(null)
  const [original, setOriginal] = useState<VersionText | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const decision = pendingDecision(syllabus, reviews)

  useEffect(() => setViewing(syllabus.currentVersion), [syllabus.currentVersion])
  useEffect(() => {
    setError("")
    api.getVersion(syllabus.syllabusId, viewing).then(setVersion).catch((e) => setError(errorText(e)))
  }, [syllabus.syllabusId, viewing])
  useEffect(() => {
    api.getVersion(syllabus.syllabusId, 1).then(setOriginal).catch(() => setOriginal(null))
  }, [syllabus.syllabusId])

  const current = syllabus.currentVersion
  const blocked =
    syllabus.reviewRunning ? "Wait for the running review to finish."
    : syllabus.approvalStatus === "PENDING" ? `Version ${syllabus.submittedVersion} is already waiting for approval.`
    : syllabus.approvalStatus === "APPROVED" && syllabus.approvedVersion === current ? `Version ${current} is already approved. Run another review to create a newer version.`
    : ""
  const submit = async () => {
    const note = decision ? " Your open review suggestions aren't included; decide on them first if you want them in this submission." : ""
    if (!confirm(`Submit version ${current} of ${syllabus.title} for ASPPH approval?${note}`)) return
    setBusy(true)
    setError("")
    try {
      await api.submitSyllabus(syllabus.syllabusId)
      ctx.toast(`Version ${current} submitted for approval`)
      reload()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const tags = (n: number) => [
    n === current && "Working copy",
    n === syllabus.submittedVersion && syllabus.approvalStatus === "PENDING" && "Submitted",
    n === syllabus.approvedVersion && "Approved",
  ].filter(Boolean) as string[]

  return (
    <>
      <CourseBanner ctx={ctx} syllabus={syllabus} />
      <RunningNotice ctx={ctx} syllabus={syllabus} />
      <ErrorNote>{error}</ErrorNote>
      <div className="review-layout syllabus-review-layout">
        <div className="panel review-list">
          {[...syllabus.versions].reverse().map((v) => (
            <button key={v.n} className={viewing === v.n ? "active" : ""} onClick={() => setViewing(v.n)}>
              <div>
                <Status tone={v.n === current ? "good" : "neutral"}>{tags(v.n).join(" · ") || "Earlier version"}</Status>
                <h3>Version {v.n}</h3>
                <p>{versionSourceLabel[v.source]} · {fmtDateTime(v.createdAt)}</p>
              </div>
              <Icon name="arrow" />
            </button>
          ))}
        </div>
        <section className="panel review-detail syllabus-detail">
          <div className="review-detail-head">
            <div>
              <Status tone={viewing === current ? "good" : "neutral"}>{viewing === current ? "Working copy" : `Version ${viewing}`}</Status>
              <h2>{syllabus.title}, version {viewing}</h2>
              <p className="muted">{version ? `${versionSourceLabel[version.source]} · ${fmtDateTime(version.createdAt)}` : "Loading…"}</p>
            </div>
          </div>
          <div className="document-actions">
            {version && <button className="secondary small" onClick={() => downloadVersion(syllabus.title, version, "docx")}><Icon name="file" size={14} /> Download DOCX</button>}
            {version && <button className="secondary small" onClick={() => downloadVersion(syllabus.title, version, "pdf")}><Icon name="download" size={14} /> Download PDF</button>}
            {viewing === current && <button className="primary small" disabled={busy || Boolean(blocked)} title={blocked || undefined} onClick={submit}>{busy ? "Submitting…" : `Submit version ${current} for approval`}</button>}
          </div>
          {viewing === current && blocked && <p className="form-hint">{blocked}</p>}
          {syllabus.approvalStatus === "DENIED" && viewing === current && <p className="form-hint">Address the feedback above (for example, run another review), then submit again.</p>}
          {version ? <DocumentView text={version.text} /> : <div className="loading">Loading version…</div>}
          {version && original && viewing !== 1 && <DiffView diff={lineDiff(original.text, version.text)} title={`Compare with the original upload (version 1)`} />}
        </section>
      </div>
    </>
  )
}
