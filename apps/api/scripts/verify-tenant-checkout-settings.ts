/* verify-tenant-checkout-settings.ts — proves the tenant_settings (tips/tax/payments-checkout) actually drive checkout
 * math now: the shared resolver returns the configured tip %, tax rate and surcharge (with branch-level overriding
 * tenant-level), and the kiosk renders those exact values — so the POS and the customer display can no longer diverge. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { DB } from '../../../packages/database/src/kysely.types';
import { resolveCheckoutSettings } from '../../../modules/checkout/src/checkout/checkout-settings.resolver';
import { KyselyDisplayRepository } from '../src/customer-display/customer-display.repository';
import { CustomerDisplayService } from '../src/customer-display/customer-display.service';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); c ? pass++ : fail++; };
const throws = async (n: string, fn: () => Promise<any>, code?: string) => {
  try { await fn(); ok(n, false, 'did not throw'); } catch (e: any) { ok(n, code ? e?.code === code : true, e?.code || e?.message); }
};

(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { applyMigrationToPglite } = await import('../db/migration-sql.mjs');   // Phase 10: no-transaction / CONCURRENTLY rules
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  const PORT = 5488;
  const T = '00000000-0000-0000-0000-0000000e1501', B1 = '00000000-0000-0000-0000-0000000eb501';
  const C = '00000000-0000-0000-0000-0000000ec501', TK = '00000000-0000-0000-0000-0000000e7c01', DEV = '00000000-0000-0000-0000-0000000ede01';
  const B2 = '00000000-0000-0000-0000-0000000eb502';
  const S0 = '00000000-0000-0000-0000-0000000e5e01', SB = '00000000-0000-0000-0000-0000000e5e02';
  const token = 'tok_settings_xyz';
  const hash = createHash('sha256').update(token).digest('hex');

  const db = await PGlite.create({ extensions: { pgcrypto } });
  for (const f of readdirSync(join(process.cwd(), 'db', 'migrations')).filter((f) => f.endsWith('.sql')).sort()) await applyMigrationToPglite(db, readFileSync(join(process.cwd(), 'db', 'migrations', f), 'utf8'));
  await db.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code) VALUES ('${T}','Lux LLC','Lux Nails','lux','LUX')`);
  await db.exec(`INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B1}','${T}','Uptown','active'),('${B2}','${T}','Midtown','active')`);
  await db.exec(`INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, status, marketing_sms_opt_in, marketing_email_opt_in, marketing_opt_in) VALUES ('${C}','${T}','${B1}','Sam','Lee','Sam Lee','active',false,false,false)`);
  // tenant-level settings: tips 10/15/25 (maxTip 50%), tax 6%, surcharge 2%
  const ts = (cat: string, json: string, branch: string | null) =>
    `INSERT INTO tenant_settings (tenant_id, branch_id, category, settings_json) VALUES ('${T}',${branch ? `'${branch}'` : 'NULL'},'${cat}','${json}'::jsonb)`;
  await db.exec(ts('tips', JSON.stringify({ defaultTipPercents: [10, 15, 25], allowCustomTip: true, allowNoTip: true, maxTipPercent: 50, tipBase: 'service_subtotal', assignToPrimaryTech: true }), null));
  await db.exec(ts('tax', JSON.stringify({ enabled: true, taxRatePercent: 6.0, taxLabel: 'Sales Tax', mode: 'exclusive' }), null));
  await db.exec(ts('payments-checkout', JSON.stringify({ creditCardSurchargeEnabled: true, creditCardSurchargePercent: 2.0, surchargeLabel: 'CC Fee', cashDiscountEnabled: false, customerDisplayMode: 'review_only' }), null));
  // branch-level tax override for B1: 8%
  await db.exec(ts('tax', JSON.stringify({ enabled: true, taxRatePercent: 8.0, taxLabel: 'Sales Tax', mode: 'exclusive' }), B1));

  await db.exec(`INSERT INTO ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, commission_type_snapshot, commission_value_snapshot, line_total_cents, status, progress_percent) VALUES (gen_random_uuid(),'${T}','${B1}','${TK}',gen_random_uuid(),'Full Set',10000,60,'percent',0,10000,'completed',100)`);
  await db.exec(`INSERT INTO customer_display_devices (id, tenant_id, branch_id, device_name, device_type, pairing_status) VALUES ('${DEV}','${T}','${B1}','iPad','ipad','paired')`);
  const cols = 'id, tenant_id, branch_id, display_device_id, ticket_id, customer_id, state, public_token_hash, selected_tip_cents, subtotal_cents, payment_method, expires_at';
  // S0 = branch B2 which has NO overrides → resolves tenant-level (tax 6%); SB = branch B1 (→ branch tax 8%)
  await db.exec(`INSERT INTO customer_display_sessions (${cols}) VALUES ('${S0}','${T}','${B2}','${DEV}','${TK}','${C}','showing_ticket','${hash}',0,10000,'card', now() + interval '10 minutes')`);
  await db.exec(`INSERT INTO customer_display_sessions (${cols}) VALUES ('${SB}','${T}','${B1}','${DEV}','${TK}','${C}','showing_ticket','${hash}',0,10000,'card', now() + interval '10 minutes')`);

  const server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1' }); await server.start();
  const pool = new pg.Pool({ host: '127.0.0.1', port: PORT, user: 'postgres', database: 'postgres', max: 1 });
  const k = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  const svc = new CustomerDisplayService(new KyselyDisplayRepository(k));

  try {
    // 1) the shared resolver both sides consume
    const rt = await resolveCheckoutSettings(k, T, B2); // B2 has no overrides → tenant-level values
    ok('resolver (tenant): tax 6, surcharge 2, tips 10/15/25, maxTip 50', rt.taxRatePercent === 6 && rt.creditCardSurchargePercent === 2 && JSON.stringify(rt.defaultTipPercents) === '[10,15,25]' && rt.maxTipPercent === 50, JSON.stringify(rt));
    const rb = await resolveCheckoutSettings(k, T, B1);
    ok('resolver (branch B1): tax overridden to 8, tips still tenant 10/15/25', rb.taxRatePercent === 8 && JSON.stringify(rb.defaultTipPercents) === '[10,15,25]' && rb.creditCardSurchargePercent === 2, JSON.stringify(rb));

    // 2) kiosk renders the tenant-configured values (NOT the 15/18/20 + 7.75% defaults)
    const s0 = await svc.getState(S0, token);
    ok('kiosk tip options follow tenant config: 1000/1500/2500 + No Tip', s0.tipOptions.length === 4 && s0.tipOptions[0].amountCents === 1000 && s0.tipOptions[1].amountCents === 1500 && s0.tipOptions[2].amountCents === 2500, JSON.stringify(s0.tipOptions.map((o) => o.amountCents)));
    ok('kiosk totals follow tenant tax 6% + surcharge 2%: tax 600, surcharge 212, total 10812', s0.totals.taxCents === 600 && s0.totals.surchargeCents === 212 && s0.totals.totalDueCents === 10812, JSON.stringify(s0.totals));

    // 3) branch override reaches the kiosk too (8% tax)
    const sb = await svc.getState(SB, token);
    ok('kiosk on branch B1 uses 8% tax (override): tax 800, surcharge 216, total 11016', sb.totals.taxCents === 800 && sb.totals.surchargeCents === 216 && sb.totals.totalDueCents === 11016, JSON.stringify(sb.totals));

    // 4) tip math + the configured maxTipPercent (50%) are enforced against the configured values
    const t25 = await svc.submitTip(S0, token, { tipType: 'percent', percent: 25 });
    ok('25% tip on tenant config → 2500, total 13362', t25.selectedTipCents === 2500 && t25.totals.totalDueCents === 13362, JSON.stringify(t25.totals));
    await throws('custom tip 60% (> configured max 50%) → invalid', () => svc.submitTip(S0, token, { tipType: 'custom', amountCents: 6000 }), 'invalid');
    const t50 = await svc.submitTip(S0, token, { tipType: 'custom', amountCents: 5000 });
    ok('custom tip exactly 50% (= max) → allowed, total 15912', t50.selectedTipCents === 5000 && t50.totals.totalDueCents === 15912, JSON.stringify(t50.totals));
  } catch (e: any) {
    ok('harness ran without throwing', false, e?.message || String(e)); console.error(e);
  } finally {
    await k.destroy(); await server.stop(); await db.close();
    console.log(`\n${fail === 0 ? '🎉' : '⚠️'} verify-tenant-checkout-settings: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  }
})();
