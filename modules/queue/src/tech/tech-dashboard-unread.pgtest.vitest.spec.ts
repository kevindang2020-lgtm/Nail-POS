// tech-dashboard-unread.pgtest — developer merge (Oct 6 2026): the Technician app's Home bell counts the technician's
// UNREAD in-app notifications (dashboardRaw returned a hard 0 before); read rows and another technician's rows do not count.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyTechRepository } from './tech.kysely.repository';

const T = 'ad100000-0000-4000-8000-000000000001', B = 'ad100000-0000-4000-8000-0000000000b1';
const TECH = 'ad100000-0000-4000-8000-0000000000d1', OTHER = 'ad100000-0000-4000-8000-0000000000d2';
let repo: KyselyTechRepository; let pg: any;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows);

beforeAll(async () => {
  pg = await migratedPglite();
  repo = new KyselyTechRepository(kyselyFor(pg) as any);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'L','D','tdu','TDU01')`, [T]);
  await q(`insert into branches (id, tenant_id, name) values ($1,$2,'Main')`, [B, T]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$3,$4,'Lisa','One','Lisa One'), ($2,$3,$4,'Anna','Two','Anna Two')`, [TECH, OTHER, T, B]);
  await q(`insert into technician_notifications (tenant_id, technician_id, type, title, read_at) values ($1,$2,'tip','Tip received',null), ($1,$2,'assignment','New assignment',null), ($1,$2,'arrival','Customer arrived',now()), ($1,$3,'tip','Tip received',null)`, [T, TECH, OTHER]);
}, 120_000);

describe('dashboardRaw.notificationsCount', () => {
  it('counts only this technician’s unread rows', async () => {
    const raw = await repo.dashboardRaw({ tenantId: T, branchId: B, userId: 'u1', role: 'TECH', permissions: [] } as any, TECH);
    expect(raw.notificationsCount).toBe(2);
    const other = await repo.dashboardRaw({ tenantId: T, branchId: B, userId: 'u2', role: 'TECH', permissions: [] } as any, OTHER);
    expect(other.notificationsCount).toBe(1);
  });
});
