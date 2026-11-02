// expense-duplicates.ts — is this expense one the salon already has? (mandate §47–50, §198)
//
// Three answers, never a silent delete (§49):
//   exact     the same receipt file (identical bytes), or the same vendor's same invoice / receipt number
//   possible  same vendor, same total, dates within a day; or a different vendor text but the same total and date and
//             a near-identical receipt photo (perceptual hash) — "this looks similar to an expense already saved"
//   none      nothing comparable
// "Same amount and date but a different receipt" from a DIFFERENT vendor is not a duplicate (§198 #4).
import { normalizeVendorName } from './vendor-normalize';

export interface DupSubject {
  id?: string | null;
  vendorRaw: string | null; vendorId?: string | null;
  incurredOn: string; totalCents: number;
  invoiceNumber?: string | null; receiptNumber?: string | null;
  fileHash?: string | null; perceptualHash?: string | null;
}
export interface DupCandidate extends DupSubject { id: string; status?: string }
export interface DupMatch { id: string; status: 'exact' | 'possible'; reason: string }
export interface DupResult { status: 'exact' | 'possible' | 'none'; matches: DupMatch[] }

const days = (a: string, b: string) => Math.abs(Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000;
const ref = (v: string | null | undefined) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
/** Hamming distance of two hex perceptual hashes (64-bit dHash → 16 hex chars); Infinity if not comparable. */
export function hashDistance(a?: string | null, b?: string | null): number {
  if (!a || !b || a.length !== b.length || !/^[0-9a-f]+$/i.test(a + b)) return Infinity;
  let d = 0; for (let i = 0; i < a.length; i++) { let x = parseInt(a[i], 16) ^ parseInt(b[i], 16); while (x) { d += x & 1; x >>= 1; } }
  return d;
}

export function detectExpenseDuplicates(s: DupSubject, candidates: readonly DupCandidate[]): DupResult {
  const vendor = normalizeVendorName(s.vendorRaw);
  const matches: DupMatch[] = [];
  for (const c of candidates) {
    if (s.id && c.id === s.id) continue;
    if (c.status === 'voided') continue;
    const sameVendor = (!!s.vendorId && s.vendorId === c.vendorId) || (!!vendor && vendor === normalizeVendorName(c.vendorRaw));
    if (s.fileHash && c.fileHash && s.fileHash === c.fileHash) { matches.push({ id: c.id, status: 'exact', reason: 'The same receipt file was already uploaded.' }); continue; }
    if (sameVendor && ref(s.invoiceNumber) && ref(s.invoiceNumber) === ref(c.invoiceNumber)) { matches.push({ id: c.id, status: 'exact', reason: 'Same vendor and invoice number.' }); continue; }
    if (sameVendor && ref(s.receiptNumber) && ref(s.receiptNumber) === ref(c.receiptNumber) && s.totalCents === c.totalCents) { matches.push({ id: c.id, status: 'exact', reason: 'Same vendor, receipt number and total.' }); continue; }
    if (s.totalCents !== c.totalCents) continue;
    const near = days(s.incurredOn, c.incurredOn);
    if (sameVendor && near <= 1) { matches.push({ id: c.id, status: 'possible', reason: near === 0 ? 'Same vendor, date and total.' : 'Same vendor and total, one day apart.' }); continue; }
    if (near === 0 && hashDistance(s.perceptualHash, c.perceptualHash) <= 6) matches.push({ id: c.id, status: 'possible', reason: 'Same total and date, and the receipt photo looks the same.' });
  }
  const status = matches.some((m) => m.status === 'exact') ? 'exact' : matches.length ? 'possible' : 'none';
  matches.sort((a, b) => (a.status === b.status ? 0 : a.status === 'exact' ? -1 : 1));
  return { status, matches: matches.slice(0, 5) };
}
