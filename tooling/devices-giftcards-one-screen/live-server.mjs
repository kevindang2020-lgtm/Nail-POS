// live-server.mjs — Payment Terminals + Gift Cards one-screen harness (Oct 29 2026): the REAL Front Desk POS bundle
// (tooling/checkout-one-screen/build.mjs) served against the REAL screen controllers + repositories + SQL (TerminalsScreen,
// GiftCardsScreen) and the REAL gift-card writer routes (CheckoutController → CheckoutService → KyselyCheckoutRepository:
// issue · reload · void · balance lookup), on a seeded TEST database. Tooling only — never shipped, never pointed at production.
//   FST_PG_TEMPLATE=aps node --no-warnings --experimental-strip-types --import ./tooling/full-system-test/unit-standin/register.mjs \
//     tooling/devices-giftcards-one-screen/live-server.mjs
// Controls: /__tenant?name=pilot|empty · /__lang?l=en|vi · /__role?r=OWNER|MANAGER|FRONT_DESK|TECHNICIAN · /__fail?on=1 ·
//           /__pay?ticket=<id> (Checkout takes the payment: activates the ticket's pending card / credits its reload hold) ·
//           /__log · /__unhandled · /__audit · /__sql?k=…
// What is NOT the product here (said plainly so nobody mistakes it): the HTTP layer (no Nest guards / ListQuery / Idempotent
// interceptor / step-up / rate limiter — the controller methods are called directly with the session context and the body
// pipes run explicitly); the TERMINAL and PHONE mutations (pair · test · rename · register · disable / enable · unpair ·
// approve / suspend / revoke · pairing QR) and the routing PATCH, which live in the settings / mobile-checkout modules whose
// writers use the query builder this stand-in cannot run — the harness answers them with the same row changes + audit rows
// (labelled SIMULATED in /__log). No provider is called: "Test connection" here never reaches a terminal.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import { kyselyFor } from '../../packages/testing/src/pgtest-schema.mjs';
import { seed, payTicket, PILOT, EMPTY, BRANCH, BRANCH_E, OWNER_USER, MANAGER_USER, DESK_USER, TECH_USER } from './seed.mjs';
import { TerminalsScreenRepository } from '../../modules/payments/src/finance-screens/terminals-screen.repository.ts';
import { TerminalsScreenController } from '../../modules/payments/src/finance-screens/terminals-screen.controller.ts';
import { GiftCardsScreenRepository } from '../../modules/payments/src/finance-screens/gift-cards-screen.repository.ts';
import { GiftCardsScreenController } from '../../modules/payments/src/finance-screens/gift-cards-screen.controller.ts';
import { KyselyCheckoutRepository } from '../../modules/checkout/src/checkout/checkout.kysely.repository.ts';
import { CheckoutService } from '../../modules/checkout/src/checkout/checkout.service.ts';
import { CheckoutController } from '../../modules/checkout/src/checkout/checkout.controller.ts';
import { dataset } from '../checkout-one-screen/fixtures.mjs';
import { ValidatedBody } from '../../packages/permissions/src/guards/validated-body.ts';
import { hasPermission } from '../../packages/permissions/src/security-core.ts';
import { setCodedErrorSink } from '../../packages/api-contracts/src/coded-error.ts';
import { hashCardNumber } from '../../modules/gift-cards/src/gift-cards/gift-card-number-core.ts';
import * as CB from '../../modules/checkout/src/request-schemas.ts';
const V = (schema, b) => ValidatedBody(schema, { strict: true }).transform(b);

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(ROOT, 'tooling/checkout-one-screen/out');
const req = createRequire(import.meta.url);
const rbac = req(join(ROOT, 'packages/permissions/dist/rbac.js'));
const perms = (role) => [...(rbac.ROLE_PERMISSIONS?.[role] ?? [])];
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml' };

const pg = await PGlite.create({ loadDataDir: true });
const db = kyselyFor(pg);
const t0 = Date.now(); const seeded = await seed(pg, db);
console.log(`seeded in ${Date.now() - t0} ms`, seeded, 'db', pg.dbname);

