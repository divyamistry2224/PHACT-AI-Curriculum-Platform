export type Role = "faculty" | "admin"
export type ReviewStatus = "DRAFT" | "APPROVED" | "REJECTED"
export type JobStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED"
export type EvidenceKind = "Authoritative" | "Faculty Example"
export type ModerationStatus =
  | "SUBMITTED"
  | "PENDING_MODERATION"
  | "APPROVED"
  | "INDEXING"
  | "PUBLISHED"
  | "REJECTED"
  | "INDEX_FAILED"

export interface FacultyUser {
  id: string
  displayName: string
  email: string
  role: Role
  institution: string
  title: string
}

export interface Syllabus {
  id: string
  facultyId: string
  courseName: string
  subject: string
  description: string
  /** Private upload location. Never part of the shared knowledge sources. */
  s3Key: string
  fileName?: string
  source: "pdf" | "text"
  extractedText: string
  extractedIsIllustrative: boolean
  uploadedAt: string
  status: "UPLOADED" | "ANALYZED" | "FAILED"
}

export type SyllabusStatus =
  | "DRAFT"
  | "GENERATING"
  | "GENERATION_FAILED"
  | "DRAFT_READY"
  | "PENDING_ADMIN_REVIEW"
  | "APPROVED"
  | "REJECTED"

export interface SyllabusSection {
  id: string
  title: string
  content: string
  order: number
}

export interface SyllabusVersion {
  id: string
  syllabusId: string
  courseId: string
  facultyId: string
  versionNumber: number
  status: SyllabusStatus
  sections: SyllabusSection[]
  appliedRecommendationIds: string[]
  confirmedMappingIds: string[]
  createdAt: string
  updatedAt: string
  submittedAt?: string
}

export interface ReviewSubmission {
  id: string
  syllabusId: string
  syllabusVersionId: string
  facultyId: string
  submittedAt: string
  status: "PENDING_ADMIN_REVIEW" | "APPROVED" | "REJECTED"
}

export interface AdminReviewDecision {
  id: string
  submissionId: string
  syllabusVersionId: string
  reviewerId: string
  reviewerName: string
  decision: "APPROVED" | "REJECTED"
  reason?: string
  reviewedAt: string
}

export interface SyllabusWorkflow {
  syllabus: Syllabus
  versions: SyllabusVersion[]
  submissions: ReviewSubmission[]
  decisions: AdminReviewDecision[]
}

export interface AnalysisJob {
  id: string
  syllabusId: string
  facultyId: string
  status: JobStatus
  /** Number of completed analysis stages. */
  progressStep: number
  createdAt: string
  startedAt?: string
  completedAt?: string
  updatedAt: string
  error?: string
  simulateFailure?: boolean
}

export interface Citation {
  id: string
  title: string
  publisher: string
  kind: EvidenceKind
  version: string
  excerpt: string
  illustrative: boolean
}

export interface ReviewEvent {
  id: string
  action: "GENERATED" | "EDITED" | "APPROVED" | "REJECTED" | "REOPENED"
  actor: string
  at: string
  note?: string
}

export interface Recommendation {
  id: string
  jobId: string
  syllabusId: string
  title: string
  module: string
  activityType: string
  description: string
  rationale: string
  implementationSteps: string[]
  learningOutcomes: string[]
  responsibleAI: string
  citations: Citation[]
  status: ReviewStatus
  reviewedBy?: string
  reviewedAt?: string
  updatedAt: string
  history: ReviewEvent[]
}

export interface CompetencyMapping {
  id: string
  objective: string
  competency: string
  alignment: "Strong Alignment" | "Partial Alignment" | "Gap Identified"
  gap: string
  improvement: string
  source: string
  reasoning: string
}

export interface KnowledgeSource {
  id: string
  title: string
  sourceType: EvidenceKind
  category: string
  s3Key: string
  version: string
  approvalStatus: "ACTIVE" | "PUBLISHED" | "RETIRED" | "SUPERSEDED"
  ingestionStatus: "INDEXED" | "INDEXING" | "PENDING" | "FAILED"
  updatedAt: string
  publisher: string
  summary: string
  competencies: string[]
  body: string
}

export interface SharedContribution {
  id: string
  recommendationId: string
  submittedBy: string
  submittedById: string
  title: string
  description: string
  courseSubject: string
  consentGiven: boolean
  consentAt: string
  submittedAt: string
  moderationStatus: ModerationStatus
  sanitization: "PASSED" | "NEEDS_REVIEW"
  reviewedBy?: string
  rejectionReason?: string
  publishedAt?: string
}

export interface SyncStatus {
  state: "IDLE" | "REQUESTED" | "IN_PROGRESS" | "COMPLETED"
  requestedAt?: string
  completedAt?: string
}

export interface FacultySettings {
  displayName: string
  institution: string
  title: string
  notifyAnalysis: boolean
  notifyModeration: boolean
  shareReminder: boolean
}

export interface HistoryRow {
  jobId: string
  syllabusId: string
  courseName: string
  subject: string
  uploadedAt: string
  status: JobStatus
  recommendationCount: number
  drafts: number
  approved: number
  rejected: number
  lastModified: string
}

export interface ActivityItem {
  id: string
  title: string
  detail: string
  at: string
}

export interface DashboardData {
  stats: {
    syllabi: number
    recommendations: number
    pending: number
    approved: number
    shared: number
  }
  history: HistoryRow[]
  pending: (Recommendation & { courseName: string })[]
  contributions: SharedContribution[]
  activity: ActivityItem[]
}
