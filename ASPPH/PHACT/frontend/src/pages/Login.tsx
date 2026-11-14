import { useState } from "react"
import { api, dataMode } from "../api"
import type { User } from "../types"
import { BrandMark, ErrorNote, Icon, errorText } from "../components/ui"

const DEMO_ACCOUNTS = [
  { email: "faculty@phact.demo", label: "Faculty member", name: "Dr. Maya Chen" },
  { email: "admin@phact.demo", label: "ASPPH Administrator", name: "ASPPH Administrator" },
]

export function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const signIn = async (address: string, secret: string) => {
    setError("")
    setBusy(true)
    try {
      onLogin(await api.signIn(address, secret))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="signin">
      <section className="signin-story">
        <div className="brand light"><BrandMark full /></div>
        <div><p className="eyebrow">Responsible curriculum transformation</p><h1>Bring AI into public health education with purpose.</h1><p>CEPH competency grading, AI-era teaching recommendations grounded in approved peer syllabi, and administrator review in one guided workspace.</p></div>
        <small>Developed for the Association of Schools and Programs of Public Health</small>
      </section>
      <section className="signin-form"><form onSubmit={(e) => { e.preventDefault(); signIn(email, password) }}>
        <p className="eyebrow">{dataMode === "live" ? "Secure sign in" : "Public demonstration"}</p><h2>Welcome to PHACT</h2>
        <p>{dataMode === "live" ? "Sign in with the account your PHACT administrator created for you." : "Explore the faculty or administrator demo below. Reviews use sample data and simulated AI responses; the hackathon AWS environment has expired."}</p>
        <label>Email address<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="faculty@university.edu" required /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={dataMode === "live" ? "Your password" : "Any password in mock mode"} required minLength={dataMode === "live" ? 8 : 1} /></label>
        <ErrorNote>{error}</ErrorNote><button className="primary wide" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        {dataMode === "live" ? (
          <p className="form-note">Demo accounts: <b>faculty@phact.demo</b> and <b>admin@phact.demo</b>. Ask your team lead for the passwords.</p>
        ) : (
          <>
            <p className="form-note">Try our example: <b>EPID 601: Applied Epidemiologic Methods</b>, a fictional Harbor State University syllabus. <a href={`${import.meta.env.BASE_URL}sample-syllabus.docx`} download>Download the syllabus (DOCX)</a>.</p>
            <ol className="form-note"><li>Choose <b>Faculty member</b> below and open <b>Upload a syllabus</b>.</li><li>Click <b>Load example syllabus</b>, then <b>Upload and Run Competency Review</b>.</li><li>Review suggestions, explore AI recommendations, save and export your revision, then submit it for approval.</li><li>Switch to <b>Administrator</b> to review the submission.</li></ol>
            <div className="or"><span>Choose a demo account</span></div>
            <div className="demo-accounts">{DEMO_ACCOUNTS.map((account) => <button key={account.email} type="button" className="demo-account" onClick={() => signIn(account.email, "mock")}><span>{account.name.replace(/^Dr\.\s*/, "").split(" ").map((p) => p[0]).join("").slice(0, 2)}</span><div><b>{account.label}</b><small>{account.name} · {account.email}</small></div><Icon name="arrow" size={15} /></button>)}</div>
          </>
        )}
      </form></section>
    </div>
  )
}
