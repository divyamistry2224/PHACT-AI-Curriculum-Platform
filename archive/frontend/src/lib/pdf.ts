import type { SyllabusVersion } from "../types"

const pdfText = (value: string) => value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/[^\x20-\x7E\n]/g, " ")

/** Small dependency-free local PDF export for mock/frontend-only use. */
export function buildSyllabusPdf(version: SyllabusVersion): Blob {
  const lines = version.sections.flatMap((section) => [`${section.order}. ${section.title}`, ...section.content.split("\n"), ""])
  const wrapped = lines.flatMap((line) => line.match(/.{1,92}(?:\s|$)/g) || [line]).slice(0, 70)
  const commands = ["BT", "/F1 11 Tf", "48 760 Td", ...wrapped.map((line, index) => `${index ? "0 -15 Td" : ""} (${pdfText(line)}) Tj`), "ET"].filter(Boolean).join("\n")
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${commands.length} >>\nstream\n${commands}\nendstream`]
  let output = "%PDF-1.4\n"
  const offsets: number[] = [0]
  objects.forEach((object, index) => { offsets[index + 1] = output.length; output += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const xref = output.length
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return new Blob([output], { type: "application/pdf" })
}

export function downloadSyllabusPdf(version: SyllabusVersion, courseName: string) {
  const url = URL.createObjectURL(buildSyllabusPdf(version))
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `${courseName.replace(/[^\w]+/g, "-")}-PHACT-v${version.versionNumber}.pdf`
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
