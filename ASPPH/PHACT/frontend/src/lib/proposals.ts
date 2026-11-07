import type { DiffSegment, Hunk } from "../types"

/**
 * TypeScript port of the backend's proposal logic (backend/shared/phact/proposals.py), used by the mock
 * adapter so mock mode behaves like the real service. Keep the two in step.
 */

export type Piece = { op: "equal"; text: string } | { op: "hunk"; id: string }

const CONTEXT_LINES = 2
const MIN_EXCERPT_CHARS = 12
const norm = (text: string) => text.replace(/[#*_`>|]/g, " ").replace(/\s+/g, " ").trim().toLowerCase()

function paragraphs(lines: string[]): string[][] {
  const groups: string[][] = [[]]
  lines.forEach((line, i) => {
    if (groups[groups.length - 1].length && !line.trim() && i + 1 < lines.length && lines[i + 1].trim()) groups.push([])
    groups[groups.length - 1].push(line)
  })
  return groups
}

export function build(diff: DiffSegment[]): { pieces: Piece[]; hunks: Hunk[] } {
  const runs: ({ kind: "equal"; lines: string[] } | { kind: "change"; before: string[]; after: string[] })[] = []
  for (const segment of diff) {
    const lines = segment.text.split("\n")
    const last = runs[runs.length - 1]
    if (segment.op === "equal") runs.push({ kind: "equal", lines })
    else if (last && last.kind === "change") (segment.op === "delete" ? last.before : last.after).push(...lines)
    else runs.push(segment.op === "delete" ? { kind: "change", before: lines, after: [] } : { kind: "change", before: [], after: lines })
  }
  const pieces: Piece[] = []
  const hunks: Hunk[] = []
  runs.forEach((run, index) => {
    if (run.kind === "equal") return void pieces.push({ op: "equal", text: run.lines.join("\n") })
    const prev = runs[index - 1]
    const next = runs[index + 1]
    const previous = prev?.kind === "equal" ? prev.lines : []
    const following = next?.kind === "equal" ? next.lines : []
    const parts = !run.before.length && run.after.length ? paragraphs(run.after) : [run.after]
    parts.forEach((after, n) => {
      const hunk: Hunk = {
        id: `h${hunks.length + 1}`,
        before: n === 0 ? run.before.join("\n") : "",
        after: after.join("\n"),
        beforeLines: n === 0 ? run.before.length : 0,
        afterLines: after.length,
        contextBefore: n === 0 ? previous.slice(-CONTEXT_LINES).join("\n") : "",
        contextAfter: n === parts.length - 1 ? following.slice(0, CONTEXT_LINES).join("\n") : "",
      }
      hunks.push(hunk)
      pieces.push({ op: "hunk", id: hunk.id })
    })
  })
  return { pieces, hunks }
}

export function compose(pieces: Piece[], hunks: Record<string, Hunk>, accepted: Record<string, string>): string {
  const lines: string[] = []
  for (const piece of pieces) {
    if (piece.op === "equal") { lines.push(...piece.text.split("\n")); continue }
    const hunk = hunks[piece.id]
    if (piece.id in accepted) {
      const text = accepted[piece.id]
      if (text === hunk.after) { if (hunk.afterLines) lines.push(...text.split("\n")) } else if (text) lines.push(...text.split("\n"))
    } else if (hunk.beforeLines) lines.push(...hunk.before.split("\n"))
  }
  return lines.join("\n")
}

export function assign(hunks: Hunk[], excerpts: string[][]): { perItem: string[][]; unclaimed: string[] } {
  const claimed = new Set<string>()
  const perItem = excerpts.map((list) => {
    const ids: string[] = []
    for (const excerpt of list) {
      const needle = norm(excerpt)
      if (needle.length < MIN_EXCERPT_CHARS) continue
      const hit = hunks.find((h) => !claimed.has(h.id) && (norm(h.after).includes(needle) || norm(h.before).includes(needle)))
      if (hit) { ids.push(hit.id); claimed.add(hit.id) }
    }
    return ids
  })
  return { perItem, unclaimed: hunks.filter((h) => !claimed.has(h.id)).map((h) => h.id) }
}
