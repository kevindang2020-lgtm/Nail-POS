// money-protection-center.pgtest — the six AI Money Protection guides (Nov 3 2026; migration 778) on the REAL schema.
// DT = detection runs (recorded, all layers, failure recorded, manual rate limit) · SU = overview · AL = alerts list / detail / actions ·
// IN = investigation timeline · RU = rules + safe settings · HL = Check AI Money Protection System.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { MoneyProtectionCenter, MoneyCenterError, type McDeps } from './money-protection-center';
import { MoneyProtectionService } from './ai-money-protection.service';
import { KyselyMoneyProtectionRepository } from './ai-money-protection.kysely.repository';
import { InMemoryEntitlement } from './ai-money-protection-entitlement';
import { InvestigationService } from './ai-money-protection-investigations.service';
import { KyselyInvestigationRepository } from './ai-money-protection-investigations.kysely.repository';
import type { MoneyProtectionFlags } from './ai-money-protection-flags';

const id = (n: number) => `77780000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), B = id(2), B2 = id(3), X = id(4), BX = id(5), OWNER = id(10), CASHIER = id(11), TK = id(20), TK2 = id(21), C1 = id(30);
const ALL = ['ai_money_protection.view', 'ai_money_protection.view_alerts', 'ai_money_protection.investigate', 'ai_money_protection.manage_settings', 'ai_money_protection.manage_rules',
  'ai_money_protection.resolve', 'customers.view'];
const ctx = (o: any = {}) => ({ tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: ALL, ...o });
const FLAGS: MoneyProtectionFlags = { enabled: true, deterministicRules: true, baselines: true, reconciliation: true, aiSummaries: false, autoExactDuplicatePrevention: false };
let pg: any; let db: any; let mc: MoneyProtectionCenter; let svc: MoneyProtectionService; let failNext = false; let scheduled = false;
const q = async (text: string, params: unknown[] = []) => (await pg.query(text, params)).rows as any[];
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof MoneyCenterError ? e.code : (e as Error).message; } }

beforeAll(async () => {
  pg = await migratedPglite();
  db = kyselyFor(pg);
  svc = new MoneyProtectionService(new KyselyMoneyProtectionRepository(db), new InMemoryEntitlement(() => true), FLAGS);
  const deps: McDeps = {
    flags: () => FLAGS, entitlement: new InMemoryEntitlement((t) => t === T), scheduled: () => scheduled,
    detect: async (tenantId) => {
      if (failNext) { failNext = false; throw new Error('payments read failed'); }
      const sys = { tenantId, branchId: null, userId: 'system', role: 'SYSTEM', permissions: ['ai_money_protection.manage_rules'] } as any;
      const d = await svc.evaluateDeterministic(sys); const r = await svc.evaluateReconciliation(sys);
      return { evaluated: d.evaluated + r.evaluated, created: d.created + r.created, updated: d.updated + r.updated, layers: { d, r } };
    },
    saveRule: (c, ruleId, input) => svc.updateSetting(c as any, ruleId, input),
    previewRule: (c, ruleId, th) => svc.previewRule(c as any, ruleId, th),
  };
  mc = new MoneyProtectionCenter(db, deps);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'S','Pilot','mp-778','MP778','active'), ($2,'X','Other','mp-778x','MP778X','active')`, [T, X]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','UTC'), ($3,$2,'North','active','UTC'), ($4,$5,'Other','active','UTC')`, [B, T, B2, BX, X]);
  await q(`insert into users (id, tenant_id, full_name, email, status, role) values ($1,$3,'Owner Kim','o@mp.test','active','OWNER'), ($2,$3,'Cashier Lan','c@mp.test','active','FRONT_DESK')`, [OWNER, CASHIER, T]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone) values ($1,$2,$3,'Linh','Pham','Linh Pham','+18565550142')`, [C1, T, B]);
  await q(`set session_replication_role = replica`);
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents, tip_cents, ticket_number, created_at, updated_at)
    values ($1,$2,$3,$4,'paid',5000,0,0,5000,0,'T-1042', now(), now()), ($5,$2,$6,$4,'paid',3000,0,0,3000,0,'T-2001', now(), now())`, [TK, T, B, C1, TK2, B2]);
  // the same processor transaction captured twice → MP_DUP_CHARGE_EXACT (CRITICAL), by the cashier
  for (const p of [id(40), id(41)]) await q(`insert into payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, tax_cents, discount_cents, change_due_cents, status, processor_transaction_id, created_by_user_id, created_at, updated_at)
    values ($1,$2,$3,$4,'card',5000,0,0,0,0,'approved','ptx-1',$5, now(), now())`, [p, T, B, TK, CASHIER]);
  for (const p of [id(42), id(43)]) await q(`insert into payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, tax_cents, discount_cents, change_due_cents, status, processor_transaction_id, created_by_user_id, created_at, updated_at)
    values ($1,$2,$3,$4,'card',3000,0,0,0,0,'approved','ptx-2',$5, now(), now())`, [p, T, B2, TK2, CASHIER]);
  await q(`set session_replication_role = origin`);
  await q(`set timezone = 'UTC'`);
}, 180_000);

