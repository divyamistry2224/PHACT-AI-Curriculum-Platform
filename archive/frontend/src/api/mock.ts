/**
 * Mock PHACT API. Every function mirrors a planned API Gateway + FastAPI endpoint,
 * so this module can be swapped for real HTTP calls without changing the UI.
 * No AWS credentials or privileged operations ever run in the browser.
 */
import {
  competencyMappings,
  demoUsers,
  recommendationTemplates,
  seedContributions,
  seedJobs,
  seedRecommendations,
  seedSources,
  seedSyllabi,
} from "../mocks/fixtures/data"
import type {
  ActivityItem,
  AdminReviewDecision,
  AnalysisJob,
  CompetencyMapping,
  DashboardData,
  FacultySettings,
  FacultyUser,
  HistoryRow,
  KnowledgeSource,
  Recommendation,
  ReviewStatus,
  Role,
  SharedContribution,
  Syllabus,
  SyllabusSection,
  SyllabusVersion,
  SyllabusWorkflow,
  ReviewSubmission,
  SyncStatus,
} from "../types"
import type { FacultyNotification, PhactApi, RecommendationDecisionInput } from "./types"

export const ANALYSIS_STAGES = [
  "Syllabus Uploaded",
  "Content Extraction",
  "Privacy and Safety Checks",
  "Retrieving Curriculum Standards",
  "Retrieving Approved Faculty Examples",
  "Generating Recommendations",
  "Mapping Competencies",
  "Analysis Complete",
]

const STAGE_MS = 850
const DB_KEY = "phact-v3-db"
const SESSION_KEY = "phact-v2-session"
const SETTINGS_KEY = "phact-v2-settings"

// Clear storage from the retired AI preference features.
for (const key of [
  "phact-prefs",
  "phact-analysis-settings",
  "phact-recommendations",
  "phact-contributions",
  "phact-auth",
  "phact-role",
]) localStorage.removeItem(key)

interface Db {
  version: 3
  syllabi: Syllabus[]
  jobs: AnalysisJob[]
  recommendations: Recommendation[]
  contributions: SharedContribution[]
  sources: KnowledgeSource[]
  sync: SyncStatus
  versions: SyllabusVersion[]
  submissions: ReviewSubmission[]
  decisions: AdminReviewDecision[]
  confirmedMappings: Record<string, string[]>
  notifications: FacultyNotification[]
}

const clone = <T>(value: T): T => structuredClone(value)
const now = () => new Date().toISOString()
const uid = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

function seed(): Db {
  return {
    version: 3,
    syllabi: clone(seedSyllabi),
    jobs: clone(seedJobs),
    recommendations: clone(seedRecommendations),
    contributions: clone(seedContributions),
    sources: clone(seedSources),
    sync: { state: "COMPLETED", completedAt: "2025-02-25T13:14:00Z" },
    versions: [],
    submissions: [],
    decisions: [],
    confirmedMappings: {},
    notifications: [],
  }
}

function load(): Db {
  try {
    const db = JSON.parse(localStorage.getItem(DB_KEY) || "") as Db
    if (db.version === 3) return { ...db, notifications: db.notifications || [] }
  } catch {
    /* fall through to seed */
  }
  const db = seed()
  save(db)
  return db
}

function save(db: Db) {
  localStorage.setItem(DB_KEY, JSON.stringify(db))
}

function mutate<T>(fn: (db: Db) => T): Promise<T> {
  const db = load()
  try {
    const result = fn(db)
    save(db)
    return Promise.resolve(clone(result))
  } catch (error) {
    return Promise.reject(error)
  }
}

