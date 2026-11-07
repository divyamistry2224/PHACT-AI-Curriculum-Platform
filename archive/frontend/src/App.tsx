import { useEffect, useState } from "react"
import { HashRouter, useLocation, useNavigate } from "react-router-dom"
import { api } from "./api"
import type { FacultyUser, Role } from "./types"
import { type Page } from "./components/ui"
import { Layout } from "./components/Layout"
import { ROUTES, DEFAULT_ROUTE, canAccessRoute, resolveRoute } from "./routes"
import { Login } from "./pages/Login"
import { Dashboard } from "./pages/Dashboard"
import { Progress, Upload } from "./pages/Upload"
import { Recommendations } from "./pages/Recommendations"
import { Mapping } from "./pages/Mapping"
import { Review } from "./pages/Review"
import { ExportShare } from "./pages/ExportShare"
import { Repository } from "./pages/Repository"
import { Activity } from "./pages/Activity"
import { Settings } from "./pages/Settings"
import { KnowledgeAdmin, Moderation } from "./pages/Admin"
import { AdminApprovals } from "./pages/AdminQueue"
import { Legal } from "./pages/Legal"
import type { AppCtx } from "./components/workspace"

const ACTIVE_JOB_KEY = "phact-v2-active-job"

export default function App() { return <HashRouter><PhactApp /></HashRouter> }

function PhactApp() {
  const routerNavigate = useNavigate()
  const location = useLocation()
  const [user, setUser] = useState<FacultyUser | null>(() => api.currentUser())
  const [toast, setToast] = useState("")
  const [menuOpen, setMenuOpen] = useState(false)
  const [activeJobId, setActiveJobId] = useState<string | null>(() => localStorage.getItem(ACTIVE_JOB_KEY))
  const hashPath = window.location.hash.replace(/^#/, "") || "/"
  const route = resolveRoute(location.pathname === "/" ? hashPath : location.pathname)
  const role: Role = user?.role || "faculty"

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(""), 2800)
    return () => clearTimeout(timer)
  }, [toast])
  useEffect(() => {
    if (!user || user.role !== "faculty") return
    api.listHistory(user).then((rows) => {
      if (activeJobId && rows.some((row) => row.jobId === activeJobId)) return
      const next = rows.find((row) => row.status === "COMPLETED")?.jobId || null
      setActiveJobId(next)
      if (next) localStorage.setItem(ACTIVE_JOB_KEY, next)
    })
  }, [user, activeJobId])
  useEffect(() => {
    if (!user || canAccessRoute(route, role)) return
    const targetPath = role === "admin" ? "/admin/sources" : DEFAULT_ROUTE.path
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${targetPath}`)
  }, [user, role, route, hashPath])
  useEffect(() => {
    if (hashPath === route.path) return
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${route.path}`)
  }, [hashPath, route.path])

  const navigate = (page: Page) => {
    const next = ROUTES.find((item) => item.id === page)
    if (next) routerNavigate(next.path)
    setMenuOpen(false)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }
  const openJob = (jobId: string, next?: Page) => {
    setActiveJobId(jobId)
    localStorage.setItem(ACTIVE_JOB_KEY, jobId)
    if (next) navigate(next)
  }
  const logout = () => { api.signOut(); setUser(null); routerNavigate("/dashboard") }
  const switchRole = async (nextRole: Role) => { const next = await api.switchRole(nextRole); setUser(next); routerNavigate(nextRole === "admin" ? "/admin/queue" : "/dashboard") }

  if (!user) return <Login onLogin={(next) => { setUser(next); navigate(next.role === "admin" ? "moderation" : "dashboard") }} />

  const effectivePage: Page = canAccessRoute(route, role) ? route.id : role === "admin" ? "knowledge-admin" : "dashboard"
  const ctx: AppCtx = { user, navigate, toast: setToast, activeJobId, openJob }
  const content = <>
    {effectivePage === "dashboard" && <Dashboard ctx={ctx} />}
    {effectivePage === "upload" && <Upload ctx={ctx} />}
    {effectivePage === "progress" && <Progress ctx={ctx} />}
    {effectivePage === "recommendations" && <Recommendations ctx={ctx} />}
    {effectivePage === "mapping" && <Mapping ctx={ctx} />}
    {effectivePage === "review" && <Review ctx={ctx} />}
    {effectivePage === "export" && <ExportShare ctx={ctx} />}
    {effectivePage === "repository" && <Repository />}
    {effectivePage === "activity" && <Activity ctx={ctx} />}
    {effectivePage === "settings" && <Settings ctx={ctx} onUserChange={setUser} />}
    {effectivePage === "knowledge-admin" && <KnowledgeAdmin ctx={ctx} />}
    {effectivePage === "community-moderation" && <Moderation ctx={ctx} />}
    {effectivePage === "moderation" && <AdminApprovals ctx={ctx} />}
    {(effectivePage === "privacy" || effectivePage === "terms") && <Legal type={effectivePage} />}
  </>
  return <Layout user={user} role={role} page={effectivePage} menuOpen={menuOpen} setMenuOpen={setMenuOpen} navigate={navigate} onLogout={logout} onRoleChange={switchRole} toast={toast}>{content}</Layout>
}
