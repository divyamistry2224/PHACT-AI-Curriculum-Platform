import { createHttpApi } from "./http"
import { createMockApi } from "./mock"

export * from "./types"
export { SIGNED_OUT_EVENT } from "./http"

const env = import.meta.env
// "live" calls the API; "mock" simulates it in the browser. Unset means live when an API URL is configured.
const mode: "live" | "mock" = env.VITE_DATA_MODE === "mock" || env.VITE_DATA_MODE === "live" ? env.VITE_DATA_MODE : env.VITE_API_BASE_URL ? "live" : "mock"

/** One service selected at the application boundary. Pages import this module, never an adapter directly. */
export const api =
  mode === "live"
    ? createHttpApi({
        baseUrl: env.VITE_API_BASE_URL || "",
        region: env.VITE_AWS_REGION || "us-east-1",
        userPoolClientId: env.VITE_USER_POOL_CLIENT_ID || "",
        cognitoEndpoint: env.VITE_COGNITO_ENDPOINT || undefined,
      })
    : createMockApi()
export const dataMode = mode

/** Stages a running review moves through, in order (the backend's `stage` values). */
export const REVIEW_STAGES = [
  { stage: "QUEUED", label: "Queued", detail: "Waiting for a reviewer slot" },
  { stage: "RETRIEVING_SOURCES", label: "Retrieving sources", detail: "CEPH competencies and approved peer syllabi" },
  { stage: "ANALYZING", label: "Privacy screening and analysis", detail: "Safety check, personal details masked, AI analysis" },
  { stage: "REWRITING", label: "Safety check and rewrite", detail: "Output checked, revised syllabus assembled" },
  { stage: "SAVING", label: "Saving the new version", detail: "Diff computed and version saved" },
] as const
