import type { DocBlock } from "./docx"

/**
 * PDF export with jsPDF: US Letter, real text measurement and wrapping, tables laid out as tables, a running
 * header, and page numbers. jsPDF is loaded only when someone exports, so it doesn't add to the app's start-up.
 */

const NAVY: [number, number, number] = [0, 51, 91]
const TEAL: [number, number, number] = [15, 71, 92]
const INK: [number, number, number] = [34, 54, 70]
const MUTED: [number, number, number] = [97, 112, 121]
const LINE: [number, number, number] = [204, 214, 222]

const PAGE = { width: 612, height: 792, margin: 56, top: 72, bottom: 60 }

/** jsPDF's built-in fonts cover Windows-1252; swap the few common characters outside it. */
const clean = (text: string) =>
  text
    .replace(/[→⇒]/g, "->")
    .replace(/−/g, "-")
    .replace(/[≤]/g, "<=")
    .replace(/[≥]/g, ">=")
    .replace(/[^\x00-\xff–—‘’“”•…€]/g, " ")

const STYLE: Record<Exclude<DocBlock["kind"], "table">, { size: number; bold: boolean; color: [number, number, number]; before: number; after: number }> = {
  title: { size: 20, bold: true, color: NAVY, before: 4, after: 8 },
  heading: { size: 14, bold: true, color: TEAL, before: 16, after: 6 },
  subheading: { size: 12, bold: true, color: INK, before: 10, after: 4 },
  para: { size: 10.5, bold: false, color: INK, before: 3, after: 3 },
  bullet: { size: 10.5, bold: false, color: INK, before: 2, after: 2 },
  note: { size: 9, bold: false, color: MUTED, before: 6, after: 4 },
}

export async function buildPdf(blocks: DocBlock[], meta: { title: string; subtitle: string }): Promise<Blob> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")])
  const doc = new jsPDF({ unit: "pt", format: "letter" })
  const width = PAGE.width - PAGE.margin * 2
  let y = PAGE.top

  const room = (needed: number) => {
    if (y + needed > PAGE.height - PAGE.bottom) {
      doc.addPage()
      y = PAGE.top
    }
  }

  for (const block of blocks) {
    if (block.kind === "table") {
      const rows = (block.rows || []).map((row) => row.map(clean))
      const pairs = !block.header && rows.every((row) => row.length === 2)
      autoTable(doc, {
        startY: y + 4,
        head: block.header ? [rows[0]] : undefined,
        body: block.header ? rows.slice(1) : rows,
        margin: { left: PAGE.margin, right: PAGE.margin, top: PAGE.top, bottom: PAGE.bottom },
        theme: "grid",
        styles: { font: "helvetica", fontSize: 9.5, cellPadding: 5, textColor: INK, lineColor: LINE, lineWidth: 0.5, overflow: "linebreak" },
        headStyles: { fillColor: [235, 239, 242], textColor: NAVY, fontStyle: "bold" },
        columnStyles: pairs ? { 0: { fontStyle: "bold", cellWidth: 130, textColor: TEAL } } : {},
      })
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10
      continue
    }
    const style = STYLE[block.kind]
    const indent = block.kind === "bullet" ? 14 : 0
    doc.setFont("helvetica", style.bold ? "bold" : "normal")
    doc.setFontSize(style.size)
    doc.setTextColor(...style.color)
    const lines: string[] = doc.splitTextToSize(clean(block.text), width - indent)
    const lineHeight = style.size * 1.35
    y += style.before
    // Keep a heading with at least two lines of what follows it.
    room(lineHeight * Math.min(lines.length, 3) + (style.bold ? lineHeight * 2 : 0))
    if (block.kind === "bullet") {
      doc.text("•", PAGE.margin + 3, y + style.size)
    }
    for (const line of lines) {
      room(lineHeight)
      doc.text(line, PAGE.margin + indent, y + style.size)
      y += lineHeight
    }
    if (block.kind === "title") {
      doc.setDrawColor(...LINE)
      doc.line(PAGE.margin, y + 4, PAGE.width - PAGE.margin, y + 4)
      y += 6
    }
    y += style.after
  }

  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(8.5)
    doc.setTextColor(...TEAL)
    doc.text("PHACT", PAGE.margin, 36)
    doc.setFont("helvetica", "normal")
    doc.setTextColor(...MUTED)
    doc.text(clean(`${meta.title} • ${meta.subtitle}`).slice(0, 110), PAGE.margin + 36, 36)
    doc.setDrawColor(...LINE)
    doc.line(PAGE.margin, 44, PAGE.width - PAGE.margin, 44)
    doc.text(`Page ${page} of ${pages}`, PAGE.width - PAGE.margin, PAGE.height - 30, { align: "right" })
  }
  return doc.output("blob")
}
