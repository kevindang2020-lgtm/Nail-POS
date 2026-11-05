// analytics-export.ts — dependency-free serializers for the Analytics export endpoint.
// Produces real CSV, XLSX (minimal OOXML in a hand-rolled store ZIP), and PDF (minimal 1.4)
// so exports need no new third-party libraries. All three are byte-validated in the spec.
// Security: no card/PII/secret fields are ever present in the analytics payload; CSV cells are
// guarded against spreadsheet-formula injection.

// ---------- shared ----------
export type ExportRow = [string, string];

const csvCell = (v: string) => {
  const s = String(v ?? '');
  // Formula-injection guard: neutralise leading = + - @ (and tab/CR variants).
  const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${guarded.replace(/"/g, '""')}"`;
};
export function toCsv(rows: ExportRow[]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

// Tabular CSV (header row + data rows) with the same spreadsheet-formula-injection guard. Used by the
// Revenue & Residuals payout-report export, whose records are wide tables rather than key/value pairs.
export function toCsvGrid(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const head = headers.map((h) => csvCell(String(h)));
  const body = rows.map((r) => r.map((c) => csvCell(c == null ? '' : String(c))));
  return [head, ...body].map((r) => r.join(',')).join('\r\n');
}

const xmlEsc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- ZIP (store / no compression) for XLSX ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
type ZipEntry = { name: string; data: Buffer; crc: number; offset: number };
function zipStore(files: { name: string; content: string }[]): Buffer {
  const entries: ZipEntry[] = [];
  const chunks: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const data = Buffer.from(f.content, 'utf8');
    const crc = crc32(data);
    const nameBuf = Buffer.from(f.name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    entries.push({ name: f.name, data, crc, offset });
    chunks.push(local, nameBuf, data);
    offset += local.length + nameBuf.length + data.length;
  }
  const central: Buffer[] = [];
  let cdSize = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0, 8);
    c.writeUInt16LE(0, 10); c.writeUInt16LE(0, 12); c.writeUInt16LE(0, 14);
    c.writeUInt32LE(e.crc, 16); c.writeUInt32LE(e.data.length, 20); c.writeUInt32LE(e.data.length, 24);
    c.writeUInt16LE(nameBuf.length, 28); c.writeUInt16LE(0, 30); c.writeUInt16LE(0, 32);
    c.writeUInt16LE(0, 34); c.writeUInt16LE(0, 36); c.writeUInt32LE(0, 38); c.writeUInt32LE(e.offset, 42);
    central.push(c, nameBuf);
    cdSize += c.length + nameBuf.length;
  }
  const cdOffset = offset;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12); eocd.writeUInt32LE(cdOffset, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, ...central, eocd]);
}

const colRef = (n: number) => { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

export function toXlsx(rows: ExportRow[], sheetName = 'Analytics'): Buffer {
  return toXlsxGrid([], rows.map((r) => [r[0], r[1]]), sheetName, /* prependHeaders */ false);
}

// Tabular XLSX (optional header row + data rows), multi-column, reusing the store-ZIP OOXML machinery.
export function toXlsxGrid(headers: string[], rows: (string | number | null | undefined)[][], sheetName = 'Sheet1', prependHeaders = true): Buffer {
  const allRows: (string | number | null | undefined)[][] = prependHeaders && headers.length ? [headers, ...rows] : rows;
  const sheetRows = allRows.map((r, ri) => {
    const cells = r.map((val, ci) => `<c r="${colRef(ci)}${ri + 1}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(val == null ? '' : String(val))}</t></is></c>`).join('');
    return `<row r="${ri + 1}">${cells}</row>`;
  }).join('');
  const files = [
    { name: '[Content_Types].xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>` },
    { name: '_rels/.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEsc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>` },
    { name: 'xl/worksheets/sheet1.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>` },
  ];
  return zipStore(files);
}

// ---------- PDF (minimal 1.4, single page, Helvetica) ----------
const pdfText = (s: string) => String(s ?? '')
  .replace(/[—–]/g, '-').replace(/[·•]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/×/g, 'x')
  .replace(/[^\x20-\x7e]/g, '') // Helvetica/WinAnsi: keep printable ASCII only
  .replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
export function toPdf(title: string, lines: string[]): Buffer {
  const content = [`BT`, `/F1 16 Tf`, `50 760 Td`, `(${pdfText(title)}) Tj`, `/F1 10 Tf`, `0 -24 Td`];
  for (const ln of lines) content.push(`(${pdfText(ln)}) Tj`, `0 -14 Td`);
  content.push(`ET`);
  const stream = content.join('\n');
  const objs = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,
    `<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = `%PDF-1.4\n`;
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(pdf, 'utf8')); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

// Multi-page tabular PDF: title + a fixed-width column header, rows paginated across pages.
// Columns are truncated/padded to fit an ASCII monospace-ish layout (Helvetica); dependency-free.
export function toPdfGrid(title: string, headers: string[], rows: (string | number | null | undefined)[][]): Buffer {
  const nCols = Math.max(1, headers.length);
  const totalWidth = 110; // approx chars across a Letter page at ~8pt
  const colW = Math.max(6, Math.floor(totalWidth / nCols));
  const fit = (v: unknown) => { const s = pdfText(String(v ?? '')); return (s.length > colW ? s.slice(0, colW - 1) + '.' : s).padEnd(colW).slice(0, colW); };
  const lineOf = (cells: (string | number | null | undefined)[]) => cells.map(fit).join(' ');
  const headerLine = lineOf(headers);
  const ruleLine = ''.padEnd(headerLine.length, '-');
  const bodyLines = rows.map(lineOf);

  const linesPerPage = 46;
  const pages: string[][] = [];
  for (let i = 0; i < bodyLines.length; i += linesPerPage) pages.push(bodyLines.slice(i, i + linesPerPage));
  if (pages.length === 0) pages.push([]);

  const pageStreams = pages.map((pl, pi) => {
    const content = [`BT`, `/F1 14 Tf`, `50 760 Td`, `(${pdfText(title)}${pages.length > 1 ? ` (page ${pi + 1}/${pages.length})` : ''}) Tj`, `/F1 8 Tf`, `0 -20 Td`, `(${headerLine}) Tj`, `0 -11 Td`, `(${ruleLine}) Tj`, `0 -11 Td`];
    for (const ln of pl) content.push(`(${ln}) Tj`, `0 -11 Td`);
    content.push(`ET`);
    return content.join('\n');
  });

  // objects: 1 Catalog, 2 Pages, 3 Font, then per page: pageObj + contentObj
  const pageObjNums: number[] = [];
  const objs: string[] = [];
  objs.push(`<< /Type /Catalog /Pages 2 0 R >>`);
  const kidsPlaceholderIndex = objs.length; // index 1 will be replaced after we know page obj numbers
  objs.push(``); // placeholder for Pages
  objs.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>`);
  pageStreams.forEach((stream) => {
    const pageNum = objs.length + 1;
    const contentNum = pageNum + 1;
    pageObjNums.push(pageNum);
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNum} 0 R >>`);
    objs.push(`<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`);
  });
  objs[kidsPlaceholderIndex] = `<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageObjNums.length} >>`;

  let pdf = `%PDF-1.4\n`;
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(pdf, 'utf8')); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}
