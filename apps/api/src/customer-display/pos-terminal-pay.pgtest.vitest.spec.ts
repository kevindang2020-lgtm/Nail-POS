// pos-terminal-pay.pgtest.vitest.spec.ts — Fiserv master build §7 / §8B (Nov 4 2026), on the real schema: the front-desk
// "Pay on Clover Compact" drives the SAME terminal path as the customer display, branch-scoped and idempotent per attempt.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { InMemoryTerminalLeases, KyselyTerminalLeases } from '@aipowersalon/checkout';
import { PaymentGatewayResolver } from '@aipowersalon/payments';
import { TerminalCaptureService } from './terminal-capture.service';
import { posTerminalResult } from './pos-terminal-pay.controller';

const T = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BR = 'd1111111-1111-4111-8111-111111111111';
const BR2 = 'd2222222-1111-4111-8111-111111111111';
const CUST = 'd3333333-3333-4333-8333-333333333333';
const SVC = 'd4444444-4444-4444-8444-444444444444';
const STATION = 'd5555555-5555-4555-8555-555555555555';
let pg: any; let db: any;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);
const secrets = { encrypt: (s: string) => 'v2p:' + s, decrypt: (s: string) => s.replace(/^v2p:/, '') } as any;
const STAFF = 'd6666666-6666-4666-8666-666666666666';
const scope = { tenantId: T, branchId: BR, userId: STAFF };

