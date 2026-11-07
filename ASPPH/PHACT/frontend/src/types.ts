/**
 * PHACT data shapes. Field names match the backend API exactly (see PHACT_API_Contract.xlsx and the
 * backend README), so responses are used as-is with no renaming layer.
 */

export type Role = "faculty" | "admin"

/** The signed-in user, read from the Cognito ID token. */
export interface User {
  userId: string
  email: string
  name: string
  role: Role
}

export type SourceType = "PDF" | "DOCX" | "PASTE"
export type VersionSource = "UPLOAD" | "COMPETENCY" | "MODERNIZATION"
export type ApprovalStatus = "NONE" | "PENDING" | "APPROVED" | "DENIED"
export type ReviewType = "COMPETENCY" | "MODERNIZATION"
export type JobStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED"
export type ReviewStage = "RETRIEVING_SOURCES" | "ANALYZING" | "REWRITING" | "SAVING"

/** GET /syllabi items, and the response of submit and undo. */
export interface SyllabusSummary {
  syllabusId: string
  title: string
  subject?: string
  institution?: string
  description?: string
  sourceType: SourceType
  currentVersion: number
  currentVersionSource: VersionSource
  versionCount: number
  reviewRunning: boolean
  activeReviewId?: string
  /** A completed review whose suggestions are waiting for the faculty member's decisions. */
  pendingReviewId?: string
  approvalStatus: ApprovalStatus
  submittedVersion?: number
  submittedAt?: string
  decidedAt?: string
  denyReason?: string
  approvedVersion?: number
  approvedAt?: string
  approvalNote?: string
  createdAt: string
  updatedAt: string
  expiresAt: string
}

export interface VersionEntry {
  n: number
  source: VersionSource
  reviewId?: string
  createdAt: string
}

export interface SyllabusDetail extends SyllabusSummary {
  versions: VersionEntry[]
}

/** GET /syllabi/{id}/versions/{n} */
export interface VersionText {
  syllabusId: string
  version: number
  source: VersionSource
  reviewId?: string
  createdAt: string
  isCurrent: boolean
  text: string
}

/** POST /uploads */
export interface UploadReservation {
  uploadId: string
  uploadKey: string
  uploadUrl: string
  method: "PUT"
  headers: Record<string, string>
  maxBytes: number
  expiresInSeconds: number
}

/** POST /syllabi */
export interface SyllabusCreated {
  syllabus: SyllabusDetail
  extractedText: string
}

export interface ReviewSummary {
  reviewId: string
  syllabusId: string
  reviewType: ReviewType
  jobStatus: JobStatus
  stage?: ReviewStage
  inputVersion: number
  outputVersion?: number
  /** Competency: addressed, partial, notAddressed, total. AI: recommendations, integrateAi, aiResistant, peerExamplesCited. Both: linesAdded, linesRemoved. */
  summary?: Record<string, number>
  errorMessage?: string
  createdAt: string
  startedAt?: string
  completedAt?: string
  undoneAt?: string
  /** Set once the faculty member saved (or declined) the suggestions. */
  decidedAt?: string
  decision?: ReviewDecision
  acceptedHunks?: { hunkId: string; edited: boolean }[]
  acceptedSuggestions?: { title: string; reason: string; edited: boolean }[]
  /** The faculty member's instructions for this run (personal details purged). */
  guidance?: string
  /** Suggestions declined in earlier runs that this run was told not to repeat. */
  declinedContext?: string[]
}

export interface ReviewDecision {
  changesAccepted: number
  changesDeclined: number
  changesEdited: number
  suggestionsAccepted: number
  suggestionsDeclined: number
}

/** One block of changed lines in a proposal. `before` is removed, `after` is added. */
export interface Hunk {
  id: string
  before: string
  after: string
  beforeLines: number
  afterLines: number
  contextBefore: string
  contextAfter: string
}

/** What the faculty member decided for one change: accept it (optionally with edited text) or decline it. */
export interface HunkDecision {
  hunkId: string
  accept: boolean
  text?: string
}

export interface DiffSegment {
  op: "equal" | "insert" | "delete"
  text: string
}

export type CompetencyStatus = "ADDRESSED" | "PARTIAL" | "NOT_ADDRESSED"

export interface CompetencyGrade {
  code: string
  number: number
  domain: string
  statement: string
  status: CompetencyStatus
  evidence: string
  rationale: string
  cephInterpretation: string
}

