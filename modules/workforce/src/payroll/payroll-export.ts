/**
 * payroll-export.ts — PURE payroll export builders (Payroll mandate §82–§84, §156). CSV and XLSX of ONE period's stable
 * line snapshot, built in memory and handed back on the authorized response only (never a public URL, never stored —
 * the service writes the payroll_exports audit row with the sha256 of these exact bytes).
 *  • money is exact (§156): every amount is written twice — integer cents (the authoritative value) and a dollars string
 *    produced by integer arithmetic ("1234.05"), never a float format;
 *  • CSV cells are guarded against spreadsheet formula injection (a leading = + - @ tab or CR is neutralised);
 *  • XLSX is a minimal OOXML workbook in a stored (uncompressed) ZIP — no third-party dependency; numeric cells for cents.
 */
import { createHash } from 'crypto';

export type PayrollExportFormat = 'csv' | 'xlsx';
export interface ExportLine {
  technicianId: string; technicianName: string | null; servicesCount: number; grossSalesCents: number;
  commissionCents: number; retailCommissionCents: number; cardTipCents: number; cashTipCents: number; tipsCents: number;
  guaranteeTopUpCents: number; hourlyPayCents: number; workedMinutes: number; potentialOvertimeMinutes: number; salaryPayCents: number;
  bonusCents: number; deductionCents: number; adjustmentCents: number; netCents: number; payableCents: number; paidCents: number;
}
export interface ExportPeriod { id: string; label: string | null; periodStart: string; periodEnd: string; status: string; version: number; approvalHash: string | null }

/** PURE: integer cents → "1234.05" / "-0.07" with no floating point. */
export function centsToDecimalString(cents: number): string {
  const c = Math.trunc(Number(cents) || 0);
  const neg = c < 0; const a = Math.abs(c);
  return `${neg ? '-' : ''}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}

const MONEY: [keyof ExportLine, string][] = [
  ['grossSalesCents', 'gross_service_sales'], ['commissionCents', 'service_commission'], ['retailCommissionCents', 'retail_commission'],
  ['cardTipCents', 'card_tips'], ['cashTipCents', 'cash_tips'], ['tipsCents', 'tips_total'], ['guaranteeTopUpCents', 'guarantee_top_up'],
  ['hourlyPayCents', 'hourly_pay'], ['salaryPayCents', 'salary_pay'], ['bonusCents', 'bonuses'], ['deductionCents', 'deductions'],
  ['adjustmentCents', 'adjustments'], ['netCents', 'net'], ['payableCents', 'payable'], ['paidCents', 'paid'],
];

/** PURE: the header + rows (strings / integers) shared by both formats. */
export function exportGrid(period: ExportPeriod, lines: ExportLine[]): { headers: string[]; rows: (string | number)[][] } {
  const headers = ['period_id', 'period_start', 'period_end', 'period_status', 'period_version', 'technician_id', 'technician_name', 'services', 'worked_minutes', 'potential_overtime_minutes',
    ...MONEY.flatMap(([, n]) => [`${n}_cents`, `${n}_usd`]), 'approval_hash'];
  const sorted = lines.slice().sort((a, b) => (a.technicianName || '').localeCompare(b.technicianName || '') || a.technicianId.localeCompare(b.technicianId));
  const rows = sorted.map((l) => [period.id, period.periodStart, period.periodEnd, period.status, period.version, l.technicianId, l.technicianName || '', l.servicesCount, l.workedMinutes, l.potentialOvertimeMinutes,
    ...MONEY.flatMap(([k]) => [Math.trunc(Number(l[k]) || 0), centsToDecimalString(Number(l[k]) || 0)]), period.approvalHash || '']);
  return { headers, rows };
}

const csvCell = (v: string | number) => {
  if (typeof v === 'number') return String(v);
  const guarded = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${guarded.replace(/"/g, '""')}"`;
};
export function toPayrollCsv(period: ExportPeriod, lines: ExportLine[]): Buffer {
  const { headers, rows } = exportGrid(period, lines);
  // money columns that start with '-' are numbers or our own decimal strings — written unquoted so no guard mangles them
  const cell = (v: string | number, i: number) => (typeof v === 'string' && /_usd$/.test(headers[i]) ? v : csvCell(v));
  return Buffer.from([headers.map((h) => csvCell(h)).join(','), ...rows.map((r) => r.map(cell).join(','))].join('\r\n') + '\r\n', 'utf8');
}

// ---------- XLSX (stored ZIP + minimal OOXML) ----------
const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf: Buffer): number { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function zipStore(files: { name: string; content: string }[]): Buffer {
  const chunks: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const f of files) {
    const data = Buffer.from(f.content, 'utf8'); const name = Buffer.from(f.name, 'utf8'); const crc = crc32(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0, 6); h.writeUInt16LE(0, 8); h.writeUInt16LE(0, 10); h.writeUInt16LE(0x21, 12);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
    chunks.push(h, name, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0, 8); c.writeUInt16LE(0, 10); c.writeUInt16LE(0, 12); c.writeUInt16LE(0x21, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(name.length, 28);
    c.writeUInt16LE(0, 30); c.writeUInt16LE(0, 32); c.writeUInt16LE(0, 34); c.writeUInt16LE(0, 36); c.writeUInt32LE(0, 38); c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += h.length + name.length + data.length;
  }
  const cd = Buffer.concat(central);
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(0, 4); e.writeUInt16LE(0, 6); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10);
  e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(offset, 16); e.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, cd, e]);
}
const colRef = (n: number) => { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
export function toPayrollXlsx(period: ExportPeriod, lines: ExportLine[]): Buffer {
  const { headers, rows } = exportGrid(period, lines);
  const all: (string | number)[][] = [headers, ...rows];
  const sheet = all.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => typeof v === 'number'
    ? `<c r="${colRef(ci)}${ri + 1}"><v>${Math.trunc(v)}</v></c>`
    : `<c r="${colRef(ci)}${ri + 1}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`).join('')}</row>`).join('');
  return zipStore([
    { name: '[Content_Types].xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>' },
    { name: '_rels/.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Payroll" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: 'xl/worksheets/sheet1.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>` },
  ]);
}

export function buildPayrollExport(format: PayrollExportFormat, period: ExportPeriod, lines: ExportLine[]): { filename: string; mimeType: string; bytes: Buffer; sha256: string; rowCount: number } {
  const bytes = format === 'xlsx' ? toPayrollXlsx(period, lines) : toPayrollCsv(period, lines);
  const base = `payroll-${period.periodStart}-to-${period.periodEnd}-v${period.version}`;
  return { filename: `${base}.${format}`, mimeType: format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv', bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'), rowCount: lines.length };
}