describe('Money Protection — detection is recorded', () => {
  it('SU-01 before any run: monitoring "never_checked" (never "no alerts"), zero cards; check: detection never ran = FAILED, not scheduled = WARNING', async () => {
    const s: any = await mc.summary(ctx());
    expect(s.monitoring).toBe('never_checked');
    expect(s.cards.openAlerts).toBe(0);
    const h: any = await mc.check(ctx());
    const k = Object.fromEntries(h.checks.map((c: any) => [c.key, c]));
    expect(k.detection_recent.state).toBe('FAILED');
    expect(k.detection_scheduled.state).toBe('WARNING');
    expect(h.overall).toBe('FAILED');
    await q(`delete from money_protection_health_runs where tenant_id = $1`, [T]);
  });
  it('DT-01 Run detection now: one recorded pass, raises the duplicate-charge alerts; a second press within 2 minutes reuses it', async () => {
    const r: any = await mc.runDetection(ctx(), 'manual');
    expect(r).toMatchObject({ status: 'succeeded', reused: false });
    expect(r.created).toBeGreaterThanOrEqual(2);
    expect((await mc.runDetection(ctx(), 'manual') as any).reused).toBe(true);
    const runs: any = await mc.detectionRuns(ctx(), {});
    expect(runs.items[0]).toMatchObject({ trigger: 'manual', status: 'succeeded', actor: 'Owner Kim' });
    expect(await code(mc.runDetection(ctx({ permissions: ['ai_money_protection.view'] }), 'manual'))).toBe('PERMISSION_DENIED');
  });
  it('DT-02 a failed pass is recorded as failed (never as "no alerts"); a scheduled pass needs no person', async () => {
    failNext = true;
    expect((await mc.runDetection(ctx(), 'scheduled') as any)).toMatchObject({ status: 'failed', errorCode: 'detection_failed' });
    expect((await mc.summary(ctx()) as any).monitoring).toBe('last_run_failed');
    expect(((await mc.alerts(ctx(), {})) as any).monitor.state).toBe('last_run_failed');   // the list says why it may be empty
    expect((await mc.runDetection(ctx(), 'scheduled') as any).status).toBe('succeeded');
    expect((await mc.summary(ctx()) as any).monitoring).toBe('current');
    const m = ((await mc.alerts(ctx(), {})) as any).monitor;
    expect(m.state).toBe('current'); expect(m.lastSuccessAt).not.toBeNull(); expect(typeof m.lastEvaluated).toBe('number');
  });
});

