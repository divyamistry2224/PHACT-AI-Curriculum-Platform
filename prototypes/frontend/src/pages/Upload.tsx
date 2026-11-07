import { useEffect, useRef, useState } from "react"
import { ANALYSIS_STAGES, api } from "../api"
import type { AnalysisJob, Syllabus } from "../types"
import { EmptyState, ErrorNote, Icon, JobBadge, PageHeader, Status, errorText, fmtDateTime } from "../components/ui"
import type { AppCtx } from "../components/workspace"

const MAX_MB = 10
const SUBJECTS = ["Epidemiology", "Biostatistics", "Ethics", "Environmental Health", "Health Policy", "Global Health", "Community Health", "Health Equity"]

function validateFile(file: File): string {
  const lower = file.name.toLowerCase()
  const isPdf = file.type === "application/pdf" || lower.endsWith(".pdf")
  const isDocx = file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || lower.endsWith(".docx")
  if (!isPdf && !isDocx) return "Only PDF or DOCX files can be uploaded. You can also paste syllabus text instead."
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
  const [course, setCourse] = useState("")
  const [subject, setSubject] = useState(SUBJECTS[0])
  const [description, setDescription] = useState("")
  const [simulateFailure, setSimulateFailure] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState("")
  const input = useRef<HTMLInputElement>(null)

  const pick = (f?: File | null) => {
    if (!f) return
    const problem = validateFile(f)
    setFileError(problem)
    setFile(problem ? null : f)
    if (!problem && !course) setCourse(f.name.replace(/\.pdf$/i, "").replace(/[-_]+/g, " "))
  }
  const remove = () => {
    setFile(null)
    setFileError("")
    if (input.current) input.current.value = ""
  }

  const pasted = manual && text.trim().length > 0
  const preview = pasted
    ? text.trim()
    : file
      ? `${course || "Course"}${description ? ` — ${description}` : ""}\n\nCourse objectives, weekly modules, assignments, and policies are extracted on the server after secure upload. This preview is illustrative in demo mode.`
      : ""

  const analyze = async () => {
    setError("")
    if (!file && !pasted) return setError("Add a PDF, DOCX, or paste your syllabus text first.")
    if (pasted && text.trim().length < 80) return setError("Pasted text is very short. Include objectives, modules, and assignments (at least 80 characters).")
    if (!course.trim()) return setError("Enter a course name.")
    try {
      setProgress(0)
      const syllabus = await api.uploadSyllabus(
        ctx.user,
        { file: pasted ? undefined : file || undefined, text: pasted ? text : undefined, courseName: course, subject, description },
        setProgress,
      )
      const job = await api.createAnalysisJob(ctx.user, syllabus.id, { simulateFailure })
      ctx.openJob(job.id, "progress")
    } catch (e) {
      setProgress(null)
      setError(errorText(e))
    }
  }
  const busy = progress !== null

  return (
    <>
      <PageHeader eyebrow="Step 1 of 6" title="Analyze a syllabus" description="Add your course material. PHACT reviews it against trusted curriculum resources and approved faculty examples, then prepares draft recommendations for you to review." />
      <div className="upload-grid">
        <section className="panel upload-panel">
          <div className="section-heading">
            <span>01</span>
            <div>
              <h2>Syllabus</h2>
              <p>Upload a PDF (up to {MAX_MB} MB) or paste your syllabus text.</p>
            </div>
          </div>
          {!file ? (
            <div
              role="button"
              tabIndex={0}
              className={`dropzone ${dragging ? "dragging" : ""}`}
              onClick={() => input.current?.click()}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragging(false)
                pick(e.dataTransfer.files[0])
              }}
            >
              <span className="upload-icon"><Icon name="upload" size={24} /></span>
              <b>Drag and drop your syllabus PDF or DOCX</b>
              <small>or browse files on your computer</small>
              <span className="small-button">Browse Files</span>
            </div>
          ) : (
            <div className="file-preview">
              <div className="pdf-page">
                <span>PDF</span>
                <div />
                <div />
                <div className="short" />
                <div />
                <div className="short" />
              </div>
              <div>
                {busy ? <Status tone="blue">Uploading {progress}%</Status> : <Status tone="good">Ready to upload</Status>}
                <h3>{file.name}</h3>
                <p>{(file.size / 1024 / 1024).toFixed(2)} MB · {file.name.toLowerCase().endsWith(".docx") ? "DOCX" : "PDF"} document</p>
                {busy && (
                  <div className="progress-bar slim"><span style={{ width: `${progress}%` }} /></div>
                )}
                {!busy && (
                  <div className="button-row">
                    <button className="text-button" onClick={() => input.current?.click()}>Replace</button>
                    <button className="text-button danger" onClick={remove}>Remove</button>
                  </div>
                )}
              </div>
            </div>
          )}
          <input ref={input} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => pick(e.target.files?.[0])} hidden />
          <ErrorNote>{fileError}</ErrorNote>
          <button className="text-button paste-toggle" onClick={() => setManual(!manual)} aria-expanded={manual}>
            <Icon name="file" /> {manual ? "Hide pasted text" : "Or paste syllabus text instead"} <Icon name="chevron" />
          </button>
          {manual && (
            <label>
              Syllabus text {file && <small className="muted">(pasted text is used instead of the PDF)</small>}
              <textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste course objectives, modules, assignments, and policies here..." />
            </label>
          )}
          <div className="form-grid">
            <label>
              Course name
              <input value={course} onChange={(e) => setCourse(e.target.value)} placeholder="e.g. Introduction to Epidemiology" />
            </label>
            <label>
              Subject area
              <select value={subject} onChange={(e) => setSubject(e.target.value)}>
                {SUBJECTS.map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>
          </div>
          <label>
            Course description
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="A short summary of the course and its audience" />
          </label>
        </section>
        <section className="panel analyze-panel">
          <div className="section-heading">
            <span>02</span>
            <div>
              <h2>Extracted text preview</h2>
              <p>Check that PHACT is reading the right document.</p>
            </div>
          </div>
          {preview ? (
            <div className="text-preview">
              <div>
                <Status tone={pasted ? "good" : "neutral"}>{pasted ? "Pasted text" : "Illustrative preview"}</Status>
                <small>{preview.length.toLocaleString()} characters</small>
              </div>
              <pre>{preview}</pre>
            </div>
          ) : (
            <EmptyState icon="file" title="Nothing to preview yet">Add a PDF or paste text to see the extracted content.</EmptyState>
          )}
          <div className="selection-summary">
            <p className="eyebrow">What happens next</p>
            <div><span>1. Secure private upload</span><b>Only you can access it</b></div>
            <div><span>2. Privacy and safety checks</span><b>Personal data screened</b></div>
            <div><span>3. Curriculum standards and examples</span><b>Retrieved with citations</b></div>
            <div><span>4. Draft recommendations</span><b>For your review</b></div>
          </div>
          <div className="privacy-note">
            <Icon name="lock" />
            <div>
              <b>Your syllabus stays private</b>
              <p>Uploading never publishes your syllabus to the community repository or shared knowledge sources. Sharing is a separate, optional step after you approve results.</p>
            </div>
          </div>
          <label className="demo-toggle">
            <input type="checkbox" checked={simulateFailure} onChange={(e) => setSimulateFailure(e.target.checked)} />
            <span>Demo: simulate a processing failure to preview error and retry handling</span>
          </label>
          <ErrorNote>{error}</ErrorNote>
          <button className="primary wide analyze" onClick={analyze} disabled={busy}>
            {busy ? `Uploading… ${progress}%` : "Analyze Syllabus"} {!busy && <Icon name="arrow" />}
          </button>
          <p className="form-note">You will review and approve every recommendation before it can be exported or shared.</p>
        </section>
      </div>
    </>
  )
}

