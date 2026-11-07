import { useEffect, useRef, useState } from "react"
import { REVIEW_STAGES, api } from "../api"
import type { CompetencyResults, ModernizationResults } from "../types"
import { EmptyState, ErrorNote, Icon, JobBadge, PageHeader, Status, errorText, fmtDateTime } from "../components/ui"
import { useReview, useSyllabus, type AppCtx } from "../components/workspace"

const MAX_MB = 10

function validateFile(file: File): string {
  const lower = file.name.toLowerCase()
  if (!lower.endsWith(".pdf") && !lower.endsWith(".docx")) return "Only PDF or DOCX files can be uploaded. You can also paste syllabus text instead."
  if (file.size === 0) return "This file is empty. Choose another document."
  if (file.size > MAX_MB * 1024 * 1024) return `This file is larger than ${MAX_MB} MB. Upload a smaller document or paste the text.`
  return ""
}

export function Upload({ ctx }: { ctx: AppCtx }) {
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState("")
  const [dragging, setDragging] = useState(false)
  const [manual, setManual] = useState(false)
  const [text, setText] = useState("")
  const [title, setTitle] = useState("")
  const [institution, setInstitution] = useState("")
  const [description, setDescription] = useState("")
  const [progress, setProgress] = useState<number | null>(null)
  const [step, setStep] = useState("")
  const [extracted, setExtracted] = useState("")
  const [error, setError] = useState("")
  const input = useRef<HTMLInputElement>(null)

  const pick = (f?: File | null) => {
    if (!f) return
    const problem = validateFile(f)
    setFileError(problem)
    setFile(problem ? null : f)
    if (!problem && !title) setTitle(f.name.replace(/\.(pdf|docx)$/i, "").replace(/[-_]+/g, " "))
  }
  const remove = () => {
    setFile(null)
    setFileError("")
    if (input.current) input.current.value = ""
  }

  const pasted = manual && text.trim().length > 0
  const analyze = async () => {
    setError("")
    if (!file && !pasted) return setError("Add a PDF or DOCX, or paste your syllabus text first.")
    if (pasted && text.trim().length < 200) return setError("Pasted text is very short. Include objectives, schedule, and assignments (at least 200 characters).")
    if (!title.trim()) return setError("Enter a course title.")
    try {
      setProgress(0)
      setStep("Uploading and checking your syllabus")
      const created = await api.uploadSyllabus(
        { file: pasted ? undefined : file || undefined, text: pasted ? text : undefined, title: title.trim(), institution: institution.trim() || undefined, description: description.trim() || undefined },
        setProgress,
      )
      setExtracted(created.extractedText)
      setStep("Starting the competency review")
      ctx.openSyllabus(created.syllabus.syllabusId)
      const review = await api.startReview(created.syllabus.syllabusId, "COMPETENCY")
      ctx.watchReview(review.reviewId)
    } catch (e) {
      setProgress(null)
      setStep("")
      setError(errorText(e))
    }
  }
  const busy = progress !== null

  return (
    <>
      <PageHeader eyebrow="Step 1 of 5" title="Upload a syllabus" description="Add your syllabus. PHACT checks it, screens out personal details, and grades it against the 22 CEPH foundational competencies. You decide what to keep at every step." />
      <div className="upload-grid">
        <section className="panel upload-panel">
          <div className="section-heading"><span>01</span><div><h2>Syllabus</h2><p>Upload a PDF or DOCX (up to {MAX_MB} MB) or paste your syllabus text.</p></div></div>
          {!file ? (
            <div
              role="button"
              tabIndex={0}
              className={`dropzone ${dragging ? "dragging" : ""}`}
              onClick={() => input.current?.click()}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files[0]) }}
            >
              <span className="upload-icon"><Icon name="upload" size={24} /></span>
              <b>Drag and drop your syllabus PDF or DOCX</b>
              <small>or browse files on your computer</small>
              <span className="small-button">Browse Files</span>
            </div>
          ) : (
            <div className="file-preview">
              <div className="pdf-page"><span>{file.name.toLowerCase().endsWith(".docx") ? "DOCX" : "PDF"}</span><div /><div /><div className="short" /><div /><div className="short" /></div>
              <div>
                {busy ? <Status tone="blue">{step}</Status> : <Status tone="good">Ready to upload</Status>}
                <h3>{file.name}</h3>
                <p>{(file.size / 1024 / 1024).toFixed(2)} MB · {file.name.toLowerCase().endsWith(".docx") ? "DOCX" : "PDF"} document</p>
                {busy && <div className="progress-bar slim"><span style={{ width: `${progress}%` }} /></div>}
                {!busy && <div className="button-row"><button className="text-button" onClick={() => input.current?.click()}>Replace</button><button className="text-button danger" onClick={remove}>Remove</button></div>}
              </div>
            </div>
          )}
          <input ref={input} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => pick(e.target.files?.[0])} hidden />
          <ErrorNote>{fileError}</ErrorNote>
          <button className="text-button paste-toggle" onClick={() => setManual(!manual)} aria-expanded={manual}>
            <Icon name="file" /> {manual ? "Hide pasted text" : "Or paste syllabus text instead"} <Icon name="chevron" />
          </button>
          {manual && (
            <label>Syllabus text {file && <small className="muted">(pasted text is used instead of the file)</small>}
              <textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste course objectives, schedule, assignments, and policies here..." />
            </label>
          )}
          <label>Course title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. EPID 601: Applied Epidemiologic Methods" /></label>
          <label>Institution <small className="muted">(optional; shown if this syllabus is approved as a peer example)</small><input value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="e.g. Harbor State University" /></label>
          <label>Course description <small className="muted">(optional)</small><textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="A short summary of the course and its audience" /></label>
        </section>
        <section className="panel analyze-panel">
          <div className="section-heading"><span>02</span><div><h2>Text preview</h2><p>Check that PHACT is reading the right document.</p></div></div>
          {pasted || extracted ? (
            <div className="text-preview">
              <div><Status tone="good">{extracted ? "Extracted by PHACT" : "Pasted text"}</Status><small>{(extracted || text.trim()).length.toLocaleString()} characters</small></div>
              <pre>{extracted || text.trim()}</pre>
            </div>
          ) : (
            <EmptyState icon="file" title={file ? "Text is extracted after upload" : "Nothing to preview yet"}>{file ? "PHACT reads PDF and DOCX files on the server after a secure upload." : "Add a file or paste text to get started."}</EmptyState>
          )}
          <div className="selection-summary">
            <p className="eyebrow">What happens next</p>
            <div><span>1. Secure private upload</span><b>Only you can see it</b></div>
            <div><span>2. Content and privacy checks</span><b>Personal details masked</b></div>
            <div><span>3. CEPH competency review</span><b>All 22 competencies graded</b></div>
            <div><span>4. Suggested changes</span><b>Accept, decline, or edit each</b></div>
          </div>
          <div className="privacy-note">
            <Icon name="lock" />
            <div><b>Your syllabus stays private</b><p>Nothing is shared unless you submit it and an ASPPH administrator approves it. Uploads and working versions are deleted automatically after 180 days.</p></div>
          </div>
          <ErrorNote>{error}</ErrorNote>
          <button className="primary wide analyze" onClick={analyze} disabled={busy}>{busy ? `${step}…` : "Upload and Run Competency Review"} {!busy && <Icon name="arrow" />}</button>
        </section>
      </div>
    </>
  )
}

