import { api as mockApi, ANALYSIS_STAGES } from "./mock"
import { createHttpApi } from "./http"

export { ANALYSIS_STAGES }
export * from "./types"

const mode = import.meta.env.VITE_DATA_MODE === "live" ? "live" : "mock"
const baseUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/v1"

/** One replaceable service selected at the application boundary. Pages import this module, never the mock adapter. */
export const api = mode === "live" ? createHttpApi({ mode, baseUrl }) : mockApi
export const dataMode = mode
