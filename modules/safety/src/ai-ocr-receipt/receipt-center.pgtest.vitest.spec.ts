// receipt-center.pgtest — AI OCR Receipt Scanner guide (Nov 1 2026; migration 770) on the REAL migrated schema.
// SU = summary cards · LI = history (search, groups, dates, pages, scope) · DE = detail · HL = health (read-only).
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { ReceiptCenter, ReceiptCenterError, tracks } from './receipt-center';

const P = 'c7700000-0000-4000-8000-';
const id = (n: number) => P + String(n).padStart(12, '0');
const T = id(1), B1 = id(2), B2 = id(3), X = id(4), BX = id(5), OWNER = id(10);
const ctx = (o: any = {}) => ({ tenantId: T, branchId: B1, userId: OWNER, role: 'OWNER', permissions: ['pos.ai_ocr_receipt.view'], ...o });
let db: any; let rc: ReceiptCenter; let scope: string[] | null = null; let providers: string[] = [];
const q = async (s: any) => (await s.execute(db)).rows as any[];
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof ReceiptCenterError ? e.code : (e as Error).message; } }
let n = 100;
async function doc(o: { t?: string; b?: string; vendor?: string; total?: number | null; state?: string; dup?: string; daysAgo?: number; purchase?: string | null; number?: string }) {
  const D = id(++n);
  await q(sql`insert into ocr_documents (id, tenant_id, branch_id, uploaded_by_user_id, vendor, total_cents, pipeline_status, duplicate_status, document_date, document_number, created_at, updated_at)
    values (${D}, ${o.t ?? T}, ${o.b ?? B1}, ${OWNER}, ${o.vendor ?? null}, ${o.total ?? null}, ${o.state ?? 'review_required'}, ${o.dup ?? 'none'}, ${o.purchase ?? null}, ${o.number ?? null},
      now() - (${o.daysAgo ?? 0} || ' days')::interval, now() - (${o.daysAgo ?? 0} || ' days')::interval)`);
  return D;
}

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  rc = new ReceiptCenter(db, async () => scope, async () => ({ allowed: false, reason: 'trial_expired', subscriptionStatus: 'trialing' }), () => providers);
  await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'S', 'Pilot', 'rc-770', 'RC770', 'active'), (${X}, 'X', 'Other', 'rc-770x', 'RC770X', 'active')`);
  await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B1}, ${T}, 'Main', 'America/New_York'), (${B2}, ${T}, 'North', 'America/New_York'), (${BX}, ${X}, 'Other', 'America/New_York')`);
  await q(sql`insert into users (id, tenant_id, full_name, email, status, role) values (${OWNER}, ${T}, 'Owner', 'o@rc.test', 'active', 'OWNER')`);
});

describe('Receipt scanner — cards', () => {
  it('SU-01 nothing scanned: every card 0 with its definition; the queue and failures are separate', async () => {
    const s: any = await rc.summary(ctx(), {});
    expect(s.cards).toEqual({ scanned: 0, needsReview: 0, duplicates: 0, approvedExpenses: 0, approvedExpenseCents: 0 });
    expect(s.period.preset).toBe('month');
    expect(s.definitions.approvedExpenses).toBe('approved_expense_from_receipt_in_period');
  });
  it('SU-02 cards count real rows: uploaded this month, the review queue, open duplicate holds, approved expenses from receipts; another salon never counts', async () => {
    const S1 = await doc({ vendor: 'Sally Beauty', total: 4599, state: 'review_required', number: 'INV-7', purchase: '2026-10-30' });
    await doc({ vendor: 'Sally Beauty', total: 4599, state: 'duplicate_hold', dup: 'exact' });
    await doc({ vendor: 'OPI Supply', total: 12000, state: 'extraction_failed' });
    const P1 = await doc({ vendor: 'Costco', total: 8800, state: 'posted' });
    await q(sql`insert into ocr_line_items (tenant_id, document_id, line_number, description, sku, quantity, line_total_cents) values (${T}, ${S1}, 1, 'Acetone 16oz', 'ACE-16', 2, 4599)`);
    await q(sql`insert into ocr_reviews (tenant_id, document_id, status, started_by_user_id) values (${T}, ${P1}, 'approved', ${OWNER})`);
    await q(sql`insert into audit_logs (tenant_id, user_id, action_type, entity_type, entity_id, metadata_json) values (${T}, ${OWNER}, 'document.approve', 'ocr_document', ${P1}, ${JSON.stringify({ outcome: 'approved', reason: 'ok' })}::jsonb)`);
    await q(sql`insert into ocr_postings (tenant_id, document_id, destination, status, idempotency_key, posted_at) values (${T}, ${P1}, 'expense', 'posted', ${'k-' + P1}, now())`);
    await q(sql`insert into expenses (tenant_id, branch_id, category, amount_cents, incurred_on, status, receipt_document_id) values (${T}, ${B1}, 'Supplies', 8800, current_date, 'approved', ${P1})`);
    await doc({ t: X, b: BX, vendor: 'Sally Beauty', total: 4599 });   // another salon
    const s: any = await rc.summary(ctx(), {});
    expect(s.cards).toMatchObject({ scanned: 4, needsReview: 1, duplicates: 1, approvedExpenses: 1, approvedExpenseCents: 8800 });
    expect(s.pipeline.failed).toBe(1);
  });
});

