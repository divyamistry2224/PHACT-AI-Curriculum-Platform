import type {
  AdminSubmission,
  DecisionNotification,
  Feedback,
  HunkDecision,
  SubmissionSummary,
  AdminSyllabusSummary,
  ApprovalStatus,
  CompetencyResults,
  KnowledgeBase,
  ModernizationResults,
  QueueItem,
  QueueStatus,
  Review,
  ReviewSummary,
  ReviewType,
  Role,
  SyllabusDetail,
  SyllabusSummary,
  User,
  VersionEntry,
} from "../types"
import { diffStats, lineDiff } from "../lib/diff"
import { assign, build, compose, type Piece } from "../lib/proposals"
import { CEPH_COMPETENCIES, MOCK_GRADES, SAMPLE_SYLLABUS } from "../mocks/fixtures/data"
import { ApiError, type PhactApi } from "./types"

/**
 * Mock adapter: simulates the PHACT backend in this browser so the UI can be developed without AWS.
 * It follows the same rules as the backend (one review at a time, keep or discard the newest version,
 * one pending submission, reasons required for denial) and persists to localStorage.
 */

const STORE_KEY = "phact-mock-v3"
const USER_KEY = "phact-mock-user"
const STAGE_MS = 1500
const STAGES = ["RETRIEVING_SOURCES", "ANALYZING", "REWRITING", "SAVING"] as const

const USERS: Record<Role, User> = {
  faculty: { userId: "mock-faculty", email: "faculty@phact.demo", name: "Dr. Maya Chen", role: "faculty" },
  admin: { userId: "mock-admin", email: "admin@phact.demo", name: "ASPPH Administrator", role: "admin" },
}

interface StoredSyllabus {
  summary: Omit<SyllabusSummary, "currentVersionSource" | "versionCount" | "reviewRunning">
  ownerId: string
  ownerEmail: string
  decidedByEmail?: string
  notification?: DecisionNotification
  versions: (VersionEntry & { text: string })[]
}
interface StoredReview {
  summary: ReviewSummary
  results?: CompetencyResults | ModernizationResults
  pieces?: Piece[]
}
interface Store {
  feedback?: Feedback[]
  summaries?: Record<string, SubmissionSummary>
  syllabi: Record<string, StoredSyllabus>
  reviews: Record<string, StoredReview>
  kbSyncs: Record<string, { startedAt: string }>
}

