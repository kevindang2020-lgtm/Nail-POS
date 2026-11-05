// serving-line-revision.pgtest — a service line added during serving leaves a revision that names the REAL line
// (wave 4 SQL, Oct 13 2026). Found in the pilot's PostgreSQL log: `invalid input syntax for type uuid: "line_8001"` x20 —
// ServingService minted a process-local id ('line_' + counter from 8000) for every added line, the Kysely repository
// inserted the line with a database-generated uuid, and the revision insert then sent the synthetic id to
// ticket_revisions.service_line_id (uuid). recordRevision's catch swallowed it: the ticket's edit history lost every
// "Added <service>" entry (and the ticket version never moved for it).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { clearBranchTimeZoneCache } from '@aipowersalon/database';
import { KyselyServingRepository } from './serving.kysely.repository';
import { ServingService } from './serving.service';

const P = 'c5e60000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const TA = id('a1'), BA = id('b1'), CUST = id('c0'), MIA = id('e001'), CAT = id('c100'), SVC = id('d001'), ADD = id('d002'), UA = id('ee1');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let pg: any; let svc: ServingService; let repo: KyselyServingRepository;
const q = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows as any[];
const ctx = () => ({ tenantId: TA, branchId: BA, userId: UA, role: 'OWNER', permissions: ['pos.serving.view', 'pos.serving.edit_services', 'pos.serving.start'] } as any);

beforeAll(async () => {
  pg = await migratedPglite(); const db = kyselyFor(pg);
  clearBranchTimeZoneCache();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Rev LLC','Rev','rev-salon','REVS01','active')`, [TA]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York')`, [BA, TA]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Ann','Guest','Ann Guest')`, [CUST, TA, BA]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails')`, [CAT, TA, BA]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$3,$4,$5,'Manicure',45,4500), ($2,$3,$4,$5,'Gel Top',10,1000)`, [SVC, ADD, TA, BA, CAT]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) values ($1,$2,$3,'Mia','C','Mia C','active',true)`, [MIA, TA, BA]);
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, primary_technician_id, status, ticket_number, subtotal_cents, total_cents) values ($1,$2,$3,$4,$5,'in_service','T1',4500,4500)`, [id('f1'), TA, BA, CUST, MIA]);
  await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, status) values ($1,$2,$3,$4,$5,'Manicure',4500,45,4500,'serving')`, [TA, BA, id('f1'), SVC, MIA]);
  repo = new KyselyServingRepository(db);
  svc = new ServingService(repo, { toTenant: () => undefined } as any);
}, 180_000);

describe('added service line → revision names the persisted line', () => {
  it('POS add service: the line is stored and the service_added revision carries its uuid and snapshot', async () => {
    const t = id('f1');
    const vBefore = Number((await q(`select version from tickets where id=$1`, [t]))[0].version);
    await svc.addService(ctx(), t, { serviceId: ADD, technicianId: MIA, managerOverride: undefined } as any).catch(async (e) => {
      // a salon that forbids edits during serving needs an override — this suite is about the revision, so allow it
      if (!/override/i.test(String(e?.message))) throw e;
      await q(`insert into tenant_settings (tenant_id, branch_id, category, settings) values ($1,$2,'queue-workflow','{"allowServiceEditDuringServing":true}')`, [TA, BA]).catch(() => undefined);
      await svc.addService(ctx(), t, { serviceId: ADD, technicianId: MIA } as any);
    });
    const lines = await q(`select id from ticket_service_lines where ticket_id=$1 and service_id=$2`, [t, ADD]);
    expect(lines.length).toBe(1);
    const revs = await repo.listRevisions(ctx(), t);
    const added = revs.find((r) => r.action === 'service_added');
    expect(added?.serviceLineId).toMatch(UUID);
    expect(added?.serviceLineId).toBe(lines[0].id);
    expect((added?.after as any)?.serviceName).toBe('Gel Top');
    expect(Number((await q(`select version from tickets where id=$1`, [t]))[0].version)).toBeGreaterThan(vBefore);
  });
});
