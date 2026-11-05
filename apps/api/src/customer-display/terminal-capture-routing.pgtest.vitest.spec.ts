// terminal-capture-routing.pgtest.vitest.spec.ts — Payments mandate §13 / §17 / §50 / §52 (wave 3), on the real schema:
// the customer display's Clover charge gets its Bolt credentials from THE provider router (terminal's merchant account →
// branch merchant → tenant default), opened with the PAYMENT secrets. Before: the key was read off tenant_payment_config
// and opened with the MFA key, so a Super-Admin-sealed key (v2p:) reached the Clover as ciphertext. Also: a DISABLED
// terminal is never charged; the registry remembers when the terminal last answered.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { InMemoryTerminalLeases } from '@aipowersalon/checkout';
import { PaymentGatewayResolver } from '@aipowersalon/payments';
import { TerminalCaptureService } from './terminal-capture.service';

const T = 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BR = 'c1111111-1111-4111-8111-111111111111';
const BR2 = 'c2222222-1111-4111-8111-111111111111';
const CUST = 'c3333333-3333-4333-8333-333333333333';
const SVC = 'c4444444-4444-4444-8444-444444444444';
let pg: any; let db: any; let n = 0;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);
const paymentSecrets = { encrypt: (s: string) => 'v2p:' + s, decrypt: (s: string) => { if (!s.startsWith('v2p:')) throw new Error('not a payment secret'); return s.slice(4); } } as any;
const mfaDecrypt = (s: string) => (s.startsWith('v1:') ? s.slice(3) : s);   // the MFA opener passes anything else through unchanged

