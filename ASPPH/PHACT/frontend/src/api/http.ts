import type {
  AdminSubmission,
  Feedback,
  FeedbackList,
  SubmissionSummary,
  AdminSyllabusSummary,
  KnowledgeBase,
  QueueItem,
  Review,
  ReviewSummary,
  SyllabusCreated,
  SyllabusDetail,
  SyllabusSummary,
  SyncStarted,
  UploadReservation,
  VersionText,
} from "../types"
import { createCognitoSession } from "./cognito"
import { ApiError, type ApiConfig, type PhactApi } from "./types"

export const SIGNED_OUT_EVENT = "phact:signed-out"

/** Live adapter: calls the PHACT API. It never falls back to mock data. */
export function createHttpApi(config: ApiConfig): PhactApi {
  const session = createCognitoSession(config)
  const base = config.baseUrl.replace(/\/$/, "")

  const expired = () => {
    session.signOut()
    window.dispatchEvent(new Event(SIGNED_OUT_EVENT))
    return new ApiError("Your session has ended. Sign in again.", 401, "UNAUTHORIZED")
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await session.idToken()
    if (!token) throw expired()
    let response: Response
    try {
      response = await fetch(`${base}${path}`, {
        method,
        headers: { Authorization: token, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })
    } catch {
      throw new ApiError("Can't reach the PHACT service. Check your connection and try again.", 0, "NETWORK")
    }
    const payload = await response.json().catch(() => ({}))
    if (response.status === 401) throw expired()
    if (!response.ok) {
      // API Gateway's own errors (for example, a route that isn't deployed) have only `message`.
      throw new ApiError(payload.code ? payload.message : `The PHACT service returned an error (${response.status}).`, response.status, payload.code, payload.requestId)
    }
    return payload as T
  }

  function putFile(reservation: UploadReservation, file: File, onProgress?: (percent: number) => void) {
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open(reservation.method, reservation.uploadUrl)
      Object.entries(reservation.headers).forEach(([key, value]) => xhr.setRequestHeader(key, value))
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 90))
      }
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new ApiError(`File upload failed (${xhr.status}). Try again.`, xhr.status, "UPLOAD_FAILED")))
      xhr.onerror = () => reject(new ApiError("File upload failed. Check your connection and try again.", 0, "UPLOAD_FAILED"))
      xhr.send(file)
    })
  }

  const q = encodeURIComponent

  return {
    mode: "live",
    currentUser: session.currentUser,
    signIn: session.signIn,
    signOut: session.signOut,

    async uploadSyllabus(input, onProgress) {
      const fields = { title: input.title, subject: input.subject, institution: input.institution, description: input.description }
      if (!input.file) {
        onProgress?.(50)
        const created = await request<SyllabusCreated>("POST", "/syllabi", { ...fields, text: input.text })
        onProgress?.(100)
        return created
      }
      const reservation = await request<UploadReservation>("POST", "/uploads", { fileName: input.file.name, fileSize: input.file.size })
      if (input.file.size > reservation.maxBytes) throw new ApiError(`This file is larger than ${Math.floor(reservation.maxBytes / 1024 / 1024)} MB.`, 400, "TOO_LARGE")
      await putFile(reservation, input.file, onProgress)
      const created = await request<SyllabusCreated>("POST", "/syllabi", { ...fields, uploadKey: reservation.uploadKey })
      onProgress?.(100)
      return created
    },
    listSyllabi: () => request<{ syllabi: SyllabusSummary[] }>("GET", "/syllabi").then((r) => r.syllabi),
    getSyllabus: (id) => request<{ syllabus: SyllabusDetail; reviews: ReviewSummary[] }>("GET", `/syllabi/${q(id)}`),
    getVersion: (id, n) => request<VersionText>("GET", `/syllabi/${q(id)}/versions/${n}`),
    startReview: (id, type, guidance) => request<ReviewSummary>("POST", `/syllabi/${q(id)}/${type === "COMPETENCY" ? "competency" : "modernization"}-reviews`, guidance ? { guidance } : {}),
    getReview: (reviewId) => request<Review>("GET", `/reviews/${q(reviewId)}`),
    decideReview: (reviewId, decisions) => request<{ syllabus: SyllabusSummary; review: ReviewSummary }>("POST", `/reviews/${q(reviewId)}/decisions`, { decisions }),
    undoReview: (reviewId) => request<SyllabusSummary>("POST", `/reviews/${q(reviewId)}/undo`, {}),
    submitSyllabus: (id) => request<SyllabusSummary>("POST", `/syllabi/${q(id)}/submit`, {}),
    submitFeedback: (input) => request<Feedback>("POST", "/feedback", input),

    listQueue: (status) => request<{ items: QueueItem[] }>("GET", `/admin/queue?status=${status}`).then((r) => r.items),
    getSubmission: (id) => request<AdminSubmission>("GET", `/admin/syllabi/${q(id)}`),
    approveSubmission: (id, note) => request<AdminSyllabusSummary>("POST", `/admin/syllabi/${q(id)}/approve`, note ? { note } : {}),
    rejectSubmission: (id, reason) => request<AdminSyllabusSummary>("POST", `/admin/syllabi/${q(id)}/reject`, { reason }),
    summarizeSubmission: (id) => request<SubmissionSummary>("POST", `/admin/syllabi/${q(id)}/summary`, {}),
    listKnowledgeBases: () => request<{ knowledgeBases: KnowledgeBase[] }>("GET", "/admin/kb").then((r) => r.knowledgeBases),
    syncKnowledgeBase: (kb) => request<SyncStarted>("POST", "/admin/kb/sync", { kb }),
    listFeedback: () => request<FeedbackList>("GET", "/admin/feedback"),
  }
}
