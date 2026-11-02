// rn-extra.mjs — Loyalty & Rewards → Rewards Network in the catalog harness (Global Loyalty & Rewards Network, Oct 30 2026):
// the REAL GlobalRewardsController → GlobalRewardsService → GlobalRewardsRepository → SQL on the seeded TEST database, the
// SANDBOX funding provider (no real money), realtime frames through the harness stream. Tooling only — never shipped.
// Controls (GET /__rn?…):
//   flags=on|off|nocustom|nopurchase   platform_settings for the 7 network flags (all default OFF)
//   enroll=1 | suspend=1               Super Admin enrollment through the real repository (audited)
//   provider=sandbox|none|lost         the funding seam: sandbox, none (BLOCKED_EXTERNAL), lost (submit throws → UNKNOWN)
//   advance=<intentId>&to=<STATUS>     the sandbox provider's later answer, through the real service (Super Admin path)
//   stepup=on|off                      enforce @RequireStepUp routes (STEP_UP_REQUIRED until /auth/step-up)
//   reset=1                            wipe this salon's network rows (wallet / purchases / versions / enrollment)
//   state=1                            DB truth for assertions (wallet, ledger, versions, purchases, journal balance, audit)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRewardsRepository } from '../../modules/loyalty/src/global-rewards/global-rewards.repository.ts';
import { GlobalRewardsService } from '../../modules/loyalty/src/global-rewards/global-rewards.service.ts';
import { GlobalRewardsController, SuperAdminGlobalRewardsController } from '../../modules/loyalty/src/global-rewards/global-rewards.controller.ts';
import { SandboxTokenFundingProvider } from '../../modules/loyalty/src/global-rewards/token-funding-provider.ts';
import { GR_FLAGS } from '../../modules/loyalty/src/global-rewards/global-rewards-flags.ts';
import { holdForTicket, finalizeForPaidTicket } from '../../modules/loyalty/src/global-rewards/rewards-redemption.ts';
import { CustomerRewardsController, OwnerRewardsController } from '../../modules/loyalty/src/global-rewards/rewards-apps.controller.ts';
import { sql } from 'kysely';

const SA_USER = '00000000-0000-4000-8000-00000000a001';
class LostProvider { name = 'sandbox'; sandbox = true; async submit() { throw new Error('harness: the provider answer was lost'); } }

