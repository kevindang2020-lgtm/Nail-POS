// customer-notes-review.pgtest — extras Customer Notes 6 · 02 (round 10): stale / conflicting preference detection. The
// read-only review names a Preferred-technician note that points at an archived / inactive technician, or at someone other
// than the profile's preferred technician, and notes last updated over a year before the latest paid visit — each with
// its evidence; never another salon's technicians; nothing is written.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyCustomersRepository } from './customers.kysely.repository';
import { CustomersService } from './customers.service';

const id = (n: number) => `a8a20000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), X = id(2), B = id(3), BX = id(4), C1 = id(10), C2 = id(11), C3 = id(12);
const MIA = id(20), LAN = id(21), OLD = id(22), MIAX = id(23);
let pg: any; let svc: CustomersService;
const q = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows as any[];
const ctx: any = { tenantId: T, branchId: B, userId: id(90), role: 'MANAGER', permissions: ['pos.customers.notes.view', 'pos.customers.notes.edit', 'pos.customers.view'] };

beforeAll(async () => {
  pg = await migratedPglite();
  svc = new CustomersService(new KyselyCustomersRepository(kyselyFor(pg) as any) as any);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'N','Notes','nr-a8a2','NRA8A2','active'), ($2,'X','Other','nr-a8a2x','NRA8A2X','active')`, [T, X]);
  await q(`insert into branches (id, tenant_id, name, status) values ($1,$2,'Main','active'), ($3,$4,'Other','active')`, [B, T, BX, X]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active, archived_at) values
    ($1,$5,$6,'Mia','Chen','Mia Chen','active',true,null), ($2,$5,$6,'Lan','Nguyễn','Lan Nguyễn','active',true,null), ($3,$5,$6,'Old','Timer','Old Timer','archived',false,now()),
    ($4,$7,$8,'Rosa','Diaz','Rosa Diaz','archived',false,now())`, [MIA, LAN, OLD, MIAX, T, B, X, BX]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, preferred_technician_id) values ($1,$4,$5,'A','One','A One',$6), ($2,$4,$5,'B','Two','B Two',null), ($3,$4,$5,'C','Three','C Three',$7)`, [C1, C2, C3, T, B, MIA, LAN]);
}, 180_000);

describe('Customer Notes 6 · 02 — stale / conflicting preference review', () => {
  it('flags an inactive technician and a note that disagrees with the profile, with evidence; accents and case ignored', async () => {
    await svc.setNotes(ctx, C1, { salonNotes: '', allergyNotes: '', preferredStyle: '', servicePreferences: '', warnings: '', customerVisible: false, preferredTechnician: 'Only with OLD TIMER or lan nguyen' });
    const before = await q(`select (select count(*) from customers)::int + (select count(*) from technicians)::int as n, (select notes_json::text from customers where id = $1) as j`, [C1]);
    const r = await svc.notesReview(ctx, C1);
    expect(r.checked).toBe(true);
    expect(r.flags).toEqual([
      { code: 'technician_inactive', field: 'preferredTechnician', evidence: { note: 'Only with OLD TIMER or lan nguyen', technician: 'Old Timer', status: 'archived' } },
      { code: 'technician_differs_from_profile', field: 'preferredTechnician', evidence: { note: 'Only with OLD TIMER or lan nguyen', profileTechnician: 'Mia Chen' } },
    ]);
    expect(await q(`select (select count(*) from customers)::int + (select count(*) from technicians)::int as n, (select notes_json::text from customers where id = $1) as j`, [C1])).toEqual(before);
  });
  it('agreeing / unnamed notes are clean; another salon\'s technician never matches; stale notes vs the latest paid visit', async () => {
    await svc.setNotes(ctx, C3, { salonNotes: '', allergyNotes: '', preferredStyle: '', servicePreferences: '', warnings: '', customerVisible: false, preferredTechnician: 'Lan Nguyễn' });
    expect((await svc.notesReview(ctx, C3)).flags).toEqual([]);                    // matches the profile's Lan
    await svc.setNotes(ctx, C2, { salonNotes: '', allergyNotes: '', preferredStyle: '', servicePreferences: '', warnings: '', customerVisible: false, preferredTechnician: 'Rosa Diaz, anyone quick' });
    expect((await svc.notesReview(ctx, C2)).flags).toEqual([]);                    // Rosa is the other salon's (archived) technician
    await q(`update customers set notes_updated_at = now() - interval '500 days' where id = $1`, [C2]);
    await q(`insert into tickets (tenant_id, branch_id, customer_id, status, paid_at, subtotal_cents, tax_cents, discount_cents, total_cents) values ($1,$2,$3,'paid', now() - interval '3 days', 1000, 0, 0, 1000)`, [T, B, C2]);
    const st = (await svc.notesReview(ctx, C2)).flags;
    expect(st.map((f) => f.code)).toEqual(['notes_older_than_visits']);
    expect(st[0].evidence.notesUpdatedAt! < st[0].evidence.lastVisitAt!).toBe(true);
    await q(`update customers set notes_updated_at = now() - interval '30 days' where id = $1`, [C2]);
    expect((await svc.notesReview(ctx, C2)).flags).toEqual([]);
    await expect(svc.notesReview({ ...ctx, tenantId: X, branchId: BX }, C1)).rejects.toBeTruthy();   // another salon cannot read it
  });
});
