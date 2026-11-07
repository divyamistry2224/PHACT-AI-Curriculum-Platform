import type { ReactNode } from "react"
import type { ApprovalStatus, JobStatus } from "../types"

export type Page =
  | "dashboard"
  | "upload"
  | "progress"
  | "competency"
  | "recommendations"
  | "review"
  | "export"
  | "activity"
  | "approvals"
  | "knowledge"
  | "feedback"
  | "privacy"
  | "terms"

const iconPaths: Record<string, ReactNode> = {
  home: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 9.5V21h13V9.5M9 21v-7h6v7" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
      <path d="M4 15v5h16v-5" />
    </>
  ),
  idea: (
    <>
      <path d="M9 18h6M10 22h4" />
      <path d="M8.5 15.5A7 7 0 1 1 15.5 15.5C14.5 16.3 14 17 14 18h-4c0-1-.5-1.7-1.5-2.5Z" />
    </>
  ),
  map: (
    <>
      <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z" />
      <path d="M9 3v15M15 6v15" />
    </>
  ),
  review: (
    <>
      <path d="M6 3h12v18H6z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </>
  ),
  share: (
    <>
      <circle cx="18" cy="5" r="2" />
      <circle cx="6" cy="12" r="2" />
      <circle cx="18" cy="19" r="2" />
      <path d="m8 11 8-5M8 13l8 5" />
    </>
  ),
  library: (
    <>
      <path d="M4 4h4v16H4zM10 4h4v16h-4zM16 5l4-1 2 15-4 1z" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  bell: (
    <>
      <path d="M6 17h12l-1.5-2.5V10a4.5 4.5 0 0 0-9 0v4.5Z" />
      <path d="M10 20h4" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  arrow: <path d="m9 18 6-6-6-6" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m16 16 5 5" />
    </>
  ),
  file: (
    <>
      <path d="M6 2h8l4 4v16H6z" />
      <path d="M14 2v5h5M9 13h6M9 17h6" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7h.01" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  download: (
    <>
      <path d="M12 3v13m0 0 5-5m-5 5-5-5" />
      <path d="M4 20h16" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 7h-6V1" />
      <path d="M20 7a9 9 0 1 0 1 7" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4" />,
  x: <path d="m6 6 12 12M18 6 6 18" />,
  shield: <path d="M12 3 4.5 6v6c0 4.5 3.2 7.8 7.5 9 4.3-1.2 7.5-4.5 7.5-9V6Z" />,
  alert: (
    <>
      <path d="M12 3 2 20h20Z" />
      <path d="M12 10v4M12 17h.01" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="1.5" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />,
  people: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5a3 3 0 0 1 0 6M18 14c2 .7 3 2.8 3 6" />
    </>
  ),
}

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {iconPaths[name]}
    </svg>
  )
}

export function BrandMark({ full = false }: { full?: boolean }) {
  return (
    <img
      className={`brand-mark ${full ? "brand-mark-full" : ""}`}
      src="/branding/phact-logo-2.png"
      alt="PHACT - Public Health AI Curriculum Transformation Platform"
    />
  )
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  )
}

export type Tone = "neutral" | "good" | "warn" | "bad" | "blue"

/** Compact status: a small tone dot plus a sentence-case text label. */
export function Status({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={`status ${tone}`}>
      <i aria-hidden="true" />
      {children}
    </span>
  )
}

/** Converts API enums such as INDEX_FAILED into sentence case. */
export const sentence = (value: string) => {
  const t = value.replace(/_/g, " ").toLowerCase()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

export interface StepItem {
  label: string
  onSelect: () => void
}

/** Six-column workflow stepper; steps before `current` render as complete. */
export function Stepper({ steps, current }: { steps: StepItem[]; current: number }) {
  const state = (i: number) => (i < current ? "complete" : i === current ? "current" : "upcoming")
  return (
    <nav className="stepper" aria-label="Curriculum workflow">
      <ol className="stepper-track" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((step, i) => (
          <li key={step.label} className={`step ${state(i)}`}>
            <button onClick={step.onSelect} aria-current={i === current ? "step" : undefined}>
              <span className="step-dot">{i < current ? <Icon name="check" size={13} /> : i + 1}</span>
              <span className="step-label">{step.label}</span>
              <span className="sr-only">{state(i) === "complete" ? "(completed)" : state(i) === "current" ? "(current step)" : ""}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="stepper-mobile">
        <span className="step-dot current-dot">{Math.min(current, steps.length - 1) + 1}</span>
        <div>
          <small>Step {Math.min(current, steps.length - 1) + 1} of {steps.length}</small>
          <b>{steps[Math.min(current, steps.length - 1)].label}</b>
        </div>
        <label>
          <span className="sr-only">Go to step</span>
          <select value="" onChange={(e) => steps[Number(e.target.value)]?.onSelect()}>
            <option value="" disabled>Go to step</option>
            {steps.map((s, i) => (
              <option key={s.label} value={i}>{i + 1}. {s.label}</option>
            ))}
          </select>
        </label>
      </div>
    </nav>
  )
}

const jobTone: Record<JobStatus, Tone> = { QUEUED: "neutral", RUNNING: "blue", COMPLETED: "good", FAILED: "bad" }
const jobLabel: Record<JobStatus, string> = { QUEUED: "Queued", RUNNING: "Analyzing", COMPLETED: "Complete", FAILED: "Failed" }
export function JobBadge({ status }: { status: JobStatus }) {
  return <Status tone={jobTone[status]}>{jobLabel[status]}</Status>
}

export const approvalLabel: Record<ApprovalStatus, string> = { NONE: "Not submitted", PENDING: "Pending approval", APPROVED: "Approved", DENIED: "Denied" }
export const approvalTone: Record<ApprovalStatus, Tone> = { NONE: "neutral", PENDING: "blue", APPROVED: "good", DENIED: "bad" }
export function ApprovalBadge({ status }: { status: ApprovalStatus }) {
  return <Status tone={approvalTone[status]}>{approvalLabel[status]}</Status>
}

/** Provenance label for knowledge sources; deliberately distinct from status dots. */
export function Kind({ type, children }: { type: "Authoritative" | "Faculty Example"; children?: ReactNode }) {
  return (
    <span className={`kind ${type === "Authoritative" ? "authoritative" : "faculty"}`}>
      <i aria-hidden="true">{type === "Authoritative" ? "A" : "F"}</i>
      {children ?? (type === "Authoritative" ? "Authoritative" : "Faculty example")}
    </span>
  )
}

export function EmptyState({ icon = "file", title, children, action }: { icon?: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-icon"><Icon name={icon} size={20} /></span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  )
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null
  return (
    <div className="error-note" role="alert">
      <Icon name="alert" size={16} />
      <span>{children}</span>
    </div>
  )
}

export function fmtDate(iso?: string) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}
export function fmtDateTime(iso?: string) {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
}
export function initials(name: string) {
  return name.replace(/^Dr\.\s*/, "").split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase()
}
export const errorText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Try again.")
export const versionSourceLabel = { UPLOAD: "Original upload", COMPETENCY: "Competency review", MODERNIZATION: "AI modernization" } as const