let A1: string, A2: string;
describe('Alerts', () => {
  it('AL-01 list: this branch (+ salon-wide) only; overview counts match', async () => {
    const l: any = await mc.alerts(ctx(), {});
    expect(l.items.length).toBeGreaterThanOrEqual(1);
    expect(l.items.every((a: any) => a.branch === 'Main' || a.branch === null)).toBe(true);
    A1 = l.items.find((a: any) => a.ruleId === 'MP_DUP_CHARGE_EXACT').id;
    const all: any = await mc.alerts(ctx({ branchId: null }), {});
    A2 = all.items.find((a: any) => a.branch === 'North').id;
    const s: any = await mc.summary(ctx());
    expect(s.cards.openAlerts).toBe(l.total);
    expect(s.cards.critical).toBeGreaterThanOrEqual(1);
    // extras (MP5 · 04): two open alerts on the SAME transaction count their money once in the de-duplicated figure
    const before = s.exposure;
    expect(before.sumCents).toBe(s.cards.valueUnderReviewCents);
    for (const [rule, amt] of [['MP_X_OVERLAP_A', 5000], ['MP_X_OVERLAP_B', 3000]] as const)
      await q(`insert into money_protection_alerts (tenant_id, branch_id, rule_id, alert_type, severity, status, amount_cents, entity_fingerprint, related) values ($1,$2,$3,'test','LOW','NEW',$4,$5,$6::jsonb)`,
        [T, B, rule, amt, 'fp-' + rule, JSON.stringify({ transactionIds: ['tx-overlap-1'] })]);
    const after: any = (await mc.summary(ctx())).exposure;
    expect(after.sumCents - before.sumCents).toBe(8000);
    expect(after.dedupedCents - before.dedupedCents).toBe(5000);
    expect(after.overlappingAlerts - before.overlappingAlerts).toBeGreaterThanOrEqual(2);
    expect(after.groups - before.groups).toBe(1);
    await q(`delete from money_protection_alerts where tenant_id = $1 and rule_id like 'MP_X_OVERLAP_%'`, [T]);
  });
  it('AL-02 search: rule name, hóa đơn number, staff name, customer name / phone (customers.view only), alert id', async () => {
    expect((await mc.alerts(ctx(), { q: 'Exact duplicate' }) as any).items.map((a: any) => a.id)).toContain(A1);
    expect((await mc.alerts(ctx(), { q: 'T-1042' }) as any).items.map((a: any) => a.id)).toContain(A1);
    expect((await mc.alerts(ctx(), { q: 'Cashier Lan' }) as any).items.map((a: any) => a.id)).toContain(A1);
    expect((await mc.alerts(ctx(), { q: 'Linh Pham' }) as any).items.map((a: any) => a.id)).toContain(A1);
    expect((await mc.alerts(ctx({ permissions: ALL.filter((p) => p !== 'customers.view') }), { q: 'Linh Pham' }) as any).total).toBe(0);
    expect((await mc.alerts(ctx(), { q: A1 }) as any).items.map((a: any) => a.id)).toEqual([A1]);
    expect((await mc.alerts(ctx(), { q: 'T-2001' }) as any).total).toBe(0);   // the other branch's hóa đơn
  });
  it('AL-03 filters, dates, sort, pages; From after To refused', async () => {
    expect((await mc.alerts(ctx(), { severity: 'CRITICAL', category: 'duplicate_charge' }) as any).items.every((a: any) => a.severity === 'CRITICAL')).toBe(true);
    expect((await mc.alerts(ctx(), { status: 'dismissed' }) as any).total).toBe(0);
    expect((await mc.alerts(ctx(), { preset: 'today' }) as any).total).toBeGreaterThanOrEqual(1);
    const today = (await mc.alerts(ctx(), {}) as any).period.today;
    expect(await code(mc.alerts(ctx(), { preset: 'custom', from: today, to: '2020-01-01' }))).toBe('MC_INVALID_PERIOD');
    expect((await mc.alerts(ctx(), { pageSize: 10, page: 9 }) as any).items).toEqual([]);
  });
  it('AL-04 detail: evidence, the source hóa đơn and payments it points at, the staff involved; another branch → not found', async () => {
    const d: any = await mc.alert(ctx(), A1);
    expect(d.rule).toMatchObject({ id: 'MP_DUP_CHARGE_EXACT', humanReview: true });
    expect(d.sources.tickets[0]).toMatchObject({ number: 'T-1042', customer: 'Linh Pham' });
    expect(d.sources.payments).toHaveLength(2);
    expect(d.sources.staff[0]).toMatchObject({ name: 'Cashier Lan' });
    expect(d.actions).toEqual(['acknowledge', 'dismiss']);
    // extras (MP5 · 03): evidence completeness per source kind
    expect(d.completeness.payments).toMatchObject({ expected: 2, verified: 2, missing: 0, stale: 0 });
    expect(d.completeness.tickets.verified).toBe(d.sources.tickets.length);
    const pid = d.sources.payments[0].id;
    await q(`update payments set updated_at = now() + interval '1 minute' where id = $1`, [pid]);   // changed after the alert last saw it
    expect(((await mc.alert(ctx(), A1)) as any).completeness.payments.stale).toBe(1);
    expect(await code(mc.alert(ctx(), A2))).toBe('MC_NOT_FOUND');
    expect(await code(mc.alert(ctx(), 'x'))).toBe('MC_NOT_FOUND');
  });
  it('AL-05 acknowledge → dismiss (reason) → reopen (reason): append-only history, audited; stale and own-activity refused', async () => {
    expect(await code(mc.alertAction(ctx(), A1, { action: 'dismiss', reason: 'no' }))).toBe('MC_REASON_REQUIRED');
    expect(await code(mc.alertAction(ctx(), A1, { action: 'acknowledge', expectedStatus: 'ACKNOWLEDGED' }))).toBe('MC_STALE');
    expect(await code(mc.alertAction(ctx({ userId: CASHIER }), A1, { action: 'acknowledge' }))).toBe('SEGREGATION_OF_DUTIES');
    expect(await mc.alertAction(ctx(), A1, { action: 'acknowledge', expectedStatus: 'NEW' })).toMatchObject({ status: 'ACKNOWLEDGED' });
    expect(await code(mc.alertAction(ctx(), A1, { action: 'acknowledge' }))).toBe('MC_STATE_INVALID');
    await mc.alertAction(ctx(), A1, { action: 'dismiss', reason: 'Processor webhook retried; one capture voided by Fiserv' });
    expect((await mc.alerts(ctx(), { status: 'dismissed' }) as any).items.map((a: any) => a.id)).toEqual([A1]);
    await mc.alertAction(ctx(), A1, { action: 'reopen', reason: 'Bank shows two settlements' });
    const d: any = await mc.alert(ctx(), A1);
    expect(d.history.map((h: any) => h.action)).toEqual(['reopen', 'dismiss', 'acknowledge']);
    expect(d.history[1]).toMatchObject({ reason: expect.stringContaining('webhook'), actor: 'Owner Kim', from: 'ACKNOWLEDGED', to: 'DISMISSED_FALSE_POSITIVE' });
    expect((await q(`select count(*)::int as n from audit_events where tenant_id = $1 and action like 'money_protection_alert.%'`, [T]))[0].n).toBe(3);
    expect((await q(`select count(*)::int as n from payments where tenant_id = $1`, [T]))[0].n).toBe(4);   // nothing moved
  });
});

