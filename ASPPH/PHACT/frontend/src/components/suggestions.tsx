import { useMemo, useState, type ReactNode } from "react"
import { api } from "../api"
import type { Hunk, HunkDecision, ReviewSummary, SyllabusSummary } from "../types"
import { ErrorNote, Icon, Status, errorText, fmtDateTime } from "./ui"
import type { AppCtx } from "./workspace"

/** One suggestion the faculty member decides on: a CEPH change or an AI recommendation, with its changes. */
export interface SuggestionGroup {
  key: string
  title: string
  subtitle?: string
  badges?: ReactNode
  details?: ReactNode
  hunkIds: string[]
}

type Choice = "accept" | "decline"

const lines = (text: string) => (text ? text.split("\n") : [])

function HunkView({ hunk, text, editing, onEdit, onDone, onReset, editable, edited }: {
  hunk: Hunk
  text: string
  editing: boolean
  onEdit: (text: string) => void
  onDone: () => void
  onReset: () => void
  editable: boolean
  edited: boolean
}) {
  return (
    <div className="hunk">
      {hunk.contextBefore && <div className="hunk-context">{lines(hunk.contextBefore).map((l, i) => <p key={i}>{l || " "}</p>)}</div>}
      {hunk.beforeLines > 0 && <div className="diff-delete">{lines(hunk.before).map((l, i) => <p key={i}>{l || " "}</p>)}</div>}
      {editing ? (
        <div className="hunk-editor">
          <label><span className="sr-only">Edit the new text</span><textarea rows={Math.min(14, Math.max(3, text.split("\n").length + 1))} value={text} onChange={(e) => onEdit(e.target.value)} /></label>
          <div className="button-row"><button className="secondary small" onClick={onDone}><Icon name="check" size={14} /> Done editing</button>{edited && <button className="text-button" onClick={onReset}>Undo my edits</button>}</div>
        </div>
      ) : (
        (hunk.afterLines > 0 || text) && <div className="diff-insert">{lines(text).map((l, i) => <p key={i}>{l || " "}</p>)}</div>
      )}
      {hunk.contextAfter && <div className="hunk-context">{lines(hunk.contextAfter).map((l, i) => <p key={i}>{l || " "}</p>)}</div>}
      {editable && !editing && (hunk.afterLines > 0 || edited) && <button className="text-button hunk-edit" onClick={() => onEdit(text)}><Icon name="edit" size={13} /> {edited ? "Edit again" : "Edit before accepting"}</button>}
    </div>
  )
}

/**
 * Accept, decline, or edit each suggestion, then save. Accepted changes (with edits) become the next version;
 * declining everything creates no version. After saving, shows what was decided.
 */