const audited = [];
const auditor = { record: async (c, i) => { audited.push({ at: new Date().toISOString(), tenantId: c.tenantId, userId: c.userId, ...i }); } };
const C = {
  pt: new TerminalsScreenController(new TerminalsScreenRepository(db)),
  gc: new GiftCardsScreenController(new GiftCardsScreenRepository(db, auditor)),
  co: new CheckoutController(new CheckoutService(new KyselyCheckoutRepository(db))),
};

let tenant = 'pilot', lang = 'en', role = 'OWNER', fail = false;
const USERS = { OWNER: OWNER_USER, MANAGER: MANAGER_USER, FRONT_DESK: DESK_USER, TECHNICIAN: TECH_USER };
const NAMES = { OWNER: 'Linh Owner', MANAGER: 'Mai Manager', FRONT_DESK: 'Vy Front Desk', TECHNICIAN: 'Kim Tech' };
const session = () => { const t = tenant === 'empty' ? EMPTY : PILOT; return { tenantId: t, branchId: tenant === 'empty' ? BRANCH_E : BRANCH, userId: USERS[role] ?? OWNER_USER, role, permissions: perms(role), salonName: tenant === 'empty' ? 'New Salon' : 'Pilot Nail Salon' }; };
const principal = () => { const s = session(); return { userId: s.userId, tenantId: s.tenantId, branchId: s.branchId, role: s.role, permissions: s.permissions, fullName: NAMES[role] ?? 'Linh Owner', email: null, subscriptionStatus: 'active' }; };
const has = (p) => hasPermission(session(), p);   // the product's rule (granular pos.* keys resolve to their coarse capability)
const unhandled = new Map(); const log = [];

// the platform exception filter's rule: a controller that re-threw a coded refusal as a fresh HttpException still answers
// the registry code the request threw with the same sentence (packages/observability request-telemetry)
let coded = []; setCodedErrorSink((e) => coded.push(e));
async function call(fn) {
  coded = [];
  try {
    const headers = {}; const res = { setHeader: (k, v) => { headers[k.toLowerCase()] = v; } };
    const body = await fn(res);
    return { status: 200, body: body ?? null, headers };
  } catch (e) {
    const st = typeof e?.getStatus === 'function' ? e.getStatus() : e?.status ?? 500; const r = typeof e?.getResponse === 'function' ? e.getResponse() : null;
    const message0 = (r && typeof r === 'object' && r.message) || (typeof r === 'string' ? r : e?.message);
    const code = (r && typeof r === 'object' && r.code) || e?.apiCode || coded.find((c) => c.message === message0)?.apiCode || e?.code || (st === 403 ? 'PERMISSION_DENIED' : st === 401 ? 'AUTH_REQUIRED' : st === 404 ? 'RESOURCE_NOT_FOUND' : st === 400 ? 'VALIDATION_FAILED' : 'INTERNAL_ERROR');
    const message = (r && typeof r === 'object' && r.message) || (typeof r === 'string' ? r : e?.message) || 'error';
    if (st >= 500) console.error('500', e);
    return { status: st, body: { error: { code, message, details: (r && typeof r === 'object' && r.details) || e?.details || {} }, code, message } };
  }
}
const denied = () => ({ status: 403, body: { error: { code: 'PERMISSION_DENIED', message: 'You do not have permission to do that.' } } });
const bad = (code, message) => ({ status: 400, body: { error: { code, message } } });
const ok = (b) => ({ status: 200, body: b });
const SIM = (what) => log.push(`SIMULATED ${what}`);
const q = (s, p = []) => pg.query(s, p);
const sAudit = (action, entity, before = {}, after = {}) => q(`insert into settings_audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, before_json, after_json) values ($1,$2,$3,$4,$5,'payment_terminal',$6,$7::jsonb,$8::jsonb)`,
  [session().tenantId, session().branchId, session().userId, role, action, entity, JSON.stringify(before), JSON.stringify(after)]);
const dAudit = (action, dev, meta = {}) => q(`insert into audit_logs (tenant_id, user_id, role, action_type, entity_type, entity_id, metadata_json) values ($1,$2,$3,$4,'mobile_pay_device',$5,$6::jsonb)`, [session().tenantId, session().userId, role, action, dev, JSON.stringify(meta)]).catch((e) => log.push('audit_logs insert failed: ' + e.message));