const stageIndex = (jobStatus: string, stage?: string) => {
  if (jobStatus === "QUEUED") return 0
  const i = REVIEW_STAGES.findIndex((s) => s.stage === stage)
  return i < 0 ? 1 : i
}

export function Progress({ ctx }: { ctx: AppCtx }) {
  const { review, error } = useReview(ctx.activeReviewId)
  const syllabusState = useSyllabus(review?.syllabusId || null)
  const [retryError, setRetryError] = useState("")
  const syllabus = syllabusState.data?.syllabus
  const started = useRef(Date.now())
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  if (!ctx.activeReviewId) return <EmptyState title="No review running" action={<button className="primary small" onClick={() => ctx.navigate("upload")}>Upload a syllabus</button>}>Start a review from the competency or AI recommendations page.</EmptyState>
  if (error) return <div className="panel"><ErrorNote>{error}</ErrorNote></div>
  if (!review) return <div className="loading">Checking review status…</div>

  const competency = review.reviewType === "COMPETENCY"
  const done = review.jobStatus === "COMPLETED"
  const failed = review.jobStatus === "FAILED"
  const current = stageIndex(review.jobStatus, review.stage)
  const pct = done ? 100 : Math.round((current / REVIEW_STAGES.length) * 100)
  const resultsPage = competency ? "competency" : "recommendations"
  const kind = competency ? "competency review" : "AI modernization review"
  const elapsed = Math.round((Date.now() - (review.createdAt ? new Date(review.createdAt).getTime() : started.current)) / 1000)
  const retry = async () => {
    setRetryError("")
    try { ctx.watchReview((await api.startReview(review.syllabusId, review.reviewType)).reviewId) } catch (e) { setRetryError(errorText(e)) }
  }
  const counts = review.results && (competency ? (review.results as CompetencyResults).coverage : null)
  const recs = review.results && (!competency ? (review.results as ModernizationResults).recommendations : null)

  return (
    <div className="progress-page">
      <PageHeader
        eyebrow={failed ? "Review stopped" : done ? "Review complete" : "Review in progress"}
        title={failed ? `We couldn't finish the ${kind}.` : done ? `Your ${kind} is ready.` : `Running the ${kind}`}
        description={failed ? "Your syllabus is unchanged. You can run the review again." : done ? `It made ${review.summary?.suggestions ?? "its"} suggestion${review.summary?.suggestions === 1 ? "" : "s"}. Accept, decline, or edit each one; nothing changes in your syllabus until you save.` : "This usually takes one to three minutes. You can leave this page; the review keeps running."}
      />
      <div className="progress-layout">
        <section className="panel progress-panel">
          <div className="progress-number">
            <strong>{pct}%</strong>
            <span>{failed ? "stopped" : done ? "complete" : `${elapsed}s elapsed`}</span>
            <span className="progress-status"><JobBadge status={review.jobStatus} /></span>
          </div>
          <div className={`progress-bar ${failed ? "failed" : ""}`}><span style={{ width: `${pct}%` }} /></div>
          <ol>
            {REVIEW_STAGES.map((stage, i) => {
              const state = done || i < current ? "complete" : failed && i === current ? "failed" : i === current ? "running" : ""
              return (
                <li key={stage.stage} className={state}>
                  <span>{state === "complete" ? <Icon name="check" /> : state === "failed" ? <Icon name="x" /> : String(i + 1).padStart(2, "0")}</span>
                  <div><b>{stage.label}</b><small>{state === "complete" ? "Done" : state === "failed" ? "Stopped here" : state === "running" ? stage.detail : "Waiting"}</small></div>
                </li>
              )
            })}
          </ol>
          {failed && (
            <div className="failure-box">
              <ErrorNote>{review.errorMessage || "The review failed."}</ErrorNote>
              <ErrorNote>{retryError}</ErrorNote>
              <div className="button-row">
                <button className="primary small" onClick={retry}><Icon name="refresh" size={15} /> Run it again</button>
                <button className="secondary small" onClick={() => ctx.navigate(resultsPage)}>Back</button>
              </div>
            </div>
          )}
        </section>
        <aside className="panel analysis-aside">
          <p className="eyebrow">Syllabus</p>
          <h2>{syllabus?.title || "…"}</h2>
          <dl>
            {syllabus?.subject && <div><dt>Subject</dt><dd>{syllabus.subject}</dd></div>}
            <div><dt>Review</dt><dd>{competency ? "CEPH competency review" : "AI modernization review"}</dd></div>
            <div><dt>Based on</dt><dd>Version {review.inputVersion}</dd></div>
            <div><dt>Started</dt><dd>{fmtDateTime(review.createdAt)}</dd></div>
            {counts && <div><dt>Competencies</dt><dd>{counts.addressed} addressed · {counts.partial} partial · {counts.notAddressed} not addressed</dd></div>}
            {recs && <div><dt>Recommendations</dt><dd>{recs.length}</dd></div>}
            {done && review.summary && <div><dt>Proposed changes</dt><dd>+{review.summary.linesAdded} / −{review.summary.linesRemoved} lines</dd></div>}
          </dl>
          <div className="privacy-note"><Icon name="shield" /><p>Personal details are masked before the AI sees your syllabus and restored afterward. Everything the AI writes passes a safety check.</p></div>
          {done && <button className="primary wide" onClick={() => ctx.openSyllabus(review.syllabusId, resultsPage)}>Review the suggestions <Icon name="arrow" /></button>}
        </aside>
      </div>
    </div>
  )
}