describe('Investigations', () => {
  it('IN-01 open / assign / move are recorded with who; the timeline merges notes and decisions newest first; list search + pages', async () => {
    const inv = new InvestigationService(new KyselyInvestigationRepository(db), new KyselyMoneyProtectionRepository(db), (c, e) => mc.recordInvestigationEvent(c as any, e));
    const ictx = { tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: ALL } as any;
    const created = await inv.create(ictx, { title: 'Double card capture on T-1042', alertIds: [A1] });
    await inv.addNote(ictx, created.id, 'Called the processor');
    await inv.assign(ictx, created.id, OWNER);
    await inv.updateStatus(ictx, created.id, 'INVESTIGATING');
    const tl: any = await mc.investigationTimeline(ctx(), created.id);
    expect(tl.items.map((x: any) => x.kind === 'note' ? 'note' : x.action)).toEqual(['status_changed', 'assigned', 'note', 'opened']);
    expect(tl.alerts.map((a: any) => a.id)).toEqual([A1]);
    const l: any = await mc.investigations(ctx(), { q: 'T-1042' });
    expect(l.items[0]).toMatchObject({ id: created.id, status: 'INVESTIGATING', assignee: 'Owner Kim', notes: 1, alerts: 1 });
    expect((await mc.investigations(ctx(), { status: 'RESOLVED' }) as any).total).toBe(0);
    // reviewer workload: every active case in scope regardless of the list filter (assigned → not unassigned; fresh → not aging)
    const w0: any = (await mc.investigations(ctx(), { status: 'RESOLVED' }) as any).workload;
    expect(w0.open).toBeGreaterThanOrEqual(1);
    const unassigned = await inv.create(ictx, { title: 'Unassigned refund loop' });
    await db.updateTable('money_protection_investigations' as any).set({ created_at: new Date(Date.now() - 9 * 86400_000) } as any).where('id' as any, '=', unassigned.id).execute();
    const w1: any = (await mc.investigations(ctx(), {}) as any).workload;
    expect(w1.open).toBe(w0.open + 1);
    expect(w1.unassigned).toBe(w0.unassigned + 1);
    expect(w1.aging).toBe(w0.aging + 1);
  });
});

