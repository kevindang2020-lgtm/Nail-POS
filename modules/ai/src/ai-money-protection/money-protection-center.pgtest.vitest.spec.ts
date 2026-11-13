// money-protection-center.pgtest — the six AI Money Protection guides (Nov 3 2026; migration 778) on the REAL schema.
// DT = detection runs (recorded, all layers, failure recorded, manual rate limit) · SU = overview · AL = alerts list / detail / actions ·
// IN = investigation timeline · RU = rules + safe settings · HL = Check AI Money Protection System.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { MoneyProtectionCenter, MoneyCenterError, MC_NOTIFY, type McDeps } from './money-protection-center';
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
    previewRule: (c, ruleId, th) => svc.previewThresholds(c as any, ruleId, th),
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
    // the oldest line is the detection pass telling the owner about this CRITICAL alert (MP5 · 11 — no person, no reason)
    expect(d.history.map((h: any) => h.action)).toEqual(['reopen', 'dismiss', 'acknowledge', 'notified']);
    expect(d.history[1]).toMatchObject({ reason: expect.stringContaining('webhook'), actor: 'Owner Kim', from: 'ACKNOWLEDGED', to: 'DISMISSED_FALSE_POSITIVE' });
    expect((await q(`select count(*)::int as n from audit_events where tenant_id = $1 and action like 'money_protection_alert.%'`, [T]))[0].n).toBe(3);
    expect((await q(`select count(*)::int as n from payments where tenant_id = $1`, [T]))[0].n).toBe(4);   // nothing moved
  });
  it('AL-06 batch triage (MONEY PROTECTION ALERTS 13): preview says per alert what would happen and writes nothing; confirm runs the single-alert action per alert', async () => {
    const all = ctx({ branchId: null });
    const audits = async () => (await q(`select count(*)::int as n from audit_events where tenant_id = $1 and action like 'money_protection_alert.%'`, [T]))[0].n;
    const a0 = await audits();
    const p: any = await mc.alertBatch(all, { action: 'acknowledge', ids: [A1, A2, id(999), 'not-a-uuid'] });
    expect(p).toMatchObject({ preview: true, movesMoney: false, counts: { ready: 1, notFound: 1, stateInvalid: 1, ownActivity: 0 } });
    expect(p.items.find((i: any) => i.id === A2)).toMatchObject({ outcome: 'ready', status: 'NEW', to: 'ACKNOWLEDGED' });
    expect(p.items.find((i: any) => i.id === A1)).toMatchObject({ outcome: 'state_invalid', status: 'ACKNOWLEDGED', to: null });
    expect((await mc.alertBatch(ctx(), { action: 'acknowledge', ids: [A2] }) as any).counts.notFound).toBe(1);            // another branch: not seen
    expect((await mc.alertBatch(ctx({ userId: CASHIER, branchId: null }), { action: 'dismiss', ids: [A1] }) as any).items[0].outcome).toBe('own_activity');
    expect(await audits()).toBe(a0);                                                                                      // a preview writes nothing
    expect(await code(mc.alertBatch(all, { action: 'dismiss', ids: [A2], confirm: true, reason: 'no' }))).toBe('MC_REASON_REQUIRED');
    expect(await code(mc.alertBatch(all, { action: 'acknowledge', ids: [] }))).toBe('VALIDATION_FAILED');
    expect(await code(mc.alertBatch(ctx({ permissions: ['ai_money_protection.view_alerts'] }), { action: 'acknowledge', ids: [A2] }))).toBe('PERMISSION_DENIED');
    const r: any = await mc.alertBatch(all, { action: 'acknowledge', ids: [A1, A2], confirm: true });
    expect(r).toMatchObject({ preview: false, applied: 1, refused: 1 });
    expect(r.results.find((x: any) => x.id === A2)).toMatchObject({ outcome: 'applied', status: 'ACKNOWLEDGED' });
    expect(r.results.find((x: any) => x.id === A1)).toMatchObject({ outcome: 'refused', code: 'state_invalid' });
    expect(await audits()).toBe(a0 + 1);
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
  it('RU-09 (Money Protection Rules 09) Threshold Change Preview: rules/save with dryRun compares the detections on the real schema and writes nothing', async () => {
    const before = await q(`select (select count(*)::int from money_protection_rule_settings where tenant_id = $1 and rule_id = 'MP_FAILED_PAYMENT_RETRY_LOOP') s,
      (select count(*)::int from money_protection_events where tenant_id = $1) e, (select count(*)::int from money_protection_alerts where tenant_id = $1) a, (select count(*)::int from audit_logs where tenant_id = $1) l`, [T]);
    const p: any = await mc.saveRule(ctx(), 'MP_FAILED_PAYMENT_RETRY_LOOP', { thresholds: { minDeclines: 6 }, dryRun: true });
    expect(p).toMatchObject({ ruleId: 'MP_FAILED_PAYMENT_RETRY_LOOP', dryRun: true, supported: true, windowDays: 30, proposedThresholds: { minDeclines: 6 } });
    expect(p.currentCount - p.stops + p.starts).toBe(p.proposedCount);
    expect(await mc.saveRule(ctx(), 'MP_MULTIPLE_REVERSALS', { thresholds: { minReversals: 3 }, dryRun: true })).toMatchObject({ supported: false, reason: 'threshold_not_read_by_detector' });
    expect(await code(mc.saveRule(ctx(), 'MP_FAILED_PAYMENT_RETRY_LOOP', { thresholds: { minDeclines: 999 }, dryRun: true }))).toBe('MC_INVALID_THRESHOLD');
    expect(await code(mc.saveRule(ctx({ permissions: ['ai_money_protection.view'] }), 'MP_FAILED_PAYMENT_RETRY_LOOP', { thresholds: { minDeclines: 6 }, dryRun: true }))).toBe('PERMISSION_DENIED');
    const after = await q(`select (select count(*)::int from money_protection_rule_settings where tenant_id = $1 and rule_id = 'MP_FAILED_PAYMENT_RETRY_LOOP') s,
      (select count(*)::int from money_protection_events where tenant_id = $1) e, (select count(*)::int from money_protection_alerts where tenant_id = $1) a, (select count(*)::int from audit_logs where tenant_id = $1) l`, [T]);
    expect(after).toEqual(before);
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
  it('RU-07 (Money Protection Rules 07) Safer Batch Readiness: per ledger read state, 30-day records, rules on, layer and schedule; an unreadable ledger or a layer off warns', async () => {
    await q(`set session_replication_role = replica`);
    await q(`insert into gift_cards (id, tenant_id, code, initial_balance_cents, balance_cents) values ($1,$2,'GC-RU7',5000,4000)`, [id(60), T]);
    await q(`insert into gift_card_transactions (tenant_id, gift_card_id, type, amount_cents, balance_after_cents) values ($1,$2,'issue',5000,5000), ($1,$2,'redeem',1000,4000)`, [T, id(60)]);
    await q(`insert into gift_card_transactions (tenant_id, gift_card_id, type, amount_cents, balance_after_cents) values ($1,$2,'issue',100,100)`, [X, id(60)]);   // another salon: not counted
    await q(`set session_replication_role = origin`);
    const r: any = (await mc.rules(ctx())).batchReadiness;
    const by = Object.fromEntries(r.sources.map((s: any) => [s.source, s]));
    expect(by.gift_cards).toMatchObject({ state: 'ready', records30d: 2, rulesOn: 2, layerOn: true, warning: false, lastRecordAt: expect.any(String) });
    expect(by.membership).toMatchObject({ state: 'no_recent_records', records30d: 0, warning: false, lastRecordAt: null });   // said, never warned
    expect(by.cash_close.rules).toEqual(['MP_CASH_DRAWER_VARIANCE']);
    expect(r.scheduled).toBe(false);
    expect(r.warnings).toBe(1);                                   // only the missing schedule
    expect(r.lastReconciliationAt).toEqual(expect.any(String));   // the recorded pass from DT-01
    // the reconciliation layer switched off → every ledger warns "layer_off"
    FLAGS.reconciliation = false;
    try {
      const off: any = (await mc.rules(ctx())).batchReadiness;
      expect(off.sources.map((s: any) => s.state)).toEqual(['layer_off', 'layer_off', 'layer_off']);
      expect(off.warnings).toBe(4);
    } finally { FLAGS.reconciliation = true; }
    // a ledger that cannot be read is "ledger_unavailable" (never 0 records) and the system check FAILS that line
    await q(`alter table cash_drawer_sessions rename to cash_drawer_sessions_ru7`);
    try {
      const un: any = (await mc.rules(ctx())).batchReadiness;
      expect(un.sources.find((s: any) => s.source === 'cash_close')).toMatchObject({ state: 'ledger_unavailable', records30d: null, warning: true, errorCode: 'ledger_read_failed' });
      const h: any = await mc.check(ctx());
      expect(h.checks.find((c: any) => c.key === 'batch_readiness')).toMatchObject({ state: 'FAILED', detail: { unreadable: ['cash_close'] } });
    } finally {
      await q(`alter table cash_drawer_sessions_ru7 rename to cash_drawer_sessions`);
      await q(`delete from money_protection_health_runs where tenant_id = $1`, [T]);
    }
  });
});

describe('Controlled export (MONEY PROTECTION ALERTS 14 · AI MONEY PROTECTION 5 · 15 · Money Protection Rules 15)', () => {
  const EXP = [...ALL, 'ai_money_protection.export'];
  const lines = (csv: string) => csv.split('\r\n');
  const kv = (csv: string) => Object.fromEntries(lines(csv.split('\r\n\r\n')[0]).map((l) => { const i = l.indexOf(','); return [l.slice(0, i), l.slice(i + 1)]; }));
  const exports = async () => (await q(`select count(*)::int as n from audit_events where tenant_id = $1 and action = 'money_protection.exported'`, [T]))[0].n;
  it('EX-01 needs the export permission (and view_alerts for alerts); refused before anything is read or audited', async () => {
    const a0 = await exports();
    expect(await code(mc.exportCsv(ctx(), {}))).toBe('PERMISSION_DENIED');
    expect(await code(mc.exportCsv(ctx({ permissions: ['ai_money_protection.view', 'ai_money_protection.export'] }), { view: 'alerts' }))).toBe('PERMISSION_DENIED');
    expect(await exports()).toBe(a0);
    // the screen shows Export only to those who may use it
    expect((await mc.alerts(ctx(), {}) as any).canExport).toBe(false); expect((await mc.alerts(ctx({ permissions: EXP }), {}) as any).canExport).toBe(true);
    expect((await mc.rules(ctx()) as any).canExport).toBe(false);
  });
  it('EX-02 alerts: provenance block (salon, location scope, who / when, period + basis + zone, filters, detection freshness, definitions, redaction, rows) then exactly the filtered list; sanitized; audited', async () => {
    const a0 = await exports();
    const f = { status: 'all', severity: 'all' };
    const list: any = await mc.alerts(ctx(), f);
    const csv = await mc.exportCsv(ctx({ permissions: EXP }), f);
    const h = kv(csv);
    expect(h).toMatchObject({ Export: 'AI Money Protection — alerts', Salon: 'Pilot', 'Location scope': 'Main', 'Generated by': 'Owner Kim', Period: 'All dates', 'Date basis': 'detected', 'Time zone': 'UTC', Filters: 'status=all', Rows: String(list.total) });
    expect(h['Detection freshness']).toMatch(/^current; last successful detection \d{4}-/);
    expect(h.Redaction).toContain('customer names');
    expect(h.Definitions).toContain('never a confirmed loss');
    const table = csv.split('\r\n\r\n')[1].trim().split('\r\n');
    expect(table[0]).toContain('Alert ID,Detected');
    expect(table.length - 1).toBe(list.total);
    expect(list.total).toBeGreaterThan(0);
    // branch scope: only Main's alerts (T-1042), never North's hóa đơn T-2001; no customer name / phone / payment reference
    expect(csv).toContain('T-1042'); expect(csv).not.toContain('T-2001');
    expect(csv).not.toContain('Linh Pham'); expect(csv).not.toContain('5550142'); expect(csv).not.toContain('ptx-1'); expect(csv).not.toContain(id(40));
    expect(await exports()).toBe(a0 + 1);
    const au = (await q(`select metadata, resource_id, branch_id from audit_events where tenant_id = $1 and action = 'money_protection.exported' order by occurred_at desc limit 1`, [T]))[0];
    expect(au).toMatchObject({ resource_id: 'alerts', branch_id: B }); expect(au.metadata).toMatchObject({ view: 'alerts', rows: list.total });
  });
  it('EX-03 a filter is written into the file; a search text is never written (it may be a customer name or phone) but still narrows the rows', async () => {
    const csv = await mc.exportCsv(ctx({ permissions: EXP }), { status: 'all', severity: 'CRITICAL', q: 'Linh Pham' });
    const h = kv(csv);
    expect(h.Filters).toBe('status=all; severity=CRITICAL; search=given (not written)');
    expect(csv).not.toContain('Linh');
    const list: any = await mc.alerts(ctx(), { status: 'all', severity: 'CRITICAL', q: 'Linh Pham' });
    expect(h.Rows).toBe(String(list.total));
  });
  it('EX-04 rules view: all 15 rules with sanitized setting / evaluation columns, needs only view + export', async () => {
    const csv = await mc.exportCsv(ctx({ permissions: ['ai_money_protection.view', 'ai_money_protection.export'] }), { view: 'rules' });
    const h = kv(csv);
    expect(h).toMatchObject({ Export: 'AI Money Protection — rule settings', Rows: '15', Filters: 'none' });
    const table = csv.split('\r\n\r\n')[1].trim().split('\r\n');
    expect(table[0].startsWith('Rule ID,Rule,Category,Layer,Enabled,Effective,Severity')).toBe(true);
    expect(table).toHaveLength(16);
    expect(table.some((l) => l.startsWith('MP_DUP_CHARGE_EXACT,'))).toBe(true);
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
    expect(k.batch_readiness.state).toBe('PASSED');   // Rules 07: ledgers readable, layer on, scheduled
    expect(k.detection_recent.lastPassedAt).toBe(h.checkedAt);
    expect(h.overall).toBe('FAILED');
    expect((await q(`select count(*)::int as n from money_protection_alerts where tenant_id = $1`, [T]))[0].n).toBe(before);
    expect((await mc.check(ctx()) as any).reused).toBe(true);
  });
});

describe('Documented Alert Rate Limits (AI MONEY PROTECTION 5 · 11; migration 875)', () => {
  const notes = async () => q(`select alert_id, dedupe_key, outcome, reason, owner_alert_id, held_until, suppressed_n, created_at from money_protection_notifications where tenant_id = $1 order by created_at, id`, [T]);
  const addAlert = (rule: string, sev: string, fp: string, win: string, amt = 4200) => q(`insert into money_protection_alerts (tenant_id, branch_id, rule_id, alert_type, severity, status, amount_cents, entity_fingerprint, evaluation_window, evidence)
    values ($1,$2,$3,'test',$4,'NEW',$5,$6,$7,$8::jsonb) returning id`, [T, B, rule, sev, amt, fp, win, JSON.stringify({ summary: 'evidence ' + fp + ' ' + win })]).then((r) => String(r[0].id));
  it('NT-01 the pass told the OWNER about each new HIGH / CRITICAL alert once: owner-only inbox line with no names or payment refs; a second call decides nothing again', async () => {
    const n = await notes();
    const told = n.filter((x) => x.outcome === 'sent' && x.alert_id);
    expect(told.map((x) => x.alert_id)).toContain(A1);
    const sevs = (await q(`select id, severity from money_protection_alerts where tenant_id = $1 and id = any($2::uuid[])`, [T, n.map((x) => x.alert_id).filter(Boolean)]));
    expect(sevs.every((a: any) => MC_NOTIFY.severities.includes(a.severity))).toBe(true);   // LOW / MEDIUM never notify
    const inbox = await q(`select severity, audience, title, body, metadata from owner_alerts where tenant_id = $1 and category = 'money_protection' and id = any($2::uuid[])`, [T, told.map((x) => x.owner_alert_id)]);
    expect(inbox).toHaveLength(told.length);
    expect(inbox.every((o: any) => o.audience === 'owner')).toBe(true);
    for (const o of inbox) for (const bad of ['Cashier', 'Lan', 'Linh', 'ptx-', '+1856']) expect(o.title + o.body).not.toContain(bad);
    expect(inbox.find((o: any) => o.metadata.moneyProtectionAlertId === A1)).toMatchObject({ severity: 'critical' });
    const before = n.length;
    const drain = await mc.notifyNewAlerts(T);   // HL-01 added one fresh HIGH alert after the last pass — it is decided now
    expect(drain.sent + drain.suppressed).toBe(1);
    expect((await notes()).length - before).toBe(1);
    expect(await mc.notifyNewAlerts(T)).toEqual({ sent: 0, suppressed: 0, rollUp: false });   // nothing is ever decided twice
    expect((await notes()).filter((x) => x.alert_id && told.some((t) => t.alert_id === x.alert_id))).toHaveLength(told.length);
  });
  it('NT-02 cooldown: the same rule about the same thing on a new day is a NEW alert with its own evidence, held back (not sent) until 24 h after the last one; its history says so', async () => {
    const a1 = (await q(`select rule_id, entity_fingerprint from money_protection_alerts where id = $1`, [A1]))[0];
    const again = await addAlert(a1.rule_id, 'CRITICAL', a1.entity_fingerprint, '2099-01-01');
    const inboxBefore = (await q(`select count(*)::int as n from owner_alerts where tenant_id = $1 and category = 'money_protection'`, [T]))[0].n;
    const r = await mc.notifyNewAlerts(T);
    expect(r.sent).toBe(0);
    const row = (await notes()).find((x) => x.alert_id === again)!;
    expect(row).toMatchObject({ outcome: 'suppressed', reason: 'cooldown', owner_alert_id: null });
    const sentAt = (await notes()).find((x) => x.alert_id === A1)!.created_at;
    expect(new Date(row.held_until).getTime() - new Date(sentAt).getTime()).toBe(MC_NOTIFY.cooldownHours * 3600e3);
    expect((await q(`select count(*)::int as n from owner_alerts where tenant_id = $1 and category = 'money_protection'`, [T]))[0].n).toBe(inboxBefore);
    const d: any = await mc.alert(ctx(), again);
    expect(d.evidence.summary).toBe(`evidence ${a1.entity_fingerprint} 2099-01-01`);   // distinct evidence kept
    expect(d.history.map((h: any) => h.action)).toEqual(['notify_held_cooldown']);
    // the cooldown is over (the last send moved 25 h back) → the next new alert for the same key is told
    await q(`set session_replication_role = replica`);
    await q(`update money_protection_notifications set created_at = created_at - interval '25 hours' where tenant_id = $1 and dedupe_key = $2`, [T, `${a1.rule_id}:${a1.entity_fingerprint}`]);
    await q(`set session_replication_role = origin`);
    const third = await addAlert(a1.rule_id, 'CRITICAL', a1.entity_fingerprint, '2099-01-02');
    await mc.notifyNewAlerts(T);
    expect((await notes()).find((x) => x.alert_id === third)).toMatchObject({ outcome: 'sent', reason: null });
  });
  it('NT-03 hourly cap: at most 5 alert notifications per salon per hour; the rest are held, ONE roll-up line says how many; the rules stay on', async () => {
    const settingsBefore = await q(`select rule_id, enabled from money_protection_rule_settings where tenant_id = $1 order by rule_id`, [T]);
    const hour = (await q(`select count(*)::int as n from money_protection_notifications where tenant_id = $1 and outcome = 'sent' and alert_id is not null and created_at > now() - interval '1 hour'`, [T]))[0].n;
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) ids.push(await addAlert('MP_REFUND_EXCEEDS_CAPTURE', 'HIGH', 'cap-' + i, '2099-02-01'));
    const r = await mc.notifyNewAlerts(T);
    const room = Math.max(0, MC_NOTIFY.hourlyCap - hour);
    expect(r).toMatchObject({ sent: room, suppressed: 8 - room, rollUp: true });
    const mine = (await notes()).filter((x) => ids.includes(x.alert_id));
    expect(mine.filter((x) => x.reason === 'hourly_cap')).toHaveLength(8 - room);
    const roll = (await notes()).filter((x) => x.alert_id === null);
    expect(roll).toHaveLength(1);
    expect(roll[0]).toMatchObject({ outcome: 'sent', suppressed_n: 8 - room });
    const ra = (await q(`select body, audience from owner_alerts where id = $1`, [roll[0].owner_alert_id]))[0];
    expect(ra.audience).toBe('owner'); expect(ra.body).toContain(`${8 - room} more`);
    // more held in the same hour → still ONE roll-up line
    await addAlert('MP_REFUND_EXCEEDS_CAPTURE', 'HIGH', 'cap-9', '2099-02-01');
    expect(await mc.notifyNewAlerts(T)).toMatchObject({ sent: 0, suppressed: 1, rollUp: false });
    expect((await notes()).filter((x) => x.alert_id === null)).toHaveLength(1);
    const held: any = await mc.alert(ctx(), ids[7]);
    expect(held.history.map((h: any) => h.action)).toEqual(['notify_held_cap']);
    expect(held.alert.status).toBe('NEW');   // the alert itself is untouched
    expect(await q(`select rule_id, enabled from money_protection_rule_settings where tenant_id = $1 order by rule_id`, [T])).toEqual(settingsBefore);
  });
  it('NT-04 the overview documents the limits and what they did in the last 24 hours (counts from the table); the log is append-only', async () => {
    const s: any = await mc.summary(ctx());
    const n = (await notes()).filter((x) => Date.now() - new Date(x.created_at).getTime() < 24 * 3600e3);
    expect(s.notifications).toMatchObject({ severities: ['CRITICAL', 'HIGH'], cooldownHours: 24, hourlyCap: 5, audience: 'owner' });
    expect(s.notifications.last24h).toEqual({
      sent: n.filter((x) => x.outcome === 'sent' && x.alert_id).length, heldCooldown: n.filter((x) => x.reason === 'cooldown').length,
      heldCap: n.filter((x) => x.reason === 'hourly_cap').length, rollUps: n.filter((x) => x.alert_id === null).length });
    expect(s.notifications.last24h.heldCap).toBeGreaterThanOrEqual(1);
    expect(await code(q(`update money_protection_notifications set outcome = 'sent' where tenant_id = $1`, [T]))).toMatch(/append-only/);
    expect(await code(q(`delete from money_protection_notifications where tenant_id = $1`, [T]))).toMatch(/append-only/);
  });
  it('NT-05 another salon\'s alert can never be logged against this salon (B-12)', async () => {
    expect(await code(q(`insert into money_protection_notifications (tenant_id, alert_id, dedupe_key, outcome) values ($1, $2, 'x', 'sent')`, [X, A1]))).not.toBe('ok');
  });
});

describe('round 10 — Money Protection Rules 05 · 10', () => {
  it('WT-01 why it triggered: the rule condition, the recorded values, the thresholds as configured now (gates marked), the verified references', async () => {
    const d: any = await mc.alert(ctx(), A1);
    expect(d.whyTriggered).toMatchObject({ ruleId: 'MP_DUP_CHARGE_EXACT', condition: expect.stringMatching(/processor transaction id or idempotency key/), thresholdsNote: 'as_configured_now',
      references: { tickets: d.sources.tickets.length, payments: 2, staff: d.sources.staff.length }, triggeredRules: expect.arrayContaining(['MP_DUP_CHARGE_EXACT']) });
    expect(d.whyTriggered.matched).toEqual(d.evidence.currentValues ?? {});
    // a rule with thresholds: the gate thresholds are marked, a salon override shows as custom (values recorded by the alert shown as matched)
    await mc.saveRule(ctx(), 'MP_FAILED_PAYMENT_RETRY_LOOP', { thresholds: { minDeclines: 6 } });
    const [al] = await q(`insert into money_protection_alerts (tenant_id, branch_id, rule_id, alert_type, severity, status, risk_score, amount_cents, entity_fingerprint, evidence, related, first_seen_at, last_seen_at, created_at, updated_at)
      values ($1,$2,'MP_FAILED_PAYMENT_RETRY_LOOP','failed_payment_retry_loop','MEDIUM','NEW',40,0,'fp-why-1',$3::jsonb,'{}'::jsonb, now(), now(), now(), now()) returning id`,
      [T, B, JSON.stringify({ summary: 'Repeated declines — requires review.', triggeredRules: ['MP_FAILED_PAYMENT_RETRY_LOOP'], currentValues: { declines: 7, windowMinutes: 15 }, recommendedReview: [] })]);
    const w: any = (await mc.alert(ctx(), String(al.id))).whyTriggered;
    expect(w.matched).toEqual({ declines: 7, windowMinutes: 15 });
    expect(w.thresholds).toEqual(expect.arrayContaining([{ key: 'minDeclines', value: 6, custom: true, gate: true }, { key: 'windowMinutes', value: 15, custom: false, gate: true }, { key: 'highSeverityAt', value: 8, custom: false, gate: false }]));
    expect(w.thresholdsAsOf).toEqual(expect.any(String));
  });
  it('CD-01 configuration diff: each change has its effective time; only the rule\'s latest change can be rolled back (restores its before, with the current version)', async () => {
    const h: any = await mc.settingsHistory(ctx(), {});
    const likely = h.items.filter((x: any) => x.ruleId === 'MP_DUP_CHARGE_LIKELY');
    expect(likely.length).toBeGreaterThanOrEqual(2);
    expect(likely[0]).toMatchObject({ effectiveAt: likely[0].at, rollback: { eligible: true, why: 'current', restores: likely[0].before, expectedUpdatedAt: expect.any(String) } });
    expect(likely[1].rollback).toMatchObject({ eligible: false, why: 'superseded', restores: null });
    // the rollback is the ordinary save with the before values + current version; afterwards the old latest is superseded
    const rb = likely[0].rollback;
    await mc.saveRule(ctx(), 'MP_DUP_CHARGE_LIKELY', { enabled: rb.restores.enabled, thresholds: rb.restores.thresholds, expectedUpdatedAt: rb.expectedUpdatedAt, reason: 'Roll back the last change' });
    const h2: any = await mc.settingsHistory(ctx(), {});
    const l2 = h2.items.filter((x: any) => x.ruleId === 'MP_DUP_CHARGE_LIKELY');
    expect(l2[0].rollback.eligible).toBe(true); expect(l2[1].rollback.why).toBe('superseded');
  });
});
