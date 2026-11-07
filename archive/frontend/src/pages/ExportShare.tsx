import { useEffect, useState } from "react"
import { api } from "../api"
import type { CompetencyMapping, SharedContribution } from "../types"
import { BrandMark, EmptyState, ErrorNote, Icon, ModerationBadge, PageHeader, errorText, fmtDate } from "../components/ui"
import { useAnalysis, type AppCtx } from "../components/workspace"
import { buildDocx, downloadBlob, type DocBlock } from "../lib/docx"
import { JobGate } from "./Recommendations"

const SUBJECTS = ["Epidemiology", "Biostatistics", "Ethics", "Environmental Health", "Health Policy", "Global Health", "Community Health", "Health Equity"]

export function ExportShare({ ctx }: { ctx: AppCtx }) {
  const analysis = useAnalysis(ctx.activeJobId)
  const [mappings, setMappings] = useState<CompetencyMapping[]>([])
  const [picked, setPicked] = useState<Set<string> | null>(null)
  const [opts, setOpts] = useState({ course: true, mappings: true, citations: true })
  const [contributions, setContributions] = useState<SharedContribution[]>([])
  const [shareOpen, setShareOpen] = useState(true)

  useEffect(() => {
    if (ctx.activeJobId) api.getCompetencyMappings(ctx.activeJobId).then(setMappings)
    api.listContributions(ctx.user.id).then(setContributions)
    api.getSettings(ctx.user).then((s) => setShareOpen(s.shareReminder))
  }, [ctx.activeJobId, ctx.user])

  const syllabus = analysis.data?.syllabus
  // Business rule: only approved recommendations are ever exportable.
  const approved = (analysis.data?.recommendations || []).filter((r) => r.status === "APPROVED")
  const selected = approved.filter((r) => (picked ? picked.has(r.id) : true))
  const toggle = (id: string) => {
    const next = new Set(picked ?? approved.map((r) => r.id))
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setPicked(next)
  }

  const exportDocx = () => {
    if (!syllabus) return
    const blocks: DocBlock[] = [
      { kind: "title", text: `${syllabus.courseName}: Approved AI Integration Plan` },
      { kind: "note", text: `Prepared with PHACT · Exported ${fmtDate(new Date().toISOString())} by ${ctx.user.displayName}` },
    ]
    if (opts.course) blocks.push({ kind: "heading", text: "Course information" }, { kind: "para", text: `${syllabus.subject}. ${syllabus.description}` }, { kind: "note", text: `Faculty: ${ctx.user.displayName}, ${ctx.user.institution}` })
    blocks.push({ kind: "heading", text: "Approved recommendations" })
    selected.forEach((r, i) => {
      blocks.push(
        { kind: "subheading", text: `${i + 1}. ${r.title}` },
        { kind: "note", text: `${r.module} · ${r.activityType} · Approved by ${r.reviewedBy} on ${fmtDate(r.reviewedAt)}` },
        { kind: "para", text: r.description },
        { kind: "para", text: `Rationale: ${r.rationale}` },
        ...r.implementationSteps.map((s) => ({ kind: "bullet" as const, text: s })),
        { kind: "para", text: `Learning outcomes: ${r.learningOutcomes.join(" ")}` },
        { kind: "para", text: `Responsible AI: ${r.responsibleAI}` },
      )
      if (opts.citations) r.citations.forEach((c) => blocks.push({ kind: "note", text: `[${c.kind === "Authoritative" ? "Authoritative" : "Faculty example"}] ${c.title}, ${c.publisher}, v${c.version}${c.illustrative ? " (illustrative demo citation)" : ""}` }))
    })
    if (opts.mappings && mappings.length) {
      blocks.push({ kind: "heading", text: "Competency mapping" })
      mappings.forEach((m) => blocks.push({ kind: "subheading", text: m.objective }, { kind: "para", text: `${m.alignment}: ${m.competency}` }, { kind: "note", text: `Suggested improvement: ${m.improvement}${opts.citations ? ` · Source: ${m.source}` : ""}` }))
    }
    blocks.push({ kind: "note", text: "AI-generated recommendations reviewed and approved by faculty. They are not accreditation requirements." })
    downloadBlob(buildDocx(blocks), `${syllabus.courseName.replace(/[^\w]+/g, "-")}-PHACT-plan.docx`)
    ctx.toast("DOCX downloaded")
  }

  return (
    <>
      <PageHeader eyebrow="Step 5 of 6" title="Export and share" description="Download your approved recommendations for your course records. Sharing with other educators is optional and handled separately." />
      <JobGate ctx={ctx} analysis={analysis}>
        {!approved.length ? (
          <div className="panel">
            <EmptyState icon="review" title="No approved recommendations for this course" action={<button className="primary small" onClick={() => ctx.navigate("review")}>Go to Review & Approval</button>}>
              Only approved recommendations can be exported or shared.
            </EmptyState>
          </div>
        ) : (
          <div className="export-grid">
            <section className="panel">
              <div className="section-heading">
                <span>01</span>
                <div>
                  <h2>Select approved items</h2>
                  <p>{syllabus?.courseName} · {selected.length} of {approved.length} selected</p>
                </div>
              </div>
              <div className="selection-list">
                {approved.map((r) => (
                  <label key={r.id}>
                    <input type="checkbox" checked={selected.some((s) => s.id === r.id)} onChange={() => toggle(r.id)} />
                    <div>
                      <b>{r.title}</b>
                      <small>Approved by {r.reviewedBy} · {fmtDate(r.reviewedAt)}</small>
                    </div>
                  </label>
                ))}
              </div>
              <div className="export-options">
                <label><input type="checkbox" checked={opts.course} onChange={(e) => setOpts({ ...opts, course: e.target.checked })} /> Include course information</label>
                <label><input type="checkbox" checked={opts.mappings} onChange={(e) => setOpts({ ...opts, mappings: e.target.checked })} /> Include competency mappings</label>
                <label><input type="checkbox" checked={opts.citations} onChange={(e) => setOpts({ ...opts, citations: e.target.checked })} /> Include supporting citations</label>
              </div>
              <div className="button-row">
                <button className="primary" disabled={!selected.length} onClick={() => window.print()}><Icon name="download" size={16} /> Export PDF</button>
                <button className="secondary" disabled={!selected.length} onClick={exportDocx}><Icon name="file" size={16} /> Export DOCX</button>
              </div>
              <p className="form-hint">PDF opens your browser's print dialog. Choose “Save as PDF”.</p>
            </section>
            <aside className="panel export-preview">
              <div className="paper">
                <div className="paper-head"><BrandMark /> <span>Approved plan</span></div>
                <h2>{syllabus?.courseName}</h2>
                <p>Prepared for {ctx.user.displayName} · {fmtDate(new Date().toISOString())}</p>
                {opts.course && syllabus && (
                  <div>
                    <small>Course information</small>
                    <p>{syllabus.subject}. {syllabus.description}</p>
                  </div>
                )}
                <hr />
                {!selected.length && <p className="muted">Select at least one item to preview.</p>}
                {selected.map((r, i) => (
                  <div key={r.id}>
                    <small>Recommendation {i + 1} · {r.module}</small>
                    <h3>{r.title}</h3>
                    <p>{r.description}</p>
                    {opts.citations && <p className="paper-cite">Sources: {r.citations.map((c) => `${c.title} (${c.kind === "Authoritative" ? "authoritative" : "faculty example"})`).join("; ")}</p>}
                  </div>
                ))}
                {opts.mappings && mappings.length > 0 && (
                  <div>
                    <small>Competency mapping</small>
                    {mappings.map((m) => (
                      <p key={m.id}><b>{m.alignment}:</b> {m.objective}</p>
                    ))}
                  </div>
                )}
                <p className="paper-foot">Faculty-approved AI-generated recommendations. Not accreditation requirements.</p>
              </div>
            </aside>
          </div>
        )}
        {approved.length > 0 && (
          <SharePanel ctx={ctx} approved={approved} subject={syllabus?.subject || SUBJECTS[0]} contributions={contributions} onSubmitted={(c) => setContributions([c, ...contributions])} open={shareOpen} setOpen={setShareOpen} />
        )}
      </JobGate>
    </>
  )
}

