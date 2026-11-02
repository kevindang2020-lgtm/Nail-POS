// BUILD_PLAN Phase 12 (#27): the analytics lifecycles on the REAL schema — owner_alerts (a closed alert stays closed,
// a repeat is a no-op, a stale writer is refused) and ai_business_report_jobs (a finished report never moves again).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyOwnerRepository } from './owner/owner.kysely.repository';
import { KyselyReportsJobRepository } from './ai-business/ai-business-reports.kysely.repository';
import { AI_BUSINESS_REPORT_JOB, OWNER_ALERT } from './analytics-lifecycles';

const T = '7a000000-0000-4000-8000-0000000000a1';
const B = '7a000000-0000-4000-8000-0000000000b1';
const U = '7a000000-0000-4000-8000-0000000000c1';
let pg: any; let owner: KyselyOwnerRepository; let reports: KyselyReportsJobRepository;
const ctx = { tenantId: T, userId: U, role: 'OWNER', permissions: ['owner.alerts.resolve'], branchId: B } as never;
const q = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows as any[];
const alert = async (status = 'new') => (await q(`insert into owner_alerts (tenant_id, branch_id, category, severity, status, title) values ($1,$2,'ops','info',$3,'Test') returning id`, [T, B, status]))[0].id as string;
const statusOf = async (t: string, id: string) => (await q(`select status from ${t} where id = $1`, [id]))[0].status;

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Lifecycle LLC','Lifecycle','lifecycle-a','LIFEA','active')`, [T]);
  await q(`insert into branches (id, tenant_id, name, status) values ($1,$2,'Main','active')`, [B, T]);
  const db = kyselyFor(pg) as never;
  owner = new KyselyOwnerRepository(db); reports = new KyselyReportsJobRepository(db);
}, 120_000);

describe('owner_alert machine', () => {
  it('reproduces today: new → acknowledged → resolved; repeating a move is a no-op', async () => {
    const id = await alert();
    expect((await owner.updateAlertStatus(ctx, id, 'acknowledged', U, false))?.status).toBe('acknowledged');
    expect((await owner.updateAlertStatus(ctx, id, 'acknowledged', U, false))?.status).toBe('acknowledged');
    expect((await owner.updateAlertStatus(ctx, id, 'resolved', U, true))?.status).toBe('resolved');
    expect((await owner.updateAlertStatus(ctx, id, 'resolved', U, true))?.status).toBe('resolved');
  });
  it('a resolved / dismissed alert is closed: it cannot be re-opened or flipped (409 INVALID_STATE_TRANSITION, nothing written)', async () => {
    const r = await alert('resolved'); const d = await alert('dismissed');
    for (const [id, to] of [[r, 'acknowledged'], [r, 'dismissed'], [d, 'resolved'], [d, 'acknowledged']] as const) {
      const e: any = await owner.updateAlertStatus(ctx, id, to, U, false).catch((x) => x);
      expect(e).toMatchObject({ code: 'INVALID_STATE_TRANSITION', status: 409, details: { machine: 'owner_alert', to } });
    }
    expect(await statusOf('owner_alerts', r)).toBe('resolved');
    expect(await statusOf('owner_alerts', d)).toBe('dismissed');
  });
  it('the table: every move listed, nothing out of a closed state', () => {
    expect(OWNER_ALERT.sourcesOf('acknowledged').sort()).toEqual(['acknowledged', 'in_progress', 'new']);
    expect(OWNER_ALERT.can('resolved', 'acknowledged')).toBe(false);
  });
});

describe('ai_business_report_job machine', () => {
  it('queued → running → completed; a late failure cannot overwrite the completed report', async () => {
    const job = await reports.create(ctx, 'daily_brief' as never, 'today');
    await reports.markRunning(ctx, job.id);
    expect((await reports.complete(ctx, job.id, { ok: 1 }))?.status).toBe('completed');
    expect(await reports.fail(ctx, job.id, 'late timeout')).toBeNull();
    expect(await statusOf('ai_business_report_jobs', job.id)).toBe('completed');
    await reports.markRunning(ctx, job.id);
    expect(await statusOf('ai_business_report_jobs', job.id)).toBe('completed');
  });
  it('a failed report stays failed (no completion after the failure); a queued job may still finish (markRunning lost)', async () => {
    const a = await reports.create(ctx, 'daily_brief' as never, 'today');
    expect((await reports.fail(ctx, a.id, 'boom'))?.status).toBe('failed');
    expect(await reports.complete(ctx, a.id, { ok: 1 })).toBeNull();
    const b = await reports.create(ctx, 'daily_brief' as never, 'today');
    expect((await reports.complete(ctx, b.id, { ok: 1 }))?.status).toBe('completed');
    expect(AI_BUSINESS_REPORT_JOB.sourcesOf('completed').sort()).toEqual(['queued', 'running']);
  });
});
