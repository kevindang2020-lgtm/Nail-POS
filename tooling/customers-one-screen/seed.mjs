// seed.mjs — Customers one-screen harness (Loyalty & Rewards · Membership Overview · Customer Retention, Oct 29 2026).
// Seeds a TEST salon into a fresh database through the same writers the product uses where they exist (loyalty points via
// applyLoyaltyEntry sourced to the visit, redemptions / voids via LoyaltyProgramRepository, a past win-back campaign via
// RetentionSmsService + the worker with a recording messenger). Tooling only — never run against production. Names are
// invented test customers; phone numbers are 555-01xx test numbers.
//   PILOT  "Pilot Nail Salon (test)"  ~260 customers, 3 membership plans, loyalty members, rewards, redemptions, visits
//   EMPTY  "New Salon (test)"          a salon on its first day (empty states)
import { applyLoyaltyEntry } from '../../modules/customers/src/loyalty/loyalty-ledger.service.ts';
import { LoyaltyProgramRepository } from '../../modules/customers/src/loyalty/loyalty-program.repository.ts';
import { RetentionRepository } from '../../modules/customers/src/retention/retention.repository.ts';
import { RetentionSmsService, RETENTION_SMS_JOB } from '../../modules/customers/src/retention/retention-sms.service.ts';
import { runRetentionSmsJob } from '../../modules/customers/src/retention/retention-sms.worker.ts';

