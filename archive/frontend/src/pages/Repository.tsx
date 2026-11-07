import { useEffect, useState } from "react"
import { api } from "../api"
import type { KnowledgeSource } from "../types"
import { EmptyState, Icon, Kind, PageHeader, fmtDate } from "../components/ui"

type Group = "All" | "Authoritative" | "Faculty Example"
const groupLabel = { Authoritative: "Authoritative Curriculum Resources", "Faculty Example": "Faculty-Approved Teaching Examples" }

export function Repository() {
  const [sources, setSources] = useState<KnowledgeSource[]>([])
  const [group, setGroup] = useState<Group>("All")
  const [category, setCategory] = useState("All categories")
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<string | null>(null)
  useEffect(() => {
    // Faculty only see sources that are current and indexed for retrieval.
    api.listKnowledgeSources("faculty").then(setSources)
  }, [])
  const q = query.toLowerCase()
  const inGroup = sources.filter((s) => group === "All" || s.sourceType === group)
  const categories = ["All categories", ...new Set(inGroup.map((s) => s.category))]
  const shown = inGroup.filter(
    (s) => (category === "All categories" || s.category === category) && (!q || `${s.title} ${s.summary} ${s.publisher} ${s.competencies.join(" ")}`.toLowerCase().includes(q)),
  )
  const detail = shown.find((s) => s.id === selected) || shown[0]
  const count = (g: Group) => (g === "All" ? sources.length : sources.filter((s) => s.sourceType === g).length)

  return (
    <>
      <PageHeader eyebrow="Knowledge Repository" title="Trusted sources behind every recommendation" description="Search the resources PHACT draws on. Official curriculum resources and faculty-approved teaching examples are kept distinct so you always know what kind of evidence you are reading." />
      <div className="repository-explainer">
        <div>
          <span className="source-letter authoritative">A</span>
          <div>
            <b>{groupLabel.Authoritative}</b>
            <p>Accreditation criteria, ASPPH guidance, workforce expectations, and curated references maintained by ASPPH.</p>
          </div>
        </div>
        <div>
          <span className="source-letter faculty">F</span>
          <div>
            <b>{groupLabel["Faculty Example"]}</b>
            <p>Activities and adaptations that faculty approved, chose to share, and ASPPH moderated before publication.</p>
          </div>
        </div>
      </div>
      <div className="searchbar">
        <Icon name="search" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by title, topic, publisher, or competency" aria-label="Search repository" />
        <div className="tabs small">
          {(["All", "Authoritative", "Faculty Example"] as Group[]).map((g) => (
            <button
              key={g}
              className={group === g ? "active" : ""}
              onClick={() => {
                setGroup(g)
                setCategory("All categories")
              }}
            >
              {g === "All" ? "All" : g === "Authoritative" ? "Authoritative" : "Faculty examples"}
              <span>{count(g)}</span>
            </button>
          ))}
        </div>
        <select className="category-select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          {categories.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      <div className="repository-grid">
        <div className="resource-list">
          {!shown.length && <div className="panel"><EmptyState icon="search" title="No resources match your search">Try a different keyword or category.</EmptyState></div>}
          {shown.map((s) => (
            <button key={s.id} className={`panel resource-card ${detail?.id === s.id ? "active" : ""}`} onClick={() => setSelected(s.id)}>
              <div>
                <div className="rec-meta">
                  <Kind type={s.sourceType}>{s.sourceType === "Authoritative" ? "Authoritative resource" : "Faculty-approved example"}</Kind>
                  <span>{s.category}</span>
                </div>
                <h2>{s.title}</h2>
                <p>{s.summary}</p>
                <small>{s.publisher} · Updated {fmtDate(s.updatedAt)}</small>
              </div>
            </button>
          ))}
        </div>
        {detail && (
          <aside className="panel resource-detail">
            <Kind type={detail.sourceType}>{groupLabel[detail.sourceType]}</Kind>
            <h2>{detail.title}</h2>
            <p>{detail.summary}</p>
            <dl>
              <div><dt>Source type</dt><dd>{detail.sourceType === "Authoritative" ? "Authoritative" : "Faculty example"}</dd></div>
              <div><dt>Category</dt><dd>{detail.category}</dd></div>
              <div><dt>{detail.sourceType === "Authoritative" ? "Publisher" : "Contributor"}</dt><dd>{detail.publisher}</dd></div>
              <div><dt>Version</dt><dd>{detail.version}</dd></div>
              <div><dt>Status</dt><dd>{detail.approvalStatus === "PUBLISHED" ? "Published" : "Current"}</dd></div>
              <div><dt>Last updated</dt><dd>{fmtDate(detail.updatedAt)}</dd></div>
            </dl>
            {detail.competencies.length > 0 && (
              <>
                <h3>Relevant competencies</h3>
                <div className="tag-list">{detail.competencies.map((c) => <span key={c}>{c}</span>)}</div>
              </>
            )}
            <h3>About this resource</h3>
            <p className="detail-body">{detail.body}</p>
            <p className="source-note">Demonstration record. {detail.sourceType === "Faculty Example" ? "Faculty examples illustrate approaches; they are not authoritative requirements." : "Confirm language against the current published document."}</p>
          </aside>
        )}
      </div>
    </>
  )
}
