// payment-signature.pgtest.vitest.spec.ts — the cardholder signs ONCE, on the Clover card terminal (Kevin, Oct 6 2026), and
// that signature has to still be on the payment tomorrow.
//
// Against a real PGlite schema (every migration; 386 and 513 must apply cleanly):
//   • the display's terminal charge asks the terminal for the signature, and the image the terminal returns is kept on
//     the approved payment, marked captured_on 'terminal' — one row per payment (a second Pay tap charges nothing and
//     writes nothing);
//   • the front desk reads it back with the same call as before, tenant-scoped — another salon reads null;
//   • a terminal answer with no signature, or one that is not an image, leaves the payment approved and stores nothing;
//   • signatures the display captured before the change ('customer_display') stay valid rows; nothing else is accepted.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { InMemoryTerminalLeases, KyselyCheckoutRepository } from '@aipowersalon/checkout';
import { TerminalCaptureService } from './terminal-capture.service';

class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() {
    const pg = this.pg;
    return {
      async executeQuery(q: any) {
        const r: any = await pg.query(q.sql, [...(q.parameters ?? [])]);
        return { rows: r.rows ?? [], numAffectedRows: BigInt(r.affectedRows ?? 0) };
      },
      streamQuery() { throw new Error('not used'); },
    } as any;
  }
  async beginTransaction(c: any) { await c.executeQuery({ sql: 'begin', parameters: [] }); }
  async commitTransaction(c: any) { await c.executeQuery({ sql: 'commit', parameters: [] }); }
  async rollbackTransaction(c: any) { await c.executeQuery({ sql: 'rollback', parameters: [] }); }
  async releaseConnection() {}
  async destroy() {}
}

const T = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BR = 'a1111111-1111-4111-8111-111111111111';
const BR2 = 'b1111111-1111-4111-8111-111111111111';
const CUST = 'a3333333-3333-4333-8333-333333333333';
const SVC = 'a4444444-4444-4444-8444-444444444444';
const USER = 'a2222222-2222-4222-8222-222222222222';
const ctx = { tenantId: T, branchId: BR, userId: USER, role: 'MANAGER', permissions: [] };
const otherCtx = { tenantId: OTHER, branchId: BR2, userId: USER, role: 'MANAGER', permissions: [] };
// a tiny bitmap ("BM" + pixels): what a CardPointe terminal sends, base64 of the gzip-compressed bitmap
const BMP = Buffer.concat([Buffer.from('BM'), Buffer.alloc(80, 7)]);
const TERMINAL_SIG = gzipSync(BMP).toString('base64');

let pg: PGlite; let db: Kysely<any>; let checkout: KyselyCheckoutRepository; let n = 0;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);

