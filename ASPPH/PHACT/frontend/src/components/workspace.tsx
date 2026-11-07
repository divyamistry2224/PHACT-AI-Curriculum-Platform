import { useCallback, useEffect, useState, type ReactNode } from "react"
import { api } from "../api"
import type { DiffSegment, Review, ReviewSummary, ReviewType, SyllabusDetail, SyllabusSummary, User } from "../types"
import { diffStats } from "../lib/diff"
import { markdownBlocks } from "../lib/document"
import { ApprovalBadge, EmptyState, ErrorNote, Icon, Status, errorText, fmtDate, fmtDateTime, type Page } from "./ui"

export interface AppCtx {
  user: User
  navigate: (page: Page) => void
  toast: (message: string) => void
  /** The syllabus the faculty workflow pages show. */
  activeSyllabusId: string | null
  openSyllabus: (syllabusId: string, page?: Page) => void
  /** The review the progress page follows. */
  activeReviewId: string | null
  watchReview: (reviewId: string) => void
}

const POLL_MS = 3000

/** One syllabus with its reviews. Polls while a review is running so pages update on their own. */
export function useSyllabus(syllabusId: string | null) {
  const [data, setData] = useState<{ syllabus: SyllabusDetail; reviews: ReviewSummary[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const reload = useCallback(async () => {
    if (!syllabusId) {
      setData(null)
      setLoading(false)
      return
    }
    try {
      setData(await api.getSyllabus(syllabusId))
      setError("")
    } catch (e) {
      setError(errorText(e))
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [syllabusId])
  useEffect(() => {
    setLoading(true)
    reload()
  }, [reload])
  const running = data?.syllabus.reviewRunning
  useEffect(() => {
    if (!running) return
    const timer = setInterval(reload, POLL_MS)
    return () => clearInterval(timer)
  }, [running, reload])
  return { data, loading, error, reload }
}

/** One review with its results. Polls until it finishes. */
export function useReview(reviewId: string | null | undefined) {
  const [review, setReview] = useState<Review | null>(null)
  const [error, setError] = useState("")
  useEffect(() => {
    setReview(null)
    if (!reviewId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const next = await api.getReview(reviewId)
        if (cancelled) return
        setReview(next)
        setError("")
        if (next.jobStatus === "QUEUED" || next.jobStatus === "RUNNING") timer = setTimeout(poll, POLL_MS)
      } catch (e) {
        if (!cancelled) setError(errorText(e))
      }
    }
    poll()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [reviewId])
  return { review, error, setReview }
}

/** The newest review of a type that still counts: running, or completed and not discarded. */
export function latestReview(reviews: ReviewSummary[], type: ReviewType): ReviewSummary | undefined {
  return reviews.find((r) => r.reviewType === type && !r.undoneAt && r.jobStatus !== "FAILED")
}

/** The newest failed review of a type, if it's newer than any that counts. */
export function latestFailure(reviews: ReviewSummary[], type: ReviewType): ReviewSummary | undefined {
  const newest = reviews.find((r) => r.reviewType === type && !r.undoneAt)
  return newest?.jobStatus === "FAILED" ? newest : undefined
}

/** A completed review whose suggestions are waiting for the faculty member's decisions. */
export function awaitingDecision(syllabus: SyllabusSummary, review?: ReviewSummary): boolean {
  return Boolean(review && review.jobStatus === "COMPLETED" && !review.decidedAt && syllabus.pendingReviewId === review.reviewId)
}

export function pendingDecision(syllabus: SyllabusSummary, reviews: ReviewSummary[]): ReviewSummary | undefined {
  return syllabus.pendingReviewId ? reviews.find((r) => r.reviewId === syllabus.pendingReviewId) : undefined
}

/** Where a syllabus stands, for list rows. */
export function syllabusState(s: SyllabusSummary, reviews?: ReviewSummary[]): { label: string; tone: "good" | "warn" | "neutral" | "bad" | "blue" } {
  if (s.reviewRunning) return { label: "Review running", tone: "blue" }
  if (s.pendingReviewId) return { label: "Suggestions to review", tone: "warn" }
  if (s.approvalStatus === "PENDING") return { label: "Pending approval", tone: "blue" }
  if (s.approvalStatus === "APPROVED") return { label: s.approvedVersion === s.currentVersion ? "Approved" : `v${s.approvedVersion} approved`, tone: "good" }
  if (s.approvalStatus === "DENIED") return { label: "Needs revision", tone: "bad" }
  return { label: s.currentVersion > 1 ? `Working copy v${s.currentVersion}` : "Uploaded", tone: "neutral" }
}

/** Course context bar with a selector for the caller's syllabi, plus the approval decision and its reason. */
export function CourseBanner({ ctx, syllabus, right }: { ctx: AppCtx; syllabus: SyllabusDetail; right?: ReactNode }) {
  return (
    <>
      <CourseSelector ctx={ctx} syllabus={syllabus} right={right} />
      <ApprovalPanel syllabus={syllabus} />
    </>
  )
}

function CourseSelector({ ctx, syllabus, right }: { ctx: AppCtx; syllabus: SyllabusDetail; right?: ReactNode }) {
  const [rows, setRows] = useState<SyllabusSummary[]>([])
  useEffect(() => {
    api.listSyllabi().then(setRows).catch(() => setRows([]))
  }, [ctx.user.userId])
  const options = rows.some((r) => r.syllabusId === syllabus.syllabusId) ? rows : [syllabus, ...rows]
  return (
    <div className="course-banner">
      <div className="banner-main">
        <div>
          <label className="course-select">
            <span className="sr-only">Syllabus</span>
            <select value={syllabus.syllabusId} onChange={(e) => ctx.openSyllabus(e.target.value)}>
              {options.map((r) => (
                <option key={r.syllabusId} value={r.syllabusId}>
                  {r.title} · {fmtDate(r.createdAt)}
                </option>
              ))}
            </select>
          </label>
          <span>
            {[syllabus.subject, syllabus.institution].filter(Boolean).join(" · ")}
            {syllabus.subject || syllabus.institution ? " · " : ""}Working copy v{syllabus.currentVersion} · <Icon name="lock" size={11} /> Private until approved
          </span>
        </div>
      </div>
      <div className="banner-counts">{right ?? <ApprovalBadge status={syllabus.approvalStatus} />}</div>
    </div>
  )
}

/** Guard for pages that need an active syllabus. */
export function SyllabusGate({ ctx, state, children }: { ctx: AppCtx; state: ReturnType<typeof useSyllabus>; children: (data: { syllabus: SyllabusDetail; reviews: ReviewSummary[] }) => ReactNode }) {
  if (state.loading) return <div className="loading">Loading syllabus…</div>
  if (state.error) return <div className="panel"><ErrorNote>{state.error}</ErrorNote></div>
  if (!state.data)
    return (
      <div className="panel">
        <EmptyState title="No syllabus selected" action={<button className="primary small" onClick={() => ctx.navigate("upload")}>Upload a syllabus</button>}>
          Upload a syllabus, or open one from My Syllabi.
        </EmptyState>
      </div>
    )
  return <>{children(state.data)}</>
}

/**
 * Starts a review and opens the progress page. Faculty can add instructions for this run (focus, scope, what
 * to leave alone); they guide which changes are suggested, never the grades.
 */
export function RunReviewButton({ ctx, syllabus, type, label, primary = true, declinedCount = 0 }: { ctx: AppCtx; syllabus: SyllabusSummary; type: ReviewType; label: string; primary?: boolean; declinedCount?: number }) {
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [guidance, setGuidance] = useState("")
  const blocked = syllabus.reviewRunning || Boolean(syllabus.pendingReviewId)
  const start = async () => {
    setBusy(true)
    setError("")
    try {
      const review = await api.startReview(syllabus.syllabusId, type, guidance.trim() || undefined)
      ctx.watchReview(review.reviewId)
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }
  const examples = type === "COMPETENCY"
    ? "For example: Focus on communication and leadership competencies. Don't change the reading list."
    : "For example: Students are first-year MPH. Prefer AI-resistant assessments. Leave weeks 1 to 3 alone."
  return (
    <span className={`run-review${open ? " open" : ""}`}>
      {open && !blocked && (
        <label className="run-guidance">
          Instructions for this run <small className="muted">(optional)</small>
          <textarea rows={3} maxLength={1000} value={guidance} onChange={(e) => setGuidance(e.target.value)} placeholder={examples} />
          <small className="muted">These guide which changes PHACT suggests and how. They don't change the CEPH grading.{declinedCount ? ` PHACT will also skip the ${declinedCount} suggestion${declinedCount === 1 ? "" : "s"} you declined before.` : ""}</small>
        </label>
      )}
      <span className="button-row">
        {!open && !blocked && <button className="text-button" onClick={() => setOpen(true)}><Icon name="edit" size={14} /> Add instructions</button>}
        <button className={primary ? "primary" : "secondary"} disabled={busy || blocked} title={syllabus.pendingReviewId ? "Decide on the open suggestions first" : undefined} onClick={start}>
          <Icon name="spark" size={15} /> {syllabus.reviewRunning ? "A review is running" : syllabus.pendingReviewId ? "Decide on open suggestions first" : busy ? "Starting…" : label}
        </button>
      </span>
      <ErrorNote>{error}</ErrorNote>
    </span>
  )
}

/** Suggestions declined in earlier decided runs of this type; the next run is told not to repeat them. */
export function declinedCount(reviews: ReviewSummary[], type: ReviewType): number {
  return reviews.filter((r) => r.reviewType === type && r.decidedAt && !r.undoneAt).reduce((n, r) => n + (r.decision?.suggestionsDeclined || 0), 0)
}

/** Shows the instructions a run was given and how many earlier declines it was told to skip. */
export function RunContext({ review }: { review: ReviewSummary }) {
  if (!review.guidance && !review.declinedContext?.length) return null
  return (
    <div className="run-context">
      <Icon name="info" size={15} />
      <div>
        {review.guidance && <p><b>Your instructions for this run:</b> {review.guidance}</p>}
        {review.declinedContext?.length ? <p className="muted">PHACT was told not to repeat {review.declinedContext.length} suggestion{review.declinedContext.length === 1 ? "" : "s"} you declined before.</p> : null}
      </div>
    </div>
  )
}

/** Running-review notice with a link to the progress page. */
export function RunningNotice({ ctx, syllabus }: { ctx: AppCtx; syllabus: SyllabusSummary }) {
  if (!syllabus.reviewRunning || !syllabus.activeReviewId) return null
  return (
    <div className="decision-bar running">
      <div>
        <b>A review is running on this syllabus.</b>
        <p>This page updates when it finishes. Reviews usually take one to three minutes.</p>
      </div>
      <button className="secondary small" onClick={() => ctx.watchReview(syllabus.activeReviewId!)}>View progress <Icon name="arrow" size={14} /></button>
    </div>
  )
}

const CONTEXT_LINES = 2

/** Line diff: inserts in green, deletions struck through, long unchanged stretches collapsed. */
export function DiffView({ diff, title = "Changes to the syllabus" }: { diff: DiffSegment[]; title?: string }) {
  const [open, setOpen] = useState(false)
  const stats = diffStats(diff)
  return (
    <section className="panel diff-panel">
      <button className="diff-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>
          <b>{title}</b>
          <small><span className="diff-added">+{stats.linesAdded}</span> <span className="diff-removed">−{stats.linesRemoved}</span> lines</small>
        </span>
        <Icon name="chevron" />
      </button>
      {open && (
        <div className="diff-view">
          {diff.map((segment, i) => {
            const lines = segment.text.split("\n")
            if (segment.op !== "equal") return <div key={i} className={`diff-${segment.op}`}>{lines.map((line, j) => <p key={j}>{line || " "}</p>)}</div>
            if (lines.length <= CONTEXT_LINES * 2 + 1) return <div key={i} className="diff-equal">{lines.map((line, j) => <p key={j}>{line || " "}</p>)}</div>
            const head = i === 0 ? [] : lines.slice(0, CONTEXT_LINES)
            const tail = i === diff.length - 1 ? [] : lines.slice(-CONTEXT_LINES)
            const hidden = lines.length - head.length - tail.length
            return (
              <div key={i} className="diff-equal">
                {head.map((line, j) => <p key={`h${j}`}>{line || " "}</p>)}
                <p className="diff-gap">… {hidden} unchanged line{hidden === 1 ? "" : "s"} …</p>
                {tail.map((line, j) => <p key={`t${j}`}>{line || " "}</p>)}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

/** Renders syllabus text (light Markdown) as a document. */
export function DocumentView({ text }: { text: string }) {
  return (
    <div className="syllabus-document">
      <div className="document-copy">
        {markdownBlocks(text).map((block, i) => {
          if (block.kind === "title") return <h2 key={i}>{block.text}</h2>
          if (block.kind === "heading") return <h3 key={i}>{block.text}</h3>
          if (block.kind === "subheading") return <h4 key={i}>{block.text}</h4>
          if (block.kind === "bullet") return <p key={i} className="doc-bullet">• {block.text}</p>
          if (block.kind === "table") {
            const pairs = !block.header && (block.rows || []).every((row) => row.length === 2)
            const body = block.header ? (block.rows || []).slice(1) : block.rows || []
            return (
              <table key={i} className={`doc-table${pairs ? " pairs" : ""}`}>
                {block.header && <thead><tr>{block.rows![0].map((c, j) => <th key={j}>{c}</th>)}</tr></thead>}
                <tbody>{body.map((row, r) => <tr key={r}>{row.map((c, j) => (pairs && j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}</tr>)}</tbody>
              </table>
            )
          }
          return <p key={i}>{block.text}</p>
        })}
      </div>
    </div>
  )
}

/** Approval status panel shared by the faculty pages. */
export function ApprovalPanel({ syllabus }: { syllabus: SyllabusSummary }) {
  const s = syllabus
  if (s.approvalStatus === "PENDING")
    return <div className="decision-panel"><b>Version {s.submittedVersion} is waiting for administrator approval</b><p>Submitted {fmtDateTime(s.submittedAt)}. You can keep running reviews; the submitted version stays as it is.</p></div>
  if (s.approvalStatus === "DENIED")
    return <div className="decision-panel rejected"><b>An administrator asked for revisions to version {s.submittedVersion}</b><p>{fmtDateTime(s.decidedAt)}</p>{s.denyReason && <p><strong>Feedback:</strong> {s.denyReason}</p>}</div>
  if (s.approvalStatus === "APPROVED")
    return <div className="decision-panel approved"><b>Version {s.approvedVersion} is approved and in the shared library</b><p>{fmtDateTime(s.approvedAt)}. A PII-scrubbed copy now helps other faculty as a peer example.</p>{s.approvalNote && <p><strong>Administrator's note:</strong> {s.approvalNote}</p>}</div>
  return null
}

export function ReviewStatusLine({ review }: { review: ReviewSummary }) {
  return <Status tone={review.jobStatus === "COMPLETED" ? "good" : review.jobStatus === "FAILED" ? "bad" : "blue"}>{review.jobStatus === "COMPLETED" ? `Completed ${fmtDateTime(review.completedAt)}` : review.jobStatus === "FAILED" ? "Failed" : "Running"}</Status>
}
