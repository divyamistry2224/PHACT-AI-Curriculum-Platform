import type { DocBlock } from "./docx"

/**
 * The backend stores syllabus text as light Markdown: "# " and "## " headings, "- " bullets, and
 * "| a | b |" table rows (that's how DOCX tables are extracted). These helpers turn it into blocks for
 * on-screen display and for DOCX/PDF export. Consecutive table rows become one table.
 */
const SEPARATOR = /^\|?[\s:|-]+\|?$/
const cells = (line: string) => line.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim())

export function markdownBlocks(text: string): DocBlock[] {
  const blocks: DocBlock[] = []
  const lines = text.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    if (line.startsWith("|")) {
      const rows: string[][] = []
      let header = false
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const row = lines[i].trim()
        if (SEPARATOR.test(row)) header = rows.length === 1
        else rows.push(cells(row))
        i++
      }
      i--
      // Two-column tables are usually label/value pairs ("Instructor | Dr. ..."), unless the first row reads
      // like column names ("Assessment | Weight": short, no numbers).
      const twoColumns = rows.every((row) => row.length === 2)
      const namesColumns = header && rows.length > 1 && rows[0].every((cell) => cell && !/\d/.test(cell) && cell.split(/\s+/).length <= 3)
      if (rows.length) blocks.push({ kind: "table", text: "", rows, header: header && (!twoColumns || namesColumns) })
      continue
    }
    if (SEPARATOR.test(line) && line.includes("-")) continue
    if (line.startsWith("### ")) blocks.push({ kind: "subheading", text: line.slice(4) })
    else if (line.startsWith("## ")) blocks.push({ kind: "heading", text: line.slice(3) })
    else if (line.startsWith("# ")) blocks.push({ kind: "title", text: line.slice(2) })
    else if (/^[-*•]\s+/.test(line)) blocks.push({ kind: "bullet", text: line.replace(/^[-*•]\s+/, "") })
    else if (/^\d+[.)]\s+/.test(line)) blocks.push({ kind: "bullet", text: line })
    else blocks.push({ kind: "para", text: line })
  }
  return blocks
}

export const fileSafe = (name: string) => name.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "") || "syllabus"
