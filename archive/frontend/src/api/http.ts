import type { ApiConfig, ApiErrorShape, FacultyNotification, PhactApi, RecommendationDecisionInput, SyllabusCreateResponse, UploadReservation } from "./types"
import type { FacultyUser } from "../types"

const unavailable = (method: string) => Promise.reject(new Error(`${method} is not available: the PHACT backend contract is not implemented yet.`))

/** Live adapter boundary. It never falls back to mock data. Unimplemented operations fail explicitly. */
export function createHttpApi(config: ApiConfig): PhactApi {
  const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const headers = new Headers(init.headers)
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json")
    const idToken = localStorage.getItem("phact-id-token")
    if (idToken) headers.set("Authorization", idToken)
    const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}${path}`, { ...init, headers })
    if (!response.ok) {
      let payload: Partial<ApiErrorShape> = {}
      try { payload = await response.json() } catch { /* non-JSON failure */ }
      const error = new Error(payload.message || `PHACT API request failed (${response.status}).`) as Error & { code?: string; requestId?: string }
      error.code = payload.code
      error.requestId = payload.requestId
      throw error
    }
    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
  }

  const uploadSyllabus: PhactApi["uploadSyllabus"] = async (user, input, onProgress) => {
    if (!input.file) {
      const r = await request<SyllabusCreateResponse>("/syllabi", { method: "POST", body: JSON.stringify({ title: input.courseName, subject: input.subject, description: input.description, text: input.text }) })
      return { id: r.syllabus.id, facultyId: user.id, courseName: r.syllabus.title, subject: r.syllabus.subject || input.subject, description: r.syllabus.description || input.description, s3Key: r.syllabus.uploadKey || "", source: "text", extractedText: r.extractedText, extractedIsIllustrative: false, uploadedAt: new Date().toISOString(), status: "UPLOADED" }
    }
    const file = input.file
    const reservation = await request<UploadReservation>("/uploads", { method: "POST", body: JSON.stringify({ fileName: file.name, fileSize: file.size }) })
    if (file.size > reservation.maxBytes) throw new Error(`This file is larger than ${Math.floor(reservation.maxBytes / 1024 / 1024)} MB.`)
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open(reservation.method, reservation.uploadUrl)
      Object.entries(reservation.headers).forEach(([key, value]) => xhr.setRequestHeader(key, value))
      xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100)) }
      xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`File upload failed (${xhr.status}).`))
      xhr.onerror = () => reject(new Error("File upload failed. Try again."))
      xhr.send(file)
    })
    const r = await request<SyllabusCreateResponse>("/syllabi", { method: "POST", body: JSON.stringify({ title: input.courseName, subject: input.subject, description: input.description, uploadKey: reservation.uploadKey }) })
    onProgress?.(100)
    return { id: r.syllabus.id, facultyId: user.id, courseName: r.syllabus.title, subject: r.syllabus.subject || input.subject, description: r.syllabus.description || input.description, s3Key: r.syllabus.uploadKey || reservation.uploadKey, fileName: file.name, source: file.name.toLowerCase().endsWith(".docx") ? "text" : "pdf", extractedText: r.extractedText, extractedIsIllustrative: false, uploadedAt: new Date().toISOString(), status: "UPLOADED" }
  }

  const httpApi: PhactApi = {
    getDashboard: () => unavailable("getDashboard"),
    listHistory: () => unavailable("listHistory"),
    uploadSyllabus,
    createAnalysisJob: () => unavailable("createAnalysisJob"),
    getAnalysis: () => unavailable("getAnalysis"),
    retryJob: () => unavailable("retryJob"),
    saveRecommendation: () => unavailable("saveRecommendation"),
    reviewRecommendation: () => unavailable("reviewRecommendation"),
    reopenRecommendation: () => unavailable("reopenRecommendation"),
    getCompetencyMappings: () => unavailable("getCompetencyMappings"),
    confirmCompetencyMapping: () => unavailable("confirmCompetencyMapping"),
    getConfirmedMappings: () => unavailable("getConfirmedMappings"),
    submitContribution: () => unavailable("submitContribution"),
    listContributions: () => unavailable("listContributions"),
    getRecommendation: () => unavailable("getRecommendation"),
    moderateContribution: () => unavailable("moderateContribution"),
    queueIndexing: () => unavailable("queueIndexing"),
    listKnowledgeSources: () => unavailable("listKnowledgeSources"),
    updateSourceStatus: () => unavailable("updateSourceStatus"),
    retrySourceIngestion: () => unavailable("retrySourceIngestion"),
    requestSync: () => unavailable("requestSync"),
    getSyncStatus: () => unavailable("getSyncStatus"),
    getSyllabusWorkflow: () => unavailable("getSyllabusWorkflow"),
    listSyllabusWorkflows: () => unavailable("listSyllabusWorkflows"),
    generateSyllabus: () => unavailable("generateSyllabus"),
    saveSyllabusDraft: () => unavailable("saveSyllabusDraft"),
    submitSyllabus: () => unavailable("submitSyllabus"),
    createRevision: () => unavailable("createRevision"),
    decideSyllabus: () => unavailable("decideSyllabus"),
    saveRecommendationDecisions: (reviewId: string, decisions: RecommendationDecisionInput[]) => request<void>(`/reviews/${reviewId}/decisions`, { method: "PUT", body: JSON.stringify({ decisions }) }),
    listNotifications: (user: FacultyUser) => request<FacultyNotification[]>(`/notifications?userId=${encodeURIComponent(user.id)}`),
    markNotificationRead: (_user: FacultyUser, id: string) => request<void>(`/notifications/${encodeURIComponent(id)}/read`, { method: "PATCH" }),
    getSettings: () => unavailable("getSettings"),
    saveSettings: () => unavailable("saveSettings"),
    resetDemo: () => undefined,
    currentUser: () => null,
    signOut: () => localStorage.removeItem("phact-id-token"),
    signIn: () => unavailable("signIn: connect Cognito before enabling live authentication"),
    switchRole: () => unavailable("switchRole"),
  }
  return httpApi
}