function SharePanel({
  ctx, approved, subject, contributions, onSubmitted, open, setOpen,
}: {
  ctx: AppCtx
  approved: { id: string; title: string; description: string }[]
  subject: string
  contributions: SharedContribution[]
  onSubmitted: (c: SharedContribution) => void
  open: boolean
  setOpen: (v: boolean) => void
}) {
  const taken = new Set(contributions.filter((c) => c.moderationStatus !== "REJECTED").map((c) => c.recommendationId))
  const eligible = approved.filter((r) => !taken.has(r.id))
  const [recId, setRecId] = useState("")
  const current = eligible.find((r) => r.id === recId) || eligible[0]
  const [form, setForm] = useState({ title: "", description: "", subject })
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (current) setForm({ title: current.title, description: current.description, subject })
    setConsent(false)
  }, [current?.id, subject])

  const submit = async () => {
    if (!current) return
    setError("")
    try {
      const c = await api.submitContribution(ctx.user, { recommendationId: current.id, title: form.title, description: form.description, courseSubject: form.subject, consent })
      onSubmitted(c)
      setRecId("")
      ctx.toast("Submitted for community review")
    } catch (e) {
      setError(errorText(e))
    }
  }
  const courseContribs = contributions.filter((c) => approved.some((r) => r.id === c.recommendationId))

  return (
    <section className="panel share-panel">
      <div className="section-heading">
        <span><Icon name="people" /></span>
        <div>
          <h2>Contribute to the PHACT Knowledge Community</h2>
          <p>Optionally share an approved resource to help other public health educators. Your syllabus is never shared. Submissions are reviewed by ASPPH moderators before anything is published.</p>
        </div>
        <label className="switch">
          <span className="sr-only">Show sharing form</span>
          <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} />
          <span />
        </label>
      </div>
      {open && (
        <div className="share-form">
          {!eligible.length ? (
            <p className="muted">Every approved recommendation for this course has already been submitted.</p>
          ) : (
            <>
              <label>
                Approved recommendation to share
                <select value={current?.id} onChange={(e) => setRecId(e.target.value)}>
                  {eligible.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
                </select>
              </label>
              <div className="form-grid">
                <label>Resource title<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
                <label>
                  Course subject
                  <select value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })}>
                    {[...new Set([subject, ...SUBJECTS])].map((s) => <option key={s}>{s}</option>)}
                  </select>
                </label>
              </div>
              <label>Description<textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Describe the resource for other educators. Remove student or institutional details." /></label>
              <label className="consent">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>I consent to share this approved resource with the PHACT Knowledge Community. I understand it will be screened and moderated, may be edited for privacy, and if published can be retrieved as a faculty example for other educators.</span>
              </label>
              <ErrorNote>{error}</ErrorNote>
              <button className="primary" disabled={!consent} onClick={submit}>Submit for Community Review</button>
            </>
          )}
          {courseContribs.length > 0 && (
            <div className="my-submissions">
              <p className="eyebrow">Your submissions from this course</p>
              {courseContribs.map((c) => (
                <div key={c.id}>
                  <div>
                    <b>{c.title}</b>
                    <small>Submitted {fmtDate(c.submittedAt)}{c.rejectionReason ? ` · ${c.rejectionReason}` : ""}</small>
                  </div>
                  <ModerationBadge status={c.moderationStatus} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