/** A ticket with one $50 line, shown on a display session, about to be paid on the terminal. */
async function paying(): Promise<any> {
  n++;
  const tk = (await q(`insert into tickets (tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents) values ($1,$2,$3,'open',5000,0,0,5000) returning id`, [T, BR, CUST]))[0];
  await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values ($1,$2,$3,$4,'Gel Manicure',5000,45,5000)`, [T, BR, tk.id, SVC]);
  const s = (await q(`insert into customer_display_sessions (tenant_id, branch_id, public_token_hash, ticket_id) values ($1,$2,$3,$4) returning id`, [T, BR, 'h' + n + Date.now(), tk.id]))[0];
  return { id: String(s.id), tenantId: T, branchId: BR, state: 'payment_processing', ticketId: String(tk.id), ticketNumber: null, customerId: CUST, publicTokenHash: null, selectedTipCents: 0, subtotalCents: 5000, paymentMethod: 'card', expiresAt: null, closedAt: null, ticketStatus: 'open', lastPaymentStatus: null };
}
const terminal = (answer: Record<string, unknown>) => {
  const asked: any[] = [];
  const svc = new TerminalCaptureService(db as any, () => ({ name: 'fake', ping: async () => true, display: async () => {}, authCard: async (i: any) => { asked.push(i); return { approved: true, declined: false, respstat: 'A', respText: 'Approval', retref: 'RR' + n, amountCents: 5000, ...answer }; } }) as any, (x) => x, undefined, new InMemoryTerminalLeases());
  return { svc, asked };
};
const sigRows = (ticketId: string) => q(`select payment_id, captured_on, signature_png from payment_signatures where tenant_id = $1 and ticket_id = $2`, [T, ticketId]);

beforeAll(async () => {
  pg = new PGlite();
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    const s = readFileSync(join(MIGRATIONS_DIR, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '').replace(/\bINDEX\s+CONCURRENTLY\b/gi, 'INDEX');   // Phase 10: CONCURRENTLY cannot run in PGlite's implicit transaction (same rule as pgliteCompatible)
    if (f.startsWith('386') || f.startsWith('513')) await pg.exec(s);   // the signature migrations are NOT tolerated
    else try { await pg.exec(s); } catch { /* pg_trgm / btree_gist / etc. */ }
  }
  db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  checkout = new KyselyCheckoutRepository(db as any);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Luxe','Luxe Nails','luxe','LUXE','active'), ($2,'Belle','Belle','belle','BELLE','active')`, [T, OTHER]);
  await q(`insert into branches (id, tenant_id, name, status) values ($1,$2,'Main','active'), ($3,$4,'Main','active')`, [BR, T, BR2, OTHER]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Ana','Lee','Ana Lee')`, [CUST, T, BR]);
  const cat = (await q(`insert into service_categories (tenant_id, branch_id, name) values ($1,$2,'Nails') returning id`, [T, BR]))[0].id;
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$2,$3,$4,'Gel Manicure',45,5000)`, [SVC, T, BR, cat]);
  await q(`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values ($1, null, 'payments-checkout', $2::jsonb)`, [T, JSON.stringify({ customerDisplayCaptureMode: 'terminal' })]);
  await q(`insert into pos_payment_terminals (id, tenant_id, branch_id, label, status, hsn) values (gen_random_uuid(),$1,$2,'Clover Flex','paired','HSN1')`, [T, BR]);
  await q(`insert into tenant_payment_config (tenant_id, merchant_id, bolt_base_url, bolt_api_key_enc) values ($1,'M1','https://bolt.cardpointe.com','enc')`, [T]);
}, 180000);

describe('the signature is taken once, on the Clover terminal, and kept on the payment', () => {
  it('the terminal\'s signature is kept on the approved payment as a viewable image, marked "terminal"', async () => {
    const row = await paying(); const t = terminal({ signature: TERMINAL_SIG });
    const r = await t.svc.capture(row as any);
    expect(r).toMatchObject({ outcome: 'approved' });
    const rows = await sigRows(row.ticketId);
    expect(rows).toEqual([{ payment_id: (r as any).paymentId, captured_on: 'terminal', signature_png: 'data:image/bmp;base64,' + BMP.toString('base64') }]);
  });

  it('the front desk reads it back with the same call as before; another salon cannot', async () => {
    const row = await paying();
    await terminal({ signature: TERMINAL_SIG }).svc.capture(row as any);
    expect(await checkout.paymentSignatureForTicket(ctx as any, row.ticketId)).toEqual({ signaturePng: 'data:image/bmp;base64,' + BMP.toString('base64'), capturedOn: 'terminal' });
    expect(await checkout.paymentSignatureForTicket(otherCtx as any, row.ticketId)).toBeNull();
  });

  it('a second Pay tap charges nothing and writes no second signature', async () => {
    const row = await paying(); const t = terminal({ signature: TERMINAL_SIG });
    await t.svc.capture(row as any);
    expect(await t.svc.capture(row as any)).toMatchObject({ outcome: 'duplicate' });
    expect(t.asked).toHaveLength(1);
    expect(await sigRows(row.ticketId)).toHaveLength(1);
  });

  it('no signature from the terminal, or one that is not an image: the payment stands, nothing is stored', async () => {
    for (const answer of [{}, { signature: Buffer.from('<svg/>').toString('base64') }, { signature: 'not base64 at all %%%' }]) {
      const row = await paying();
      expect(await terminal(answer).svc.capture(row as any)).toMatchObject({ outcome: 'approved' });
      expect((await q(`select status from tickets where id = $1`, [row.ticketId]))[0].status).toBe('paid');
      expect(await sigRows(row.ticketId)).toEqual([]);
    }
  });

  it('a declined card keeps no signature', async () => {
    const row = await paying();
    expect(await terminal({ approved: false, declined: true, respstat: 'C', signature: TERMINAL_SIG }).svc.capture(row as any)).toMatchObject({ outcome: 'declined' });
    expect(await sigRows(row.ticketId)).toEqual([]);
  });

  it('migration 513: signatures the display took before the change stay valid; nothing but display / terminal is accepted', async () => {
    // a payment belongs to a real ticket (fk_payments_ticket, Phase 10 migration 538)
    const tkt = (await paying()).ticketId;
    const pay = (await q(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, status) values ($1,$2,$3,'card',100,'approved') returning id`, [T, BR, tkt]))[0];
    await q(`insert into payment_signatures (tenant_id, branch_id, payment_id, signature_png, captured_on) values ($1,$2,$3,'data:image/png;base64,AA==','customer_display')`, [T, BR, pay.id]);
    const pay2 = (await q(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, status) values ($1,$2,$3,'card',100,'approved') returning id`, [T, BR, tkt]))[0];
    await expect(q(`insert into payment_signatures (tenant_id, branch_id, payment_id, signature_png, captured_on) values ($1,$2,$3,'x','pos')`, [T, BR, pay2.id])).rejects.toThrow(/captured_on/);
    expect((await q(`select column_default from information_schema.columns where table_name = 'payment_signatures' and column_name = 'captured_on'`))[0].column_default).toMatch(/terminal/);
  });
});
