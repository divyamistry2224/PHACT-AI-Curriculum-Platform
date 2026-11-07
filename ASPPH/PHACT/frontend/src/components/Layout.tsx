import { useEffect, useState, type ReactNode } from "react"
import type { Role, User } from "../types"
import { BrandMark, Icon, initials, type Page } from "./ui"
import { getNavigation, getRoute } from "../routes"
import { api, dataMode } from "../api"
import { markRead, notificationsFor, type Notification } from "../lib/notifications"

export interface LayoutProps {
  user: User
  role: Role
  page: Page
  menuOpen: boolean
  setMenuOpen: (open: boolean) => void
  navigate: (page: Page) => void
  onLogout: () => void
  /** Only in mock mode: switch between the demo faculty and admin users. */
  onRoleChange?: (role: Role) => void
  onOpenSyllabus: (syllabusId: string) => void
  children: ReactNode
  toast?: string
}

const NOTIFICATION_POLL_MS = 60_000

export function Layout({ user, role, page, menuOpen, setMenuOpen, navigate, onLogout, onRoleChange, onOpenSyllabus, children, toast }: LayoutProps) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [showNotifications, setShowNotifications] = useState(false)
  useEffect(() => {
    if (role !== "faculty") return
    const load = () => api.listSyllabi().then((rows) => setNotifications(notificationsFor(rows))).catch(() => setNotifications([]))
    load()
    const timer = setInterval(load, NOTIFICATION_POLL_MS)
    return () => clearInterval(timer)
  }, [user.userId, role, page])
  const unread = notifications.filter((n) => !n.read).length
  const nav = getNavigation(role)
  const active = page === "progress" ? "upload" : page
  const current = getRoute(page).label
  const groups = [...new Set(nav.map((item) => item.group).filter(Boolean))]

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="brand"><BrandMark /></div>
        <button className="mobile-close icon-button" onClick={() => setMenuOpen(false)} aria-label="Close menu"><Icon name="close" /></button>
        <div className="role-label">{role === "admin" ? "ASPPH administration" : "Faculty workspace"}</div>
        <nav aria-label="Primary navigation">
          {groups.map((group) => (
            <div className="nav-group" key={group}>
              <span className="nav-group-label">{group}</span>
              {nav.filter((item) => item.group === group).map((item) => (
                <button key={item.id} className={active === item.id ? "active" : ""} onClick={() => navigate(item.id)} aria-current={active === item.id ? "page" : undefined}>
                  <Icon name={item.icon || "file"} /><span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="user-chip"><span>{initials(user.name)}</span><div><b>{user.name}</b><small>{role === "admin" ? "ASPPH Administrator" : user.email}</small></div></div>
          <button className="text-button" onClick={onLogout}>Sign out</button>
        </div>
      </aside>
      {menuOpen && <button className="scrim" aria-label="Close menu" onClick={() => setMenuOpen(false)} />}
      <main className="main" id="main-content">
        <header className="topbar">
          <button className="menu-button icon-button" onClick={() => setMenuOpen(true)} aria-label="Open menu"><Icon name="menu" /></button>
          <div className="breadcrumb"><span>PHACT</span><Icon name="arrow" size={13} /><b>{current}</b></div>
          <span className="role-switcher">
            {dataMode === "mock" && <span>Mock mode</span>}
            {role === "faculty" && (
              <span className="notification-wrap">
                <button className="icon-button notification-button" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} onClick={() => setShowNotifications((open) => !open)}>
                  <Icon name="bell" size={18} />{unread > 0 && <b>{unread}</b>}
                </button>
                {showNotifications && (
                  <div className="notification-panel" role="dialog" aria-label="Notifications">
                    <strong>Notifications</strong>
                    {notifications.length === 0 ? <p className="muted">No approval decisions yet.</p> : notifications.slice(0, 5).map((n) => (
                      <button key={n.id} className={n.read ? "read" : "unread"} onClick={() => {
                        markRead(n.id)
                        setNotifications((items) => items.map((item) => (item.id === n.id ? { ...item, read: true } : item)))
                        onOpenSyllabus(n.syllabusId)
                        setShowNotifications(false)
                      }}>
                        <b>{n.title}</b><span>{n.message}</span>
                      </button>
                    ))}
                  </div>
                )}
              </span>
            )}
            {onRoleChange ? (
              <label><span className="sr-only">Demo role</span><select value={role} onChange={(e) => onRoleChange(e.target.value as Role)} aria-label="Demo role"><option value="faculty">Faculty</option><option value="admin">Administrator</option></select></label>
            ) : (
              <strong>{role === "admin" ? "Administrator" : "Faculty"}</strong>
            )}
          </span>
        </header>
        <div className="content page-enter" key={`${page}-${role}`}>{children}</div>
        <footer><span>PHACT prototype{dataMode === "mock" ? " · Mock mode: sample data in this browser" : ""}</span><span><button onClick={() => navigate("privacy")}>Privacy Policy</button><button onClick={() => navigate("terms")}>Terms of Service</button></span></footer>
      </main>
      {toast && <div className="toast" role="status"><Icon name="check" />{toast}</div>}
    </div>
  )
}