const now = () => new Date().toISOString()
const id = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`)
const delay = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms))

function load(): Store {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) return JSON.parse(raw) as Store
  } catch {
    /* fall through to an empty store */
  }
  return { syllabi: {}, reviews: {}, kbSyncs: {} }
}
let store = load()
const save = () => {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)) } catch { /* storage unavailable */ }
}

function currentUser(): User | null {
  try {
    const role = localStorage.getItem(USER_KEY) as Role | null
    return role ? USERS[role] : null
  } catch {
    return null
  }
}
function requireUser(role?: Role): User {
  const user = currentUser()
  if (!user) throw new ApiError("Sign in to continue.", 401, "UNAUTHORIZED")
  if (role === "admin" && user.role !== "admin") throw new ApiError("This page is only available to ASPPH administrators.", 403, "FORBIDDEN")
  return user
}

function summary(s: StoredSyllabus): SyllabusSummary {
  const current = s.versions.find((v) => v.n === s.summary.currentVersion)
  return { ...s.summary, currentVersionSource: current?.source || "UPLOAD", versionCount: s.versions.length, reviewRunning: Boolean(s.summary.activeReviewId) }
}
function detail(s: StoredSyllabus): SyllabusDetail {
  return { ...summary(s), versions: s.versions.map(({ text: _text, ...entry }) => entry) }
}
function adminSummary(s: StoredSyllabus): AdminSyllabusSummary {
  return { ...summary(s), ownerEmail: s.ownerEmail, decidedByEmail: s.decidedByEmail, notification: s.notification && s.notification.decision === s.summary.approvalStatus ? s.notification : null }
}
function owned(syllabusId: string): StoredSyllabus {
  const user = requireUser()
  const s = store.syllabi[syllabusId]
  if (!s || s.ownerId !== user.userId) throw new ApiError("Syllabus not found.", 404, "NOT_FOUND")
  return s
}

// ---------------------------------------------------------------- simulated review output

type Proposed<T> = { results: Omit<T, "diff" | "hunks" | "otherHunkIds">; revised: string; excerpts: string[][] }

function competencyOutput(text: string): Proposed<CompetencyResults> {
  const competencies = CEPH_COMPETENCIES.map((c) => {
    const status = MOCK_GRADES[c.number] || "NOT_ADDRESSED"
    return {
      code: `D2-${c.number}`, number: c.number, domain: c.domain, statement: c.statement, cephInterpretation: c.interpretation, status,
      evidence: status === "NOT_ADDRESSED" ? "" : "Course schedule and assignments (mock evidence)",
      rationale: status === "ADDRESSED" ? "Students practice and are assessed on this competency (mock)." : status === "PARTIAL" ? "Introduced, but not assessed in a way CEPH requires (mock)." : "Not covered by this course (mock).",
    }
  })
  const coverage = {
    addressed: competencies.filter((c) => c.status === "ADDRESSED").length,
    partial: competencies.filter((c) => c.status === "PARTIAL").length,
    notAddressed: competencies.filter((c) => c.status === "NOT_ADDRESSED").length,
    total: competencies.length,
  }
  const changes = [
    { section: "Learning outcomes", change: "Added a community briefing where teams present findings to a non-academic audience.", reason: "Strengthens CEPH 19 (communication).", competencyCodes: ["D2-19"], hunkIds: [] as string[] },
    { section: "Assignments", change: "Added a short equity reflection tied to the surveillance project.", reason: "Moves CEPH 6 from partial to addressed.", competencyCodes: ["D2-6"], hunkIds: [] as string[] },
  ]
  const revised = `${text}\n\n## Community briefing (added by competency review)\nTeams present their surveillance findings to a mock community advisory board and answer questions in plain language.\n\n## Equity reflection (added by competency review)\nA 2-page reflection on how structural factors shaped the disease patterns in your project data.`
  return { results: { coverage, competencies, changes }, revised, excerpts: [["Teams present their surveillance findings to a mock community advisory board"], ["A 2-page reflection on how structural factors shaped the disease patterns"]] }
}

function modernizationOutput(text: string): Proposed<ModernizationResults> {
  const recommendations: ModernizationResults["recommendations"] = [
    { title: "Audit AI-drafted analysis code", category: "TEACHING_METHODS", approach: "INTEGRATE_AI", target: "Weekly problem sets", recommendation: "Students ask an AI assistant to draft R code for one problem set, then document every error they find and fix.", rationale: "Builds verification habits instead of banning tools students will use in practice.", peerExamples: [{ title: "BIOS 622: Applied Biostatistics and Data Visualization", institution: "Cascadia Pacific University", snippet: "Students submit an annotated log of AI-suggested code and corrections. (mock excerpt)" }], hunkIds: [] },
    { title: "Oral defense of the surveillance brief", category: "ASSESSMENT_TOOLS", approach: "AI_RESISTANT", target: "Final project", recommendation: "Add a 10-minute oral defense where each student explains one design decision in their team's brief.", rationale: "Confirms individual understanding regardless of how the written brief was produced.", peerExamples: [], hunkIds: [] },
    { title: "AI and bias in surveillance data", category: "CONTENT_ENHANCEMENT", approach: "INTEGRATE_AI", target: "Health equity module", recommendation: "Add a case discussion on how algorithmic tools can amplify gaps in surveillance data.", rationale: "Connects AI literacy to the course's equity content.", peerExamples: [], hunkIds: [] },
  ]
  const revised = `${text}\n\n## Responsible AI use (added by AI modernization review)\nYou may use AI assistants for drafting code. Keep a log of prompts and every correction you make; the log is part of your grade.\n\n## Oral defense (added by AI modernization review)\nEach student defends one design decision from the final brief in a 10-minute conversation with the instructor.`
  return { results: { recommendations, peerExamplesAvailable: 4 }, revised, excerpts: [["Keep a log of prompts and every correction you make"], ["Each student defends one design decision from the final brief"], []] }
}

