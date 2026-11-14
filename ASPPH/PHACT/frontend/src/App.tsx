import { useEffect, useState } from "react"
import { HashRouter, useLocation, useNavigate } from "react-router-dom"
import { SIGNED_OUT_EVENT, api, dataMode } from "./api"
import { COMPLETED_EXAMPLE_ID } from "./api/mock"
import type { Role, User } from "./types"
import { type Page } from "./components/ui"
import { Layout } from "./components/Layout"
import { ROUTES, canAccessRoute, homeFor, resolveRoute } from "./routes"
import { Login } from "./pages/Login"
import { Dashboard } from "./pages/Dashboard"
import { Progress, Upload } from "./pages/Upload"
import { Competency } from "./pages/Competency"
import { Recommendations } from "./pages/Recommendations"
import { Review } from "./pages/Review"
import { ExportPage } from "./pages/ExportShare"
import { Activity } from "./pages/Activity"
import { KnowledgeAdmin } from "./pages/Admin"
import { AdminApprovals } from "./pages/AdminQueue"
import { AdminFeedback } from "./pages/AdminFeedback"
import { Legal } from "./pages/Legal"
import type { AppCtx } from "./components/workspace"

const ACTIVE_SYLLABUS_KEY = "phact-active-syllabus"
const ACTIVE_REVIEW_KEY = "phact-active-review"

const stored = (key: string) => {
  try { return localStorage.getItem(key) } catch { return null }
}
const store = (key: string, value: string | null) => {
  try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key) } catch { /* storage unavailable */ }
}

export default function App() { return <HashRouter><PhactApp /></HashRouter> }

function PhactApp() {
  const routerNavigate = useNavigate()
  const location = useLocation()
  const [user, setUser] = useState<User | null>(() => api.currentUser())
  const [toast, setToast] = useState("")
  const [menuOpen, setMenuOpen] = useState(false)
  const [activeSyllabusId, setActiveSyllabusId] = useState<string | null>(() => stored(ACTIVE_SYLLABUS_KEY))
  const [activeReviewId, setActiveReviewId] = useState<string | null>(() => stored(ACTIVE_REVIEW_KEY))
  const route = resolveRoute(location.pathname)
  const role: Role = user?.role || "faculty"

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(""), 2800)
    return () => clearTimeout(timer)
  }, [toast])

  // The live adapter signals here when the session ends (token expired and couldn't be refreshed).
  useEffect(() => {
    const onSignedOut = () => setUser(null)
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut)
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut)
  }, [])

  // Default the faculty workflow to the newest syllabus when none is selected (or the selected one is gone).
  useEffect(() => {
    if (!user || user.role !== "faculty") return
    api.listSyllabi().then((rows) => {
      if (activeSyllabusId && rows.some((row) => row.syllabusId === activeSyllabusId)) return
      const next = rows[0]?.syllabusId || null
      setActiveSyllabusId(next)
      store(ACTIVE_SYLLABUS_KEY, next)
    }).catch(() => undefined)
  }, [user, activeSyllabusId])

  const navigate = (page: Page) => {
    const next = ROUTES.find((item) => item.id === page)
    if (next) routerNavigate(next.path)
    setMenuOpen(false)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }
  const openSyllabus = (syllabusId: string, next?: Page) => {
    setActiveSyllabusId(syllabusId)
    store(ACTIVE_SYLLABUS_KEY, syllabusId)
    if (next) navigate(next)
  }
  const watchReview = (reviewId: string) => {
    setActiveReviewId(reviewId)
    store(ACTIVE_REVIEW_KEY, reviewId)
    navigate("progress")
  }
  const logout = () => {
    api.signOut()
    setUser(null)
    store(ACTIVE_SYLLABUS_KEY, null)
    store(ACTIVE_REVIEW_KEY, null)
    setActiveSyllabusId(null)
    setActiveReviewId(null)
    routerNavigate("/dashboard")
  }
  const switchRole = api.switchRole
    ? async (nextRole: Role) => {
        const next = await api.switchRole!(nextRole)
        setUser(next)
        navigate(homeFor(nextRole))
      }
    : undefined

  if (!user) return <Login onLogin={(next, example) => { setUser(next); if (example) openSyllabus(COMPLETED_EXAMPLE_ID, "recommendations"); else navigate(homeFor(next.role)) }} />

  const effectivePage: Page = canAccessRoute(route, role) ? route.id : homeFor(role)
  const ctx: AppCtx = { user, navigate, toast: setToast, activeSyllabusId, openSyllabus, activeReviewId, watchReview }
  const content = <>
    {dataMode === "mock" && role === "faculty" && <section className="example-toolbar" aria-labelledby="example-title">
      <div className="example-toolbar-heading"><h2 id="example-title">EPID 601 · Worked example</h2></div>
      <p className="example-toolbar-description">Original syllabus → competency edits → AI recommendations. Explore all three versions and the accepted changes.</p>
      <div className="example-toolbar-actions"><button className="secondary small" onClick={() => openSyllabus(COMPLETED_EXAMPLE_ID, "competency")}>Competency suggestions</button><button className="primary small" onClick={() => openSyllabus(COMPLETED_EXAMPLE_ID, "recommendations")}>AI recommendations</button><button className="secondary small" onClick={() => openSyllabus(COMPLETED_EXAMPLE_ID, "review")}>Compare versions</button><button className="secondary small" onClick={() => openSyllabus(COMPLETED_EXAMPLE_ID, "export")}>Export syllabus</button></div>
    </section>}

    {effectivePage === "dashboard" && <Dashboard ctx={ctx} />}
    {effectivePage === "upload" && <Upload ctx={ctx} />}
    {effectivePage === "progress" && <Progress ctx={ctx} />}
    {effectivePage === "competency" && <Competency ctx={ctx} />}
    {effectivePage === "recommendations" && <Recommendations ctx={ctx} />}
    {effectivePage === "review" && <Review ctx={ctx} />}
    {effectivePage === "export" && <ExportPage ctx={ctx} />}
    {effectivePage === "activity" && <Activity ctx={ctx} />}
    {effectivePage === "approvals" && <AdminApprovals ctx={ctx} />}
    {effectivePage === "knowledge" && <KnowledgeAdmin ctx={ctx} />}
    {effectivePage === "feedback" && <AdminFeedback />}
    {(effectivePage === "privacy" || effectivePage === "terms") && <Legal type={effectivePage} />}
  </>
  return <Layout user={user} role={role} page={effectivePage} menuOpen={menuOpen} setMenuOpen={setMenuOpen} navigate={navigate} onLogout={logout} onRoleChange={switchRole} onOpenSyllabus={(id) => openSyllabus(id, "review")} toast={toast}>{content}</Layout>
}
