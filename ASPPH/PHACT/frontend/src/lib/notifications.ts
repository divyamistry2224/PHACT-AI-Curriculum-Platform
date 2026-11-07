import type { SyllabusSummary } from "../types"

/**
 * Faculty notifications are derived from approval decisions on the caller's syllabi (no separate
 * notifications service). "Read" is remembered in this browser only.
 */

const READ_KEY = "phact-read-decisions"

export interface Notification {
  id: string
  syllabusId: string
  title: string
  message: string
  decidedAt: string
  read: boolean
}

function readSet(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(READ_KEY) || "[]") as string[])
  } catch {
    return new Set()
  }
}

export function notificationsFor(syllabi: SyllabusSummary[]): Notification[] {
  const read = readSet()
  return syllabi
    .filter((s) => s.decidedAt && (s.approvalStatus === "APPROVED" || s.approvalStatus === "DENIED"))
    .map((s) => {
      const id = `${s.syllabusId}:${s.decidedAt}`
      const approved = s.approvalStatus === "APPROVED"
      return {
        id,
        syllabusId: s.syllabusId,
        title: approved ? `${s.title} was approved` : `${s.title} needs revision`,
        message: approved ? s.approvalNote || `Version ${s.approvedVersion} is now in the shared library.` : s.denyReason || "An administrator denied this submission.",
        decidedAt: s.decidedAt!,
        read: read.has(id),
      }
    })
    .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt))
}

export function markRead(id: string) {
  try {
    const read = readSet()
    read.add(id)
    localStorage.setItem(READ_KEY, JSON.stringify([...read]))
  } catch {
    /* storage unavailable */
  }
}