function advanceJob(db: Db, job: AnalysisJob) {
  const syllabus = db.syllabi.find((s) => s.id === job.syllabusId)
  if (job.status === "QUEUED" && Date.now() - Date.parse(job.createdAt) > 500) {
    job.status = "RUNNING"
    job.startedAt = now()
    job.progressStep = 1
  }
  if (job.status !== "RUNNING" || !job.startedAt) return
  const step = Math.min(
    8,
    1 + Math.floor((Date.now() - Date.parse(job.startedAt)) / STAGE_MS),
  )
  job.updatedAt = now()
  if (job.simulateFailure && step >= 3) {
    job.status = "FAILED"
    job.progressStep = 2
    job.error =
      "Privacy and safety checks could not be completed. Your syllabus remains private and nothing was shared. Retry the analysis."
    if (syllabus) syllabus.status = "FAILED"
    return
  }
  job.progressStep = step
  if (step < 8) return
  job.status = "COMPLETED"
  job.completedAt = now()
  if (!syllabus) return
  syllabus.status = "ANALYZED"
  if (db.recommendations.some((r) => r.jobId === job.id)) return
  const at = now()
  for (const t of recommendationTemplates(syllabus.courseName)) {
    db.recommendations.push({
      ...t,
      id: uid("rec"),
      jobId: job.id,
      syllabusId: syllabus.id,
      status: "DRAFT",
      updatedAt: at,
      history: [
        {
          id: uid("evt"),
          action: "GENERATED",
          actor: "PHACT analysis",
          at,
          note: "Draft created from retrieved sources.",
        },
      ],
    })
  }
}

function advanceSync(db: Db) {
  const s = db.sync
  if (!s.requestedAt || s.state === "COMPLETED" || s.state === "IDLE") return
  const elapsed = Date.now() - Date.parse(s.requestedAt)
  if (s.state === "REQUESTED" && elapsed > 900) s.state = "IN_PROGRESS"
  if (s.state !== "IN_PROGRESS" || elapsed <= 2800) return
  s.state = "COMPLETED"
  s.completedAt = now()
  for (const source of db.sources) {
    if (source.ingestionStatus === "PENDING" || source.ingestionStatus === "INDEXING")
      source.ingestionStatus = "INDEXED"
  }
  for (const c of db.contributions) {
    if (c.moderationStatus !== "INDEXING") continue
    c.moderationStatus = "PUBLISHED"
    c.publishedAt = now()
    db.sources.push({
      id: `k-${c.id}`,
      title: c.title,
      sourceType: "Faculty Example",
      category: "Community contribution",
      s3Key: `s3://phact-context/community/${c.id}.json`,
      version: "1.0",
      approvalStatus: "PUBLISHED",
      ingestionStatus: "INDEXED",
      updatedAt: now().slice(0, 10),
      publisher: `${c.submittedBy}, moderated by ASPPH`,
      summary: c.description,
      competencies: [c.courseSubject],
      body: c.description,
    })
  }
}

function historyRows(db: Db, facultyId: string): HistoryRow[] {
  return db.jobs
    .filter((j) => j.facultyId === facultyId)
    .map((job) => {
      advanceJob(db, job)
      const s = db.syllabi.find((x) => x.id === job.syllabusId)!
      const recs = db.recommendations.filter((r) => r.jobId === job.id)
      const lastModified = [job.updatedAt, ...recs.map((r) => r.updatedAt)].sort().reverse()[0]
      return {
        jobId: job.id,
        syllabusId: s.id,
        courseName: s.courseName,
        subject: s.subject,
        uploadedAt: job.createdAt,
        status: job.status,
        recommendationCount: recs.length,
        drafts: recs.filter((r) => r.status === "DRAFT").length,
        approved: recs.filter((r) => r.status === "APPROVED").length,
        rejected: recs.filter((r) => r.status === "REJECTED").length,
        lastModified,
      }
    })
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
}

function readSettings(user: FacultyUser): FacultySettings {
  const fallback: FacultySettings = {
    displayName: user.displayName,
    institution: user.institution,
    title: user.title,
    notifyAnalysis: true,
    notifyModeration: true,
    shareReminder: true,
  }
  try {
    const all = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}")
    return { ...fallback, ...(all[user.id] || {}) }
  } catch {
    return fallback
  }
}

function withSettings(user: FacultyUser): FacultyUser {
  const s = readSettings(user)
  return { ...user, displayName: s.displayName, institution: s.institution, title: s.title }
}

