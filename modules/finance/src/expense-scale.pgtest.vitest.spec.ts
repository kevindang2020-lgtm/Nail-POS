// expense-scale.pgtest — mandate §205: 10 receipts, 1,000 receipts, 100,000 expenses (SCALE_TESTS=1; 10,000 routinely), on the real migrated schema (PGlite).
// Proves the reads stay PAGED and INDEXED at that size: the inbox list answers one page (never the table), its total is a
// count, the dashboard / report aggregate in SQL, the OCR document list is capped, and EXPLAIN shows the (tenant, …) indexes
// chosen rather than a sequential scan of 100k rows. The rows are generated in SQL (generate_series) — no service loop.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { ExpenseService, type FinanceCtx, type BranchScopePort } from './expense.service';

const T = 'f9200000-0000-4000-8000-000000000001', T2 = 'f9200000-0000-4000-8000-000000000002';
const B1 = 'f9200000-0000-4000-8000-0000000000b1', B2 = 'f9200000-0000-4000-8000-0000000000b2';
const OWNER = 'f9200000-0000-4000-8000-0000000000e1';
const ALL = ['owner.expenses.view', 'owner.expenses.manage', 'owner.expenses.approve', 'owner.expenses.export', 'owner.expenses.categories.manage', 'owner.expenses.reimbursements.manage'];
const owner: FinanceCtx = { tenantId: T, userId: OWNER, role: 'OWNER', permissions: ALL };
const scopes: BranchScopePort = { async resolve(_ctx, requested) { return { branchId: requested ?? null, allowed: null, restricted: null }; } };
let pg: { query: (s: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
let svc: ExpenseService;
const q = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows;
// the full §205 size (100,000 expenses) takes ~4.5 min to seed on a 2-core host, so the routine run seeds 10,000 and the
// same assertions scale with EXPENSES; SCALE_TESTS=1 runs the mandate's full figure (proven Oct 27 2026: 6/6 in 277 s)
const FULL = /^(1|true|yes)$/i.test(String(process.env.SCALE_TESTS ?? ''));
const EXPENSES = FULL ? 100_000 : 10_000, RECEIPTS = 1_000;

beforeAll(async () => {
  pg = await migratedPglite();
  svc = new ExpenseService(kyselyFor(pg) as never, scopes, new OutboxWriter(), () => new Date('2026-10-27T15:00:00Z'));
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'Scale Co','Scale Salon','scale-a','SCLA'), ($2,'Other','Other','scale-b','SCLB')`, [T, T2]);
  await q(`insert into tenant_settings (id, tenant_id, branch_id, category, settings_json) values (gen_random_uuid(), $1, NULL, 'business-branch', '{"timezone":"UTC"}'::jsonb)`, [T]);
  await q(`insert into branches (id, tenant_id, name) values ($1,$3,'Downtown'), ($2,$3,'Uptown')`, [B1, B2, T]);
  await q(`insert into users (id, tenant_id, first_name, last_name, full_name, email, status, role) values ($1,$2,'O','O','O O','o@scale.test','active','OWNER')`, [OWNER, T]);
  // 1,000 receipts (10 of them today), 100,000 expenses over three years, 90 % approved, 10 categories, 50 vendors, two branches
  await q(`insert into ocr_documents (tenant_id, branch_id, vendor, total_cents, pipeline_status, document_type, created_at)
    select $1, case when g % 2 = 0 then $2::uuid else $3::uuid end, 'Vendor ' || (g % 50), 1000 + g, case when g % 10 = 0 then 'review_required' else 'posted' end, 'receipt',
           case when g <= 10 then now() else now() - ((1 + g % 700) || ' days')::interval end
    from generate_series(1, ${RECEIPTS}) g`, [T, B1, B2]);
  await q(`insert into expenses (tenant_id, branch_id, status, kind, bill_status, category, category_source, amount_cents, vendor, incurred_on, source, created_by, updated_by, version)
    select $1, case when g % 3 = 0 then null when g % 3 = 1 then $2::uuid else $3::uuid end,
           case when g % 10 = 0 then 'pending_review' else 'approved' end, case when g % 25 = 0 then 'bill' else 'expense' end, case when g % 25 = 0 then 'open' else null end,
           (array['rent','supplies','equipment','utilities','marketing','repairs','insurance','software','payroll','other'])[1 + g % 10], 'owner',
           100 + (g * 37) % 50000, 'Vendor ' || (g % 50), (date '2026-10-27' - (g % 1095))::date, 'manual', $4, $4, 1
    from generate_series(1, ${EXPENSES}) g`, [T, B1, B2, OWNER]);
  await q(`analyze expenses`); await q(`analyze ocr_documents`);
}, 600_000);

describe('§205 scale: 1,000 receipts and 100,000 expenses', () => {
  it('the data is there, for this salon only', async () => {
    expect(Number((await q(`select count(*)::int as c from expenses where tenant_id = $1`, [T]))[0].c)).toBe(EXPENSES);
    expect(Number((await q(`select count(*)::int as c from ocr_documents where tenant_id = $1`, [T]))[0].c)).toBe(RECEIPTS);
    expect(Number((await q(`select count(*)::int as c from expenses where tenant_id = $1`, [T2]))[0].c)).toBe(0);
  });
  it('the inbox list answers ONE page (50 by default, 200 at most) with a counted total — never the whole table', async () => {
    const t0 = Date.now();
    const page = await svc.list(owner, { tab: 'all', branchId: 'all' } as never);
    expect(page.items).toHaveLength(50);
    expect(page.total).toBe(EXPENSES);
    const last = await svc.list(owner, { tab: 'all', branchId: 'all', page: EXPENSES / 50, pageSize: 50 } as never);
    expect(last.items).toHaveLength(50);
    expect((await svc.list(owner, { tab: 'all', branchId: 'all', pageSize: 5000 } as never)).items).toHaveLength(200);   // the cap
    const review = await svc.list(owner, { tab: 'needs_review', branchId: 'all', pageSize: 10 } as never);
    expect(review.items).toHaveLength(10); expect(review.total).toBe(EXPENSES / 10);
    const filtered = await svc.list(owner, { tab: 'approved', branchId: 'all', category: 'rent', minCents: 40000, period: 'year', pageSize: 20 } as never);
    expect(filtered.items.every((e: { category: string; amountCents: number }) => e.category === 'rent' && e.amountCents >= 40000)).toBe(true);
    const search = await svc.list(owner, { tab: 'all', branchId: 'all', q: 'Vendor 7', pageSize: 20 } as never);
    expect(search.items.length).toBe(20); expect(search.total).toBeGreaterThan(EXPENSES / 100);
    expect(Date.now() - t0).toBeLessThan(20_000);
  }, 60_000);
  it('the dashboard and the report aggregate in SQL and reconcile with each other at 100k rows', async () => {
    const dash = await svc.dashboard(owner, 'all');
    expect(dash.receiptsUploadedToday).toBe(10);
    expect(dash.needsReview).toBe(EXPENSES / 10);
    const year = await svc.report(owner, { period: 'year', branchId: 'all' });
    expect(year.count).toBeGreaterThan(EXPENSES / 5);
    expect(year.reconciles).toBe(true);
    expect(year.byCategory).toHaveLength(10);
    expect(year.byCategory.reduce((t, c) => t + c.totalCents, 0)).toBe(year.totalCents);
    expect(year.totalCents).toBe(dash.thisYearCents);
    const month = await svc.report(owner, { period: 'month', branchId: 'all' });
    expect(month.totalCents).toBe(dash.thisMonthCents);
  }, 60_000);
  it('the list, the dashboard counts and the report read through the tenant / date / status indexes — no sequential scan of expenses', async () => {
    const plans = await Promise.all([
      q(`explain select * from expenses e where e.tenant_id = $1 and e.archived_at is null order by e.incurred_on desc, e.created_at desc, e.id limit 50`, [T]),
      q(`explain select coalesce(sum(amount_cents),0) from expenses e where e.tenant_id = $1 and e.status in ('approved') and e.incurred_on between '2026-01-01' and '2026-12-31'`, [T]),
      q(`explain select count(*) from expenses e where e.tenant_id = $1 and e.status = 'pending_review' and e.archived_at is null`, [T]),
    ]);
    for (const p of plans) {
      const text = p.map((r) => String(r['QUERY PLAN'])).join('\n');
      expect(text).toMatch(/Index|Bitmap/);
      expect(text).not.toMatch(/Seq Scan on expenses/);
    }
  });
  it('the OCR document list is capped at 200 rows with a counted total; a thumbnail is never fetched with the list (no bytes column)', async () => {
    const list = await q(`select id, vendor, total_cents, pipeline_status from ocr_documents where tenant_id = $1 and deleted_at is null order by created_at desc limit 200`, [T]);
    expect(list).toHaveLength(200);
    expect(Number((await q(`select count(*)::int as c from ocr_documents where tenant_id = $1 and deleted_at is null`, [T]))[0].c)).toBe(RECEIPTS);
    const plan = (await q(`explain select id from ocr_documents where tenant_id = $1 and pipeline_status = 'review_required' order by created_at desc limit 200`, [T])).map((r) => String(r['QUERY PLAN'])).join('\n');
    expect(plan).toMatch(/Index|Bitmap/);
  });
  it('ten receipts posted through the service in a row stay idempotent per document and show up in the dashboard', async () => {
    const docs = await q(`select id from ocr_documents where tenant_id = $1 and pipeline_status = 'review_required' limit 10`, [T]);
    expect(docs).toHaveLength(10);
    for (const [i, d] of docs.entries()) {
      const cents = 250_001 + i;   // ten different receipts (not ten copies of one — that would rightly be stopped as duplicates)
      await q(`update ocr_documents set document_date = '2026-10-27', vendor = 'Scale Vendor', total_cents = $2 where id = $1`, [d.id, cents]);
      const a = await svc.create(owner, { amountCents: cents, incurredOn: '2026-10-27', vendor: 'Scale Vendor', category: 'supplies', receiptDocumentId: String(d.id), intent: 'submit', idempotencyKey: `scale-${d.id}` });
      const b = await svc.create(owner, { amountCents: cents, incurredOn: '2026-10-27', vendor: 'Scale Vendor', category: 'supplies', receiptDocumentId: String(d.id), intent: 'submit', idempotencyKey: `scale-${d.id}` });
      expect(b.expense.id).toBe(a.expense.id); expect(b.created).toBe(false);
    }
    expect((await svc.dashboard(owner, 'all')).needsReview).toBe(EXPENSES / 10 + 10);
  }, 60_000);
  // VietnamesePOS §41 (Oct 28 2026 audit): the expense search folds accents like every other POS name search — runs last so
  // the extra row does not move the counts above
  it('"nha cung cap dep" finds the vendor "Nhà Cung Cấp Đẹp"; the amount and number searches are unchanged', async () => {
    await svc.create(owner, { amountCents: 4321, incurredOn: '2026-10-27', vendor: 'Nhà Cung Cấp Đẹp', category: 'supplies', intent: 'submit', idempotencyKey: 'vi-fold-vendor' });
    const hit = await svc.list(owner, { tab: 'all', branchId: 'all', q: 'nha cung cap dep', pageSize: 5 } as never);
    expect(hit.items.map((e: { vendor: string }) => e.vendor)).toEqual(['Nhà Cung Cấp Đẹp']);
    expect((await svc.list(owner, { tab: 'all', branchId: 'all', q: 'ĐẸP', pageSize: 5 } as never)).total).toBe(1);
    expect((await svc.list(owner, { tab: 'all', branchId: 'all', q: '$43.21', pageSize: 5 } as never)).total).toBeGreaterThanOrEqual(1);
  }, 60_000);
});
