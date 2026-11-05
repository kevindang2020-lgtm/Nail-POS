// technician-import-core.ts — Technician Profile mandate §112 (technician import) + §113 (never auto-merge by name).
//
// PURE: CSV → candidate rows → per-row validation. The service then sends each VALID row through the SAME
// TechniciansService.create a manager's single "Add Technician" uses — so an imported row maps to identity /
// invitation / employment / branch / role exactly like a hand-typed one, and an existing AIPowerSalon account is
// matched ONLY by phone or email (the identity directory's keys), never by name. A row with neither key is refused:
// without a key there is nobody to invite and nothing to dedupe on, and guessing by name is the bug §113 forbids.

export const IMPORT_MAX_ROWS = 200;
export const IMPORT_COLUMNS = ['firstName', 'lastName', 'phone', 'email', 'roleLabel'] as const;

export interface ImportCandidate { line: number; firstName: string; lastName: string; phone: string | null; email: string | null; roleLabel: string | null }
export interface ImportRowError { line: number; error: string }
export interface ImportValidation { valid: ImportCandidate[]; invalid: ImportRowError[] }

const HEADER_ALIASES: Record<string, (typeof IMPORT_COLUMNS)[number]> = {
  firstname: 'firstName', first: 'firstName', 'first name': 'firstName', first_name: 'firstName',
  lastname: 'lastName', last: 'lastName', 'last name': 'lastName', last_name: 'lastName',
  phone: 'phone', mobile: 'phone', 'phone number': 'phone', cell: 'phone',
  email: 'email', 'e-mail': 'email', 'email address': 'email',
  role: 'roleLabel', rolelabel: 'roleLabel', title: 'roleLabel', role_label: 'roleLabel',
};

/** RFC-4180-ish split of one CSV line (quoted fields, doubled quotes). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Parse CSV text with a header row. Unknown columns are ignored; the header decides the mapping. */
export function parseTechnicianCsv(text: string): { rows: Array<Record<string, string> & { __line: string }>; error?: string } {
  const lines = String(text ?? '').replace(/^\uFEFF/, '').split(/\r?\n/).map((l, i) => ({ l, n: i + 1 })).filter((x) => x.l.trim() !== '');
  if (!lines.length) return { rows: [], error: 'The file is empty.' };
  const header = splitCsvLine(lines[0].l).map((h) => HEADER_ALIASES[h.toLowerCase().trim()] ?? null);
  if (!header.includes('firstName') || !header.includes('lastName')) return { rows: [], error: 'The header row must include First Name and Last Name columns.' };
  if (!header.includes('phone') && !header.includes('email')) return { rows: [], error: 'The header row must include a Phone or an Email column.' };
  const body = lines.slice(1);
  if (body.length > IMPORT_MAX_ROWS) return { rows: [], error: `At most ${IMPORT_MAX_ROWS} technicians per import.` };
  return {
    rows: body.map(({ l, n }) => {
      const cells = splitCsvLine(l);
      const r: Record<string, string> & { __line: string } = { __line: String(n) } as any;
      header.forEach((k, i) => { if (k) r[k] = cells[i] ?? ''; });
      return r;
    }),
  };
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE = /^[+()\-\s\d]{7,}$/;
const digits = (p: string) => p.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');

/**
 * Validate parsed rows. A row needs first + last name and at least one identity key (phone / email), each well
 * formed. Two rows in ONE file carrying the same phone or email are the same person typed twice — the later one is
 * refused (never silently merged, never created twice).
 */
export function validateImportRows(rows: Array<Record<string, unknown>>): ImportValidation {
  const valid: ImportCandidate[] = []; const invalid: ImportRowError[] = [];
  const seenPhone = new Map<string, number>(); const seenEmail = new Map<string, number>();
  rows.slice(0, IMPORT_MAX_ROWS).forEach((raw, idx) => {
    const line = Number((raw as any).__line ?? idx + 2);
    const s = (k: string) => String((raw as any)[k] ?? '').trim();
    const firstName = s('firstName').slice(0, 100), lastName = s('lastName').slice(0, 100);
    const phone = s('phone') || null, email = (s('email') || '').toLowerCase() || null;
    const roleLabel = s('roleLabel').slice(0, 80) || null;
    if (!firstName || !lastName) return void invalid.push({ line, error: 'First and last name are required.' });
    if (!phone && !email) return void invalid.push({ line, error: 'A phone or an email is required (technicians are never matched by name).' });
    if (email && !EMAIL.test(email)) return void invalid.push({ line, error: 'Email is not valid.' });
    if (phone && (!PHONE.test(phone) || digits(phone).length < 10)) return void invalid.push({ line, error: 'Phone is not valid.' });
    const pk = phone ? digits(phone) : null;
    if (pk && seenPhone.has(pk)) return void invalid.push({ line, error: `Same phone as line ${seenPhone.get(pk)} — one person per row.` });
    if (email && seenEmail.has(email)) return void invalid.push({ line, error: `Same email as line ${seenEmail.get(email)} — one person per row.` });
    if (pk) seenPhone.set(pk, line);
    if (email) seenEmail.set(email, line);
    valid.push({ line, firstName, lastName, phone, email, roleLabel });
  });
  if (rows.length > IMPORT_MAX_ROWS) invalid.push({ line: 0, error: `Only the first ${IMPORT_MAX_ROWS} rows were read.` });
  return { valid, invalid };
}

// the wire shape is the API contract's (Constitution 13 §15): preview outcomes are will_*, commit outcomes created / invited_existing / refused / invalid
export type { TechnicianImportOutcome as ImportRowOutcome, TechnicianImportRow as ImportRowResult } from '@aipowersalon/api-contracts/tenant';