function requestSyncOn(db: Db) {
  if (db.sync.state === "REQUESTED" || db.sync.state === "IN_PROGRESS") return
  db.sync = { state: "REQUESTED", requestedAt: now(), completedAt: db.sync.completedAt }
}

function syllabusSections(
  syllabus: Syllabus,
  recommendations: Recommendation[],
  mappings: CompetencyMapping[],
): SyllabusSection[] {
  const accepted = recommendations.filter((r) => r.status === "APPROVED")
  const mappingText = mappings.length
    ? mappings.map((m) => `${m.competency}: ${m.improvement}`).join("\n")
    : "No competency mappings have been confirmed yet."
  const activities = accepted.length
    ? accepted.map((r) => `${r.title}\n${r.description}`).join("\n\n")
    : "No faculty-approved AI curriculum recommendations have been incorporated."
  return [
    { id: "course-information", title: "Course information", content: `${syllabus.courseName}\n${syllabus.subject}\n\nFaculty-owned syllabus revision`, order: 1 },
    { id: "description", title: "Course description", content: syllabus.description || "Course description to be completed by faculty.", order: 2 },
    { id: "objectives", title: "Learning objectives", content: "Students will apply public health concepts, evaluate evidence, and communicate defensible conclusions.", order: 3 },
    { id: "activities", title: "Recommended learning activities", content: activities, order: 4 },
    { id: "competencies", title: "Competency alignment", content: mappingText, order: 5 },
    { id: "schedule", title: "Schedule", content: "Week 1: Foundations\nWeeks 2-6: Applied public health practice\nFinal week: Synthesis and reflection", order: 6 },
    { id: "assessment", title: "Assessment methods and grading policies", content: "Assessment methods, grading weights, deadlines, prerequisites, and institutional policies remain faculty-controlled. Review and confirm these details before submission.\n\nOriginal source context:\n" + syllabus.extractedText.slice(0, 700), order: 7 },
    { id: "materials", title: "Required materials and academic policies", content: "Required materials and academic policies should be confirmed against the original syllabus before submission.", order: 8 },
  ]
}

function workflowFor(db: Db, syllabus: Syllabus): SyllabusWorkflow {
  return {
    syllabus: clone(syllabus),
    versions: clone(db.versions.filter((v) => v.syllabusId === syllabus.id).sort((a, b) => b.versionNumber - a.versionNumber)),
    submissions: clone(db.submissions.filter((s) => s.syllabusId === syllabus.id).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))),
    decisions: clone(db.decisions.filter((d) => db.submissions.find((s) => s.id === d.submissionId)?.syllabusId === syllabus.id).sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt))),
  }
}