/** Advance a running review based on elapsed time; when it finishes, add its version to the syllabus. */
function advance(r: StoredReview) {
  const s = r.summary
  if (s.jobStatus !== "QUEUED" && s.jobStatus !== "RUNNING") return
  const elapsed = Date.now() - new Date(s.createdAt).getTime()
  const step = Math.floor(elapsed / STAGE_MS)
  if (step < 1) return
  s.jobStatus = "RUNNING"
  s.startedAt ||= new Date(new Date(s.createdAt).getTime() + STAGE_MS).toISOString()
  if (step <= STAGES.length) {
    s.stage = STAGES[step - 1]
    return
  }
  const syllabus = store.syllabi[s.syllabusId]
  const input = syllabus?.versions.find((v) => v.n === s.inputVersion)
  if (!syllabus || !input) {
    Object.assign(s, { jobStatus: "FAILED", errorMessage: "The version this review was based on is no longer available.", completedAt: now() })
    return
  }
  const proposed = s.reviewType === "COMPETENCY" ? competencyOutput(input.text) : modernizationOutput(input.text)
  const diff = lineDiff(input.text, proposed.revised)
  const { pieces, hunks } = build(diff)
  const { perItem, unclaimed } = assign(hunks, proposed.excerpts)
  const items = s.reviewType === "COMPETENCY" ? (proposed.results as CompetencyResults).changes : (proposed.results as ModernizationResults).recommendations
  items.forEach((item, i) => { item.hunkIds = perItem[i] || [] })
  delete syllabus.summary.activeReviewId
  syllabus.summary.pendingReviewId = s.reviewId
  syllabus.summary.updatedAt = now()
  const totals = s.reviewType === "COMPETENCY"
    ? { ...(proposed.results as CompetencyResults).coverage }
    : (() => { const recs = (proposed.results as ModernizationResults).recommendations; return { recommendations: recs.length, integrateAi: recs.filter((x) => x.approach === "INTEGRATE_AI").length, aiResistant: recs.filter((x) => x.approach === "AI_RESISTANT").length, peerExamplesCited: recs.reduce((n, x) => n + x.peerExamples.length, 0) } })()
  r.results = { ...proposed.results, diff, hunks, otherHunkIds: unclaimed } as CompetencyResults | ModernizationResults
  r.pieces = pieces
  Object.assign(s, { jobStatus: "COMPLETED", summary: { ...totals, ...diffStats(diff), suggestions: items.length + (unclaimed.length ? 1 : 0), changes: hunks.length }, completedAt: now() })
  delete s.stage
}

function advanceAll() {
  Object.values(store.reviews).forEach(advance)
  save()
}

function queueItem(s: StoredSyllabus): QueueItem {
  const x = s.summary
  return { syllabusId: x.syllabusId, title: x.title, subject: x.subject, institution: x.institution, ownerEmail: s.ownerEmail, approvalStatus: x.approvalStatus as QueueStatus, submittedVersion: x.submittedVersion || 1, submittedAt: x.submittedAt || x.createdAt, decidedAt: x.decidedAt, decidedByEmail: s.decidedByEmail, denyReason: x.denyReason, approvedVersion: x.approvedVersion }
}

