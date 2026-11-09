// logs-page.pgtest — Device & Integration Logs SUNMI guide (Nov 9 2026) on the REAL schema: dated, numbered pages,
// newest first, the range's counts, and the real device events (audit_logs / go_checkin_logs) read where they live.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyLogsRepository } from './logs.kysely.repository';
import { LogsService, ValidationError } from './logs.service';

const T = 'c8460000-0000-4000-8000-000000000001', B = 'c8460000-0000-4000-8000-000000000002', X = 'c8460000-0000-4000-8000-000000000003', U = 'c8460000-0000-4000-8000-000000000004';
const ctx = { tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: ['pos.logs.view'] };
let db: any; let svc: LogsService;
const q = async (s: any) => (await s.execute(db)).rows;

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  svc = new LogsService(new KyselyLogsRepository(db));
  await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'S', 'Pilot', 'lg-846', 'LG846', 'active'), (${X}, 'X', 'Other', 'lg-846x', 'LG846X', 'active')`);
  await q(sql`insert into branches (id, tenant_id, name) values (${B}, ${T}, 'Main')`);
  await q(sql`insert into tenant_event_logs (tenant_id, branch_id, category, severity, source, message, created_at) values
    (${T}, ${B}, 'integration', 'error', 'webhook', 'delivery failed 500', '2026-11-08T10:00:00Z'),
    (${T}, ${B}, 'integration', 'info', 'webhook', 'delivered', '2026-11-07T10:00:00Z'),
    (${X}, null, 'integration', 'error', 'webhook', 'other salon', '2026-11-08T10:00:00Z')`);
  await q(sql`insert into audit_logs (tenant_id, branch_id, action_type, entity_type, entity_id, created_at) values
    (${T}, ${B}, 'customer_display_revoked', 'customer_display', ${B}, '2026-11-09T09:00:00Z'), (${T}, ${B}, 'customer_note_reviewed', 'customer', ${B}, '2026-11-09T09:30:00Z')`);
  await q(sql`insert into go_checkin_logs (tenant_id, branch_id, event_type, safe_message, created_at) values (${T}, ${B}, 'check_in_completed', 'guest checked in', '2026-11-06T10:00:00Z')`);
}, 180_000);

describe('Device & Integration Logs — pages', () => {
  it('LG-01 newest first across the log store and the device events; other salons and non-device audits excluded', async () => {
    const r = await svc.query(ctx, { page: 1, pageSize: 10 });
    expect(r.logs.map((l) => l.message)).toEqual(['customer display revoked', 'delivery failed 500', 'delivered', 'guest checked in']);
    expect(r.summary).toEqual({ events: 4, warnings: 1, errors: 1, device: 2, integration: 2 });
    expect(r).toMatchObject({ total: 4, page: 1, pageSize: 10, totalPages: 1 });
  });
  it('LG-02 filters + date range + pages agree with the counts', async () => {
    const r = await svc.query(ctx, { page: 1, pageSize: 10, category: 'device' });
    expect(r.logs.every((l) => l.category === 'device')).toBe(true); expect(r.summary!.events).toBe(2);
    const d = await svc.query(ctx, { page: 1, pageSize: 10, from: '2026-11-07', to: '2026-11-08' });
    expect(d.logs.map((l) => l.message)).toEqual(['delivery failed 500', 'delivered']);
    const p2 = await svc.query(ctx, { page: 2, pageSize: 10, search: 'deliver' });
    expect(p2.logs).toHaveLength(0); expect(p2.total).toBe(2);
    await expect(svc.query(ctx, { page: 1, from: '2026-11-09', to: '2026-11-01' })).rejects.toBeInstanceOf(ValidationError);
  });
  it('LG-03 the legacy shape (no page) is unchanged', async () => {
    const r = await svc.query(ctx, { limit: 50 });
    expect(Object.keys(r)).toEqual(['logs']);
    expect(r.logs.map((l) => l.message)).toEqual(['delivery failed 500', 'delivered']);
  });
});
