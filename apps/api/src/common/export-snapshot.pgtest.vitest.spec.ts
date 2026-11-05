// BUILD_PLAN Phase 9 (Constitution 2 §153 exports): every export records who / which key / filters / rows / checksum in
// export_snapshots (append-only), and an export whose record cannot be written is not handed over.
import { describe, it, expect, beforeAll } from 'vitest';
import { lastValueFrom, of } from 'rxjs';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { ExportSnapshotInterceptor, isExportRoute, summarizeExport, exportChecksum, exportFilters } from './export-snapshot.interceptor';

const T = 'a9200000-0000-4000-8000-0000000000a1', U = 'c9200000-0000-4000-8000-0000000000c1', B = 'b9200000-0000-4000-8000-0000000000b1';
let db: any;
const reflector = (key: string | null) => ({ get: () => key }) as any;
const ctxFor = (req: any) => ({ getType: () => 'http', switchToHttp: () => ({ getRequest: () => req }), getHandler: () => () => undefined }) as any;
const req = (path: string, query: Record<string, unknown> = {}) => ({ method: 'GET', route: { path }, query, ctx: { tenantId: T, branchId: B, userId: U, role: 'MANAGER', permissions: [] } });
const CSV = 'Name,Phone\nAnn,555-0101\nBob,555-0102\n';

beforeAll(async () => { db = kyselyFor(await migratedPglite()); }, 120_000);

describe('recognising an export', () => {
  it('by its key or its path; reads never', () => {
    expect(isExportRoute('pos.customers.export', '/pos/customers/export', 'GET')).toBe(true);
    expect(isExportRoute('ai_scheduling.export', '/pos/ai-scheduling/ops/export', 'GET')).toBe(true);
    expect(isExportRoute('owner.reports.export', '/owner/reports/:reportId/export', 'GET')).toBe(true);
    expect(isExportRoute(null, '/super-admin/billing/exports/:id', 'GET')).toBe(true);
    expect(isExportRoute('pos.customers.view', '/pos/customers', 'GET')).toBe(false);
    expect(isExportRoute(null, '/super-admin/billing/exports/jobs/:token', 'GET')).toBe(false);   // polling a job hands nothing over
    expect(isExportRoute(null, '/super-admin/billing/exports/jobs/:token/download', 'GET')).toBe(true);
    expect(isExportRoute('pos.customers.export', '/pos/customers/export', 'DELETE')).toBe(false);
  });
  it('summarises what was handed over', () => {
    expect(summarizeExport(CSV)).toMatchObject({ rowCount: 2, format: 'csv' });
    expect(summarizeExport({ format: 'csv', filename: 'x.csv', csv: CSV })).toMatchObject({ rowCount: 2, content: CSV });
    expect(summarizeExport({ rows: [1, 2, 3] })?.rowCount).toBe(3);
    expect(summarizeExport({ format: 'pdf', filename: '', disabledReason: 'not configured' })).toBeNull();
    expect(summarizeExport('')).toBeNull();
    expect(exportChecksum(CSV)).toMatch(/^[0-9a-f]{64}$/);
    expect(exportFilters({ status: 'active', tenantId: 'evil', branch_id: 'x' })).toEqual({ status: 'active' });
  });
});

describe('the interceptor', () => {
  it('records who, which key, filters, row count and the checksum of exactly the CSV handed over', async () => {
    const i = new ExportSnapshotInterceptor(reflector('pos.customers.export'), db);
    const out = await lastValueFrom(i.intercept(ctxFor(req('/pos/customers/export', { segment: 'vip', tenantId: 'spoof' })), { handle: () => of({ format: 'csv', filename: 'pos-customers.csv', csv: CSV }) }));
    expect(out).toMatchObject({ csv: CSV });
    const row: any = (await sql`select * from export_snapshots where tenant_id = ${T} order by created_at desc limit 1`.execute(db)).rows[0];
    expect(row).toMatchObject({ user_id: U, branch_id: B, permission: 'pos.customers.export', row_count: 2, checksum: exportChecksum(CSV), format: 'csv', route: 'GET /pos/customers/export' });
    expect(row.filters).toEqual({ segment: 'vip' });
  });
  it('leaves a non-export route alone and records nothing for an export that handed nothing over', async () => {
    const before = Number(((await sql`select count(*)::int as n from export_snapshots`.execute(db)) as any).rows[0].n);
    await lastValueFrom(new ExportSnapshotInterceptor(reflector('pos.customers.view'), db).intercept(ctxFor(req('/pos/customers')), { handle: () => of([{ id: 1 }]) }));
    await lastValueFrom(new ExportSnapshotInterceptor(reflector('pos.reports.export'), db).intercept(ctxFor(req('/pos/reports/export')), { handle: () => of({ format: 'pdf', filename: '', disabledReason: 'x' }) }));
    expect(Number(((await sql`select count(*)::int as n from export_snapshots`.execute(db)) as any).rows[0].n)).toBe(before);
  });
  it('fails CLOSED: when the record cannot be written the export is not handed over (503)', async () => {
    const broken = { getExecutor: () => { throw new Error('db down'); } } as any;
    const p = lastValueFrom(new ExportSnapshotInterceptor(reflector('pos.customers.export'), broken).intercept(ctxFor(req('/pos/customers/export')), { handle: () => of(CSV) }));
    await expect(p).rejects.toMatchObject({ status: 503 });
  });
  it('a snapshot is evidence: it can never be changed or deleted', async () => {
    await expect(sql`update export_snapshots set row_count = 0`.execute(db)).rejects.toThrow(/append-only/);
    await expect(sql`delete from export_snapshots`.execute(db)).rejects.toThrow(/append-only/);
  });
});