export const api: PhactApi = {
  // Authentication (Amazon Cognito in production)
  currentUser(): FacultyUser | null {
    const id = localStorage.getItem(SESSION_KEY)
    const user = demoUsers.find((u) => u.id === id)
    return user ? withSettings(user) : null
  },
  async signIn(email: string): Promise<FacultyUser> {
    const user = demoUsers.find((u) => u.email === email.trim().toLowerCase())
    if (!user) throw new Error("No demo account uses that email. Choose a demo account below.")
    localStorage.setItem(SESSION_KEY, user.id)
    return withSettings(user)
  },
  async switchRole(role: Role): Promise<FacultyUser> {
    const user = demoUsers.find((u) => u.role === role)!
    localStorage.setItem(SESSION_KEY, user.id)
    return withSettings(user)
  },
  signOut() {
    localStorage.removeItem(SESSION_KEY)
  },

  // Dashboard and history
  getDashboard(user: FacultyUser): Promise<DashboardData> {
    return mutate((db) => {
      const rows = historyRows(db, user.id)
      const jobIds = new Set(rows.map((r) => r.jobId))
      const recs = db.recommendations.filter((r) => jobIds.has(r.jobId))
      const course = (r: Recommendation) =>
        db.syllabi.find((s) => s.id === r.syllabusId)?.courseName || "Course"
      advanceSync(db)
      const contributions = db.contributions.filter((c) => c.submittedById === user.id)
      const verbs: Record<string, string> = {
        EDITED: "Draft revision saved",
        APPROVED: "Recommendation approved",
        REJECTED: "Recommendation rejected",
        REOPENED: "Returned to draft",
      }
      const activity: ActivityItem[] = [
        ...recs.flatMap((r) =>
          r.history
            .filter((h) => h.action !== "GENERATED")
            .map((h) => ({ id: h.id, title: verbs[h.action], detail: `${r.title} · ${course(r)}`, at: h.at })),
        ),
        ...rows
          .filter((r) => r.status === "COMPLETED")
          .map((r) => ({ id: `a-${r.jobId}`, title: "Analysis completed", detail: r.courseName, at: r.uploadedAt })),
        ...contributions.map((c) => ({ id: `a-${c.id}`, title: "Submitted for community review", detail: c.title, at: c.submittedAt })),
      ]
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 3)
      return {
        stats: {
          syllabi: rows.filter((r) => r.status === "COMPLETED").length,
          recommendations: recs.length,
          pending: recs.filter((r) => r.status === "DRAFT").length,
          approved: recs.filter((r) => r.status === "APPROVED").length,
          shared: contributions.length,
        },
        history: rows.slice(0, 4),
        pending: recs
          .filter((r) => r.status === "DRAFT")
          .slice(0, 3)
          .map((r) => ({ ...r, courseName: course(r) })),
        contributions,
        activity,
      }
    })
  },
  listHistory(user: FacultyUser): Promise<HistoryRow[]> {
    return mutate((db) => historyRows(db, user.id))
  },

  // Private syllabus upload (presigned S3 PUT in production)
  async uploadSyllabus(
    user: FacultyUser,
    input: { file?: File; text?: string; courseName: string; subject: string; description: string },
    onProgress?: (percent: number) => void,
  ): Promise<Syllabus> {
    if (input.file) {
      // Emulates transfer progress events from the mock transport.
      for (const pct of [15, 38, 62, 84, 100]) {
        await new Promise((resolve) => setTimeout(resolve, 140))
        onProgress?.(pct)
      }
    } else onProgress?.(100)
    return mutate((db) => {
      const id = uid("syl")
      const fileName = input.file?.name.replace(/[^\w.-]+/g, "-")
      const text = input.text?.trim()
      const syllabus: Syllabus = {
        id,
        facultyId: user.id,
        courseName: input.courseName.trim(),
        subject: input.subject,
        description: input.description.trim(),
        s3Key: `private/${user.id}/${id}/${fileName || "pasted-syllabus.txt"}`,
        fileName: input.file?.name,
        source: input.file ? "pdf" : "text",
        extractedText:
          text ||
          `Course: ${input.courseName.trim()}. ${input.description.trim()} Module objectives, assignments, and policies appear here after server-side extraction.`,
        extractedIsIllustrative: !text,
        uploadedAt: now(),
        status: "UPLOADED",
      }
      db.syllabi.push(syllabus)
      return syllabus
    })
  },

  // Analysis jobs (asynchronous; the client polls status)
  createAnalysisJob(
    user: FacultyUser,
    syllabusId: string,
    options: { simulateFailure?: boolean } = {},
  ): Promise<AnalysisJob> {
    return mutate((db) => {
      const at = now()
      const job: AnalysisJob = {
        id: uid("job"),
        syllabusId,
        facultyId: user.id,
        status: "QUEUED",
        progressStep: 1,
        createdAt: at,
        updatedAt: at,
        simulateFailure: options.simulateFailure,
      }
      db.jobs.push(job)
      return job
    })
  },
  getAnalysis(
    jobId: string,
  ): Promise<{ job: AnalysisJob; syllabus: Syllabus; recommendations: Recommendation[] } | null> {
    return mutate((db) => {
      const job = db.jobs.find((j) => j.id === jobId)
      if (!job) return null
      advanceJob(db, job)
      return {
        job,
        syllabus: db.syllabi.find((s) => s.id === job.syllabusId)!,
        recommendations: db.recommendations.filter((r) => r.jobId === jobId),
      }
    })
  },
  retryJob(jobId: string): Promise<AnalysisJob> {
    return mutate((db) => {
      const job = db.jobs.find((j) => j.id === jobId)
      if (!job) throw new Error("Analysis not found")
      Object.assign(job, {
        status: "QUEUED",
        progressStep: 1,
        createdAt: now(),
        updatedAt: now(),
        startedAt: undefined,
        error: undefined,
        simulateFailure: false,
      })
      return job
    })
  },

  // Recommendations and review
  saveRecommendation(rec: Recommendation, actor: string): Promise<Recommendation> {
    return mutate((db) => {
      const target = db.recommendations.find((r) => r.id === rec.id)
      if (!target) throw new Error("Recommendation not found")
      if (target.status !== "DRAFT")
        throw new Error("Return this recommendation to draft before editing.")
      if (!rec.title.trim() || !rec.description.trim())
        throw new Error("Title and proposed activity are required.")
      Object.assign(target, {
        title: rec.title.trim(),
        description: rec.description.trim(),
        rationale: rec.rationale.trim(),
        implementationSteps: rec.implementationSteps.map((s) => s.trim()).filter(Boolean),
        learningOutcomes: rec.learningOutcomes.map((s) => s.trim()).filter(Boolean),
        responsibleAI: rec.responsibleAI.trim(),
        updatedAt: now(),
      })
      target.history.push({ id: uid("evt"), action: "EDITED", actor, at: now(), note: "Draft revision saved." })
      return target
    })
  },
  reviewRecommendation(
    id: string,
    status: Exclude<ReviewStatus, "DRAFT">,
    actor: string,
    note?: string,
  ): Promise<Recommendation> {
    return mutate((db) => {
      const target = db.recommendations.find((r) => r.id === id)
      if (!target) throw new Error("Recommendation not found")
      if (target.status !== "DRAFT") throw new Error("Only draft recommendations can be reviewed.")
      if (status === "APPROVED" && !target.citations.length)
        throw new Error("A recommendation needs a supporting source before approval.")
      const at = now()
      Object.assign(target, { status, reviewedBy: actor, reviewedAt: at, updatedAt: at })
      target.history.push({ id: uid("evt"), action: status, actor, at, note: note?.trim() || undefined })
      return target
    })
  },
  reopenRecommendation(id: string, actor: string): Promise<Recommendation> {
    return mutate((db) => {
      const target = db.recommendations.find((r) => r.id === id)
      if (!target) throw new Error("Recommendation not found")
      if (db.contributions.some((c) => c.recommendationId === id && c.moderationStatus !== "REJECTED"))
        throw new Error("This recommendation has a community submission and cannot return to draft.")
      Object.assign(target, { status: "DRAFT", reviewedBy: undefined, reviewedAt: undefined, updatedAt: now() })
      target.history.push({ id: uid("evt"), action: "REOPENED", actor, at: now() })
      return target
    })
  },
  getCompetencyMappings(jobId: string): Promise<CompetencyMapping[]> {
    return mutate((db) => {
      const job = db.jobs.find((j) => j.id === jobId)
      return job?.status === "COMPLETED" ? competencyMappings : []
    })
  },
  confirmCompetencyMapping(user: FacultyUser, mappingId: string, confirmed: boolean): Promise<string[]> {
    return mutate((db) => {
      const ids = db.confirmedMappings[user.id] || []
      db.confirmedMappings[user.id] = confirmed ? Array.from(new Set([...ids, mappingId])) : ids.filter((id) => id !== mappingId)
      return db.confirmedMappings[user.id]
    })
  },
  getConfirmedMappings(user: FacultyUser): Promise<string[]> {
    return mutate((db) => db.confirmedMappings[user.id] || [])
  },

  getSyllabusWorkflow(user: FacultyUser, syllabusId?: string): Promise<SyllabusWorkflow | null> {
    return mutate((db) => {
      const syllabus = db.syllabi.find((s) => (!syllabusId || s.id === syllabusId) && (user.role === "admin" || s.facultyId === user.id))
      return syllabus ? workflowFor(db, syllabus) : null
    })
  },
  listSyllabusWorkflows(user: FacultyUser, scope: "faculty" | "admin" = user.role === "admin" ? "admin" : "faculty"): Promise<SyllabusWorkflow[]> {
    return mutate((db) => db.syllabi.filter((s) => scope === "admin" || s.facultyId === user.id).map((s) => workflowFor(db, s)).filter((w) => w.versions.length > 0))
  },
  generateSyllabus(user: FacultyUser, syllabusId: string): Promise<SyllabusVersion> {
    return mutate((db) => {
      const syllabus = db.syllabi.find((s) => s.id === syllabusId && s.facultyId === user.id)
      if (!syllabus) throw new Error("Syllabus not found")
      const job = db.jobs.find((j) => j.syllabusId === syllabusId && j.facultyId === user.id && j.status === "COMPLETED")
      if (!job) throw new Error("Complete the syllabus analysis before generating a revision.")
      const recs = db.recommendations.filter((r) => r.syllabusId === syllabusId)
      const mappingIds = db.confirmedMappings[user.id] || []
      const mappings = competencyMappings.filter((m) => mappingIds.includes(m.id))
      const previous = db.versions.filter((v) => v.syllabusId === syllabusId)
      const at = now()
      const version: SyllabusVersion = {
        id: uid("version"), syllabusId, courseId: syllabusId, facultyId: user.id,
        versionNumber: previous.length + 1, status: "DRAFT_READY",
        sections: syllabusSections(syllabus, recs, mappings),
        appliedRecommendationIds: recs.filter((r) => r.status === "APPROVED").map((r) => r.id),
        confirmedMappingIds: mappingIds,
        createdAt: at, updatedAt: at,
      }
      db.versions.push(version)
      return version
    })
  },
  saveSyllabusDraft(user: FacultyUser, versionId: string, sections: SyllabusSection[]): Promise<SyllabusVersion> {
    return mutate((db) => {
      const version = db.versions.find((v) => v.id === versionId && v.facultyId === user.id)
      if (!version || !["DRAFT", "DRAFT_READY"].includes(version.status)) throw new Error("Only an editable draft can be saved.")
      if (sections.some((s) => !s.title.trim() || !s.content.trim())) throw new Error("Every syllabus section needs a title and content.")
      version.sections = sections.map((s, i) => ({ ...s, order: i + 1 }))
      version.updatedAt = now()
      return version
    })
  },
  submitSyllabus(user: FacultyUser, versionId: string): Promise<ReviewSubmission> {
    return mutate((db) => {
      const version = db.versions.find((v) => v.id === versionId && v.facultyId === user.id)
      if (!version || !["DRAFT", "DRAFT_READY"].includes(version.status)) throw new Error("Only an editable draft can be submitted.")
      if (version.sections.some((s) => !s.content.trim())) throw new Error("Complete every syllabus section before submitting.")
      if (db.submissions.some((s) => s.syllabusVersionId === versionId && s.status === "PENDING_ADMIN_REVIEW")) throw new Error("This version is already pending administrative review.")
      const at = now()
      version.status = "PENDING_ADMIN_REVIEW"
      version.submittedAt = at
      version.updatedAt = at
      const submission: ReviewSubmission = { id: uid("submission"), syllabusId: version.syllabusId, syllabusVersionId: version.id, facultyId: user.id, submittedAt: at, status: "PENDING_ADMIN_REVIEW" }
      db.submissions.push(submission)
      return submission
    })
  },
  createRevision(user: FacultyUser, versionId: string): Promise<SyllabusVersion> {
    return mutate((db) => {
      const previous = db.versions.find((v) => v.id === versionId && v.facultyId === user.id)
      if (!previous || previous.status !== "REJECTED") throw new Error("Only a rejected version can be revised.")
      const at = now()
      const revision: SyllabusVersion = { ...clone(previous), id: uid("version"), versionNumber: Math.max(...db.versions.filter((v) => v.syllabusId === previous.syllabusId).map((v) => v.versionNumber)) + 1, status: "DRAFT_READY", createdAt: at, updatedAt: at, submittedAt: undefined }
      db.versions.push(revision)
      return revision
    })
  },
  decideSyllabus(user: FacultyUser, submissionId: string, decision: "APPROVED" | "REJECTED", reason?: string): Promise<AdminReviewDecision> {
    return mutate((db) => {
      if (user.role !== "admin") throw new Error("Administrator access is required.")
      const submission = db.submissions.find((s) => s.id === submissionId)
      if (!submission || submission.status !== "PENDING_ADMIN_REVIEW") throw new Error("This submission has already been reviewed or no longer exists.")
      if (decision === "REJECTED" && !reason?.trim()) throw new Error("A rejection reason is required.")
      const at = now()
      submission.status = decision
      const version = db.versions.find((v) => v.id === submission.syllabusVersionId)!
      version.status = decision
      version.updatedAt = at
      const record: AdminReviewDecision = { id: uid("decision"), submissionId, syllabusVersionId: version.id, reviewerId: user.id, reviewerName: user.displayName, decision, reason: reason?.trim() || undefined, reviewedAt: at }
      db.decisions.push(record)
      db.notifications.push({ id: uid("notification"), type: decision === "APPROVED" ? "SYLLABUS_APPROVED" : "SYLLABUS_REJECTED", syllabusId: submission.syllabusId, submissionId, reviewedVersion: version.versionNumber, title: decision === "APPROVED" ? "Syllabus approved" : "Revision requested", message: decision === "APPROVED" ? `${version.versionNumber === 1 ? "Your syllabus" : `Version ${version.versionNumber} of your syllabus`} was approved by ${user.displayName}.` : `${user.displayName} requested a revision: ${reason!.trim()}`, createdAt: at })
      return record
    })
  },
  saveRecommendationDecisions(_reviewId: string, decisions: RecommendationDecisionInput[]): Promise<void> {
    return mutate((db) => {
      for (const decision of decisions) {
        const recommendation = db.recommendations.find((r) => r.id === decision.recommendationId)
        if (!recommendation) continue
        if (decision.decision === "ACCEPTED") recommendation.status = "APPROVED"
        if (decision.decision === "REJECTED") recommendation.status = "REJECTED"
        if (decision.decision === "EDITED" && decision.editedText?.trim()) recommendation.description = decision.editedText.trim()
        recommendation.updatedAt = now()
      }
    })
  },
  listNotifications(user: FacultyUser): Promise<FacultyNotification[]> {
    return mutate((db) => db.notifications.filter((n) => { const submission = db.submissions.find((s) => s.id === n.submissionId); return submission?.facultyId === user.id }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
  },
  markNotificationRead(user: FacultyUser, notificationId: string): Promise<void> {
    return mutate((db) => {
      const notification = db.notifications.find((n) => n.id === notificationId)
      const submission = notification && db.submissions.find((s) => s.id === notification.submissionId)
      if (notification && submission?.facultyId === user.id) notification.readAt = now()
    })
  },

  // Community sharing (moderated publication to the Context bucket)
  submitContribution(
    user: FacultyUser,
    input: { recommendationId: string; title: string; description: string; courseSubject: string; consent: boolean },
  ): Promise<SharedContribution> {
    return mutate((db) => {
      const rec = db.recommendations.find((r) => r.id === input.recommendationId)
      if (!rec || rec.status !== "APPROVED") throw new Error("Only approved recommendations can be shared.")
      if (!input.consent) throw new Error("Sharing consent is required.")
      if (!input.title.trim() || !input.description.trim())
        throw new Error("Add a resource title and description.")
      if (db.contributions.some((c) => c.recommendationId === rec.id && c.moderationStatus !== "REJECTED"))
        throw new Error("This recommendation has already been submitted.")
      const at = now()
      const item: SharedContribution = {
        id: uid("sh"),
        recommendationId: rec.id,
        submittedBy: user.displayName,
        submittedById: user.id,
        title: input.title.trim(),
        description: input.description.trim(),
        courseSubject: input.courseSubject,
        consentGiven: true,
        consentAt: at,
        submittedAt: at,
        moderationStatus: "PENDING_MODERATION",
        sanitization: "PASSED",
      }
      db.contributions.push(item)
      return item
    })
  },
  listContributions(submittedById?: string): Promise<SharedContribution[]> {
    return mutate((db) => {
      advanceSync(db)
      return db.contributions
        .filter((c) => !submittedById || c.submittedById === submittedById)
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    })
  },
  getRecommendation(id: string): Promise<Recommendation | null> {
    return mutate((db) => db.recommendations.find((r) => r.id === id) || null)
  },
  moderateContribution(
    id: string,
    decision: "approve" | "reject",
    actor: string,
    reason?: string,
  ): Promise<SharedContribution> {
    return mutate((db) => {
      const c = db.contributions.find((x) => x.id === id)
      if (!c) throw new Error("Submission not found")
      if (c.moderationStatus !== "PENDING_MODERATION" && c.moderationStatus !== "SUBMITTED")
        throw new Error("This submission has already been moderated.")
      if (decision === "reject" && !reason?.trim()) throw new Error("Add an explanation before rejecting.")
      c.moderationStatus = decision === "approve" ? "APPROVED" : "REJECTED"
      c.reviewedBy = actor
      c.rejectionReason = decision === "reject" ? reason!.trim() : undefined
      return c
    })
  },
  queueIndexing(id: string): Promise<SharedContribution> {
    return mutate((db) => {
      const c = db.contributions.find((x) => x.id === id)
      if (!c || (c.moderationStatus !== "APPROVED" && c.moderationStatus !== "INDEX_FAILED"))
        throw new Error("Only approved submissions can be indexed.")
      c.moderationStatus = "INDEXING"
      requestSyncOn(db)
      return c
    })
  },

  // Knowledge sources and Knowledge Base synchronization
  listKnowledgeSources(scope: "faculty" | "admin"): Promise<KnowledgeSource[]> {
    return mutate((db) => {
      advanceSync(db)
      return scope === "admin"
        ? db.sources
        : db.sources.filter(
            (s) =>
              s.ingestionStatus === "INDEXED" &&
              (s.approvalStatus === "ACTIVE" || s.approvalStatus === "PUBLISHED"),
          )
    })
  },
  updateSourceStatus(id: string, approvalStatus: KnowledgeSource["approvalStatus"]): Promise<KnowledgeSource> {
    return mutate((db) => {
      const s = db.sources.find((x) => x.id === id)
      if (!s) throw new Error("Source not found")
      s.approvalStatus = approvalStatus
      // Lifecycle changes take effect only after the next synchronization.
      s.ingestionStatus = "PENDING"
      s.updatedAt = now().slice(0, 10)
      return s
    })
  },
  retrySourceIngestion(id: string): Promise<KnowledgeSource> {
    return mutate((db) => {
      const s = db.sources.find((x) => x.id === id)
      if (!s) throw new Error("Source not found")
      s.ingestionStatus = "INDEXING"
      requestSyncOn(db)
      return s
    })
  },
  requestSync(): Promise<SyncStatus> {
    return mutate((db) => {
      requestSyncOn(db)
      return db.sync
    })
  },
  getSyncStatus(): Promise<SyncStatus> {
    return mutate((db) => {
      advanceSync(db)
      return db.sync
    })
  },

  // Faculty settings
  getSettings(user: FacultyUser): Promise<FacultySettings> {
    return Promise.resolve(readSettings(user))
  },
  async saveSettings(user: FacultyUser, settings: FacultySettings): Promise<FacultyUser> {
    if (!settings.displayName.trim()) throw new Error("Display name is required.")
    const all = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}")
    all[user.id] = settings
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(all))
    return withSettings(demoUsers.find((u) => u.id === user.id)!)
  },

  resetDemo() {
    localStorage.removeItem(DB_KEY)
    localStorage.removeItem(SETTINGS_KEY)
  },
}
