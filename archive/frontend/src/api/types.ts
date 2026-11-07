/** Provisional frontend contracts. Replace or explicitly map these to generated shared types when the team adds the analysis schema. */
export type * from "../types"
import type { AdminReviewDecision, AnalysisJob, CompetencyMapping, DashboardData, FacultySettings, FacultyUser, HistoryRow, KnowledgeSource, Recommendation, ReviewStatus, ReviewSubmission, Role, SharedContribution, Syllabus, SyllabusSection, SyllabusVersion, SyllabusWorkflow, SyncStatus } from "../types"

export interface UploadInput { file?: File; text?: string; courseName: string; subject: string; description: string }
export interface ContributionInput { recommendationId: string; title: string; description: string; courseSubject: string; consent: boolean }

export interface ApiErrorShape { code: string; message: string; requestId?: string }
export interface UploadReservation { uploadId: string; uploadKey: string; uploadUrl: string; method: "PUT"; headers: Record<string, string>; maxBytes: number; expiresInSeconds: number }
export interface SyllabusCreateResponse { syllabus: { id: string; title: string; subject?: string; description?: string; uploadKey?: string }; extractedText: string }
export interface RecommendationDecisionInput { recommendationId: string; decision: "ACCEPTED" | "EDITED" | "REJECTED"; targetSectionId?: string; editedText?: string }
export interface FacultyNotification { id: string; type: "SYLLABUS_APPROVED" | "SYLLABUS_REJECTED"; syllabusId: string; submissionId: string; reviewedVersion: number; title: string; message: string; createdAt: string; readAt?: string }

/** Independent service contract. Adapters must implement this interface; it is not inferred from fixtures or mock code. */
export interface PhactApi {
  currentUser(): FacultyUser | null
  signIn(email: string): Promise<FacultyUser>
  switchRole(role: Role): Promise<FacultyUser>
  signOut(): void
  getDashboard(user: FacultyUser): Promise<DashboardData>
  listHistory(user: FacultyUser): Promise<HistoryRow[]>
  uploadSyllabus(user: FacultyUser, input: UploadInput, onProgress?: (percent: number) => void): Promise<Syllabus>
  createAnalysisJob(user: FacultyUser, syllabusId: string, options?: { simulateFailure?: boolean }): Promise<AnalysisJob>
  getAnalysis(jobId: string): Promise<{ job: AnalysisJob; syllabus: Syllabus; recommendations: Recommendation[] } | null>
  retryJob(jobId: string): Promise<AnalysisJob>
  saveRecommendation(rec: Recommendation, actor: string): Promise<Recommendation>
  reviewRecommendation(id: string, status: Exclude<ReviewStatus, "DRAFT">, actor: string, note?: string): Promise<Recommendation>
  reopenRecommendation(id: string, actor: string): Promise<Recommendation>
  getCompetencyMappings(jobId: string): Promise<CompetencyMapping[]>
  confirmCompetencyMapping(user: FacultyUser, mappingId: string, confirmed: boolean): Promise<string[]>
  getConfirmedMappings(user: FacultyUser): Promise<string[]>
  submitContribution(user: FacultyUser, input: ContributionInput): Promise<SharedContribution>
  listContributions(submittedById?: string): Promise<SharedContribution[]>
  getRecommendation(id: string): Promise<Recommendation | null>
  moderateContribution(id: string, decision: "approve" | "reject", actor: string, reason?: string): Promise<SharedContribution>
  queueIndexing(id: string): Promise<SharedContribution>
  listKnowledgeSources(scope: "faculty" | "admin"): Promise<KnowledgeSource[]>
  updateSourceStatus(id: string, approvalStatus: KnowledgeSource["approvalStatus"]): Promise<KnowledgeSource>
  retrySourceIngestion(id: string): Promise<KnowledgeSource>
  requestSync(): Promise<SyncStatus>
  getSyncStatus(): Promise<SyncStatus>
  getSyllabusWorkflow(user: FacultyUser, syllabusId?: string): Promise<SyllabusWorkflow | null>
  listSyllabusWorkflows(user: FacultyUser, scope?: "faculty" | "admin"): Promise<SyllabusWorkflow[]>
  generateSyllabus(user: FacultyUser, syllabusId: string): Promise<SyllabusVersion>
  saveSyllabusDraft(user: FacultyUser, versionId: string, sections: SyllabusSection[]): Promise<SyllabusVersion>
  submitSyllabus(user: FacultyUser, versionId: string): Promise<ReviewSubmission>
  createRevision(user: FacultyUser, versionId: string): Promise<SyllabusVersion>
  decideSyllabus(user: FacultyUser, submissionId: string, decision: "APPROVED" | "REJECTED", reason?: string): Promise<AdminReviewDecision>
  saveRecommendationDecisions(reviewId: string, decisions: RecommendationDecisionInput[]): Promise<void>
  listNotifications(user: FacultyUser): Promise<FacultyNotification[]>
  markNotificationRead(user: FacultyUser, notificationId: string): Promise<void>
  getSettings(user: FacultyUser): Promise<FacultySettings>
  saveSettings(user: FacultyUser, settings: FacultySettings): Promise<FacultyUser>
  resetDemo(): void
}

export interface ApiConfig {
  mode: "mock" | "live"
  baseUrl: string
}