async function ticket(branchId = BR): Promise<string> {
  const tk = (await q(`insert into tickets (tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents) values ($1,$2,$3,'open',5000,0,0,5000) returning id`, [T, branchId, CUST]))[0];
  await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values ($1,$2,$3,$4,'Gel Manicure',5000,45,5000)`, [T, branchId, tk.id, SVC]);
  return String(tk.id);
}
function device(seen: any[], answer: (i: any) => any = (i) => ({ approved: true, declined: false, respstat: 'A', respText: 'Approval', retref: 'R' + seen.length, amountCents: i.amountCents })) {
  return (cfg: any) => ({ name: 'fake', ping: async () => true, display: async () => {}, authCard: async (i: any) => { seen.push({ cfg, hsn: i.hsn, amountCents: i.amountCents }); return answer(i); } }) as any;
}
const svc = (factory: any) => new TerminalCaptureService(db, factory, (s: string) => s, undefined, new InMemoryTerminalLeases(), undefined, undefined, undefined, undefined, new PaymentGatewayResolver(db, secrets));

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Luxe','Luxe Nails','luxe-pt','LUXEPT','active')`, [T]);
  await q(`insert into branches (id, tenant_id, name, status) values ($1,$2,'Main','active'), ($3,$2,'Cherry Hill','active')`, [BR, T, BR2]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Ana','Lee','Ana Lee')`, [CUST, T, BR]);
  const cat = (await q(`insert into service_categories (tenant_id, branch_id, name) values ($1,$2,'Nails') returning id`, [T, BR]))[0].id;
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$2,$3,$4,'Gel Manicure',45,5000)`, [SVC, T, BR, cat]);
  await q(`insert into pos_payment_terminals (id, tenant_id, branch_id, label, status, hsn, station_id) values ('term_a',$1,$2,'Compact A','paired','HSN-A',$4), ('term_b',$1,$2,'Compact B','paired','HSN-B',null), ('term_ch',$1,$3,'Compact CH','paired','HSN-CH',null)`, [T, BR, BR2, STATION]);
  await q(`insert into tenant_payment_config (tenant_id, processor, status, environment, merchant_id, bolt_base_url, bolt_api_key_enc) values ($1,'fiserv','active','sandbox','MID-1','https://bolt-uat.cardpointe.com/api','v2p:key')`, [T]);
}, 180000);

describe('POS → Clover Compact (captureForPos)', () => {
  it('charges the terminal tied to this register, records ONE approved payment and marks the ticket paid', async () => {
    const seen: any[] = []; const tk = await ticket();
    const o: any = await svc(device(seen)).captureForPos(scope, tk, { attemptKey: 'attempt-0001', stationId: STATION });
    expect(o.outcome).toBe('approved');
    expect(seen).toHaveLength(1); expect(seen[0].hsn).toBe('HSN-A');
    expect(seen[0].cfg).toEqual({ baseUrl: 'https://bolt-uat.cardpointe.com/api', apiKey: 'key', merchantId: 'MID-1' });
    const pays = await q(`select status, idempotency_key from payments where ticket_id = $1`, [tk]);
    expect(pays).toEqual([{ status: 'approved', idempotency_key: 'termcap_pos_attempt-0001' }]);
    expect((await q(`select status from tickets where id = $1`, [tk]))[0].status).toBe('paid');
  });

  it('the same attempt key again (lost answer retry) returns the recorded approval and charges NOTHING', async () => {
    const seen: any[] = []; const tk = await ticket(); const s = svc(device(seen));
    await s.captureForPos(scope, tk, { attemptKey: 'attempt-0002', terminalId: 'term_b' });
    const again: any = await s.captureForPos(scope, tk, { attemptKey: 'attempt-0002', terminalId: 'term_b' });
    expect(again.outcome).toBe('approved'); expect(seen).toHaveLength(1);
  });

  it('a ticket of another branch is refused before any terminal is touched', async () => {
    const seen: any[] = []; const tk = await ticket(BR2);
    const o: any = await svc(device(seen)).captureForPos(scope, tk, { attemptKey: 'attempt-0003', terminalId: 'term_a' });
    expect(o.outcome).toBe('skipped'); expect(o.reason).toMatch(/another location/); expect(seen).toHaveLength(0);
  });

  it('a terminal of another branch cannot be picked', async () => {
    const seen: any[] = []; const tk = await ticket();
    const o: any = await svc(device(seen)).captureForPos(scope, tk, { attemptKey: 'attempt-0004', terminalId: 'term_ch' });
    expect(o.outcome).toBe('failed'); expect(o.reason).toMatch(/not paired at this location/); expect(seen).toHaveLength(0);
  });

  it('several terminals, no pick and no register → asks to choose, charges nothing', async () => {
    const seen: any[] = []; const tk = await ticket();
    const o: any = await svc(device(seen)).captureForPos(scope, tk, { attemptKey: 'attempt-0005' });
    expect(o.outcome).toBe('failed'); expect(o.reason).toMatch(/choose one/); expect(seen).toHaveLength(0);
  });

  it('decline → declined, ticket stays open; terminal throw → unknown (verify), never declined', async () => {
    const tk = await ticket();
    const d: any = await svc(device([], () => ({ approved: false, declined: true, respstat: 'C', respText: 'Do Not Honor' }))).captureForPos(scope, tk, { attemptKey: 'attempt-0006', terminalId: 'term_b' });
    expect(d.outcome).toBe('declined');
    expect((await q(`select status from tickets where id = $1`, [tk]))[0].status).not.toBe('paid');
    const u: any = await svc(() => ({ name: 'fake', ping: async () => true, display: async () => {}, authCard: async () => { throw new Error('socket hang up'); } }) as any).captureForPos(scope, tk, { attemptKey: 'attempt-0007', terminalId: 'term_b' });
    expect(u.outcome).toBe('unknown');
    expect(posTerminalResult(u)).toMatchObject({ status: 'unknown', next: 'verify' });
  });

  it('the ticket being paid elsewhere (display / phone) → in progress, nothing charged', async () => {
    const seen: any[] = []; const tk = await ticket(); const s = svc(device(seen));
    await (s as any).ticketLocks.acquire({ tenantId: T, branchId: BR, ticketId: tk, userId: 'd7777777-7777-4777-8777-777777777777', sessionId: 'other-device', source: 'display' });
    const o: any = await s.captureForPos(scope, tk, { attemptKey: 'attempt-0008', terminalId: 'term_b' });
    expect(o.outcome).toBe('ticket_busy'); expect(seen).toHaveLength(0);
  });

  it('Cancel reaches the device that is prompting for THIS ticket', async () => {
    const tk = await ticket(); let release!: (v: any) => void; let cancelled = '';
    const s = svc(() => ({ name: 'fake', ping: async () => true, display: async () => {}, cancel: async (hsn: string) => { cancelled = hsn; release({ approved: false, declined: true, respstat: 'C', respText: 'Cancelled' }); }, authCard: () => new Promise((r) => { release = r; }) }) as any);
    const pending = s.captureForPos(scope, tk, { attemptKey: 'attempt-0009', terminalId: 'term_b' });
    await new Promise((r) => setTimeout(r, 50));
    expect(await s.cancelForPos(scope, tk)).toEqual({ cancelled: true });
    expect(cancelled).toBe('HSN-B');
    expect((await pending).outcome).toBe('declined');
    expect(await s.cancelForPos(scope, tk)).toMatchObject({ cancelled: false });
  });

  it('terminalsForPos lists only this branch', async () => {
    const list = await svc(device([])).terminalsForPos(scope);
    expect(list.map((x) => x.id).sort()).toEqual(['term_a', 'term_b']);
  });

  it('a malformed attempt key, or no signed-in staff member, is refused', async () => {
    const tk = await ticket(); const seen: any[] = [];
    expect((await svc(device(seen)).captureForPos(scope, tk, { attemptKey: 'x' })).outcome).toBe('skipped');
    expect((await svc(device(seen)).captureForPos({ ...scope, userId: null }, tk, { attemptKey: 'attempt-0010', terminalId: 'term_b' })).outcome).toBe('skipped');
    expect(seen).toHaveLength(0);
  });

  it('Cancel reaches the terminal even when it lands on ANOTHER API server (lease relay, migration 703)', async () => {
    // two service instances = two API replicas, sharing only the database (real leases, not in-memory)
    const tk = await ticket(); let release!: (v: any) => void; let cancelled = '';
    const charging = new TerminalCaptureService(db, () => ({ name: 'fake', ping: async () => true, display: async () => {},
      cancel: async (hsn: string) => { cancelled = hsn; release({ approved: false, declined: true, respstat: 'C', respText: 'Cancelled' }); },
      authCard: () => new Promise((r) => { release = r; }) }) as any, (x: string) => x, undefined, new KyselyTerminalLeases(db), undefined, undefined, undefined, undefined, new PaymentGatewayResolver(db, secrets));
    charging.cancelPollMs = 50;
    const other = new TerminalCaptureService(db, (() => ({})) as any, (x: string) => x, undefined, new KyselyTerminalLeases(db), undefined, undefined, undefined, undefined, new PaymentGatewayResolver(db, secrets));
    const run = charging.captureForPos(scope, tk, { attemptKey: 'attempt-relay1', terminalId: 'term_b' });
    for (let i = 0; i < 100 && (await q(`select ticket_id from payment_terminal_leases where tenant_id = $1 and terminal_id = 'term_b'`, [T]))[0]?.ticket_id !== tk; i++) await new Promise((r) => setTimeout(r, 50));
    expect((await q(`select ticket_id from payment_terminal_leases where tenant_id = $1 and terminal_id = 'term_b'`, [T]))[0]?.ticket_id).toBe(tk);
    expect(await other.cancelForPos({ tenantId: T, branchId: BR2 }, tk)).toMatchObject({ cancelled: false });   // another branch cannot cancel it
    expect(await other.cancelForPos({ tenantId: T, branchId: BR }, tk)).toEqual({ cancelled: true, relayed: true });
    const o: any = await run;
    expect(cancelled).toBe('HSN-B');                       // sent on the CHARGING server's session
    expect(o.outcome).toBe('declined');
    expect(await q(`select 1 from payment_terminal_leases where tenant_id = $1 and terminal_id = 'term_b'`, [T])).toHaveLength(0);   // lease released
    expect(await other.cancelForPos({ tenantId: T, branchId: BR }, tk)).toMatchObject({ cancelled: false });   // nothing in flight any more
  });
});
