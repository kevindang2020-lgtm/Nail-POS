// super-admin-ai-ocr-receipt.pgtest — §78 / §145 / §149 (Oct 27 2026): the Super Admin overview on the real schema answers
// counts and rates only (never a receipt's content or a salon's name): the status map, the §115 dead letter, and the quality
// metrics — OCR success, median read time, review rate, category kept / corrected (recommended vs final, from the history),
// duplicates flagged. An empty platform answers nulls, not invented percentages.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { SuperAdminAiOcrReceiptService } from './super-admin-ai-ocr-receipt.service';

const T = 'a7800000-0000-4000-8000-000000000001', U = 'a7800000-0000-4000-8000-0000000000e1';
let pg: any; let db: any; let svc: SuperAdminAiOcrReceiptService;
const q = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows;

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg); svc = new SuperAdminAiOcrReceiptService(db);
  await q(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ($1,'A','A','sa-ocr-a','SAOCRA','active')`, [T]);
  await q(`INSERT INTO users (id, tenant_id, first_name, last_name, full_name, email, status, role) VALUES ($1, $2, 'O', 'O', 'O O', 'o@sa-ocr.test', 'active', 'OWNER')`, [U, T]);
}, 180000);

describe('Super Admin OCR overview', () => {
  it('an empty platform: zero counts, null rates (nothing invented)', async () => {
    const ov = await svc.platformOverview({ userId: 'sa' } as any);
    expect(ov.totalDocuments).toBe(0); expect(ov.extractionDeadLetter).toBe(0);
    expect(ov.metrics).toMatchObject({ uploads: 0, extracted: 0, extractionFailed: 0, ocrSuccessRate: null, medianProcessingMs: null, reviewRate: null, autoCategoryAccuracy: null, categoryCorrectionRate: null, duplicateRate: null });
  });
  it('counts the dead letter and derives the rates from the documents and the expense history', async () => {
    // 4 readings: 3 reached review (one of them needs review), 1 gave up (dead letter), 1 is still retrying (not dead)
    await q(`INSERT INTO ocr_documents (tenant_id, pipeline_status, validation_status, created_at, updated_at) VALUES
      ($1, 'review_required', 'valid', now() - interval '10 minutes', now() - interval '9 minutes'),
      ($1, 'posted', 'valid', now() - interval '20 minutes', now() - interval '19 minutes'),
      ($1, 'review_required', 'needs_review', now() - interval '30 minutes', now() - interval '27 minutes'),
      ($1, 'extraction_failed', 'pending', now() - interval '40 minutes', now() - interval '35 minutes'),
      ($1, 'extraction_failed', 'pending', now() - interval '5 minutes', now())`, [T]);
    await q(`UPDATE ocr_documents SET next_extraction_at = now() + interval '1 minute' WHERE tenant_id = $1 AND created_at > now() - interval '6 minutes'`, [T]);
    // 4 scanned expenses: 1 category corrected by a person, 1 flagged as a possible duplicate; 1 manual expense
    const ids = (await q(`INSERT INTO expenses (tenant_id, status, kind, category, category_source, amount_cents, vendor, incurred_on, source, duplicate_status, created_by, updated_by)
      SELECT $1, 'approved', 'expense', 'supplies', 'system_rule', 1000 + g, 'V', '2026-10-20', 'ocr', CASE WHEN g = 4 THEN 'possible' ELSE 'none' END, $2, $2 FROM generate_series(1, 4) g RETURNING id`, [T, U])).map((r: any) => r.id);
    await q(`INSERT INTO expenses (tenant_id, status, kind, category, category_source, amount_cents, vendor, incurred_on, source, created_by, updated_by) VALUES ($1, 'approved', 'expense', 'rent', 'owner', 5000, 'L', '2026-10-20', 'manual', $2, $2)`, [T, U]);
    await q(`INSERT INTO expense_history (tenant_id, expense_id, action, actor_user_id, before_state, after_state, version) VALUES ($1, $2, 'category_corrected', $3, '{"category":"supplies"}', '{"category":"equipment"}', 2)`, [T, ids[0], U]);
    const ov = await svc.platformOverview({ userId: 'sa' } as any);
    expect(ov.extractionDeadLetter).toBe(1);
    expect(ov.byStatus['extraction_failed']).toBe(2);
    const m = ov.metrics!;
    expect([m.uploads, m.extracted, m.extractionFailed]).toEqual([5, 3, 2]);
    expect(m.ocrSuccessRate).toBe(0.6);
    expect(m.medianProcessingMs).toBe(60_000);                       // readings took 1, 1 and 3 minutes → median 1 min
    expect(m.reviewRate).toBe(0.333);                                 // one of the three extracted needed review
    expect(m.autoCategoryAccuracy).toBe(0.75); expect(m.categoryCorrectionRate).toBe(0.25);
    expect(m.duplicateRate).toBe(0.2);                                // 1 of 5 expenses created
    expect(JSON.stringify(ov)).not.toContain('V');                    // no vendor, no receipt content — counts only
  });
});