function decide(syllabusId: string, status: ApprovalStatus, fields: Partial<SyllabusSummary>): AdminSyllabusSummary {
  const admin = requireUser("admin")
  const s = store.syllabi[syllabusId]
  if (!s || !s.summary.submittedVersion) throw new ApiError("Submission not found.", 404, "NOT_FOUND")
  if (s.summary.approvalStatus !== "PENDING") throw new ApiError("This submission isn't waiting for approval. Refresh the queue.", 409, "NOT_PENDING")
  Object.assign(s.summary, { approvalStatus: status, decidedAt: now(), updatedAt: now(), ...fields })
  s.decidedByEmail = admin.email
  s.notification = { channel: "EMAIL", status: "NOT_SENT", to: s.ownerEmail, decision: status as "APPROVED" | "DENIED", version: s.summary.submittedVersion, at: now(), detail: "Mock mode doesn't send email." }
  save()
  return adminSummary(s)
}

export function createMockApi(): PhactApi {
  return {
    mode: "mock",
    currentUser,
    async signIn(email) {
      await delay()
      const role: Role = email.toLowerCase().startsWith("admin") ? "admin" : "faculty"
      localStorage.setItem(USER_KEY, role)
      return USERS[role]
    },
    signOut: () => localStorage.removeItem(USER_KEY),
    async switchRole(role) {
      localStorage.setItem(USER_KEY, role)
      return USERS[role]
    },

    async uploadSyllabus(input, onProgress) {
      const user = requireUser()
      for (const pct of [20, 55, 90]) { onProgress?.(pct); await delay(150) }
      const text = input.text?.trim() || `# ${input.title}\n\n(Mock mode: file "${input.file?.name}" isn't read in the browser. The live backend extracts the real text.)\n\n${SAMPLE_SYLLABUS}`
      const syllabusId = id()
      const created = now()
      store.syllabi[syllabusId] = {
        ownerId: user.userId, ownerEmail: user.email,
        summary: { syllabusId, title: input.title, subject: input.subject, institution: input.institution, description: input.description, sourceType: input.file ? (input.file.name.toLowerCase().endsWith(".docx") ? "DOCX" : "PDF") : "PASTE", currentVersion: 1, approvalStatus: "NONE", createdAt: created, updatedAt: created, expiresAt: new Date(Date.now() + 180 * 86400_000).toISOString() },
        versions: [{ n: 1, source: "UPLOAD", createdAt: created, text }],
      }
      save()
      onProgress?.(100)
      return { syllabus: detail(store.syllabi[syllabusId]), extractedText: text }
    },
    async listSyllabi() {
      const user = requireUser()
      advanceAll()
      await delay(120)
      return Object.values(store.syllabi).filter((s) => s.ownerId === user.userId).map(summary).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },
    async getSyllabus(syllabusId) {
      advanceAll()
      const s = owned(syllabusId)
      await delay(120)
      const reviews = Object.values(store.reviews).map((r) => r.summary).filter((r) => r.syllabusId === syllabusId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      return { syllabus: detail(s), reviews }
    },
    async getVersion(syllabusId, n) {
      const s = owned(syllabusId)
      const v = s.versions.find((x) => x.n === n)
      if (!v) throw new ApiError(`Version ${n} doesn't exist.`, 404, "NOT_FOUND")
      return { syllabusId, version: n, source: v.source, reviewId: v.reviewId, createdAt: v.createdAt, isCurrent: n === s.summary.currentVersion, text: v.text }
    },
    async startReview(syllabusId, reviewType: ReviewType, guidance?: string) {
      advanceAll()
      const s = owned(syllabusId)
      if (s.summary.pendingReviewId) throw new ApiError("Accept or decline the open suggestions on this syllabus before running another review.", 409, "DECISION_PENDING")
      if (s.summary.activeReviewId) throw new ApiError("A review is already running on this syllabus. Wait for it to finish, then try again.", 409, "REVIEW_RUNNING")
      const reviewId = id()
      const review: ReviewSummary = { reviewId, syllabusId, reviewType, jobStatus: "QUEUED", inputVersion: s.summary.currentVersion, createdAt: now(), ...(guidance?.trim() ? { guidance: guidance.trim().slice(0, 1000) } : {}) }
      store.reviews[reviewId] = { summary: review }
      s.summary.activeReviewId = reviewId
      save()
      return { ...review }
    },
    async getReview(reviewId) {
      advanceAll()
      const r = store.reviews[reviewId]
      if (!r) throw new ApiError("Review not found.", 404, "NOT_FOUND")
      owned(r.summary.syllabusId)
      await delay(80)
      return { ...r.summary, ...(r.summary.jobStatus === "COMPLETED" && r.results ? { results: r.results } : {}) } as Review
    },
    async decideReview(reviewId, decisions: HunkDecision[]) {
      const r = store.reviews[reviewId]
      if (!r || !r.results || !r.pieces) throw new ApiError("Review not found.", 404, "NOT_FOUND")
      const s = owned(r.summary.syllabusId)
      if (r.summary.decidedAt) throw new ApiError("These suggestions were already decided.", 409, "NOT_PENDING")
      if (s.summary.pendingReviewId !== reviewId || s.summary.currentVersion !== r.summary.inputVersion) throw new ApiError("The syllabus changed since these suggestions were made. Run the review again.", 409, "STALE")
      const hunks = Object.fromEntries(r.results.hunks.map((h) => [h.id, h]))
      const accepted: Record<string, string> = {}
      for (const d of decisions) if (d.accept) accepted[d.hunkId] = d.text ?? hunks[d.hunkId].after
      const edited = Object.keys(accepted).filter((id) => accepted[id] !== hunks[id].after)
      const items: { title: string; reason: string; hunkIds: string[] }[] = r.summary.reviewType === "COMPETENCY"
        ? (r.results as CompetencyResults).changes.map((c) => ({ title: c.change, reason: c.reason, hunkIds: c.hunkIds }))
        : (r.results as ModernizationResults).recommendations.map((x) => ({ title: x.title, reason: x.rationale, hunkIds: x.hunkIds }))
      if (r.results.otherHunkIds.length) items.push({ title: "Other edits", reason: "", hunkIds: r.results.otherHunkIds })
      const groups = items.filter((g) => g.hunkIds.length)
      const acceptedGroups = groups.filter((g) => g.hunkIds.some((id) => id in accepted)).map((g) => ({ title: g.title, reason: g.reason, edited: g.hunkIds.some((id) => edited.includes(id)) }))
      const input = s.versions.find((v) => v.n === r.summary.inputVersion)!
      if (Object.keys(accepted).length) {
        const out = r.summary.inputVersion + 1
        const text = compose(r.pieces, hunks, accepted)
        s.versions.push({ n: out, source: r.summary.reviewType, reviewId, createdAt: now(), text: input ? text : text })
        s.summary.currentVersion = out
        r.summary.outputVersion = out
      }
      delete s.summary.pendingReviewId
      s.summary.updatedAt = now()
      Object.assign(r.summary, {
        decidedAt: now(),
        decision: { changesAccepted: Object.keys(accepted).length, changesDeclined: r.results.hunks.length - Object.keys(accepted).length, changesEdited: edited.length, suggestionsAccepted: acceptedGroups.length, suggestionsDeclined: groups.length - acceptedGroups.length },
        acceptedHunks: Object.keys(accepted).map((hunkId) => ({ hunkId, edited: edited.includes(hunkId) })),
        acceptedSuggestions: acceptedGroups,
      })
      save()
      return { syllabus: summary(s), review: { ...r.summary } }
    },
    async undoReview(reviewId) {
      const r = store.reviews[reviewId]
      if (!r) throw new ApiError("Review not found.", 404, "NOT_FOUND")
      const s = owned(r.summary.syllabusId)
      const out = r.summary.outputVersion
      if (r.summary.jobStatus !== "COMPLETED" || r.summary.undoneAt) throw new ApiError("Only a completed review that hasn't already been undone can be undone.", 409, "NOT_UNDOABLE")
      if (r.summary.outputVersion === undefined) throw new ApiError("This review didn't create a version, so there's nothing to undo.", 409, "NOT_UNDOABLE")
      if (s.summary.currentVersion !== out || s.summary.activeReviewId) throw new ApiError("Only the most recent review can be undone.", 409, "NOT_LATEST")
      if (s.summary.approvalStatus === "PENDING" && s.summary.submittedVersion === out) throw new ApiError("This version is waiting for admin approval, so it can't be undone.", 409, "SUBMITTED")
      if (s.summary.approvedVersion === out) throw new ApiError("This version was approved into the shared library, so it can't be undone.", 409, "APPROVED")
      s.versions = s.versions.filter((v) => v.n !== out)
      s.summary.currentVersion = r.summary.inputVersion
      s.summary.updatedAt = now()
      r.summary.undoneAt = now()
      save()
      return summary(s)
    },
    async submitSyllabus(syllabusId) {
      const s = owned(syllabusId)
      const v = s.summary.currentVersion
      if (s.summary.approvalStatus === "PENDING") throw new ApiError("This syllabus is already waiting for admin approval.", 409, "ALREADY_SUBMITTED")
      if (s.summary.approvalStatus === "APPROVED" && s.summary.approvedVersion === v) throw new ApiError(`Version ${v} is already approved. Run a review to create a newer version first.`, 409, "ALREADY_APPROVED")
      if (s.summary.activeReviewId) throw new ApiError("A review is running or just finished. Wait for it, then submit again.", 409, "REVIEW_RUNNING")
      Object.assign(s.summary, { approvalStatus: "PENDING", submittedVersion: v, submittedAt: now(), updatedAt: now() })
      delete s.summary.denyReason
      delete s.summary.decidedAt
      delete s.decidedByEmail
      save()
      return summary(s)
    },

    async submitFeedback(input) {
      const user = requireUser()
      const s = owned(input.syllabusId)
      if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) throw new ApiError("rating must be a whole number from 1 to 5.", 400, "BAD_REQUEST")
      const item: Feedback = { feedbackId: id(), syllabusId: s.summary.syllabusId, syllabusTitle: s.summary.title, version: input.version || s.summary.currentVersion, rating: input.rating, comment: input.comment, ownerEmail: user.email, createdAt: now() }
      store.feedback = [item, ...(store.feedback || [])]
      save()
      return item
    },
    async listFeedback() {
      requireUser("admin")
      const items = store.feedback || []
      return { items, count: items.length, averageRating: items.length ? Math.round((items.reduce((n, f) => n + f.rating, 0) / items.length) * 100) / 100 : null }
    },

    async listQueue(status) {
      requireUser("admin")
      await delay(120)
      const items = Object.values(store.syllabi).filter((s) => s.summary.submittedVersion && s.summary.approvalStatus === status).map(queueItem)
      return items.sort((a, b) => (status === "PENDING" ? a.submittedAt.localeCompare(b.submittedAt) : b.submittedAt.localeCompare(a.submittedAt)))
    },
    async getSubmission(syllabusId): Promise<AdminSubmission> {
      requireUser("admin")
      const s = store.syllabi[syllabusId]
      if (!s || !s.summary.submittedVersion) throw new ApiError("Submission not found.", 404, "NOT_FOUND")
      const version = s.summary.submittedVersion
      const text = s.versions.find((v) => v.n === version)?.text || ""
      const diff = lineDiff(s.versions[0]?.text || "", text)
      const reviews = Object.values(store.reviews).map((r) => r.summary).filter((r) => r.syllabusId === syllabusId && r.jobStatus === "COMPLETED" && !r.undoneAt)
      const cached = store.summaries?.[syllabusId]
      return { syllabus: adminSummary(s), summary: cached && cached.version === version ? cached : null, version, text, diff, diffStats: diffStats(diff), reviews: reviews.filter((r) => r.outputVersion) }
    },
    async approveSubmission(syllabusId, note) {
      const s = store.syllabi[syllabusId]
      const version = s?.summary.submittedVersion
      const result = decide(syllabusId, "APPROVED", { approvedVersion: version, approvedAt: now(), approvalNote: note || undefined, denyReason: undefined })
      store.kbSyncs.APPROVED_SYLLABI = { startedAt: now() }
      save()
      return result
    },
    async rejectSubmission(syllabusId, reason) {
      if (!reason.trim()) throw new ApiError("reason is required.", 400, "BAD_REQUEST")
      return decide(syllabusId, "DENIED", { denyReason: reason.trim() })
    },
    async summarizeSubmission(syllabusId) {
      requireUser("admin")
      const s = store.syllabi[syllabusId]
      if (!s || !s.summary.submittedVersion) throw new ApiError("Submission not found.", 404, "NOT_FOUND")
      await delay(1200)
      const reviews = Object.values(store.reviews).map((r) => r.summary).filter((r) => r.syllabusId === syllabusId && r.outputVersion && !r.undoneAt)
      const accepted = reviews.flatMap((r) => r.acceptedSuggestions || [])
      const text = accepted.length
        ? `Mock summary: the faculty member accepted ${accepted.length} suggestion${accepted.length === 1 ? "" : "s"}, including ${accepted.slice(0, 2).map((a) => a.title.toLowerCase()).join(" and ")}. The live service writes this paragraph with AI from the recorded decisions.`
        : "The faculty member submitted the syllabus as uploaded. No PHACT review changes were applied."
      const result = { text, version: s.summary.submittedVersion, generatedAt: now() }
      store.summaries = { ...(store.summaries || {}), [syllabusId]: result }
      save()
      return { ...result, cached: false }
    },
    async listKnowledgeBases(): Promise<KnowledgeBase[]> {
      requireUser("admin")
      await delay(120)
      const approved = Object.values(store.syllabi).filter((s) => s.summary.approvedVersion).length
      const job = (kb: string, docs: number) => {
        const started = store.kbSyncs[kb]?.startedAt
        if (!started) return { ingestionJobId: `mock-${kb}`, status: "COMPLETE" as const, startedAt: "2026-11-04T16:39:57Z", updatedAt: "2026-11-04T16:41:02Z", documentsScanned: docs, documentsIndexed: docs, documentsDeleted: 0, documentsFailed: 0 }
        const running = Date.now() - new Date(started).getTime() < 8000
        return { ingestionJobId: `mock-${kb}-${started}`, status: running ? ("IN_PROGRESS" as const) : ("COMPLETE" as const), startedAt: started, updatedAt: now(), documentsScanned: docs, documentsIndexed: running ? 0 : 1, documentsDeleted: 0, documentsFailed: 0 }
      }
      return [
        { kb: "CEPH", name: "CEPH competencies (KB1)", knowledgeBaseId: "MOCKKB1", fileCount: 22, lastSync: job("CEPH", 22) },
        { kb: "APPROVED_SYLLABI", name: "Approved syllabi (KB2)", knowledgeBaseId: "MOCKKB2", fileCount: 4 + approved, lastSync: job("APPROVED_SYLLABI", 4 + approved) },
      ]
    },
    async syncKnowledgeBase(kb) {
      requireUser("admin")
      const started = store.kbSyncs[kb]?.startedAt
      if (started && Date.now() - new Date(started).getTime() < 8000) throw new ApiError("A sync is already running for this knowledge base. Check back in a minute.", 409, "SYNC_RUNNING")
      store.kbSyncs[kb] = { startedAt: now() }
      save()
      return { kb, ingestionJobId: `mock-${kb}-${Date.now()}`, status: "STARTING" }
    },
  }
}