const SCREEN = /^\/pos\/(devices\/payment-terminals|gift-cards\/(list|summary|export|[^/]+\/(detail|ledger)))/;
async function route(method, path, query, body) {
  const r = { ctx: session() }; const Q = query; const m = (re) => path.match(re); let x;
  if (fail && SCREEN.test(path)) return { status: 503, body: { error: { code: 'SERVICE_UNAVAILABLE', message: 'This is temporarily unavailable. Please try again shortly.' } } };
  // ── Payment Terminals (read model — real) ──
  const PT = '/pos/devices/payment-terminals';
  if (method === 'GET' && path === PT + '/summary') return call(() => C.pt.summary(r));
  if (method === 'GET' && path === PT + '/physical') return call(() => C.pt.physical(r, Q.search, Q.status, Q.register, Q.sort, Q.page, Q.pageSize));
  if (method === 'GET' && (x = m(/^\/pos\/devices\/payment-terminals\/physical\/([^/]+)$/))) return call(() => C.pt.physicalDetail(r, decodeURIComponent(x[1])));
  if (method === 'GET' && path === PT + '/tap-to-pay') return call(() => C.pt.phones(r, Q.search, Q.status, Q.sort, Q.page, Q.pageSize));
  if (method === 'GET' && (x = m(/^\/pos\/devices\/payment-terminals\/tap-to-pay\/([^/]+)$/))) return call(() => C.pt.phoneDetail(r, decodeURIComponent(x[1])));
  if (method === 'GET' && path === PT + '/activity') return call(() => C.pt.activity(r, Q.preset, Q.from, Q.to, Q.search, Q.status, Q.device, Q.deviceId, Q.sort, Q.page, Q.pageSize));
  if (method === 'GET' && path === PT + '/routing') return call(() => C.pt.routing(r));
  // ── terminal mutations (SIMULATED row changes + audit; see the header) ──
  const TM = '/pos/settings/payments-checkout/terminals/';
  if (path.startsWith(TM)) {
    const canEdit = has('settings.edit') || has('settings.payments_edit'); if (!canEdit) return denied();
    const T = session().tenantId; const rest = path.slice(TM.length);
    if (method === 'POST' && rest === 'pair') {
      if (!/^\d{6}$/.test(String(body.code ?? ''))) return bad('VALIDATION_FAILED', 'Enter the 6-digit pairing code shown on the terminal.');
      const tid = 'term_' + String(body.code) + '_' + Date.now().toString(36).slice(-4);
      await q(`insert into pos_payment_terminals (id, tenant_id, branch_id, label, station_id, status, paired_at, hsn, terminal_type, provider, updated_at) values ($1,$2,$3,$4,$5,'paired', now(), $6, 'clover_compact', 'cardpointe', now())`, [tid, T, session().branchId, String(body.label ?? 'Terminal').slice(0, 80), body.stationId || null, body.hsn || null]);
      await sAudit('pos_settings_terminal_paired', tid, {}, { label: body.label }); SIM(`pair ${tid}`); return ok({ id: tid, status: 'paired' });
    }
    const [tid, act] = rest.split('/').map(decodeURIComponent);
    const row = (await q(`select * from pos_payment_terminals where tenant_id = $1 and id = $2`, [T, tid])).rows[0]; if (!row) return { status: 404, body: { error: { code: 'RESOURCE_NOT_FOUND', message: 'That terminal could not be found.' } } };
    if (method === 'GET' && act === 'test') {   // no provider behind the harness: an honest "not probed" unless the seed marked the reader reachable
      const reachable = row.last_ping_ok === true && row.status === 'paired' && !row.disabled_at;
      await q(`update pos_payment_terminals set last_ping_at = now(), last_ping_ok = $3, last_seen_at = case when $3 then now() else last_seen_at end where tenant_id = $1 and id = $2`, [T, tid, reachable]);
      await sAudit('pos_settings_terminal_tested', tid, {}, { reachable }); SIM(`test ${tid} → ${reachable}`);
      return ok({ id: tid, reachable, probed: reachable, detail: reachable ? 'The terminal answered the processor ping (no card was charged).' : 'The terminal did not answer — check that it is powered on, online and registered with the processor.' });
    }
    if (method === 'POST' && act === 'rename') { await q(`update pos_payment_terminals set label = coalesce($3, label), terminal_type = coalesce($4, terminal_type), updated_at = now() where tenant_id = $1 and id = $2`, [T, tid, body.label ?? null, body.terminalType ?? null]); await sAudit('pos_settings_terminal_updated', tid, { label: row.label }, body); SIM(`rename ${tid}`); return ok({ id: tid }); }
    if (method === 'POST' && act === 'disable') { if (String(body.reason ?? '').trim().length < 3) return bad('VALIDATION_FAILED', 'Enter a reason.'); await q(`update pos_payment_terminals set disabled_at = now(), disabled_reason = $3 where tenant_id = $1 and id = $2`, [T, tid, body.reason]); await sAudit('pos_settings_terminal_disabled', tid, {}, { reason: body.reason }); SIM(`disable ${tid}`); return ok({ id: tid }); }
    if (method === 'POST' && act === 'enable') { await q(`update pos_payment_terminals set disabled_at = null, disabled_reason = null where tenant_id = $1 and id = $2`, [T, tid]); await sAudit('pos_settings_terminal_enabled', tid); SIM(`enable ${tid}`); return ok({ id: tid }); }
    if (method === 'POST' && act === 'unpair') { await q(`update pos_payment_terminals set status = 'unpaired' where tenant_id = $1 and id = $2`, [T, tid]); await sAudit('pos_settings_terminal_unpaired', tid); SIM(`unpair ${tid}`); return ok({ ok: true }); }
    if (method === 'POST' && act === 'register') { await q(`update pos_payment_terminals set station_id = $3 where tenant_id = $1 and id = $2`, [T, tid, body.stationId || null]); await sAudit('pos_settings_terminal_register_set', tid, { stationId: row.station_id }, { stationId: body.stationId || null }); SIM(`register ${tid} → ${body.stationId}`); return ok({ id: tid, stationId: body.stationId }); }
  }
  // ── Tap to Pay phone trust actions (SIMULATED; see the header) ──
  const MD = '/mobile-checkout/devices/';
  if (path.startsWith(MD) && method === 'POST') {
    if (!has('pos.devices.manage')) return denied();
    const T = session().tenantId; const rest = path.slice(MD.length);
    if (rest === 'pairings') { SIM('pairing QR'); return ok({ pairingId: 'pair_' + Date.now().toString(36), code: '482913', qrPayload: 'aps-pair:TEST-ONLY', expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), label: body.label ?? null, shared: !!body.shared }); }
    const [dev, act] = rest.split('/').map(decodeURIComponent);
    const row = (await q(`select status from mobile_pay_devices where tenant_id = $1 and device_id = $2`, [T, dev])).rows[0]; if (!row) return { status: 404, body: { error: { code: 'RESOURCE_NOT_FOUND', message: 'That phone could not be found.' } } };
    if (['revoked', 'compromised'].includes(row.status)) return { status: 409, body: { error: { code: 'CONFLICT', message: 'A revoked phone must be registered again.' } } };   // never auto-reactivated
    const to = { approve: 'active', disable: 'disabled', revoke: 'revoked' }[act]; if (!to) return undefined;
    if (act !== 'approve' && String(body.reason ?? '').trim().length < 3) return bad('VALIDATION_FAILED', 'Enter a reason.');
    await q(`update mobile_pay_devices set status = $3, revoked_at = case when $3 = 'revoked' then now() else revoked_at end, revoke_reason = case when $3 = 'revoked' then $4 else revoke_reason end where tenant_id = $1 and device_id = $2`, [T, dev, to, body.reason ?? null]);
    await dAudit('mobile_pay_device_' + to, dev, { reason: body.reason ?? null }); SIM(`${act} ${dev}`);
    return ok({ deviceId: dev, status: to });
  }
  if (method === 'GET' && (x = m(/^\/mobile-checkout\/devices\/([^/]+)\/activity$/))) return ok({ deviceId: x[1], sessions: [], events: [] });
  // ── capture routing (SIMULATED PATCH: the same settings row + settings audit) ──
  if (method === 'PATCH' && path === '/pos/settings/payments-checkout') {
    if (!(has('settings.edit') || has('settings.payments_edit'))) return denied();
    const T = session().tenantId; const mode = body.customerDisplayCaptureMode; if (!['front_desk', 'terminal'].includes(mode)) return bad('VALIDATION_FAILED', 'card capture routing must be one of front_desk, terminal');
    const before = (await q(`select settings_json from tenant_settings where tenant_id = $1 and category = 'payments-checkout' and branch_id is null`, [T])).rows[0]?.settings_json ?? {};
    if ((await q(`update tenant_settings set settings_json = settings_json || $2::jsonb where tenant_id = $1 and category = 'payments-checkout' and branch_id is null`, [T, JSON.stringify({ customerDisplayCaptureMode: mode })])).affectedRows === 0)
      await q(`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values ($1, null, 'payments-checkout', $2::jsonb)`, [T, JSON.stringify({ customerDisplayCaptureMode: mode })]);
    await q(`insert into settings_audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, before_json, after_json) values ($1,$2,$3,$4,'pos_settings_payments_checkout_updated','payments_checkout','payments-checkout',$5::jsonb,$6::jsonb)`,
      [T, session().branchId, session().userId, role, JSON.stringify({ customerDisplayCaptureMode: before.customerDisplayCaptureMode ?? 'front_desk' }), JSON.stringify({ customerDisplayCaptureMode: mode })]);
    SIM(`routing → ${mode}`); return ok({ customerDisplayCaptureMode: mode });
  }
  if (method === 'GET' && path === '/pos/settings/gift-card-settings') {
    const row = (await q(`select settings_json from tenant_settings where tenant_id = $1 and category = 'gift-card-settings' and branch_id is null`, [session().tenantId])).rows[0];
    return ok({ enabled: true, posSalesEnabled: true, presetAmountsCents: [2500, 5000, 10000], customAmountEnabled: true, minAmountCents: 1000, maxAmountCents: 50000, ...(row?.settings_json ?? {}) });
  }
  // ── customer search for the Issue dialog (the salon's own customers, from the database) ──
  if (method === 'GET' && path === '/pos/customers/search') {
    const s = String(Q.search ?? Q.q ?? '').trim().toLowerCase(); const d = s.replace(/\D/g, '');
    const rows = (await q(`select id, full_name, phone_display from customers where tenant_id = $1 and (lower(full_name) like $2 or ($3 <> '' and regexp_replace(coalesce(normalized_phone,''), '\\D', '', 'g') like '%' || $3 || '%')) order by full_name limit 8`, [session().tenantId, `%${s}%`, d.length >= 4 ? d : ''])).rows;
    return ok({ items: rows.map((c) => ({ customerId: c.id, fullName: c.full_name, phone: c.phone_display, visitsCount: 0 })), total: rows.length });
  }
  // ── Gift Cards (read model — real) ──
  if (method === 'GET' && path === '/pos/gift-cards/list') return call(() => C.gc.list(r, Q));
  if (method === 'GET' && path === '/pos/gift-cards/summary') return call(() => C.gc.summary(r, Q));
  if (method === 'GET' && path === '/pos/gift-cards/export') return has('pos.reports.export') ? call(() => C.gc.exportCsv(r, Q)) : denied();
  if (method === 'GET' && path === '/pos/gift-cards/liability') return { status: 403, body: { error: { code: 'PERMISSION_DENIED', message: 'not in this harness' } } };
  if (method === 'GET' && (x = m(/^\/pos\/gift-cards\/([^/]+)\/detail$/))) return call(() => C.gc.detail(r, x[1]));
  if (method === 'GET' && (x = m(/^\/pos\/gift-cards\/([^/]+)\/ledger$/))) return call(() => C.gc.ledger(r, x[1], Q.preset, Q.from, Q.to, Q.page, Q.pageSize));
  // ── the gift-card writer (real controller methods → CheckoutService → KyselyCheckoutRepository) ──
  if (method === 'POST' && path === '/pos/checkout/gift-cards/issue') return has('pos.checkout.gift_card_issue') ? call(() => C.co.issueFromScreen(r, V(CB.GIFT_CARD_ISSUE_BODY, body))) : denied();
  if (method === 'POST' && (x = m(/^\/pos\/checkout\/gift-cards\/([^/]+)\/reload-ticket$/))) return has('pos.checkout.gift_card_issue') ? call(() => C.co.reloadFromScreen(r, x[1], V(CB.GIFT_CARD_SCREEN_RELOAD_BODY, body))) : denied();
  if (method === 'POST' && (x = m(/^\/pos\/checkout\/gift-cards\/([^/]+)\/void-card$/))) return has('pos.checkout.void') ? call(() => C.co.voidFromScreen(r, x[1], V(CB.GIFT_CARD_VOID_BODY, body))) : denied();
  if (method === 'POST' && path === '/pos/checkout/gift-cards/lookup') {
    // CheckoutService.giftCardLookup resolves the number through the query builder (resolveGiftCardCode / getGiftCard),
    // which this stand-in cannot run — SIMULATED with the same rule: an exact 16-digit number (by its hash) or an exact
    // code, this salon only, answered masked; a miss says only "not found". (No rate limiter behind the harness.)
    if (!has('pos.checkout.gift_card_payment')) return denied();
    const input = String(V(CB.GIFT_CARD_INPUT_BODY, body)?.input ?? '').trim(); const d = input.replace(/\D+/g, '');
    const row = (await q("select id, code, card_number_last4, balance_cents, status from gift_cards where tenant_id = $1 and (card_number_hash = $2 or upper(code) = upper($3)) limit 1", [session().tenantId, /^\d{16}$/.test(d) ? hashCardNumber(d) : '-', input])).rows[0];
    SIM(`gift-card lookup → ${row ? 'found' : 'miss'}`);
    if (!row) return ok({ found: false });
    return ok({ found: true, cardId: row.id, reference: 'GC-****-' + String(row.code).slice(-4), cardNumberMasked: row.card_number_last4 ? '•••• ' + row.card_number_last4 : undefined, balanceCents: Number(row.balance_cents), status: row.status, redeemableHere: row.status === 'active' && Number(row.balance_cents) > 0 });
  }
  return undefined;
}

