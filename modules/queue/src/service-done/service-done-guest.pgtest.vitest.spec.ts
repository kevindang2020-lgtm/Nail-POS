// service-done-guest.pgtest — w4 sweep SW-08b (Oct 13 2026): the Service Done ticket's guest summary never showed the
// guest's loyalty points — same defect as Serving (SW-08): it selected customers.points_balance, which does not exist
// (points live on customer_loyalty_profiles); the statement failed and .catch hid it. Found by the sweep's own silent-SQL
// check (the PostgreSQL error log) after the Serving fix.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { clearBranchTimeZoneCache } from '@aipowersalon/database';
import { KyselyServiceDoneRepository } from './service-done.kysely.repository';

const P = 'c5ea0000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), B = id('b1'), C = id('c0'), MIA = id('e001'), TK = id('f001');
const ctx = { tenantId: T, branchId: B, userId: id('ee1'), role: 'OWNER', permissions: ['pos.service_done.view'] } as any;
let repo: KyselyServiceDoneRepository;

beforeAll(async () => {
  const pg: any = await migratedPglite(); clearBranchTimeZoneCache();
  const q = (s: string, p: unknown[] = []) => pg.query(s, p);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Done LLC','Done','sd-guest','SDGU01','active')`, [T]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York')`, [B, T]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) values ($1,$2,$3,'Mia','C','Mia C','active',true)`, [MIA, T, B]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Ann','Guest','Ann Guest')`, [C, T, B]);
  await q(`insert into customer_loyalty_profiles (tenant_id, branch_id, customer_id, points_balance) values ($1,$2,$3,75)`, [T, B, C]);
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, primary_technician_id, status, ticket_number, subtotal_cents, total_cents, service_done_at) values ($1,$2,$3,$4,$5,'service_done','T1',4500,4500, now())`, [TK, T, B, C, MIA]);
  repo = new KyselyServiceDoneRepository(kyselyFor(pg) as never);
}, 180_000);

describe('Service Done → guest summary', () => {
  it('shows the guest\'s loyalty points from the loyalty profile', async () => {
    const d: any = await repo.detail(ctx, TK);
    expect(d).toBeTruthy();
    expect(JSON.stringify(d)).toContain('"loyaltyPoints":75');
  });
});