const hex = (n, w = 12) => n.toString(16).padStart(w, '0');
export const id = (kind, n) => `${kind}-0000-4000-8000-${hex(n)}`;   // kind: 8 hex chars
export const PILOT = id('c0510000', 1), EMPTY = id('c0510000', 2);
export const BRANCH = id('b0510000', 1), BRANCH2 = id('b0510000', 2), BRANCH3 = id('b0510000', 3);
/** a branch id no branch row has (an old / deleted branch): its tickets are "Unknown branch" (CR-02) */
export const GHOST_BRANCH = id('b0510000', 9);
export const OWNER_USER = id('a0510000', 1);
const FIRST = ['Linh', 'Mai', 'Thao', 'Hoa', 'Lan', 'Ngoc', 'Trang', 'Huong', 'Anh', 'Vy', 'Emily', 'Sarah', 'Jessica', 'Ashley', 'Olivia', 'Grace', 'Chloe', 'Nora', 'Ivy', 'Rosa', 'Diana', 'Kim', 'Quinn', 'Fiona', 'Bao'];
const LAST = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Võ', 'Đặng', 'Bùi', 'Smith', 'Johnson', 'Garcia', 'Martinez', 'Brown', 'Davis', 'Wilson'];
let seedN = 42; const rnd = () => { seedN = (seedN * 1103515245 + 12345) & 0x7fffffff; return seedN / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

export async function seed(pg, db) {
  const q = (s, p = []) => pg.query(s, p);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Pilot Nail Salon LLC','Pilot Nail Salon','pilot-test','PIL001','active'), ($2,'New Salon LLC','New Salon','new-test','NEW001','active')`, [PILOT, EMPTY]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Cherry Hill','active','America/New_York'), ($3,$4,'Main','active','America/New_York')`, [BRANCH, PILOT, BRANCH2, EMPTY]);
  // Four-Module Completion Guide CR-02: a second Pilot branch (every 4th visit happens there)
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Voorhees','active','America/New_York')`, [BRANCH3, PILOT]);
  const cat = id('d0510000', 1);
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails')`, [cat, PILOT, BRANCH]);
  const SVC = [['Gel Manicure', 4500], ['Spa Pedicure', 5500], ['Acrylic Full Set', 6500], ['Dip Powder', 5000], ['Deluxe Pedicure', 7500]];
  for (let i = 0; i < SVC.length; i++) await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$2,$3,$4,$5,45,$6)`, [id('d0520000', i + 1), PILOT, BRANCH, cat, SVC[i][0], SVC[i][1]]);

  // ── customers + visits (settled tickets) ────────────────────────────────────────────────────────────────────────────
  const N = 260; const customers = [];
  for (let i = 1; i <= N; i++) {
    const cid = id('e0510000', i); const f = pick(FIRST), l = pick(LAST);
    const phoneKind = rnd(); const phone = phoneKind < 0.06 ? null : phoneKind < 0.09 ? '555-01' : `+1215555${String(1000 + i).slice(-4)}`;
    const consent = rnd() < 0.62; const ageDays = Math.floor(30 + rnd() * 700);
    await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display, marketing_sms_opt_in, created_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now() - make_interval(days => $10))`, [cid, PILOT, BRANCH, f, l, `${f} ${l}`, phone, phone, consent, ageDays]);
    customers.push({ cid, name: `${f} ${l}`, phone, consent });
  }
  await q(`insert into notification_opt_outs (tenant_id, channel, address) select $1, 'sms', normalized_phone from customers where tenant_id = $1 and normalized_phone like '+1215555%' and right(normalized_phone, 1) = '7'`, [PILOT]);
  const tickets = []; let tn = 0;
  for (let i = 0; i < customers.length; i++) {
    if (i % 7 === 3) continue;   // ~1 in 7 never visited (never "at risk")
    const visits = 1 + Math.floor(rnd() * 9); const lastAgo = Math.floor(rnd() * 480);
    for (let v = 0; v < visits; v++) {
      const ago = lastAgo + v * Math.floor(20 + rnd() * 40); const cents = pick(SVC)[1] + Math.floor(rnd() * 3) * 1000;
      const tid = id('f0510000', ++tn);
      await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, total_cents, created_at) values ($1,$2,$3,$4,'closed',$5, now() - make_interval(days => $6) - interval '2 hours')`, [tid, PILOT, tn % 4 === 0 ? BRANCH3 : BRANCH, customers[i].cid, cents, ago]);
      tickets.push({ tid, i, cents, ago });
    }
  }
  // CR-02: two settled visits recorded under a branch id the salon no longer has → "Unknown branch", never allocated
  for (const k of [0, 1]) await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, total_cents, created_at) values ($1,$2,$3,$4,'closed',4000, now() - make_interval(days => $5))`, [id('f0530000', k + 1), PILOT, GHOST_BRANCH, customers[k].cid, 200 + k]);
  // a few refunds (Lapsed Value is net of them) and a canceled ticket that is NOT a visit
  for (const t of tickets.filter((x) => x.ago > 90).slice(0, 6)) {
    const pid = id('f0520000', ++tn);
    await q(`insert into payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, status) values ($1,$2,$3,$4,'card',$5,'succeeded')`, [pid, PILOT, BRANCH, t.tid, t.cents]);
    await q(`insert into payment_refunds (tenant_id, branch_id, payment_id, amount_cents, status, reason) values ($1,$2,$3,$4,'refunded','harness')`, [PILOT, BRANCH, pid, 1500]);
  }

  // ── loyalty: members, points earned from visits through the ledger, rewards, redemptions ────────────────────────────
  const TIERS = ['Regular', 'Regular', 'Regular', 'Silver', 'Silver', 'Gold', 'Platinum'];
  const members = customers.filter((_, i) => i % 3 !== 2).slice(0, 88);
  for (let k = 0; k < members.length; k++) {
    await q(`insert into customer_loyalty_profiles (tenant_id, branch_id, customer_id, loyalty_tier, points_balance, total_earned_points, total_redeemed_points, created_at)
      values ($1,$2,$3,$4,0,0,0, now() - make_interval(days => $5))`, [PILOT, BRANCH, members[k].cid, pick(TIERS), Math.floor((members.length - k) * 4 + rnd() * 3)]);
  }
  const memberIdx = new Set(members.map((m) => m.cid));
  for (const t of tickets) {
    const c = customers[t.i]; if (!memberIdx.has(c.cid)) continue;
    await db.transaction().execute((trx) => applyLoyaltyEntry(trx, { tenantId: PILOT, branchId: BRANCH, customerId: c.cid, entryType: 'earn', delta: Math.round(t.cents / 100), reason: 'Visit', sourceTable: 'tickets', sourceId: t.tid, legacyType: 'earn', legacySource: 'pos' }));
  }
  const REWARDS = [['$5 off any service', 200, 'amount_off', 500], ['Free nail art (2 nails)', 150, 'amount_off', 1000], ['10% off', 300, 'percent_off', 10], ['$10 off pedicure', 400, 'amount_off', 1000],
    ['Free paraffin add-on', 250, 'amount_off', 800], ['15% off full set', 600, 'percent_off', 15], ['$20 off', 800, 'amount_off', 2000], ['Free gel polish change', 350, 'amount_off', 1500],
    ['Birthday treat', 100, 'amount_off', 500], ['$25 off', 1000, 'amount_off', 2500], ['Free hand massage', 120, 'amount_off', 600], ['20% off any service', 900, 'percent_off', 20]];
  const rewardIds = [];
  for (let r = 0; r < REWARDS.length; r++) {
    const rid = id('a0520000', r + 1); rewardIds.push(rid); const [t, cost, type, v] = REWARDS[r];
    await q(`insert into loyalty_rewards (id, tenant_id, title, description, points_cost, active, reward_type, value_cents, percent, valid_days, created_at)
      values ($1,$2,$3,'',$4,$5,$6,$7,$8,$9, now() - make_interval(days => $10))`, [rid, PILOT, t, cost, r % 5 !== 4, type, type === 'amount_off' ? v : 0, type === 'percent_off' ? v : 0, r % 3 === 0 ? 30 : null, (REWARDS.length - r) * 9]);
  }
  const lrepo = new LoyaltyProgramRepository(db);
  const ctx = { tenantId: PILOT, branchId: BRANCH, userId: OWNER_USER, role: 'OWNER', permissions: [] };
  let rn = 0;
  for (const m of members) {
    const bal = Number((await q(`select points_balance from customer_loyalty_profiles where tenant_id = $1 and customer_id = $2`, [PILOT, m.cid])).rows[0].points_balance);
    const reward = REWARDS.map((r, i) => ({ r, i })).find((x) => x.r[1] <= bal && x.i % 5 !== 4 && rnd() < 0.5);
    if (!reward || rn >= 26) continue;
    const key = id('a0530000', ++rn);
    await lrepo.redeem(ctx, { customerId: m.cid, rewardId: rewardIds[reward.i], idempotencyKey: key });
    if (rn % 6 === 0) await lrepo.voidRedemption(ctx, key, 'Guest changed her mind');
    else if (rn % 3 === 0) await q(`update loyalty_redemptions set status = 'used', used_at = now(), applied_at = now() where tenant_id = $1 and id = $2`, [PILOT, key]);   // settled at checkout (harness)
  }

  // ── memberships ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const PLANS = [['VIP Nail Club', 0, true, 'Custom pricing for the salon\'s VIP guests'], ['Basic Glow', 3900, false, 'One gel manicure a month'], ['Pedi Club', 5900, false, 'One spa pedicure a month + 10% off add-ons']];
  const planIds = [], verIds = [];
  for (let p = 0; p < PLANS.length; p++) {
    const pid = id('a0540000', p + 1), vid = id('a0550000', p + 1); planIds.push(pid); verIds.push(vid);
    await q(`insert into membership_plans (id, tenant_id, name, description, status, is_popular, created_at) values ($1,$2,$3,$4,'active',$5, now() - make_interval(days => $6))`, [pid, PILOT, PLANS[p][0], PLANS[p][3], p === 2, (3 - p) * 60]);
    await q(`insert into membership_plan_versions (id, plan_id, tenant_id, version_number, billing_interval, price_cents, is_custom_pricing) values ($1,$2,$3,1,'month',$4,$5)`, [vid, pid, PILOT, PLANS[p][1], PLANS[p][2]]);
    await q(`update membership_plans set current_version_id = $1 where id = $2`, [vid, pid]);
  }
  await q(`insert into membership_benefits (plan_version_id, tenant_id, benefit_type, label, percent) values ($1,$2,'percent_discount','Member discount on services',15)`, [verIds[0], PILOT]);
  await q(`insert into membership_benefits (plan_version_id, tenant_id, benefit_type, label, service_id, credits_per_cycle, value_cents, max_per_cycle) values ($1,$2,'service_credit','Monthly gel manicure',$3,1,4500,1)`, [verIds[1], PILOT, id('d0520000', 1)]);
  await q(`insert into membership_benefits (plan_version_id, tenant_id, benefit_type, label, service_id, credits_per_cycle, value_cents, max_per_cycle) values ($1,$2,'service_credit','Monthly spa pedicure',$3,1,5500,1)`, [verIds[2], PILOT, id('d0520000', 2)]);
  await q(`insert into membership_benefits (plan_version_id, tenant_id, benefit_type, label, percent) values ($1,$2,'percent_discount','10% off add-ons',10)`, [verIds[2], PILOT]);
  const ST = ['active', 'active', 'active', 'active', 'active', 'active', 'paused', 'past_due', 'trial', 'canceled', 'expired'];
  let mn = 0, payN = 0, actN = 0;
  for (let k = 0; k < 64; k++) {
    const c = customers[(k * 3 + 1) % customers.length]; const p = k % 3; const status = ST[k % ST.length];
    const mid = id('a0560000', ++mn); const started = 5 + Math.floor(rnd() * 300);
    const termEnd = k % 9 === 0 ? `now() + make_interval(days => ${1 + (k % 6)})` : 'null';
    await q(`insert into customer_memberships (id, tenant_id, branch_id, customer_id, plan_id, plan_version_id, status, started_at, next_billing_at, term_end_at, canceled_at, member_number, auto_renew)
      values ($1,$2,$3,$4,$5,$6,$7, now() - make_interval(days => $8), now() + make_interval(days => $9), ${termEnd}, ${status === 'canceled' ? "now() - make_interval(days => " + (k % 20) + ")" : 'null'}, $10, true)`,
      [mid, PILOT, BRANCH, c.cid, planIds[p], verIds[p], status, started, 1 + (k % 28), 'M' + String(1000 + k)]);
    if (PLANS[p][1] > 0 && status !== 'trial') for (let m2 = 0; m2 < 2; m2++) {
      const at = m2 === 0 ? `now() - make_interval(days => ${k % 25}, hours => 3)` : `date_trunc('month', now()) - make_interval(days => ${3 + (k % 20)})`;
      const pst = k % 13 === 0 && m2 === 0 ? 'failed' : 'succeeded'; const pidd = id('a0570000', ++payN);
      await q(`insert into membership_payments (id, tenant_id, branch_id, customer_membership_id, customer_id, kind, amount_cents, status, idempotency_key, created_at, settled_at) values ($1::uuid,$2,$3,$4,$5,'renewal',$6,$7,$1::text, ${at}, ${pst === 'succeeded' ? at : 'null'})`, [pidd, PILOT, BRANCH, mid, c.cid, PLANS[p][1], pst]);
    }
    const ev = status === 'canceled' ? 'canceled' : status === 'paused' ? 'paused' : status === 'past_due' ? 'payment_failed' : k % 2 ? 'renewed' : 'purchased';
    await q(`insert into membership_activity (id, tenant_id, branch_id, customer_membership_id, customer_id, plan_id, activity_type, customer_name_snapshot, plan_name_snapshot, amount_cents, occurred_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now() - make_interval(hours => $11))`, [id('a0580000', ++actN), PILOT, BRANCH, mid, c.cid, planIds[p], ev, c.name, PLANS[p][0], ev === 'renewed' || ev === 'purchased' ? PLANS[p][1] || null : null, k * 7 + 1]);
    if (p > 0 && status === 'active' && k % 2 === 0) {
      await q(`insert into membership_redemptions (tenant_id, branch_id, customer_membership_id, ticket_id, service_id, standard_value_cents, allocated_value_cents, created_at) values ($1,$2,$3,$4,$5,$6,$6, now() - make_interval(days => $7))`,
        [PILOT, BRANCH, mid, tickets[k % tickets.length].tid, id('d0520000', p), p === 1 ? 4500 : 5500, k % 20]);
      await q(`insert into membership_activity (id, tenant_id, branch_id, customer_membership_id, customer_id, plan_id, activity_type, customer_name_snapshot, plan_name_snapshot, occurred_at) values ($1,$2,$3,$4,$5,$6,'benefit_redeemed',$7,$8, now() - make_interval(days => $9))`,
        [id('a0580000', ++actN), PILOT, BRANCH, mid, c.cid, planIds[p], c.name, PLANS[p][0], k % 20]);
    }
  }

  // ── one past win-back campaign (sent through the recording messenger: simulated, never a real text) ─────────────────
  const rrepo = new RetentionRepository(db); const svc = new RetentionSmsService(db, rrepo, null);
  const rctx = { ...ctx, salonName: 'Pilot Nail Salon' };
  const atRisk = await rrepo.customers(rctx, { segment: 'contactable', page: 1, pageSize: 6 });
  if (atRisk.items.length) {
    const p = await svc.preview(rctx, { customerIds: atRisk.items.map((r) => r.customerId), body: 'We miss you! Book your next visit this month and enjoy a free hand massage.', label: 'September win-back' });
    const c = await svc.confirm(rctx, { previewId: p.previewId, idempotencyKey: id('a0590000', 1), label: 'September win-back' });
    const jobs = (await q(`select payload from jobs where job_type = $1 and tenant_id = $2 and payload->>'campaignId' = $3`, [RETENTION_SMS_JOB, PILOT, c.campaignId])).rows;
    let n = 0; const messenger = { sendSms: async () => ({ sent: true, status: 'sent', providerId: 'SMharness' + String(++n).padStart(24, '0'), simulated: true }) };
    for (const j of jobs) await runRetentionSmsJob(db, messenger, j.payload);
    await q(`update notifications set status = 'delivered' where tenant_id = $1 and provider_id like 'SMharness%' and right(provider_id, 1) in ('1','2','3')`, [PILOT]).catch(() => undefined);
    await q(`update retention_sms_campaigns set created_at = now() - interval '35 days', confirmed_at = now() - interval '35 days' where id = $1`, [c.campaignId]);
    await q(`update retention_sms_recipients set created_at = now() - interval '35 days' where campaign_id = $1`, [c.campaignId]);
    await q(`update jobs set status = 'succeeded' where job_type = $1 and tenant_id = $2`, [RETENTION_SMS_JOB, PILOT]);
  }
  await q('analyze');   // planner statistics, as autovacuum keeps them in a running database
  return { customers: customers.length, tickets: tickets.length, members: members.length, redemptions: rn, memberships: mn };
}
