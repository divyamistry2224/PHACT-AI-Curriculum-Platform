import { useState } from "react"
import { api } from "../api"
import { demoUsers } from "../mocks/fixtures/data"
import type { FacultyUser } from "../types"
import { BrandMark, ErrorNote, Icon, errorText, initials } from "../components/ui"

export function Login({ onLogin }: { onLogin: (user: FacultyUser) => void }) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const signIn = async (address: string) => {
    setError("")
    try { onLogin(await api.signIn(address)) } catch (e) { setError(errorText(e)) }
  }
  return (
    <div className="signin">
      <section className="signin-story">
        <div className="brand light"><BrandMark full /></div>
        <div><p className="eyebrow">Responsible curriculum transformation</p><h1>Bring AI into public health education with purpose.</h1><p>Evidence-grounded recommendations, competency alignment, and faculty review in one guided workspace.</p></div>
        <small>Developed for the Association of Schools and Programs of Public Health</small>
      </section>
      <section className="signin-form"><form onSubmit={(e) => { e.preventDefault(); signIn(email) }}>
        <p className="eyebrow">Secure sign in</p><h2>Welcome to PHACT</h2>
        <p>Sign in with your institutional account. In production, sign-in and roles are managed by your organization&apos;s identity service.</p>
        <label>Email address<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="faculty@university.edu" required /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Any password in demo mode" required minLength={4} /></label>
        <ErrorNote>{error}</ErrorNote><button className="primary wide" type="submit">Sign in</button>
        <div className="or"><span>or use a demo account</span></div>
        <div className="demo-accounts">{demoUsers.map((user) => <button key={user.id} type="button" className="demo-account" onClick={() => signIn(user.email)}><span>{initials(user.displayName)}</span><div><b>{user.role === "admin" ? "ASPPH Administrator" : "Faculty member"}</b><small>{user.displayName} · {user.email}</small></div><Icon name="arrow" size={15} /></button>)}</div>
        <p className="form-note">Mock mode uses sample data and saves changes in this browser.</p>
      </form></section>
    </div>
  )
}