export interface CompetencyChange {
  section: string
  change: string
  reason: string
  competencyCodes: string[]
  /** The proposal's changes that belong to this suggestion. */
  hunkIds: string[]
}

interface ProposalResults {
  diff: DiffSegment[]
  hunks: Hunk[]
  /** Changes no suggestion claimed; shown as "Other edits". */
  otherHunkIds: string[]
}

export interface CompetencyResults extends ProposalResults {
  coverage: { addressed: number; partial: number; notAddressed: number; total: number }
  competencies: CompetencyGrade[]
  changes: CompetencyChange[]
}

export type RecommendationCategory = "TEACHING_METHODS" | "ASSESSMENT_TOOLS" | "CONTENT_ENHANCEMENT"
export type RecommendationApproach = "INTEGRATE_AI" | "AI_RESISTANT"

export interface PeerExample {
  title: string
  institution: string
  snippet: string
}

export interface Recommendation {
  title: string
  category: RecommendationCategory
  approach: RecommendationApproach
  target: string
  recommendation: string
  rationale: string
  peerExamples: PeerExample[]
  hunkIds: string[]
}

export interface ModernizationResults extends ProposalResults {
  recommendations: Recommendation[]
  peerExamplesAvailable: number
}

/** GET /reviews/{id}: the review, plus results once it has completed. */
export interface Review extends ReviewSummary {
  results?: CompetencyResults | ModernizationResults
}

export type QueueStatus = "PENDING" | "APPROVED" | "DENIED"

/** GET /admin/queue items */
export interface QueueItem {
  syllabusId: string
  title: string
  subject?: string
  institution?: string
  ownerEmail?: string
  approvalStatus: QueueStatus
  submittedVersion: number
  submittedAt: string
  decidedAt?: string
  decidedByEmail?: string
  denyReason?: string
  approvedVersion?: number
}

/** Email status for the latest approval decision (DynamoDB Stream -> DecisionNotifier -> SES). */
export interface DecisionNotification {
  channel: "EMAIL"
  status: "SENT" | "NOT_SENT"
  to: string
  decision: "APPROVED" | "DENIED"
  version?: number
  at: string
  detail?: string
  messageId?: string
}

/** Admin endpoints return the summary plus who submitted and who decided. */
export interface AdminSyllabusSummary extends SyllabusSummary {
  ownerEmail?: string
  decidedByEmail?: string
  notification?: DecisionNotification | null
}

/** POST /admin/syllabi/{id}/summary: AI-written summary of a submission, cached per submitted version. */
export interface SubmissionSummary {
  text: string
  version: number
  generatedAt: string
  cached?: boolean
}

/** GET /admin/syllabi/{id} */
export interface AdminSubmission {
  syllabus: AdminSyllabusSummary
  summary: SubmissionSummary | null
  version: number
  text: string
  diff: DiffSegment[]
  diffStats: { linesAdded: number; linesRemoved: number }
  reviews: ReviewSummary[]
}

export type KnowledgeBaseKey = "CEPH" | "APPROVED_SYLLABI"
export type IngestionStatus = "STARTING" | "IN_PROGRESS" | "COMPLETE" | "FAILED" | "STOPPING" | "STOPPED"

export interface IngestionJob {
  ingestionJobId: string
  status: IngestionStatus
  startedAt?: string
  updatedAt?: string
  documentsScanned: number
  documentsIndexed: number
  documentsDeleted: number
  documentsFailed: number
}

/** GET /admin/kb items */
export interface KnowledgeBase {
  kb: KnowledgeBaseKey
  name: string
  knowledgeBaseId: string
  fileCount: number
  lastSync: IngestionJob | null
}

/** POST /admin/kb/sync */
export interface SyncStarted {
  kb: KnowledgeBaseKey
  ingestionJobId: string
  status: IngestionStatus
}

/** Error body every endpoint returns: {code, message, requestId}. */
export interface ApiErrorBody {
  code: string
  message: string
  requestId?: string
}

/** POST /feedback response and GET /admin/feedback items */
export interface Feedback {
  feedbackId: string
  syllabusId: string
  syllabusTitle?: string
  version: number
  rating: number
  comment?: string
  ownerEmail?: string
  createdAt: string
}

export interface FeedbackList {
  items: Feedback[]
  count: number
  averageRating: number | null
}
