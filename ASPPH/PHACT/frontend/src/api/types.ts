import type {
  AdminSubmission,
  Feedback,
  FeedbackList,
  HunkDecision,
  SubmissionSummary,
  AdminSyllabusSummary,
  KnowledgeBase,
  KnowledgeBaseKey,
  QueueItem,
  QueueStatus,
  Review,
  ReviewSummary,
  ReviewType,
  Role,
  SyllabusCreated,
  SyllabusDetail,
  SyllabusSummary,
  SyncStarted,
  User,
  VersionText,
} from "../types"

export type * from "../types"

export interface FeedbackInput {
  syllabusId: string
  version?: number
  rating: number
  comment?: string
}

export interface UploadInput {
  file?: File
  text?: string
  title: string
  subject?: string
  institution?: string
  description?: string
}

/** Thrown for any failed API call. `message` is safe to show; `code` matches the backend's error codes. */
export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public requestId?: string) {
    super(message)
    this.name = "ApiError"
  }
}

/**
 * The one service boundary pages use. The live adapter (http.ts) calls the PHACT API; the mock adapter
 * (mock.ts) simulates the same behavior in the browser for UI work without AWS. Each method maps to one
 * backend endpoint, noted beside it.
 */
export interface PhactApi {
  readonly mode: "mock" | "live"

  currentUser(): User | null
  signIn(email: string, password: string): Promise<User>
  signOut(): void
  /** Mock mode only: switch between the demo faculty and admin users. */
  switchRole?(role: Role): Promise<User>

  // Faculty
  uploadSyllabus(input: UploadInput, onProgress?: (percent: number) => void): Promise<SyllabusCreated> // POST /uploads, PUT, POST /syllabi
  listSyllabi(): Promise<SyllabusSummary[]> // GET /syllabi
  getSyllabus(syllabusId: string): Promise<{ syllabus: SyllabusDetail; reviews: ReviewSummary[] }> // GET /syllabi/{id}
  getVersion(syllabusId: string, n: number): Promise<VersionText> // GET /syllabi/{id}/versions/{n}
  startReview(syllabusId: string, reviewType: ReviewType, guidance?: string): Promise<ReviewSummary> // POST /syllabi/{id}/competency-reviews | modernization-reviews
  getReview(reviewId: string): Promise<Review> // GET /reviews/{id}
  decideReview(reviewId: string, decisions: HunkDecision[]): Promise<{ syllabus: SyllabusSummary; review: ReviewSummary }> // POST /reviews/{id}/decisions
  undoReview(reviewId: string): Promise<SyllabusSummary> // POST /reviews/{id}/undo
  submitSyllabus(syllabusId: string): Promise<SyllabusSummary> // POST /syllabi/{id}/submit
  submitFeedback(input: FeedbackInput): Promise<Feedback> // POST /feedback

  // Admin
  listQueue(status: QueueStatus): Promise<QueueItem[]> // GET /admin/queue?status=
  getSubmission(syllabusId: string): Promise<AdminSubmission> // GET /admin/syllabi/{id}
  approveSubmission(syllabusId: string, note?: string): Promise<AdminSyllabusSummary> // POST /admin/syllabi/{id}/approve
  rejectSubmission(syllabusId: string, reason: string): Promise<AdminSyllabusSummary> // POST /admin/syllabi/{id}/reject
  summarizeSubmission(syllabusId: string): Promise<SubmissionSummary> // POST /admin/syllabi/{id}/summary
  listKnowledgeBases(): Promise<KnowledgeBase[]> // GET /admin/kb
  syncKnowledgeBase(kb: KnowledgeBaseKey): Promise<SyncStarted> // POST /admin/kb/sync
  listFeedback(): Promise<FeedbackList> // GET /admin/feedback
}

export interface ApiConfig {
  baseUrl: string
  region: string
  userPoolClientId: string
  /** Optional override of the Cognito endpoint, for local testing only. */
  cognitoEndpoint?: string
}