describe('Rules and safe settings', () => {
  it('RU-01 all 15 rules with the salon setting, counts and last alert', async () => {
    const r: any = await mc.rules(ctx());
    expect(r.rules).toHaveLength(15);
    expect(r.rules.find((x: any) => x.id === 'MP_DUP_CHARGE_EXACT')).toMatchObject({ enabled: true, effective: true, severity: 'CRITICAL' });
  });
  it('RU-02 turning a rule off needs a reason; the change keeps before → after; a stale edit is refused; the history pages', async () => {
    expect(await code(mc.saveRule(ctx(), 'MP_DUP_CHARGE_LIKELY', { enabled: false }))).toBe('MC_REASON_REQUIRED');
    const s: any = await mc.saveRule(ctx(), 'MP_DUP_CHARGE_LIKELY', { enabled: false, reason: 'Split tenders trigger it at this salon' });
    expect(s.before.enabled).toBe(true); expect(s.after.enabled).toBe(false);
    expect(await code(mc.saveRule(ctx(), 'MP_DUP_CHARGE_LIKELY', { enabled: true, expectedUpdatedAt: '2020-01-01T00:00:00.000Z' }))).toBe('MC_STALE');
    await mc.saveRule(ctx(), 'MP_DUP_CHARGE_LIKELY', { enabled: true, expectedUpdatedAt: s.updatedAt });   // turning back on needs no reason
    const h: any = await mc.settingsHistory(ctx(), {});
    expect(h.items.map((x: any) => x.after.enabled)).toEqual([true, false]);
    expect(h.items[1]).toMatchObject({ rule: 'Likely duplicate charge', reason: expect.stringContaining('Split'), weaker: true, actor: 'Owner Kim' });
    expect(await code(mc.saveRule(ctx({ permissions: ['ai_money_protection.view'] }), 'MP_DUP_CHARGE_LIKELY', { enabled: true }))).toBe('PERMISSION_DENIED');
    // per-rule freshness: a rule untouched since the recorded pass shows when it was checked; a rule changed after it is "not checked yet"
    const after: any = await mc.rules(ctx());
    expect(after.rules.find((x: any) => x.id === 'MP_DUP_CHARGE_EXACT').lastCheckedAt).toEqual(expect.any(String));
    expect(after.rules.find((x: any) => x.id === 'MP_DUP_CHARGE_LIKELY').lastCheckedAt).toBeNull();
  });
  it('RU-03 (MONEY PROTECTION ALERTS 11) false-positive insights: reviewed / dismissed / reopened per rule and the dismissal reasons that repeat — the rule stays on', async () => {
    // two more recorded dismissals of the same alert with the same wording (a repeated pattern), one with its own wording
    for (const reason of ['Webhook retry', '  webhook RETRY ', 'One-off terminal glitch']) await q(`insert into money_protection_events (tenant_id, branch_id, entity_type, entity_id, action, from_state, to_state, reason) values ($1,$2,'alert',$3,'dismiss','ACKNOWLEDGED','DISMISSED_FALSE_POSITIVE',$4)`, [T, B, A1, reason]);
    const r: any = await mc.rules(ctx());
    expect(r.falsePositivePolicy).toBe('insight_only_rules_never_auto_disabled');
    const fp = r.falsePositiveInsights.find((x: any) => x.ruleId === 'MP_DUP_CHARGE_EXACT');
    expect(fp).toMatchObject({ name: expect.any(String), reviewed90d: 1, dismissed90d: 1, reopened90d: 1, dismissRatePct: 100 });
    expect(fp.repeatedReasons).toEqual([{ reason: 'webhook retry', count: 2 }]);   // one-off wording is not a pattern
    expect(r.rules.find((x: any) => x.id === 'MP_DUP_CHARGE_EXACT')).toMatchObject({ enabled: true, effective: true });   // never self-disabled
    expect(((await mc.rules(ctx({ branchId: B2 }))) as any).falsePositiveInsights).toEqual([]);   // North's view: no decisions there
  });
});

describe('Check AI Money Protection System', () => {
  it('HL-01 after a recorded pass: detection current, payments arriving, card data absent; an unexplained dismissal and a stale critical alert are flagged; read-only', async () => {
    scheduled = true;
    await q(`insert into money_protection_alerts (tenant_id, branch_id, rule_id, alert_type, severity, status, entity_fingerprint, first_seen_at, last_seen_at) values
      ($1,$2,'MP_NEGATIVE_CAPTURE','negative_capture_amount','MEDIUM','DISMISSED_FALSE_POSITIVE','fp-x', now(), now()),
      ($1,$2,'MP_REFUND_EXCEEDS_CAPTURE','refund_exceeds_capture','HIGH','NEW','fp-y', now() - interval '3 days', now() - interval '3 days')`, [T, B]);
    const before = (await q(`select count(*)::int as n from money_protection_alerts where tenant_id = $1`, [T]))[0].n;
    const h: any = await mc.check(ctx());
    const k = Object.fromEntries(h.checks.map((c: any) => [c.key, c]));
    expect(k.detection_recent.state).toBe('PASSED');
    expect(k.detection_scheduled.state).toBe('PASSED');
    expect(k.payments_feed.state).toBe('PASSED');
    expect(k.no_card_data.state).toBe('PASSED');
    expect(k.dismissals_explained).toMatchObject({ state: 'WARNING', count: 1 });
    expect(k.urgent_reviewed).toMatchObject({ state: 'FAILED', count: 1 });
    expect(k.subscription.state).toBe('PASSED');
    expect(k.detection_recent.lastPassedAt).toBe(h.checkedAt);
    expect(h.overall).toBe('FAILED');
    expect((await q(`select count(*)::int as n from money_protection_alerts where tenant_id = $1`, [T]))[0].n).toBe(before);
    expect((await mc.check(ctx()) as any).reused).toBe(true);
  });
});

