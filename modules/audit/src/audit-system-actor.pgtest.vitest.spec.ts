// audit-system-actor.pgtest — the real schema proves it: before the fix, a system actor's non-UUID id ('system:<job>')
// made the audit_events INSERT throw (actor_user_id is UUID) and AuditService.record swallowed it — the event was lost.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyAuditRepository } from './audit.kysely.repository';
import { AuditService } from './audit.service';

describe('a system actor is audited against the real schema', () => {
  let db: any; let svc: AuditService;
  beforeAll(async () => { const pg = await migratedPglite(); db = kyselyFor(pg); svc = new AuditService(new KyselyAuditRepository(db)); }, 120_000);
  it("record() with a 'system:<job>' context now stores a row (actor_user_id NULL, actor_name = the job)", async () => {
    const tenant = '6f1c2b1e-4d2a-4c3b-9a8e-1f2d3c4b5a60';   // audit_events.tenant_id carries no FK
    const row = await svc.record({ tenantId: tenant, userId: 'system:campaigns', role: 'SYSTEM' } as any, { module: 'campaigns', action: 'campaign.status_changed' } as any);
    expect(row, 'the event was lost').not.toBeNull();
    const stored = await db.selectFrom('audit_events').selectAll().where('action', '=', 'campaign.status_changed').executeTakeFirst();
    expect(stored.actor_user_id).toBeNull(); expect(stored.actor_name).toBe('system:campaigns');
  });
  it('the raw INSERT of a non-UUID actor id is what failed (the reason for the mapping)', async () => {
    await expect(db.insertInto('audit_events').values({ tenant_id: null, actor_user_id: 'system:campaigns', module: 'x', action: 'y', metadata: '{}' } as any).execute()).rejects.toThrow(/uuid/i);
  });
  // w4 sweep SW-14 (Oct 13 2026): the PostgreSQL log of the live sweep showed 177 audit_events INSERTs failing on
  // `invalid input syntax for type uuid: ""` — a context with no branch (customer-app, tech-profile and Super Admin
  // contexts pass branchId: '') — and AuditService.record swallowed each one: the audit event was LOST.
  it("record() with branchId '' (a context without a branch) stores the row with branch_id NULL", async () => {
    const tenant = '6f1c2b1e-4d2a-4c3b-9a8e-1f2d3c4b5a61';
    const row = await svc.record({ tenantId: tenant, branchId: '', userId: '6f1c2b1e-4d2a-4c3b-9a8e-1f2d3c4b5a62', role: 'CUSTOMER' } as any, { module: 'tech_profile', action: 'w4.branchless' } as any);
    expect(row, 'the event was lost').not.toBeNull();
    const stored = await db.selectFrom('audit_events').selectAll().where('action', '=', 'w4.branchless').executeTakeFirst();
    expect(stored).toBeTruthy(); expect(stored.branch_id).toBeNull();
  });
});
