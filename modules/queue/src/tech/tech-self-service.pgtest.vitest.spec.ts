// tech-self-service.pgtest — Technician App Time Clock / Performance / Tips / My Customers on the real schema (every
// migration in PGlite). Merged Oct 12 2026 from the other chat (workforce audit #26): own data only (session → technician),
// canonical stores only (punches, breaks 580, compensation snapshots, reviews), customers without contact details.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { techTimeClock, techPerformance, techTips, techCustomers } from './tech-self-service';

let pg: any; let db: any;
const T = '5e000000-0000-4000-8000-0000000000a0', B = '5e000000-0000-4000-8000-0000000000b0';
const T2 = '5e000000-0000-4000-8000-0000000000a9', B2 = '5e000000-0000-4000-8000-0000000000b9';
const USER = '5e000000-0000-4000-8000-0000000000f1', USER2 = '5e000000-0000-4000-8000-0000000000f2', MGR = '5e000000-0000-4000-8000-0000000000f3';
const TECH = '5e000000-0000-4000-8000-0000000000e1', OTHER = '5e000000-0000-4000-8000-0000000000e2', TECH_T2 = '5e000000-0000-4000-8000-0000000000e9';
const CUST = '5e000000-0000-4000-8000-0000000000c1', CUST2 = '5e000000-0000-4000-8000-0000000000c2', CUST_T2 = '5e000000-0000-4000-8000-0000000000c9';
const TK = (i: number) => `5e000000-0000-4000-8000-00000000010${i}`;
const LN = (i: number) => `5e000000-0000-4000-8000-00000000020${i}`;

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','S','S','s-5e','S5E01','active'), ('${T2}','S2','S2','s2-5e','S5E02','active') ON CONFLICT DO NOTHING;
    INSERT INTO branches (id, tenant_id, name) VALUES ('${B}','${T}','Main'), ('${B2}','${T2}','Other');
    INSERT INTO users (id, tenant_id, branch_id, full_name, email, status, role) VALUES
      ('${USER}','${T}','${B}','Mia','mia@5e.test','active','TECHNICIAN'), ('${USER2}','${T}','${B}','Leo','leo@5e.test','active','TECHNICIAN'),
      ('${MGR}','${T}','${B}','Max','max@5e.test','active','MANAGER');
    INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, is_active, user_id) VALUES
      ('${TECH}','${T}','${B}','Mia','Chen','Mia Chen',true,'${USER}'), ('${OTHER}','${T}','${B}','Leo','Park','Leo Park',true,'${USER2}'),
      ('${TECH_T2}','${T2}','${B2}','Mia','Chen','Mia Chen',true,'${USER}');
    INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email) VALUES
      ('${CUST}','${T}','${B}','Ann','adams','Ann Adams','+18565550100','ann@x.test'), ('${CUST2}','${T}','${B}','Bo','Bell','Bo Bell',null,null),
      ('${CUST_T2}','${T2}','${B2}','Zed','Zane','Zed Zane',null,null);
    INSERT INTO service_categories (id, tenant_id, branch_id, name) VALUES ('5e000000-0000-4000-8000-0000000003a1','${T}','${B}','Nails'), ('5e000000-0000-4000-8000-0000000003a9','${T2}','${B2}','Nails');
    INSERT INTO services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) VALUES
      ('5e000000-0000-4000-8000-0000000003b1','${T}','${B}','5e000000-0000-4000-8000-0000000003a1','Gel Manicure',30,1000),
      ('5e000000-0000-4000-8000-0000000003b9','${T2}','${B2}','5e000000-0000-4000-8000-0000000003a9','Gel Manicure',30,1000);
  `);
  const tickets: Array<[number, string, string, string]> = [[1, T, B, CUST], [2, T, B, CUST], [3, T, B, CUST2], [4, T2, B2, CUST_T2]];
  for (const [i, t, b, c] of tickets) {
    await pg.query(`INSERT INTO tickets (id, tenant_id, branch_id, customer_id) VALUES ($1,$2,$3,$4)`, [TK(i), t, b, c]);
    await pg.query(`INSERT INTO ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) VALUES ($1,$2,$3,$4,$6,$5,1000,30,1000)`, [LN(i), t, b, TK(i), i === 3 ? 'Pedicure' : 'Gel Manicure', t === T ? '5e000000-0000-4000-8000-0000000003b1' : '5e000000-0000-4000-8000-0000000003b9']);
  }
  // her punches: an open punch started 2h ago, plus a finished 15-minute break
  // A FIXED clock (NOW, mid-afternoon in any US zone) — the punch / break are placed relative to it, and techTimeClock reads
  // "today" from the same instant, so the test cannot depend on what time of day it runs.
  await pg.query(`INSERT INTO technician_shifts (tenant_id, branch_id, technician_id, shift_date, start_time, status) VALUES ($1,$2,$3, $4::timestamptz::date, $4::timestamptz - interval '2 hours', 'clocked_in')`, [T, B, TECH, NOW.toISOString()]);
  await pg.query(`INSERT INTO technician_breaks (tenant_id, branch_id, technician_id, kind, started_at, ended_at) VALUES ($1,$2,$3,'break', $4::timestamptz - interval '60 minutes', $4::timestamptz - interval '45 minutes')`, [T, B, TECH, NOW.toISOString()]);
  const snap = `INSERT INTO ticket_compensation_snapshots (tenant_id, branch_id, ticket_id, service_line_id, technician_id, engine_version, gross_price_cents, discount_cents, card_tip_cents, cash_tip_cents) VALUES ($1,$2,$3,$4,$5,'v1',$6,0,$7,$8)`;
  await pg.query(snap, [T, B, TK(1), LN(1), TECH, 10000, 1500, 0]);
  await pg.query(snap, [T, B, TK(2), LN(2), TECH, 6000, 0, 1000]);
  await pg.query(snap, [T, B, TK(3), LN(3), OTHER, 9999, 9999, 0]);             // Leo's — never hers
  await pg.query(snap, [T2, B2, TK(4), LN(4), TECH_T2, 7777, 7777, 0]);          // her row at ANOTHER salon — never here
  await pg.query(`INSERT INTO reviews (tenant_id, branch_id, technician_id, rating) VALUES ($1,$2,$3,5),($1,$2,$3,4),($1,$2,$4,1)`, [T, B, TECH, OTHER]);
}, 300_000);

const ctx = () => ({ tenantId: T, branchId: B, userId: USER });
const NOW = new Date('2026-06-16T19:00:00Z');   // 15:00 New York · 12:00 Los Angeles · 09:00 Honolulu

describe('Technician App self-service reads (real schema)', () => {
  it('time clock: the open punch counts toward today, the finished break is subtracted', async () => {
    const v = await techTimeClock(db, ctx(), NOW);
    expect(v.today.punches).toHaveLength(1);
    expect(v.today.punches[0].end).toBeNull();
    expect(v.today.breakMinutes).toBe(15);
    expect(v.today.workedMinutes).toBeGreaterThanOrEqual(104);
    expect(v.today.workedMinutes).toBeLessThanOrEqual(106);
    expect(v.clockStatus).toBe('CLOCKED_IN');
  });
  it('performance: her snapshots at THIS salon only; average ticket, tip rate, rating, returning customers', async () => {
    const p = await techPerformance(db, ctx(), 30);
    expect(p.ticketsServed).toBe(2);
    expect(p.salesCents).toBe(16000);
    expect(p.averageTicketCents).toBe(8000);
    expect(p.tipsCents).toBe(2500);
    expect(p.rating).toEqual({ average: 4.5, count: 2 });
    expect(p.returningCustomerPercent).toBe(100);
  });
  it("tips: card/cash split, never another technician's or another salon's", async () => {
    const t = await techTips(db, ctx(), 14);
    expect(t).toMatchObject({ totalCents: 2500, cardCents: 1500, cashCents: 1000 });
  });
  it('my customers: first name + last initial, visit count, last services — no contact details, no ids', async () => {
    const c = await techCustomers(db, ctx());
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ displayName: 'Ann A.', visits: 2, lastServices: ['Gel Manicure'] });
    const json = JSON.stringify(c);
    expect(json).not.toMatch(/\+1856|@|customer_id/);
    expect(json).not.toContain(CUST);
  });
  it('VietnamesePOS §41 (Oct 28 audit): the search folds case and accents and spans first + last name; a % is literal', async () => {
    expect((await techCustomers(db, ctx(), 'ÂNN ÁDAMS')).map((r) => r.displayName)).toEqual(['Ann A.']);
    expect((await techCustomers(db, ctx(), 'adams'))).toHaveLength(1);
    expect((await techCustomers(db, ctx(), '%'))).toHaveLength(0);
  });
  it('an account with no technician profile at this salon is refused', async () => {
    await expect(techPerformance(db, { tenantId: T, branchId: B, userId: MGR })).rejects.toThrow(/No active technician/);
  });
});
