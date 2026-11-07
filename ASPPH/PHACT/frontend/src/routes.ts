import type { Page } from "./components/ui"

export type RouteRole = "faculty" | "admin" | "public"
export interface PhactRoute {
  id: Page
  path: string
  label: string
  icon?: string
  roles: RouteRole[]
  group?: string
}

export const ROUTES: PhactRoute[] = [
  { id: "dashboard", path: "/dashboard", label: "Home Dashboard", icon: "home", roles: ["faculty"], group: "Workspace" },
  { id: "upload", path: "/upload", label: "Syllabus Upload", icon: "upload", roles: ["faculty"], group: "Workspace" },
  { id: "progress", path: "/progress", label: "Review Progress", roles: ["faculty"] },
  { id: "competency", path: "/competency", label: "Competency Review", icon: "map", roles: ["faculty"], group: "Transform" },
  { id: "recommendations", path: "/recommendations", label: "AI Recommendations", icon: "idea", roles: ["faculty"], group: "Transform" },
  { id: "review", path: "/review", label: "Review & Submit", icon: "review", roles: ["faculty"], group: "Transform" },
  { id: "export", path: "/export", label: "Export", icon: "download", roles: ["faculty"], group: "Transform" },
  { id: "activity", path: "/activity", label: "My Syllabi", icon: "clock", roles: ["faculty"], group: "Library" },
  { id: "approvals", path: "/admin/queue", label: "Final Syllabus Approvals", icon: "review", roles: ["admin"], group: "Administration" },
  { id: "knowledge", path: "/admin/knowledge", label: "Knowledge Management", icon: "library", roles: ["admin"], group: "Administration" },
  { id: "feedback", path: "/admin/feedback", label: "Faculty Feedback", icon: "people", roles: ["admin"], group: "Administration" },
  { id: "privacy", path: "/privacy", label: "Privacy Policy", roles: ["public", "faculty", "admin"] },
  { id: "terms", path: "/terms", label: "Terms of Service", roles: ["public", "faculty", "admin"] },
]

export const DEFAULT_ROUTE = ROUTES[0]
export const homeFor = (role: "faculty" | "admin"): Page => (role === "admin" ? "approvals" : "dashboard")
export const getRoute = (id: Page) => ROUTES.find((route) => route.id === id) || DEFAULT_ROUTE
export const getRouteByPath = (path: string) => ROUTES.find((route) => route.path === path)
export const getNavigation = (role: "faculty" | "admin") => ROUTES.filter((route) => route.roles.includes(role) && route.group)
export const resolveRoute = (path: string) => getRouteByPath(path) || DEFAULT_ROUTE
export const canAccessRoute = (route: PhactRoute, role: "faculty" | "admin") => route.roles.includes(role) || route.roles.includes("public")