async function paying(branchId: string): Promise<any> {
  n++;
  const tk = (await q(`insert into tickets (tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents) values ($1,$2,$3,'open',5000,0,0,5000) returning id`, [T, branchId, CUST]))[0];
  await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values ($1,$2,$3,$4,'Gel Manicure',5000,45,5000)`, [T, branchId, tk.id, SVC]);
  const s = (await q(`insert into customer_display_sessions (tenant_id, branch_id, public_token_hash, ticket_id) values ($1,$2,$3,$4) returning id`, [T, branchId, 'h' + n + Date.now(), tk.id]))[0];
  return { id: String(s.id), tenantId: T, branchId, state: 'payment_processing', ticketId: String(tk.id), ticketNumber: null, customerId: CUST, publicTokenHash: null, selectedTipCents: 0, subtotalCents: 5000, paymentMethod: 'card', expiresAt: null, closedAt: null, ticketStatus: 'open', lastPaymentStatus: null };
}
function terminal(seen: any[]) {
  return (cfg: any) => ({ name: 'fake', ping: async () => true, display: async () => {}, authCard: async (i: any) => { seen.push({ cfg, hsn: i.hsn }); return { approved: true, declined: false, respstat: 'A', respText: 'Approval', retref: 'R' + seen.length, amountCents: 5000 }; } }) as any;
}
beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Luxe','Luxe Nails','luxe-r','LUXER','active')`, [T]);
  await q(`insert into branches (id, tenant_id, name, status) values ($1,$2,'Main','active'), ($3,$2,'Cherry Hill','active')`, [BR, T, BR2]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Ana','Lee','Ana Lee')`, [CUST, T, BR]);
  const cat = (await q(`insert into service_categories (tenant_id, branch_id, name) values ($1,$2,'Nails') returning id`, [T, BR]))[0].id;
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$2,$3,$4,'Gel Manicure',45,5000)`, [SVC, T, BR, cat]);
  await q(`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values ($1, null, 'payments-checkout', $2::jsonb)`, [T, JSON.stringify({ customerDisplayCaptureMode: 'terminal' })]);
  await q(`insert into pos_payment_terminals (id, tenant_id, branch_id, label, status, hsn) values ('term_main',$1,$2,'Clover Main','paired','HSN-MAIN'), ('term_ch',$1,$3,'Clover Cherry Hill','paired','HSN-CH')`, [T, BR, BR2]);
  await q(`insert into tenant_payment_config (tenant_id, processor, status, merchant_id, bolt_base_url, bolt_api_key_enc) values ($1,'fiserv','active','MID-DEFAULT','https://bolt-default.test','v2p:default-key')`, [T]);
  await q(`insert into payment_merchant_accounts (tenant_id, branch_id, processor, status, merchant_id, bolt_base_url, bolt_api_key_enc) values ($1,$2,'fiserv','active','MID-CH','https://bolt-ch.test','v2p:cherry-key')`, [T, BR2]);
}, 180000);

describe('terminal capture → Bolt config through the provider router', () => {
  it('the Super-Admin-sealed (v2p:) key reaches the Clover DECRYPTED — the legacy MFA opener handed it over as ciphertext', async () => {
    const seen: any[] = [];
    const legacy = new TerminalCaptureService(db, terminal(seen), mfaDecrypt, undefined, new InMemoryTerminalLeases());
    await legacy.capture(await paying(BR));
    expect(seen[0].cfg.apiKey).toBe('v2p:default-key');   // the bug: ciphertext as the API key
    seen.length = 0;
    const routed = new TerminalCaptureService(db, terminal(seen), mfaDecrypt, undefined, new InMemoryTerminalLeases(), undefined, undefined, undefined, undefined, new PaymentGatewayResolver(db, paymentSecrets));
    const out = await routed.capture(await paying(BR));
    expect(out.outcome).toBe('approved');
    expect(seen[0].cfg).toEqual({ baseUrl: 'https://bolt-default.test', apiKey: 'default-key', merchantId: 'MID-DEFAULT' });
    expect(seen[0].hsn).toBe('HSN-MAIN');
  });
  it('§7/§13: the Cherry Hill terminal charges through the Cherry Hill merchant account (its own Bolt key + MID)', async () => {
    const seen: any[] = [];
    const svc = new TerminalCaptureService(db, terminal(seen), mfaDecrypt, undefined, new InMemoryTerminalLeases(), undefined, undefined, undefined, undefined, new PaymentGatewayResolver(db, paymentSecrets));
    const out = await svc.capture(await paying(BR2));
    expect(out.outcome).toBe('approved');
    expect(seen[0].cfg).toEqual({ baseUrl: 'https://bolt-ch.test', apiKey: 'cherry-key', merchantId: 'MID-CH' });
    expect(seen[0].hsn).toBe('HSN-CH');
    const t = (await q(`select last_seen_at, last_transaction_at, last_ping_ok from pos_payment_terminals where id = 'term_ch'`))[0];
    expect(t.last_seen_at).toBeTruthy(); expect(t.last_transaction_at).toBeTruthy(); expect(t.last_ping_ok).toBe(true);   // §50 health stamps
  });
  it('a paused branch merchant blocks the Clover at that branch — never the tenant default\'s key', async () => {
    await q(`update payment_merchant_accounts set status = 'paused' where branch_id = $1`, [BR2]);
    const seen: any[] = [];
    const svc = new TerminalCaptureService(db, terminal(seen), mfaDecrypt, undefined, new InMemoryTerminalLeases(), undefined, undefined, undefined, undefined, new PaymentGatewayResolver(db, paymentSecrets));
    const out: any = await svc.capture(await paying(BR2));
    expect(out.outcome).toBe('failed'); expect(out.reason).toMatch(/MERCHANT_SUSPENDED/);
    expect(seen).toHaveLength(0);
    await q(`update payment_merchant_accounts set status = 'active' where branch_id = $1`, [BR2]);
  });
  it('§52: a DISABLED terminal is never charged', async () => {
    await q(`update pos_payment_terminals set disabled_at = now(), disabled_reason = 'broken reader' where id = 'term_ch'`);
    const seen: any[] = [];
    const svc = new TerminalCaptureService(db, terminal(seen), mfaDecrypt, undefined, new InMemoryTerminalLeases(), undefined, undefined, undefined, undefined, new PaymentGatewayResolver(db, paymentSecrets));
    const out: any = await svc.capture(await paying(BR2));
    expect(out.outcome).toBe('failed'); expect(out.reason).toMatch(/TERMINAL_DISABLED/);
    expect(seen).toHaveLength(0);
    await q(`update pos_payment_terminals set disabled_at = null, disabled_reason = null where id = 'term_ch'`);
  });
});
