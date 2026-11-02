// ai-ocr-receipt-dedup.ts — PURE duplicate detection. Tenant isolation is structural: the caller only ever passes
// candidates from the SAME tenant, and no signature or key carries cross-tenant data, so documents from different tenants
// can never be compared here. Three signals: exact file hash, perceptual near-duplicate (Hamming distance on an image
// hash), and a transaction signature (normalized vendor + document number + date + total). A suspected duplicate blocks
// auto-processing and routes to review — a re-scanned or re-photographed copy of the same receipt is still a duplicate.

export type DuplicateStatus = 'exact' | 'likely' | 'possible' | 'none';

export interface DedupSubject {
  fileHash: string | null;          // e.g. sha256 of the original bytes
  perceptualHash: string | null;    // hex image hash (null for non-images)
  vendor: string | null;
  documentNumber: string | null;
  documentDate: string | null;      // ISO
  totalCents: number | null;
}
export interface DuplicateCandidate extends DedupSubject { documentId: string; }

export interface DuplicateMatch { documentId: string; status: DuplicateStatus; reason: string; perceptualDistance?: number; }
export interface DuplicateResult { status: DuplicateStatus; matches: DuplicateMatch[]; blocksAutoProcessing: boolean; }

const LEGAL_SUFFIX = /\b(inc|inc\.|llc|l\.l\.c\.|ltd|co|co\.|corp|corporation|company|gmbh)\b/gi;
export function normalizeVendor(v: string | null): string {
  return String(v ?? '').toLowerCase().replace(LEGAL_SUFFIX, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** A stable transaction signature. Prefers vendor+number+total; falls back to vendor+date+total when there's no number. */
export function transactionSignature(s: DedupSubject): string | null {
  const vendor = normalizeVendor(s.vendor);
  if (!vendor || s.totalCents == null) return null;
  if (s.documentNumber && s.documentNumber.trim()) return `n|${vendor}|${s.documentNumber.trim().toLowerCase()}|${s.totalCents}`;
  if (s.documentDate) return `d|${vendor}|${s.documentDate}|${s.totalCents}`;
  return null;
}

const HEX_BITS: Record<string, number> = {};
for (let i = 0; i < 16; i++) HEX_BITS[i.toString(16)] = (i.toString(2).match(/1/g) || []).length;
/** Hamming distance between two equal-length hex hashes (bit differences). Returns Infinity if incomparable. */
export function hammingDistance(a: string | null, b: string | null): number {
  if (!a || !b || a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    const xa = parseInt(a[i], 16), xb = parseInt(b[i], 16);
    if (Number.isNaN(xa) || Number.isNaN(xb)) return Infinity;
    d += (HEX_BITS[(xa ^ xb).toString(16)] ?? 0);
  }
  return d;
}

export interface DedupOptions { perceptualTight?: number; perceptualLoose?: number; }
const RANK: Record<DuplicateStatus, number> = { exact: 3, likely: 2, possible: 1, none: 0 };

/** Detect duplicates of `incoming` among same-tenant `candidates`. */
export function detectDuplicates(incoming: DedupSubject, candidates: DuplicateCandidate[], opts: DedupOptions = {}): DuplicateResult {
  const tight = opts.perceptualTight ?? 6;
  const loose = opts.perceptualLoose ?? 12;
  const sig = transactionSignature(incoming);
  const matches: DuplicateMatch[] = [];

  for (const c of candidates) {
    // exact: identical file bytes
    if (incoming.fileHash && c.fileHash && incoming.fileHash === c.fileHash) { matches.push({ documentId: c.documentId, status: 'exact', reason: 'identical_file' }); continue; }
    // likely: same transaction signature (re-scanned copy of the same receipt)
    const cSig = transactionSignature(c);
    if (sig && cSig && sig === cSig) { matches.push({ documentId: c.documentId, status: 'likely', reason: 'same_transaction_signature' }); continue; }
    // perceptual near-duplicate
    const dist = hammingDistance(incoming.perceptualHash, c.perceptualHash);
    if (dist <= tight) { matches.push({ documentId: c.documentId, status: 'likely', reason: 'perceptual_near_match', perceptualDistance: dist }); continue; }
    if (dist <= loose) { matches.push({ documentId: c.documentId, status: 'possible', reason: 'perceptual_soft_match', perceptualDistance: dist }); continue; }
    // possible: same vendor + total on the same date but different/absent number
    if (incoming.vendor && c.vendor && normalizeVendor(incoming.vendor) === normalizeVendor(c.vendor)
        && incoming.totalCents != null && incoming.totalCents === c.totalCents && incoming.documentDate && incoming.documentDate === c.documentDate) {
      matches.push({ documentId: c.documentId, status: 'possible', reason: 'same_vendor_total_date' });
    }
  }
  matches.sort((a, b) => RANK[b.status] - RANK[a.status]);
  const status: DuplicateStatus = matches[0]?.status ?? 'none';
  return { status, matches, blocksAutoProcessing: status === 'exact' || status === 'likely' };
}
