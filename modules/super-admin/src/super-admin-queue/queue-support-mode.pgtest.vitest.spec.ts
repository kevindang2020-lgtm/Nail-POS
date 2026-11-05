// queue-support-mode.pgtest — the ONE way a Super Admin sees real customer names on the queue screen (Oct 12 2026 merge,
// workforce audit #63, reconciled with the Phase 14 support-session guard): a LIVE support_access_sessions row she holds
// for that salon (expiry honoured), or her own open controlled-support request younger than 4 h. Anything else, and any
// lookup problem, stays masked. Real schema (every migration in PGlite).
import { describe, it, expect, beforeAll } from 'vitest';
import { LiveQueueActionsService } from './live-queue-actions.service';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

let pg: any; let db: any; let svc: LiveQueueActionsService;
const T = 'b7600000-0000-4000-8000-0000000000b1', T2 = 'b7600000-0000-4000-8000-0000000000b2';
const SA = 'a1a1a1a1-0000-4000-8000-0000000000a1', SA2 = 'a1a1a1a1-0000-4000-8000-0000000000a2';
const ctx = { userId: SA } as any;

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'Q', 'Q', 'q-t', 'QT001', 'active'), ('${T2}', 'Q2', 'Q2', 'q-t2', 'QT002', 'active') ON CONFLICT DO NOTHING;
    INSERT INTO users (id, tenant_id, full_name, email, password_hash, status, role) VALUES ('${SA}', NULL, 'Admin', 'sa@q.test', 'x', 'active', 'SUPER_ADMIN'), ('${SA2}', NULL, 'Admin 2', 'sa2@q.test', 'x', 'active', 'SUPER_ADMIN') ON CONFLICT DO NOTHING`);
  svc = new LiveQueueActionsService(db, {} as any, {} as any, {} as any);
});

describe('supportModeTenant', () => {
  it('nothing open → masked; a non-uuid → masked; no database → masked', async () => {
    expect(await svc.supportModeTenant(ctx, T)).toBeNull();
    expect(await svc.supportModeTenant(ctx, 'luxe001')).toBeNull();
    expect(await new LiveQueueActionsService(null, {} as any, {} as any, {} as any).supportModeTenant(ctx, T)).toBeNull();
  });
  it('a LIVE Phase 14 support session for this admin + salon unmasks that salon only; ended or expired ones do not', async () => {
    const id = 'c3c3c3c3-0000-4000-8000-0000000000c1';
    await pg.query(`INSERT INTO support_access_sessions (id, tenant_id, admin_user_id, reason, started_at, expires_at) VALUES ($1, $2, $3, 'queue investigation', now(), now() + interval '30 minutes')`, [id, T, SA]);
    expect(await svc.supportModeTenant(ctx, T)).toBe(T);
    expect(await svc.supportModeTenant(ctx, T2)).toBeNull();                 // another salon
    expect(await svc.supportModeTenant({ userId: SA2 } as any, T)).toBeNull(); // another admin
    await pg.query(`UPDATE support_access_sessions SET expires_at = now() - interval '1 minute' WHERE id = $1`, [id]);
    expect(await svc.supportModeTenant(ctx, T)).toBeNull();                  // expired → the Phase 14 rule
    await pg.query(`UPDATE support_access_sessions SET expires_at = now() + interval '30 minutes', ended_at = now() WHERE id = $1`, [id]);
    expect(await svc.supportModeTenant(ctx, T)).toBeNull();                  // ended
  });
  it("this admin's own open controlled-support request (queue screen) unmasks for 4 h, then stops", async () => {
    const id = 'c3c3c3c3-0000-4000-8000-0000000000c2';
    await pg.query(`INSERT INTO support_session_requests (id, tenant_id, requested_by_user_id, kind, topic, status) VALUES ($1, $2, $3, 'remote_support', 'queue', 'requested')`, [id, T2, SA]);
    expect(await svc.supportModeTenant(ctx, T2)).toBe(T2);
    await pg.query(`UPDATE support_session_requests SET created_at = now() - interval '5 hours' WHERE id = $1`, [id]);
    expect(await svc.supportModeTenant(ctx, T2)).toBeNull();
    await pg.query(`UPDATE support_session_requests SET created_at = now(), status = 'completed' WHERE id = $1`, [id]);
    expect(await svc.supportModeTenant(ctx, T2)).toBeNull();
  });
  it('every read is audited with the view and whether it unmasked; the search text is redacted', async () => {
    await svc.auditView(ctx, 'live-overview', { search: 'grace', status: 'waiting', tenantId: T }, T);
    const rows = (await pg.query(`SELECT tenant_id, metadata_json FROM audit_logs WHERE action_type = 'queue.view' AND user_id = $1`, [SA])).rows;
    expect(rows.length).toBe(1);
    expect(rows[0].tenant_id).toBe(T);
    expect(rows[0].metadata_json).toMatchObject({ view: 'live-overview', unmaskedTenantId: T, filters: { search: '[redacted]', status: 'waiting' } });
    expect(JSON.stringify(rows[0].metadata_json)).not.toContain('grace');
  });
});