export function SuggestionReview({ ctx, syllabus, review, hunks, groups, onSaved }: {
  ctx: AppCtx
  syllabus: SyllabusSummary
  review: ReviewSummary
  hunks: Hunk[]
  groups: SuggestionGroup[]
  onSaved: () => void
}) {
  const byId = useMemo(() => Object.fromEntries(hunks.map((h) => [h.id, h])), [hunks])
  const decidable = groups.filter((g) => g.hunkIds.length)
  const [choice, setChoice] = useState<Record<string, Choice>>({})
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const pending = review.jobStatus === "COMPLETED" && !review.decidedAt && syllabus.pendingReviewId === review.reviewId
  const accepted = decidable.filter((g) => choice[g.key] === "accept")
  const undecided = decidable.filter((g) => !choice[g.key]).length
  const editedCount = Object.keys(edits).filter((id) => edits[id] !== byId[id]?.after && accepted.some((g) => g.hunkIds.includes(id))).length
  const nextVersion = syllabus.currentVersion + 1

  const setAll = (value: Choice) => setChoice(Object.fromEntries(decidable.map((g) => [g.key, value])))
  const save = async () => {
    const decisions: HunkDecision[] = []
    for (const group of decidable) {
      for (const hunkId of group.hunkIds) {
        const accept = choice[group.key] === "accept"
        const text = edits[hunkId]
        decisions.push(accept && text !== undefined && text !== byId[hunkId].after ? { hunkId, accept, text } : { hunkId, accept })
      }
    }
    const message = accepted.length
      ? `Save version ${nextVersion} with ${accepted.length} of ${decidable.length} suggestion${decidable.length === 1 ? "" : "s"}?${undecided ? ` ${undecided} undecided will be left out.` : ""}`
      : "Decline every suggestion? Your syllabus stays as it is."
    if (!confirm(message)) return
    setBusy(true)
    setError("")
    try {
      const result = await api.decideReview(review.reviewId, decisions)
      ctx.toast(result.review.outputVersion ? `Saved as version ${result.review.outputVersion}` : "Suggestions declined; nothing changed")
      onSaved()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  // ---------------- after deciding: read-only
  if (!pending) {
    const acceptedIds = new Set((review.acceptedHunks || []).map((h) => h.hunkId))
    const editedIds = new Set((review.acceptedHunks || []).filter((h) => h.edited).map((h) => h.hunkId))
    return (
      <div className="suggestions">
        <DecidedBar ctx={ctx} syllabus={syllabus} review={review} onUndone={onSaved} />
        {groups.map((group) => {
          const isAccepted = group.hunkIds.some((id) => acceptedIds.has(id))
          const isEdited = group.hunkIds.some((id) => editedIds.has(id))
          return (
            <article key={group.key} className={`panel suggestion-card ${group.hunkIds.length ? (isAccepted ? "accepted" : "declined") : ""}`}>
              <SuggestionHead group={group} status={group.hunkIds.length ? <Status tone={isAccepted ? "good" : "neutral"}>{isAccepted ? (isEdited ? "Accepted with your edits" : "Accepted") : "Declined"}</Status> : <Status>No separate change</Status>} />
              {group.details}
              {group.hunkIds.length > 0 && (
                <details className="suggestion-changes">
                  <summary>{group.hunkIds.length === 1 ? "Show the proposed change" : `Show the ${group.hunkIds.length} proposed changes`}</summary>
                  {group.hunkIds.map((id) => byId[id] && <HunkView key={id} hunk={byId[id]} text={byId[id].after} editing={false} editable={false} edited={false} onEdit={() => undefined} onDone={() => undefined} onReset={() => undefined} />)}
                  {isEdited && <p className="form-hint">Your edited wording is in version {review.outputVersion}.</p>}
                </details>
              )}
            </article>
          )
        })}
      </div>
    )
  }

  // ---------------- deciding
  return (
    <div className="suggestions">
      <div className="decision-bar">
        <div>
          <b>{decidable.length} suggestion{decidable.length === 1 ? "" : "s"} to review</b>
          <p>Accept or decline each one. You can edit a change's wording before accepting it. Nothing changes until you save.</p>
        </div>
        <div className="button-row">
          <button className="secondary small" onClick={() => setAll("accept")}><Icon name="check" size={14} /> Accept all</button>
          <button className="secondary small danger-border" onClick={() => setAll("decline")}><Icon name="x" size={14} /> Reject all</button>
        </div>
      </div>
      {groups.map((group) => {
        const value = choice[group.key]
        return (
          <article key={group.key} className={`panel suggestion-card ${value === "accept" ? "accepted" : value === "decline" ? "declined" : ""}`}>
            <SuggestionHead
              group={group}
              status={group.hunkIds.length ? (
                <div className="choice" role="radiogroup" aria-label={`Decision for ${group.title}`}>
                  <button role="radio" aria-checked={value === "accept"} className={value === "accept" ? "on accept" : ""} onClick={() => setChoice({ ...choice, [group.key]: "accept" })}><Icon name="check" size={14} /> Accept</button>
                  <button role="radio" aria-checked={value === "decline"} className={value === "decline" ? "on decline" : ""} onClick={() => setChoice({ ...choice, [group.key]: "decline" })}><Icon name="x" size={14} /> Decline</button>
                </div>
              ) : <Status>Covered by other changes</Status>}
            />
            {group.details}
            {group.hunkIds.map((id) => byId[id] && (
              <HunkView
                key={id}
                hunk={byId[id]}
                text={edits[id] ?? byId[id].after}
                editing={Boolean(editing[id])}
                editable
                edited={edits[id] !== undefined && edits[id] !== byId[id].after}
                onEdit={(text) => { setEdits({ ...edits, [id]: text }); setEditing({ ...editing, [id]: true }); setChoice({ ...choice, [group.key]: "accept" }) }}
                onDone={() => setEditing({ ...editing, [id]: false })}
                onReset={() => { const next = { ...edits }; delete next[id]; setEdits(next); setEditing({ ...editing, [id]: false }) }}
              />
            ))}
          </article>
        )
      })}
      <div className="decision-footer">
        <span>
          <b>{accepted.length} of {decidable.length}</b> accepted{editedCount ? ` · ${editedCount} edited` : ""}{undecided ? ` · ${undecided} undecided (left out)` : ""}
          {Object.values(editing).some(Boolean) && <small className="footer-hint">Click "Done editing" to save.</small>}
        </span>
        <ErrorNote>{error}</ErrorNote>
        <button className="primary" disabled={busy || Object.values(editing).some(Boolean)} onClick={save}>
          {busy ? "Saving…" : accepted.length ? `Save as version ${nextVersion}` : "Decline all and close"}
        </button>
      </div>
    </div>
  )
}

function SuggestionHead({ group, status }: { group: SuggestionGroup; status: ReactNode }) {
  return (
    <div className="suggestion-head">
      <div>
        {group.badges && <div className="rec-meta">{group.badges}</div>}
        <h3>{group.title}</h3>
        {group.subtitle && <p>{group.subtitle}</p>}
      </div>
      {status}
    </div>
  )
}

function DecidedBar({ ctx, syllabus, review, onUndone }: { ctx: AppCtx; syllabus: SyllabusSummary; review: ReviewSummary; onUndone: () => void }) {
  const [error, setError] = useState("")
  const d = review.decision
  const canUndo = review.outputVersion !== undefined && review.outputVersion === syllabus.currentVersion && !review.undoneAt
    && !(syllabus.approvalStatus === "PENDING" && syllabus.submittedVersion === review.outputVersion) && syllabus.approvedVersion !== review.outputVersion
  const undo = async () => {
    if (!confirm(`Undo this save? Version ${review.outputVersion} is deleted and your working copy returns to version ${review.inputVersion}.`)) return
    try {
      await api.undoReview(review.reviewId)
      ctx.toast(`Version ${review.outputVersion} removed`)
      onUndone()
    } catch (e) {
      setError(errorText(e))
    }
  }
  if (review.undoneAt) return <div className="decision-bar settled"><Icon name="refresh" size={16} /><span>You undid this save {fmtDateTime(review.undoneAt)}.</span></div>
  if (!review.outputVersion) return <div className="decision-bar settled"><Icon name="x" size={16} /><span>{d && d.changesAccepted === 0 && d.changesDeclined === 0 ? "This review proposed no changes." : `You declined these suggestions ${fmtDateTime(review.decidedAt)}. Your syllabus didn't change.`}</span></div>
  return (
    <div className="decision-bar settled">
      <Icon name="check" size={16} />
      <span>Saved as version {review.outputVersion} {fmtDateTime(review.decidedAt)}{d ? `: ${d.suggestionsAccepted} accepted, ${d.suggestionsDeclined} declined${d.changesEdited ? `, ${d.changesEdited} edited` : ""}` : ""}.</span>
      {canUndo && <button className="text-button" onClick={undo}>Undo this save</button>}
      <ErrorNote>{error}</ErrorNote>
    </div>
  )
}