describe('Money Protection 5 · 07 — Safe Rule Preview (rules/save dryRun)', () => {
  it('RU-04 estimates current vs proposed matches on the salon\'s own history; saves nothing, records nothing, never activates', async () => {
    const TK3 = id(22);
    await q(`set session_replication_role = replica`);
    await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents, tip_cents, ticket_number, created_at, updated_at)
      values ($1,$2,$3,$4,'paid',1234,0,0,1234,0,'T-3001', now(), now())`, [TK3, T, B, C1]);
    // same hóa đơn, amount and method, 10 minutes apart: outside the default 120-second window, inside a 15-minute one
    await q(`insert into payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, tax_cents, discount_cents, change_due_cents, status, created_by_user_id, created_at, updated_at)
      values ($1,$3,$4,$5,'card',1234,0,0,0,0,'approved',$6, now() - interval '20 minutes', now()), ($2,$3,$4,$5,'card',1234,0,0,0,0,'approved',$6, now() - interval '10 minutes', now())`, [id(44), id(45), T, B, TK3, CASHIER]);
    await q(`set session_replication_role = origin`);
    const settingsBefore = await q(`select rule_id, enabled, thresholds, updated_at from money_protection_rule_settings where tenant_id = $1 order by rule_id`, [T]);
    const eventsBefore = (await q(`select count(*)::int as n from money_protection_events where tenant_id = $1`, [T]))[0].n;
    const alertsBefore = (await q(`select count(*)::int as n from money_protection_alerts where tenant_id = $1`, [T]))[0].n;
    const r: any = await mc.saveRule(ctx(), 'MP_DUP_CHARGE_LIKELY', { thresholds: { windowSeconds: 900 }, dryRun: true });
    expect(r).toMatchObject({ dryRun: true, saved: false, ruleId: 'MP_DUP_CHARGE_LIKELY', currentThresholds: { windowSeconds: 120 }, proposedThresholds: { windowSeconds: 900 } });
    expect(r.preview).toMatchObject({ thresholdsUsed: true, current: 0, proposed: 1, added: 1, removed: 0, amountCentsProposed: 1234, windowDays: 30 });
    expect(r.preview.paymentsEvaluated).toBeGreaterThanOrEqual(6);
    expect(await q(`select rule_id, enabled, thresholds, updated_at from money_protection_rule_settings where tenant_id = $1 order by rule_id`, [T])).toEqual(settingsBefore);
    expect((await q(`select count(*)::int as n from money_protection_events where tenant_id = $1`, [T]))[0].n).toBe(eventsBefore);
    expect((await q(`select count(*)::int as n from money_protection_alerts where tenant_id = $1`, [T]))[0].n).toBe(alertsBefore);
    // refusals: a threshold the rule does not use, an out-of-bounds value (the save's own bounds), a viewer without manage_settings
    expect(await code(mc.saveRule(ctx(), 'MP_DUP_CHARGE_LIKELY', { thresholds: { minDeclines: 3 }, dryRun: true }))).toBe('VALIDATION_FAILED');
    expect(await code(mc.saveRule(ctx(), 'MP_DUP_CHARGE_LIKELY', { thresholds: { windowSeconds: 5 }, dryRun: true }))).toBe('VALIDATION_FAILED');
    expect(await code(mc.saveRule(ctx({ permissions: ['ai_money_protection.view'] }), 'MP_DUP_CHARGE_LIKELY', { thresholds: { windowSeconds: 900 }, dryRun: true }))).toBe('PERMISSION_DENIED');
  });
});