export function Progress({ ctx }: { ctx: AppCtx }) {
  const [job, setJob] = useState<AnalysisJob | null>(null)
  const [syllabus, setSyllabus] = useState<Syllabus | null>(null)
  const [count, setCount] = useState(0)
  const [missing, setMissing] = useState(false)
  const [tick, setTick] = useState(0)

  // Poll the job status instead of waiting on a long synchronous request.
  useEffect(() => {
    if (!ctx.activeJobId) return setMissing(true)
    let timer: ReturnType<typeof setTimeout>
    let cancelled = false
    const poll = async () => {
      const result = await api.getAnalysis(ctx.activeJobId!)
      if (cancelled) return
      if (!result) return setMissing(true)
      setJob(result.job)
      setSyllabus(result.syllabus)
      setCount(result.recommendations.length)
      if (result.job.status === "QUEUED" || result.job.status === "RUNNING") timer = setTimeout(poll, 600)
    }
    poll()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [ctx.activeJobId, tick])

  const retry = async () => {
    if (!job) return
    await api.retryJob(job.id)
    ctx.toast("Analysis restarted")
    setTick((t) => t + 1)
  }

  if (missing)
    return <EmptyState title="No analysis selected" action={<button className="primary small" onClick={() => ctx.navigate("upload")}>Analyze a syllabus</button>}>Start a new analysis or reopen one from My Activity.</EmptyState>
  if (!job || !syllabus) return <div className="loading">Checking analysis status…</div>

  const done = job.status === "COMPLETED"
  const failed = job.status === "FAILED"
  const completed = done ? ANALYSIS_STAGES.length : job.progressStep
  const pct = Math.round((completed / ANALYSIS_STAGES.length) * 100)

  return (
    <div className="progress-page">
      <PageHeader
        eyebrow={failed ? "Analysis stopped" : done ? "Analysis complete" : "Analysis in progress"}
        title={failed ? "We couldn't finish this analysis." : done ? "Your draft recommendations are ready." : "Analyzing your course"}
        description={
          failed
            ? "Nothing was generated or shared. You can retry, or go back and paste the syllabus text."
            : done
              ? "Every recommendation starts as a draft. Nothing has been approved, exported, or shared."
              : "PHACT is comparing your syllabus with trusted curriculum standards and approved faculty examples. You can leave this page; the analysis continues."
        }
      />
      <div className="progress-layout">
        <section className="panel progress-panel">
          <div className="progress-number">
            <strong>{pct}%</strong>
            <span>{job.status === "QUEUED" ? "queued" : failed ? "stopped" : "complete"}</span>
            <span className="progress-status"><JobBadge status={job.status} /></span>
          </div>
          <div className={`progress-bar ${failed ? "failed" : ""}`}>
            <span style={{ width: `${pct}%` }} />
          </div>
          <ol>
            {ANALYSIS_STAGES.map((stage, i) => {
              const state = i < completed && !(failed && i === completed) ? "complete" : failed && i === completed ? "failed" : i === completed && !done ? (job.status === "QUEUED" ? "" : "running") : ""
              const finalDone = done && i === ANALYSIS_STAGES.length - 1
              return (
                <li key={stage} className={finalDone ? "complete" : state}>
                  <span>{state === "complete" || finalDone ? <Icon name="check" /> : state === "failed" ? <Icon name="x" /> : String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <b>{stage}</b>
                    <small>{state === "complete" || finalDone ? "Completed" : state === "failed" ? "Failed" : state === "running" ? "In progress" : job.status === "QUEUED" && i === 0 ? "Waiting to start" : "Waiting"}</small>
                  </div>
                </li>
              )
            })}
          </ol>
          {failed && (
            <div className="failure-box">
              <ErrorNote>{job.error}</ErrorNote>
              <div className="button-row">
                <button className="primary small" onClick={retry}><Icon name="refresh" size={15} /> Retry analysis</button>
                <button className="secondary small" onClick={() => ctx.navigate("upload")}>Upload again</button>
              </div>
            </div>
          )}
        </section>
        <aside className="panel analysis-aside">
          <p className="eyebrow">Course</p>
          <h2>{syllabus.courseName}</h2>
          <dl>
            <div><dt>Subject</dt><dd>{syllabus.subject}</dd></div>
            <div><dt>Source</dt><dd>{syllabus.source === "pdf" ? syllabus.fileName : "Pasted text"}</dd></div>
            <div><dt>Started</dt><dd>{fmtDateTime(job.createdAt)}</dd></div>
            <div><dt>Privacy screening</dt><dd>{completed >= 3 ? "Passed" : failed ? "Not completed" : "Pending"}</dd></div>
            {done && <div><dt>Draft recommendations</dt><dd>{count}</dd></div>}
          </dl>
          <div className="privacy-note">
            <Icon name="info" />
            <p>Recommendations are grounded in retrieved sources and remain drafts. They are never added to the shared repository automatically.</p>
          </div>
          {done && (
            <>
              <button className="primary wide" onClick={() => ctx.navigate("recommendations")}>Review Recommendations <Icon name="arrow" /></button>
              <button className="secondary wide" style={{ marginTop: 8 }} onClick={() => ctx.navigate("mapping")}>View Competency Mapping</button>
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
