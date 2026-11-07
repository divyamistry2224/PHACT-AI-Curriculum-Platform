import { useEffect, useState } from "react"
import { api } from "../api"
import type { FacultySettings, FacultyUser } from "../types"
import { ErrorNote, Icon, PageHeader, errorText, initials } from "../components/ui"
import type { AppCtx } from "../components/workspace"

export function Settings({ ctx, onUserChange }: { ctx: AppCtx; onUserChange: (u: FacultyUser) => void }) {
  const [s, setS] = useState<FacultySettings | null>(null)
  const [error, setError] = useState("")
  useEffect(() => {
    api.getSettings(ctx.user).then(setS)
  }, [ctx.user.id])
  if (!s) return null
  const save = async () => {
    setError("")
    try {
      onUserChange(await api.saveSettings(ctx.user, s))
      ctx.toast("Settings saved")
    } catch (e) {
      setError(errorText(e))
    }
  }
  const toggle = (k: "notifyAnalysis" | "notifyModeration" | "shareReminder", title: string, hint: string) => (
    <label className="toggle-row">
      <span><b>{title}</b><small>{hint}</small></span>
      <span className="switch">
        <input type="checkbox" checked={s[k]} onChange={(e) => setS({ ...s, [k]: e.target.checked })} />
        <span />
      </span>
    </label>
  )
  return (
    <>
      <PageHeader eyebrow="Settings" title="Account and preferences" description="Manage your profile, notifications, and sharing preferences. PHACT analyzes each syllabus automatically; there is nothing to configure for the recommendations themselves." />
      <div className="settings-grid">
        <section className="panel">
          <h2>Faculty profile</h2>
          <div className="profile-block">
            <span>{initials(s.displayName)}</span>
            <div>
              <b>{s.displayName}</b>
              <p>{ctx.user.email}</p>
            </div>
          </div>
          <label>Display name<input value={s.displayName} onChange={(e) => setS({ ...s, displayName: e.target.value })} /></label>
          <label>Title<input value={s.title} onChange={(e) => setS({ ...s, title: e.target.value })} /></label>
          <label>Institution<input value={s.institution} onChange={(e) => setS({ ...s, institution: e.target.value })} /></label>
        </section>
        <section className="panel">
          <h2>Notifications and sharing</h2>
          {toggle("notifyAnalysis", "Analysis complete", "Email me when a syllabus analysis finishes or needs attention.")}
          {toggle("notifyModeration", "Community review updates", "Email me when a shared resource is published or returned.")}
          {toggle("shareReminder", "Show community sharing on Export", "Open the optional sharing form when I export approved results. Sharing always requires separate consent.")}
        </section>
        <section className="panel">
          <h2>Privacy</h2>
          <ul className="check-list">
            <li><Icon name="lock" size={16} /><span>Uploaded syllabi are stored privately and are visible only to you.</span></li>
            <li><Icon name="shield" size={16} /><span>Personal information is screened before analysis, and inputs pass safety checks.</span></li>
            <li><Icon name="people" size={16} /><span>Nothing is shared with the community unless you approve it, consent, and it passes moderation.</span></li>
            <li><Icon name="spark" size={16} /><span>AI-generated recommendations never become authoritative sources.</span></li>
          </ul>
          <button className="text-button" onClick={() => ctx.navigate("privacy")}>Read the privacy policy</button>
        </section>
        <section className="panel">
          <h2>Account security</h2>
          <div className="security-note">
            <Icon name="shield" />
            <p>Sign-in, passwords, and multi-factor authentication are managed by your institution's identity provider. PHACT never stores your password.</p>
          </div>
          <dl className="plain-dl">
            <div><dt>Signed in as</dt><dd>{ctx.user.email}</dd></div>
            <div><dt>Role</dt><dd>{ctx.user.role === "admin" ? "ASPPH Administrator" : "Faculty"}</dd></div>
          </dl>
          <button
            className="secondary small danger-border"
            onClick={() => {
              if (!confirm("Reset all demo data in this browser?")) return
              api.resetDemo()
              location.reload()
            }}
          >
            Reset demo data
          </button>
        </section>
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="save-bar">
        <button className="primary" onClick={save}>Save changes</button>
      </div>
    </>
  )
}