export function rnExtra(db, pg, ROOT) {
  const repo = new GlobalRewardsRepository(db);
  const holder = { provider: new SandboxTokenFundingProvider() };
  // realtime through the harness stream, looked up at emit time (the server defines it after this module is built)
  const svc = new GlobalRewardsService(repo, null, { toTenant: (...a) => globalThis.__harnessRealtime?.toTenant(...a) });
  // the provider is swappable at run time (harness only): the service reads it through this getter
  Object.defineProperty(svc, 'provider', { get: () => holder.provider, configurable: true });
  const ctl = new GlobalRewardsController(svc);
  const saCtl = new SuperAdminGlobalRewardsController(svc);
  // which routes need a fresh step-up — read from the controller source, like the routes themselves
  const src = readFileSync(join(ROOT, 'modules/loyalty/src/global-rewards/global-rewards.controller.ts'), 'utf8');
  const salonSrc = src.slice(0, src.indexOf('export class SuperAdminGlobalRewardsController')), saSrc = src.slice(src.indexOf('export class SuperAdminGlobalRewardsController'));
  const stepUpOf = (s0) => new Set([...s0.matchAll(/@RequireStepUp\(\)[^\n]*\n?\s*(\w+)\(/g)].map((m) => m[1]));
  const stepUpMethods = stepUpOf(salonSrc), saStepUp = stepUpOf(saSrc);
  let stepUpOn = false; let fresh = false;
  const custCtl = new CustomerRewardsController(db), ownerCtl = new OwnerRewardsController(db);
  const appRoutes = (routesOf) => [
    { verb: 'GET', re: /^\/customer\/global-rewards$/, keys: [], perm: null, method: 'mine', params: ['req'], fn: custCtl.mine.bind(custCtl) },
    { verb: 'POST', re: /^\/customer\/global-rewards\/opt-in$/, keys: [], perm: null, method: 'optIn', params: ['req', 'body'], fn: custCtl.optIn.bind(custCtl) },
    { verb: 'POST', re: /^\/customer\/global-rewards\/withdraw$/, keys: [], perm: null, method: 'withdraw', params: ['req', 'body'], fn: custCtl.withdraw.bind(custCtl) },
    ...routesOf('modules/loyalty/src/global-rewards/rewards-apps.controller.ts', '/owner/loyalty', ownerCtl, 'export class OwnerRewardsController'),
  ];
  const q = async (s, p = []) => (await pg.query(s, p)).rows;
  const setFlag = (key, on) => q(`insert into platform_settings (setting_key, setting_group, value, value_type) values ($1,'loyalty',$2::jsonb,'boolean') on conflict (setting_key) do update set value = excluded.value`, [key, JSON.stringify(on)]);

  return {
    // the file also holds the Super Admin controller: parse with a tolerant instance, keep only the salon controller's own
    // methods, first route per verb + path (the salon routes come first in the file)
    routes: (routesOf) => {
      const tolerant = new Proxy(ctl, { get: (t, k) => (typeof t[k] === 'function' ? t[k] : () => undefined) });
      const seen = new Set();
      return routesOf('modules/loyalty/src/global-rewards/global-rewards.controller.ts', '/pos/loyalty/network', tolerant)
        .filter((r) => typeof ctl[r.method] === 'function' && !seen.has(r.verb + r.re) && seen.add(r.verb + r.re))
        .map((r) => ({ ...r, fn: ctl[r.method].bind(ctl), stepUp: stepUpMethods.has(r.method) }))
        // Super Admin control centre (its own class, parsed from its declaration on)
        .concat(routesOf('modules/loyalty/src/global-rewards/global-rewards.controller.ts', '/super-admin/loyalty-network', saCtl, 'export class SuperAdminGlobalRewardsController')
          .map((r) => ({ ...r, stepUp: saStepUp.has(r.method) })))
        // Customer App (no RequirePermission: the global guard + the service's CUSTOMER check) and Owner App rewards
        .concat(appRoutes(routesOf));
    },
    /** STEP_UP_REQUIRED for a step-up route until the prompt is confirmed (then ONE retry passes, as a fresh token would) */
    gate(rt) {
      if (!stepUpOn || !rt.stepUp) return null;
      if (fresh) { fresh = false; return null; }
      return { status: 403, body: { error: { code: 'STEP_UP_REQUIRED', message: 'Confirm your password to continue.' }, code: 'STEP_UP_REQUIRED' } };
    },
    stepUp(body) { if (String(body?.password ?? '') !== 'correct-horse') return { status: 403, body: { error: { code: 'STEP_UP_FAILED', message: 'Password is not correct.' }, code: 'STEP_UP_FAILED' } }; fresh = true; return { status: 200, body: { ok: true } }; },
    async control(sp, tenantId) {
      const out = {};
      if (sp.get('flags')) {
        const f = sp.get('flags');
        for (const k of Object.values(GR_FLAGS)) await setFlag(k, f !== 'off');
        if (f === 'nocustom') await setFlag(GR_FLAGS.customEarning, false);
        if (f === 'nopurchase') await setFlag(GR_FLAGS.purchases, false);
        out.flags = f;
      }
      if (sp.get('reset')) {
        for (const t of ['token_purchase_events', 'token_purchase_intents', 'tenant_earning_policy_versions', 'global_rewards_enrollments']) await q(`delete from ${t} where tenant_id = $1`, [tenantId]);
        // the wallet ledger + journal are append-only by design: a reset starts the wallet over by deleting the wallet row only
        // when the ledger is empty; otherwise the run keeps its history (assertions use deltas)
        const led = await q(`select count(*)::int as n from token_wallet_ledger where tenant_id = $1`, [tenantId]);
        if (!led[0].n) await q(`delete from tenant_token_wallets where tenant_id = $1`, [tenantId]);
        out.reset = true;
      }
      if (sp.get('enroll')) { await svc.setEnrollment(tenantId, 'enrolled', { reason: 'Harness pilot enrollment for the E2E run', actorUserId: SA_USER }); out.enrolled = true; }
      if (sp.get('suspend')) { await svc.setEnrollment(tenantId, 'suspended', { purchasingSuspended: true, reason: 'Harness suspension for the E2E run', actorUserId: SA_USER }); out.suspended = true; }
      if (sp.get('provider')) { const p = sp.get('provider'); holder.provider = p === 'none' ? null : p === 'lost' ? new LostProvider() : new SandboxTokenFundingProvider(); out.provider = p; }
      if (sp.get('advance')) out.advanced = await svc.sandboxAdvance(sp.get('advance'), sp.get('to'), SA_USER);
      // a real cross-salon redemption on this salon: verified + opted-in customer with 30 points (seeded with a matching
      // ledger row), a ticket, the reward tender + HOLD in one transaction, the rest paid in cash, then the paid-ticket finalize
      if (sp.get('redeem')) {
        const cust = (await q(`select id, branch_id from customers where tenant_id = $1 order by created_at limit 1`, [tenantId]))[0];
        const idn = (await q(`insert into customer_identities (normalized_phone, full_name, status, phone_verified_at) values ('+16095550999', 'Harness Rewards', 'active', now())
          on conflict do nothing returning id`))[0]?.id ?? (await q(`select id from customer_identities where normalized_phone = '+16095550999'`))[0].id;
        const usr = (await q(`select id from users where tenant_id = $1 order by created_at limit 1`, [tenantId]))[0];
        await q(`insert into customer_identity_links (identity_id, tenant_id, user_id, customer_id) values ($1,$2,$3,$4) on conflict do nothing`, [idn, tenantId, usr.id, cust.id]);
        await q(`insert into global_rewards_accounts (identity_id, terms_version, enrolled_via, opted_in_at, consent_source, available_tenths) values ($1, '2026-10-30', 'customer_app', now(), 'customer_app', 300)
          on conflict (identity_id) do nothing`, [idn]);
        await q(`insert into global_points_ledger (identity_id, entry_type, delta_tenths, balance_after_tenths, tenant_id, source_table, source_id) values ($1, 'adjustment', 300, 300, $2, 'harness_seed', $3) on conflict do nothing`, [idn, tenantId, 'seed-' + idn]);
        // the seeded points' value is backed in the journal (as an earn would): prepaid liability → rewards liability
        await q(`insert into rewards_journal_entries (id, entry_type, tenant_id, source_table, source_id, memo) values (gen_random_uuid(), 'earn_allocation', $1, 'harness_seed', $2, 'harness seed') on conflict do nothing`, [tenantId, 'seed-' + idn]);
        const je = (await q(`select id from rewards_journal_entries where source_table = 'harness_seed' and source_id = $1`, ['seed-' + idn]))[0];
        if (!(await q(`select 1 from rewards_journal_lines where entry_id = $1`, [je.id])).length) await db.transaction().execute(async (trx) => {
          await sql`insert into rewards_journal_lines (entry_id, account, tenant_id, debit_cents, credit_cents) values (${je.id}::uuid, 'settlement_cash', null, 300, 0), (${je.id}::uuid, 'rewards_liability', null, 0, 300)`.execute(trx);
        });
        const tk = (await q(`insert into tickets (tenant_id, branch_id, customer_id, status, total_cents) values ($1,$2,$3,'payment_in_progress',2500) returning id`, [tenantId, cust.branch_id, cust.id]))[0].id;
        await db.transaction().execute(async (trx) => {
          const pay = (await sql`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status, idempotency_key) values (${tenantId}::uuid, ${cust.branch_id}::uuid, ${tk}::uuid, 'global_reward', 200, 0, 'approved', ${'reward:h-' + tk}) returning id`.execute(trx)).rows[0].id;
          await holdForTicket(trx, repo, { tenantId, branchId: cust.branch_id, userId: null }, { ticketId: tk, customerId: cust.id, blocks: 2, dueCents: 2500, paymentId: pay, idempotencyKey: 'h-' + tk });
        });
        await q(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status) values ($1,$2,$3,'cash',2300,0,'approved')`, [tenantId, cust.branch_id, tk]);
        await q(`update tickets set status = 'paid', paid_at = now() where id = $1`, [tk]);
        out.redeemed = await db.transaction().execute((trx) => finalizeForPaidTicket(trx, repo, { tenantId, ticketId: tk }));
        globalThis.__rnCustomerUser = String(usr.id);   // the customer session the Customer App harness signs in as
        out.customerUserId = String(usr.id);
      }
      if (sp.get('stepup')) { stepUpOn = sp.get('stepup') === 'on'; fresh = false; out.stepup = stepUpOn; }
      if (sp.get('state')) {
        out.wallet = (await q(`select available_cents, lifetime_funded_cents, status, alert_level from tenant_token_wallets where tenant_id = $1`, [tenantId]))[0] ?? null;
        out.ledger = await q(`select entry_type, delta_cents, balance_after_cents from token_wallet_ledger where tenant_id = $1 order by created_at desc, id desc limit 20`, [tenantId]);
        out.versions = await q(`select version_no, mode, status, effective_from, spend_increment_cents, point_tenths_per_increment from tenant_earning_policy_versions where tenant_id = $1 order by version_no`, [tenantId]);
        out.purchases = await q(`select id, status, token_cents, amount_cents, idempotency_key from token_purchase_intents where tenant_id = $1 order by created_at desc`, [tenantId]);
        out.journalUnbalanced = (await q(`select count(*)::int as n from (select entry_id from rewards_journal_lines group by entry_id having sum(debit_cents - credit_cents) <> 0) x`))[0].n;
        out.audit = await q(`select action, summary from audit_events where tenant_id = $1 and module = 'loyalty' order by created_at desc limit 12`, [tenantId]).catch(() => []);
      }
      return out;
    },
  };
}
