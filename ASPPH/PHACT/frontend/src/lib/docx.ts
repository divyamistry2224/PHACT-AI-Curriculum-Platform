/**
 * Builds a minimal, valid .docx file in the browser without dependencies.
 * The package is an uncompressed (STORE) zip with the three required parts.
 */
export interface DocBlock {
  kind: "title" | "heading" | "subheading" | "para" | "bullet" | "note" | "table"
  text: string
  /** Table cells, row by row (kind "table" only). The first row is the header when `header` is true. */
  rows?: string[][]
  header?: boolean
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

function cell(text: string, bold: boolean) {
  return `<w:tc><w:tcPr><w:tcMar><w:top w:w="60" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/></w:tcMar></w:tcPr><w:p><w:r><w:rPr>${bold ? "<w:b/>" : ""}<w:color w:val="102C3A"/><w:sz w:val="19"/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p></w:tc>`
}

function table(b: DocBlock) {
  const border = '<w:top w:val="single" w:sz="4" w:color="CCD6DE"/><w:left w:val="single" w:sz="4" w:color="CCD6DE"/><w:bottom w:val="single" w:sz="4" w:color="CCD6DE"/><w:right w:val="single" w:sz="4" w:color="CCD6DE"/><w:insideH w:val="single" w:sz="4" w:color="CCD6DE"/><w:insideV w:val="single" w:sz="4" w:color="CCD6DE"/>'
  const width = Math.max(...(b.rows || []).map((r) => r.length))
  const rows = (b.rows || []).map((row, i) => `<w:tr>${Array.from({ length: width }, (_, j) => cell(row[j] || "", Boolean(b.header) && i === 0)).join("")}</w:tr>`).join("")
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${border}</w:tblBorders></w:tblPr>${rows}</w:tbl><w:p/>`
}

function paragraph(b: DocBlock) {
  if (b.kind === "table") return table(b)
  const size = { title: 40, heading: 30, subheading: 24, para: 21, bullet: 21, note: 17 }[b.kind as Exclude<DocBlock["kind"], "table">]
  const bold = b.kind === "title" || b.kind === "heading" || b.kind === "subheading"
  const color = b.kind === "note" ? "617079" : b.kind === "heading" ? "087E7B" : "102C3A"
  const text = b.kind === "bullet" ? `\u2022  ${b.text}` : b.text
  const indent = b.kind === "bullet" ? '<w:ind w:left="360"/>' : ""
  return `<w:p><w:pPr><w:spacing w:before="${bold ? 240 : 60}" w:after="80"/>${indent}</w:pPr><w:r><w:rPr>${bold ? "<w:b/>" : ""}<w:color w:val="${color}"/><w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(data: Uint8Array) {
  let c = 0xffffffff
  for (const byte of data) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function zip(files: { name: string; data: string }[]): Blob {
  const enc = new TextEncoder()
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const name = enc.encode(f.name)
    const data = enc.encode(f.data)
    const crc = crc32(data)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, data.length, true)
    local.setUint32(22, data.length, true)
    local.setUint16(26, name.length, true)
    chunks.push(new Uint8Array(local.buffer), name, data)
    const cd = new DataView(new ArrayBuffer(46))
    cd.setUint32(0, 0x02014b50, true)
    cd.setUint16(4, 20, true)
    cd.setUint16(6, 20, true)
    cd.setUint32(16, crc, true)
    cd.setUint32(20, data.length, true)
    cd.setUint32(24, data.length, true)
    cd.setUint16(28, name.length, true)
    cd.setUint32(42, offset, true)
    central.push(new Uint8Array(cd.buffer), name)
    offset += 30 + name.length + data.length
  }
  const size = central.reduce((n, c) => n + c.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, size, true)
  end.setUint32(16, offset, true)
  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)] as BlobPart[], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  })
}

export function buildDocx(blocks: DocBlock[]): Blob {
  const body = blocks.map(paragraph).join("")
  return zip([
    {
      name: "[Content_Types].xml",
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    },
    {
      name: "_rels/.rels",
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    },
    {
      name: "word/document.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgMar w:top="1200" w:right="1200" w:bottom="1200" w:left="1200"/></w:sectPr></w:body></w:document>`,
    },
  ])
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
