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
  { id: "recommendations", path: "/recommendations", label: "AI Recommendations", icon: "idea", roles: ["faculty"], group: "Transform" },
  { id: "mapping", path: "/mapping", label: "Competency Mapping", icon: "map", roles: ["faculty"], group: "Transform" },
  { id: "review", path: "/review", label: "Review & Approval", icon: "review", roles: ["faculty"], group: "Transform" },
  { id: "export", path: "/export", label: "Export & Share", icon: "share", roles: ["faculty"], group: "Transform" },
  { id: "repository", path: "/repository", label: "Knowledge Repository", icon: "library", roles: ["faculty", "admin"], group: "Library" },
  { id: "activity", path: "/activity", label: "My Activity", icon: "clock", roles: ["faculty"], group: "Library" },
  { id: "settings", path: "/settings", label: "Settings", icon: "settings", roles: ["faculty"], group: "Library" },
  { id: "knowledge-admin", path: "/admin/sources", label: "Knowledge Management", icon: "library", roles: ["admin"], group: "Administration" },
  { id: "moderation", path: "/admin/queue", label: "Final Syllabus Approvals", icon: "review", roles: ["admin"], group: "Administration" },
  { id: "community-moderation", path: "/admin/community", label: "Community Moderation", icon: "people", roles: ["admin"], group: "Administration" },
  { id: "privacy", path: "/privacy", label: "Privacy Policy", roles: ["public", "faculty", "admin"] },
  { id: "terms", path: "/terms", label: "Terms of Service", roles: ["public", "faculty", "admin"] },
]

export const DEFAULT_ROUTE = ROUTES[0]
export const getRoute = (id: Page) => ROUTES.find((route) => route.id === id) || DEFAULT_ROUTE
export const getRouteByPath = (path: string) => ROUTES.find((route) => route.path === path)
export const getNavigation = (role: "faculty" | "admin") => ROUTES.filter((route) => route.roles.includes(role) && route.group)
export const resolveRoute = (path: string) => getRouteByPath(path) || DEFAULT_ROUTE
export const canAccessRoute = (route: PhactRoute, role: "faculty" | "admin") => route.roles.includes(role) || route.roles.includes("public")
