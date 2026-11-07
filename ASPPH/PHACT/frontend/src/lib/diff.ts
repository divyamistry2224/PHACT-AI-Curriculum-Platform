import type { DiffSegment } from "../types"

/**
 * Line diff in the same shape the backend returns: equal, insert, and delete segments, adjacent segments
 * of the same kind merged. Used for "original vs current" comparisons the API doesn't precompute, and by
 * the mock adapter.
 */
export function lineDiff(before: string, after: string): DiffSegment[] {
  const a = before.split("\n")
  const b = after.split("\n")
  const n = a.length
  const m = b.length
  // Longest common subsequence table, filled from the end.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])

  const segments: DiffSegment[] = []
  const push = (op: DiffSegment["op"], line: string) => {
    const last = segments[segments.length - 1]
    if (last && last.op === op) last.text += `\n${line}`
    else segments.push({ op, text: line })
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { push("equal", a[i]); i++; j++ }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) push("delete", a[i++])
    else push("insert", b[j++])
  }
  while (i < n) push("delete", a[i++])
  while (j < m) push("insert", b[j++])
  return segments
}

export function diffStats(diff: DiffSegment[]) {
  const count = (op: DiffSegment["op"]) => diff.filter((s) => s.op === op).reduce((total, s) => total + s.text.split("\n").length, 0)
  return { linesAdded: count("insert"), linesRemoved: count("delete") }
}