createServer(async (rq, rs) => {
  const u = new URL(rq.url, 'http://x');
  const send = (code, body, type = 'application/json', extra = {}) => { rs.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', ...extra }); rs.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
  if (u.pathname === '/__tenant') { tenant = u.searchParams.get('name') === 'empty' ? 'empty' : 'pilot'; return send(200, { tenant }); }
  if (u.pathname === '/__lang') { lang = u.searchParams.get('l') === 'vi' ? 'vi' : 'en'; return send(200, { lang }); }
  if (u.pathname === '/__role') { role = u.searchParams.get('r') || 'OWNER'; return send(200, { role, perms: perms(role).length }); }
  if (u.pathname === '/__fail') { fail = u.searchParams.get('on') === '1'; return send(200, { fail }); }
  if (u.pathname === '/__log') return send(200, log.slice(-400));
  if (u.pathname === '/__unhandled') return send(200, [...unhandled.entries()].map(([k, n]) => ({ route: k, n })));
  if (u.pathname === '/__audit') return send(200, audited);
  if (u.pathname === '/__seeded') return send(200, seeded);
  if (u.pathname === '/__pay') { const n = await payTicket(pg, PILOT, BRANCH, u.searchParams.get('ticket')); log.push(`SIMULATED checkout payment ${u.searchParams.get('ticket')} (${n})`); return send(200, { credited: n }); }
  if (u.pathname === '/__sql') {
    const k = u.searchParams.get('k'), a = u.searchParams.get('a') ?? '';
    const QQ = {
      cards: [`select count(*)::int n, count(*) filter (where status = 'pending_payment')::int pending from gift_cards where tenant_id = $1`, [PILOT]],
      latestCard: [`select g.id, g.status, g.balance_cents, g.purchased_cents, g.customer_id, g.sale_ticket_id, (select count(*)::int from gift_card_transactions t where t.gift_card_id = g.id) tx, (select recipient_name from gift_card_recipients r where r.gift_card_id = g.id limit 1) recipient from gift_cards g where tenant_id = $1 order by created_at desc limit 1`, [PILOT]],
      card: [`select g.status, g.balance_cents, g.void_reason, g.voided_at, (select count(*)::int from gift_card_transactions t where t.gift_card_id = g.id) tx from gift_cards g where tenant_id = $1 and id = $2::uuid`, [PILOT, a]],
      cardTx: [`select type, amount_cents, balance_after_cents, idempotency_key from gift_card_transactions where tenant_id = $1 and gift_card_id = $2::uuid order by created_at, id`, [PILOT, a]],
      liability: [`select coalesce(sum(balance_cents) filter (where status in ('active','partially_redeemed','frozen')),0)::int s from gift_cards where tenant_id = $1`, [PILOT]],
      terminals: [`select id, label, station_id, status, disabled_at is not null disabled, last_ping_ok from pos_payment_terminals where tenant_id = $1 order by paired_at desc nulls last`, [PILOT]],
      phones: [`select device_id, status, revoke_reason from mobile_pay_devices where tenant_id = $1 order by device_id`, [PILOT]],
      routing: [`select settings_json->>'customerDisplayCaptureMode' mode from tenant_settings where tenant_id = $1 and category = 'payments-checkout' and branch_id is null`, [PILOT]],
      settingsAudit: [`select action_type, entity_id, after_json from settings_audit_logs where tenant_id = $1 order by created_at desc limit 5`, [PILOT]],
      tickets: [`select count(*)::int n from tickets where tenant_id = $1`, [PILOT]],
    };
    const [sq, sp] = QQ[k] ?? ['select 1', []];
    return send(200, (await q(sq, sp)).rows);
  }
  const file = join(OUT, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!u.pathname.startsWith('/api/') && existsSync(file) && !file.endsWith('/')) return send(200, readFileSync(file), TYPES[extname(file)] || 'application/octet-stream');
  if (!u.pathname.startsWith('/api/')) return send(200, readFileSync(join(OUT, 'index.html')), 'text/html');
  let raw = ''; for await (const c of rq) raw += c;
  const body = raw ? JSON.parse(raw) : {};
  const path = u.pathname.replace(/^\/api\/v1/, ''); const query = Object.fromEntries(u.searchParams.entries());
  log.push(`${rq.method} ${path}${u.search}${rq.method !== 'GET' && raw ? ' ' + raw.slice(0, 300) : ''}`);
  if (path === '/auth/me') return send(200, principal());
  if (path === '/pos/me/locale') return send(200, { language: lang, timeZone: 'America/New_York' });
  if (path === '/realtime/stream') { rs.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' }); rs.write(': connected\n\nevent: ready\ndata: {}\n\n'); const t = setInterval(() => rs.write(': ping\n\n'), 15000); rq.on('close', () => clearInterval(t)); return; }
  let hit;
  try { hit = await route(rq.method, path, query, body); } catch (e) { console.error('route', e); hit = { status: e?.getStatus?.() ?? 400, body: { error: { code: e?.getResponse?.()?.code ?? 'VALIDATION_FAILED', message: e?.message ?? 'error' } } }; }
  if (hit) {
    if (Buffer.isBuffer(hit.body)) return send(hit.status, hit.body, hit.headers?.['content-type'] ?? 'application/octet-stream');
    if (typeof hit.body === 'string') return send(hit.status, hit.body, 'text/csv; charset=utf-8');
    return send(hit.status, hit.body);
  }
  const ds = dataset('normal').route(rq.method, path, u.searchParams, body, { perms: session().permissions, branchId: session().branchId });
  if (ds !== undefined) return send(ds?.__status ?? 200, ds?.__status ? ds.body : ds);
  const k2 = `${rq.method} ${path.replace(/[0-9a-f-]{36}/g, ':id')}`; unhandled.set(k2, (unhandled.get(k2) ?? 0) + 1);
  return send(404, { error: { code: 'NOT_FOUND', message: 'not in the harness' } });
}).listen(Number(process.env.PORT || 4329), '127.0.0.1', () => console.log('devices + gift cards harness on', process.env.PORT || 4329));
