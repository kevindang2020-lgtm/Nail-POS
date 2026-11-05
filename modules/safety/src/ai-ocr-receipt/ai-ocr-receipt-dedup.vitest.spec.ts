// ai-ocr-receipt-dedup.vitest.spec.ts — tenant-scoped duplicate detection via file hash, perceptual near-match, and
// transaction signature. Exact/likely block auto-processing; cross-tenant candidates are never passed in.
import { describe, it, expect } from 'vitest';
import { detectDuplicates, transactionSignature, normalizeVendor, hammingDistance, type DuplicateCandidate } from './ai-ocr-receipt-dedup';

const cand = (o: Partial<DuplicateCandidate>): DuplicateCandidate => ({ documentId: 'd1', fileHash: null, perceptualHash: null, vendor: 'Acme Inc', documentNumber: 'INV-100', documentDate: '2025-03-04', totalCents: 1080, ...o });
const incoming = (o: any = {}) => ({ fileHash: 'h1', perceptualHash: 'ffff0000ffff0000', vendor: 'Acme Inc', documentNumber: 'INV-100', documentDate: '2025-03-04', totalCents: 1080, ...o });

describe('signatures + hashing', () => {
  it('normalizes vendors and builds stable signatures', () => {
    expect(normalizeVendor('Acme, Inc.')).toBe(normalizeVendor('ACME INC'));
    expect(transactionSignature(incoming())).toMatch(/^n\|acme\|inv-100\|1080/);
    expect(transactionSignature({ ...incoming(), documentNumber: null })).toMatch(/^d\|acme\|2025-03-04\|1080/);
    expect(hammingDistance('00', '0f')).toBe(4);
    expect(hammingDistance('ff', 'ffff')).toBe(Infinity);
  });
});

describe('duplicate detection', () => {
  it('ranks exact > likely and blocks auto-processing on both', () => {
    const exact = detectDuplicates(incoming(), [cand({ documentId: 'dup', fileHash: 'h1' })]);
    expect(exact.status).toBe('exact');
    expect(exact.blocksAutoProcessing).toBe(true);
    const sameSig = detectDuplicates(incoming({ fileHash: 'h2' }), [cand({ documentId: 'dup', fileHash: 'hX' })]);
    expect(sameSig.status).toBe('likely');
    expect(sameSig.blocksAutoProcessing).toBe(true);
    const multi = detectDuplicates(incoming(), [cand({ documentId: 'sig', fileHash: 'hX' }), cand({ documentId: 'exact', fileHash: 'h1' })]);
    expect(multi.matches[0].status).toBe('exact');
  });
  it('grades perceptual matches and leaves unrelated docs as none', () => {
    expect(detectDuplicates(incoming({ fileHash: 'z', documentNumber: 'DIFF', perceptualHash: 'ffff0000ffff0001' }), [cand({ documentId: 'dup', documentNumber: 'OTHER', totalCents: 999, perceptualHash: 'ffff0000ffff0000' })]).status).toBe('likely');
    const soft = detectDuplicates({ fileHash: 'z', perceptualHash: 'ffff0000ffffff00', vendor: null, documentNumber: null, documentDate: null, totalCents: null }, [cand({ documentId: 'dup', vendor: null, documentNumber: null, documentDate: null, totalCents: null, perceptualHash: 'ffff0000ffff0000' })]);
    expect(soft.status).toBe('possible');
    expect(soft.blocksAutoProcessing).toBe(false);
    const none = detectDuplicates(incoming({ fileHash: 'z', perceptualHash: '0000000000000000', documentNumber: 'NEW', totalCents: 1, vendor: 'Zeta' }), [cand({ documentId: 'other', fileHash: 'y', perceptualHash: 'ffffffffffffffff' })]);
    expect(none.status).toBe('none');
  });
  it('finds no duplicates when no (same-tenant) candidates are provided', () => {
    expect(detectDuplicates(incoming(), []).status).toBe('none');
  });
});