describe('Receipt scanner — history', () => {
  it('LI-01 newest first with a stable tie; search by vendor, invoice number, SKU on a line, an exact amount, a document id', async () => {
    const all: any = await rc.documents(ctx(), {});
    expect(all.total).toBe(4);
    expect(all.items[0].uploadedAt >= all.items[1].uploadedAt).toBe(true);
    expect((await rc.documents(ctx(), { q: 'sally' })).total).toBe(2);
    expect((await rc.documents(ctx(), { q: 'INV-7' })).total).toBe(1);
    expect((await rc.documents(ctx(), { q: 'ACE-16' })).items[0].vendor).toBe('Sally Beauty');
    expect((await rc.documents(ctx(), { q: '$88.00' })).items[0].vendor).toBe('Costco');
    expect((await rc.documents(ctx(), { q: all.items[0].id })).total).toBe(1);
  });
  it('LI-02 status groups, four separate tracks, purchase-date filter, numbered pages', async () => {
    const dup: any = await rc.documents(ctx(), { group: 'duplicates' });
    expect(dup.items.map((x: any) => x.tracks.duplicate)).toEqual(['exact']);
    const posted: any = await rc.documents(ctx(), { group: 'posted' });
    expect(posted.items[0].tracks).toEqual({ reading: 'read', expense: 'expense_approved', receiving: 'not_applicable', duplicate: 'none' });
    expect((await rc.documents(ctx(), { group: 'failed' })).items[0].tracks.reading).toBe('failed');
    expect((await rc.documents(ctx(), { dateField: 'purchase', preset: 'custom', from: '2026-10-01', to: '2026-10-31' })).total).toBe(1);
    const p2: any = await rc.documents(ctx(), { pageSize: 10, page: 2 });
    expect(p2.items).toEqual([]); expect(p2.total).toBe(4);
    expect(await code(rc.documents(ctx(), { preset: 'custom', from: '2026-11-05', to: '2026-11-01' }))).toBe('RC_INVALID_PERIOD');
  });
  it('LI-03 a branch-restricted person sees only their branches; another branch\'s receipt answers like a missing one', async () => {
    const other = await doc({ b: B2, vendor: 'North Supply', total: 500 });
    scope = [B1];
    expect((await rc.documents(ctx(), { q: 'North' })).total).toBe(0);
    expect(await code(rc.document(ctx(), other))).toBe('RC_NOT_FOUND');
    scope = null;
    expect((await rc.documents(ctx(), { q: 'North' })).total).toBe(1);
  });
});

describe('Receipt Review queues (guide 12)', () => {
  it('RV-01 each tab is one exact queue (in_review sits with Review Required); the per-state counts match', async () => {
    await doc({ vendor: 'In Review Co', state: 'in_review' });
    await doc({ vendor: 'Hand Typed', state: 'manual_entry_required' });
    expect((await rc.documents(ctx(), { group: 'review' })).items.map((x: any) => x.vendor).sort()).toEqual(['In Review Co', 'North Supply', 'Sally Beauty']);
    expect((await rc.documents(ctx(), { group: 'manual_entry' })).items.map((x: any) => x.vendor)).toEqual(['Hand Typed']);
    expect((await rc.documents(ctx(), { group: 'reading_failed' })).items.map((x: any) => x.vendor)).toEqual(['OPI Supply']);
    expect((await rc.documents(ctx(), { group: 'duplicate_hold' })).total).toBe(1);
    const s: any = await rc.summary(ctx(), {});
    expect(s.states).toMatchObject({ review_required: 2, in_review: 1, duplicate_hold: 1, extraction_failed: 1, posted: 1, manual_entry_required: 1 });
  });
});

describe('Receipt scanner — detail and health', () => {
  it('DE-01 the detail carries lines, the expense link, the approval trail; another salon\'s id is not found', async () => {
    const posted: any = (await rc.documents(ctx(), { group: 'posted' })).items[0];
    const d: any = await rc.document(ctx(), posted.id);
    expect(d.expense).toMatchObject({ status: 'approved', amountCents: 8800 });
    expect(d.postings[0]).toMatchObject({ destination: 'expense', status: 'posted' });
    expect(d.trail[0]).toMatchObject({ action: 'approve', by: 'Owner' });
    const x = (await q(sql`select id from ocr_documents where tenant_id = ${X} limit 1`))[0].id;
    expect(await code(rc.document(ctx(), x))).toBe('RC_NOT_FOUND');
    expect(tracks({ pipeline_status: 'approved', posting_dest: null })).toMatchObject({ expense: 'approved_not_posted' });
  });
  it('HL-01 a posting with no approval is FAILED; no reading service is a WARNING; the check writes only its run', async () => {
    const D = await doc({ vendor: 'Ghost', total: 100, state: 'posted' });
    await q(sql`insert into ocr_postings (tenant_id, document_id, destination, status, idempotency_key, posted_at) values (${T}, ${D}, 'expense', 'posted', ${'k-' + D}, now())`);
    const before = (await q(sql`select count(*)::int as n from ocr_postings where tenant_id = ${T}`))[0].n;
    const c: any = await rc.check(ctx());
    const by = (k: string) => c.checks.find((x: any) => x.key === k);
    expect(by('posting_needs_approval')).toMatchObject({ state: 'FAILED', count: 1 });
    expect(by('ocr_provider').state).toBe('WARNING');
    expect(by('subscription')).toMatchObject({ state: 'FAILED', detail: { reason: 'trial_expired' } });
    expect(by('tenant_isolation').state).toBe('PASSED');
    expect(c.overall).toBe('FAILED');
    expect((await rc.check(ctx())).reused).toBe(true);
    expect((await q(sql`select count(*)::int as n from ocr_postings where tenant_id = ${T}`))[0].n).toBe(before);
  });
});
