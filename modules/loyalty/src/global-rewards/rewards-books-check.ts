// rewards-books-check.ts — the Global Loyalty BOOKS CHECK (Final Completion guide §07) + review-first FRAUD signals (§09).
// PLATFORM-WIDE by design (it reconciles every salon's ledgers against each other); reached only from Super Admin
// (SuperAdminGuard + super_admin.billing.*) and the daily job. Reviewed in check:tenant's baseline as a platform-only file.
//
//   runBooksCheck   ONE canonical checker for the manual "Run check" button AND the daily job. One run per run key
//                   ('daily:YYYY-MM-DD' at the America/New_York cutoff, or 'manual:<uuid>'): a second start of the same key
//                   returns the first run (no duplicate concurrent execution); a run that errored is retried under the
//                   same key (attempts + 1). Every check writes a PASS / WARNING / FAILED / UNKNOWN finding with expected
//                   vs actual, the affected ids and the recommended action. NOTHING is auto-corrected.
//   detectFraud     review-first alerts (never confiscates points or erases liabilities); deduplicated by evidence.
//   dailyBooksCheck the job body: today's key + catch-up of the last 3 missed days.
import { sql, type Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { centsPerPointTenth } from './global-rewards-core';
import { GlobalRewardsRepository } from './global-rewards.repository';
import { payoutProviderFromEnv } from './rewards-payouts';
import { logException } from '@aipowersalon/observability';
import { canMoveToSql } from '@aipowersalon/database';
import { recordPlatformAuditStrict } from '@aipowersalon/audit';
import { REWARDS_RECON_FINDING, LOYALTY_FRAUD_ALERT, REWARDS_RECON_RUN } from './global-rewards-lifecycles';

type Row = Record<string, any>;
const n = (v: unknown): number => (v == null ? 0 : Number(v));
type Outcome = 'PASS' | 'WARNING' | 'FAILED' | 'UNKNOWN';
interface Finding { checkType: string; outcome: Outcome; severity?: 'info' | 'warning' | 'critical' /* written from the outcome (sev) */; tenantId?: string | null; expected?: number | null; actual?: number | null; affected?: string[]; detail: string; action?: string | null }
const sev = (o: Outcome): Finding['severity'] => (o === 'FAILED' ? 'critical' : o === 'PASS' ? 'info' : 'warning');
const TZ = 'America/New_York';

/** 'YYYY-MM-DD' of `d` in the salon network's accounting zone, and that day's start (the cutoff) in UTC */
export function accountingDay(d: Date): { day: string; cutoff: Date } {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const probe = new Date(`${day}T12:00:00Z`);
  const offH = Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(probe)) - 12;   // −4 (EDT) / −5 (EST)
  return { day, cutoff: new Date(Date.parse(`${day}T00:00:00Z`) - offH * 3600_000) };
}

/** the checks — each a pure read; the caller writes the findings */
export async function collectFindings(db: Kysely<any>, cutoff: Date): Promise<Finding[]> {
  const out: Finding[] = [];
  const C = cutoff.toISOString();
  const program = await new GlobalRewardsRepository(db).program();
  const cpt = centsPerPointTenth(program);
  const push = (f: Finding) => out.push(f);

  // 1 — every journal entry balances (double entry)
  const unb = (await sql<Row>`SELECT e.id FROM rewards_journal_entries e JOIN rewards_journal_lines l ON l.entry_id = e.id WHERE e.created_at < ${C}::timestamptz
    GROUP BY e.id HAVING sum(l.debit_cents) <> sum(l.credit_cents) LIMIT 50`.execute(db)).rows;
  push({ checkType: 'journal_balanced', outcome: unb.length ? 'FAILED' : 'PASS', expected: 0, actual: unb.length, affected: unb.map((r) => String(r.id)), detail: unb.length ? `${unb.length} journal entries do not balance` : 'Every journal entry balances', action: unb.length ? 'Finance review; post an approved compensating entry. Never delete entries.' : null });

  // 2 — each salon's wallet equals its token ledger
  const wal = (await sql<Row>`SELECT w.tenant_id, w.available_cents, coalesce((SELECT sum(l.delta_cents) FROM token_wallet_ledger l WHERE l.tenant_id = w.tenant_id), 0) AS ledger
    FROM tenant_token_wallets w`.execute(db)).rows.filter((r) => n(r.available_cents) !== n(r.ledger));
  if (!wal.length) push({ checkType: 'wallet_projection', outcome: 'PASS', detail: 'Every salon wallet equals its token ledger' });
  for (const r of wal) push({ checkType: 'wallet_projection', outcome: 'FAILED', tenantId: String(r.tenant_id), expected: n(r.ledger), actual: n(r.available_cents), detail: 'Wallet balance differs from its token ledger', action: 'Investigate the wallet ledger; correct only with an approved compensating ledger entry.' });

  // 3 — each customer's available + held equals their points ledger; never negative (also a CHECK)
  const pm = (await sql<Row>`SELECT ga.identity_id, ga.available_tenths + ga.reserved_tenths AS acct, coalesce((SELECT sum(g.delta_tenths) FROM global_points_ledger g WHERE g.identity_id = ga.identity_id), 0) AS ledger
    FROM global_rewards_accounts ga`.execute(db)).rows.filter((r) => n(r.acct) !== n(r.ledger));
  push({ checkType: 'points_projection', outcome: pm.length ? 'FAILED' : 'PASS', expected: 0, actual: pm.length, affected: pm.slice(0, 50).map((r) => String(r.identity_id)), detail: pm.length ? `${pm.length} customer balances differ from their points ledger` : 'Every customer balance (available + held) equals the points ledger', action: pm.length ? 'Investigate; correct with an approved points adjustment.' : null });

  // 4 — confirmed token purchases ↔ wallet credits (both directions, exactly once)
  const fundGap = (await sql<Row>`SELECT i.id, i.tenant_id FROM token_purchase_intents i WHERE i.status = 'FUNDS_VERIFIED' AND i.funded_at < ${C}::timestamptz
      AND (SELECT count(*) FROM token_wallet_ledger l WHERE l.tenant_id = i.tenant_id AND l.source_table = 'token_purchase_intents' AND l.source_id = i.id::text AND l.entry_type = 'purchase_funded') <> 1
    UNION ALL SELECT l.source_id::uuid, l.tenant_id FROM token_wallet_ledger l WHERE l.entry_type = 'purchase_funded' AND l.source_table = 'token_purchase_intents'
      AND NOT EXISTS (SELECT 1 FROM token_purchase_intents i WHERE i.id::text = l.source_id AND i.tenant_id = l.tenant_id AND i.status IN ('FUNDS_VERIFIED', 'REVERSED', 'CHARGED_BACK')) LIMIT 50`.execute(db)).rows;
  push({ checkType: 'funding_purchases', outcome: fundGap.length ? 'FAILED' : 'PASS', actual: fundGap.length, expected: 0, affected: fundGap.map((r) => String(r.id)), detail: fundGap.length ? 'A wallet credit without a verified purchase (or a verified purchase credited ≠ once)' : 'Every verified token purchase credited its wallet exactly once; no credit without one', action: fundGap.length ? 'Freeze purchases for the salon; finance review against provider funding evidence.' : null });

  // 5 — each issued point has one earning source, one rate snapshot and ONE token-backing consumption
  const earnGap = (await sql<Row>`SELECT e.id, e.tenant_id FROM reward_earn_transactions e WHERE e.status IN ('EARNED', 'PARTIALLY_REVERSED', 'REVERSED') AND e.created_at < ${C}::timestamptz
    AND ((SELECT count(*) FROM token_wallet_ledger l WHERE l.tenant_id = e.tenant_id AND l.source_id = e.id::text AND l.entry_type = 'earn_allocation') <> 1
      OR (SELECT count(*) FROM global_points_ledger g WHERE g.tenant_id = e.tenant_id AND g.source_id = e.id::text AND g.entry_type = 'earn') <> 1
      OR e.rule_source IS NULL) LIMIT 50`.execute(db)).rows;
  push({ checkType: 'earn_backing', outcome: earnGap.length ? 'FAILED' : 'PASS', actual: earnGap.length, expected: 0, affected: earnGap.map((r) => String(r.id)), detail: earnGap.length ? 'Points issued without exactly one funding debit / points row / rule snapshot' : 'Every issued point has one source, one rule snapshot and one token-backing debit', action: earnGap.length ? 'Investigate the earn processor; never mint replacement funding.' : null });

  // 6 — holds: none stranded past its deadline (the expiry job should have resolved them)
  const stranded = (await sql<Row>`SELECT r.id FROM reward_redemptions r WHERE r.status = 'HELD' AND r.expires_at < now() - interval '15 minutes' LIMIT 50`.execute(db)).rows;
  push({ checkType: 'holds_stranded', outcome: stranded.length ? 'WARNING' : 'PASS', actual: stranded.length, expected: 0, affected: stranded.map((r) => String(r.id)), detail: stranded.length ? `${stranded.length} holds are past their deadline (protective hold on an unresolved card, or the expiry job is behind)` : 'No hold is stranded past its deadline', action: stranded.length ? 'Check the ticket’s card tenders; check the hold-expiry job heartbeat.' : null });

  // 7 — finalized redemptions ↔ paid tickets ↔ exactly one payable; a paid ticket's approved reward tender is confirmed
  const redGap = (await sql<Row>`SELECT r.id, r.tenant_id FROM reward_redemptions r LEFT JOIN tickets t ON t.id = r.ticket_id AND t.tenant_id = r.tenant_id
      WHERE r.status IN ('CONFIRMED_REDEEMED', 'REVERSED') AND r.confirmed_at < ${C}::timestamptz
      AND (coalesce(t.status, '') NOT IN ('paid', 'refunded', 'partially_refunded') OR (SELECT count(*) FROM merchant_reimbursements m WHERE m.redemption_id = r.id) <> 1) LIMIT 50`.execute(db)).rows;
  const unconfirmed = (await sql<Row>`SELECT p.id, p.tenant_id FROM payments p JOIN tickets t ON t.id = p.ticket_id AND t.tenant_id = p.tenant_id
      WHERE p.method = 'global_reward' AND p.status IN ('approved', 'partial') AND t.status = 'paid' AND t.paid_at < ${C}::timestamptz - interval '10 minutes'
      AND NOT EXISTS (SELECT 1 FROM reward_redemptions r WHERE r.payment_id = p.id AND r.tenant_id = p.tenant_id AND r.status IN ('CONFIRMED_REDEEMED', 'REVERSED')) LIMIT 50`.execute(db)).rows;
  push({ checkType: 'redemptions_paid', outcome: redGap.length || unconfirmed.length ? 'FAILED' : 'PASS', actual: redGap.length + unconfirmed.length, expected: 0, affected: [...redGap, ...unconfirmed].map((r) => String(r.id)),
    detail: redGap.length || unconfirmed.length ? `${redGap.length} redemption(s) without a paid ticket / single payable; ${unconfirmed.length} paid ticket(s) whose reward tender was never confirmed (recovery state)` : 'Every finalized redemption matches a paid ticket and exactly one payable',
    action: redGap.length || unconfirmed.length ? 'Recovery: finance review of each ticket; never silently alter a paid ticket.' : null });

  // 8 — payouts: PAID only with a settled attempt (also enforced by the DB); provider absent → owed stays owed
  const badPaid = (await sql<Row>`SELECT m.id FROM merchant_reimbursements m LEFT JOIN payout_attempts pa ON pa.id = m.payout_attempt_id
      WHERE m.status = 'PAID' AND (pa.status IS DISTINCT FROM 'SETTLED' OR pa.settled_amount_cents <> m.amount_cents - m.adjusted_cents) LIMIT 50`.execute(db)).rows;
  push({ checkType: 'payouts_settled', outcome: badPaid.length ? 'FAILED' : 'PASS', actual: badPaid.length, expected: 0, affected: badPaid.map((r) => String(r.id)), detail: badPaid.length ? 'A PAID payable without matching provider settlement' : 'Every PAID payable has a matching verified provider settlement', action: badPaid.length ? 'STOP disbursements; finance review.' : null });
  const owed = (await sql<Row>`SELECT count(*) AS c, coalesce(sum(m.amount_cents - m.adjusted_cents), 0) AS v FROM merchant_reimbursements m WHERE m.status IN ('ACCRUED_OWED', 'PAYOUT_ELIGIBLE', 'PAYOUT_FAILED', 'ON_HOLD', 'PAYOUT_PENDING')`.execute(db)).rows[0];
  if (!payoutProviderFromEnv() && n(owed?.c) > 0) push({ checkType: 'payout_provider', outcome: 'UNKNOWN', actual: n(owed?.v), detail: `${n(owed?.c)} payable(s) owed to salons (${n(owed?.v)} cents) — no approved payout provider (BLOCKED_EXTERNAL); they stay owed`, action: 'External: approve a payout provider + finance sign-off.' });
  const agedPending = (await sql<Row>`SELECT m.id FROM merchant_reimbursements m WHERE m.status = 'PAYOUT_PENDING' AND m.updated_at < now() - interval '7 days' LIMIT 50`.execute(db)).rows;
  if (agedPending.length) push({ checkType: 'payouts_aged', outcome: 'WARNING', actual: agedPending.length, affected: agedPending.map((r) => String(r.id)), detail: 'Payouts pending for more than 7 days', action: 'Query the payout provider for each attempt.' });

  // 9 — customer reward liability equals the funded value of outstanding points (available + held)
  const liab = n((await sql<Row>`SELECT coalesce(sum(l.credit_cents - l.debit_cents), 0) AS v FROM rewards_journal_lines l WHERE l.account = 'rewards_liability'`.execute(db)).rows[0]?.v);
  const pts = n((await sql<Row>`SELECT coalesce(sum(ga.available_tenths + ga.reserved_tenths), 0) AS t FROM global_rewards_accounts ga`.execute(db)).rows[0]?.t);
  push({ checkType: 'liability_vs_points', outcome: liab === pts * cpt ? 'PASS' : 'FAILED', expected: pts * cpt, actual: liab, detail: liab === pts * cpt ? 'Rewards liability equals outstanding points value' : 'Rewards liability differs from outstanding points value', action: liab === pts * cpt ? null : 'Finance review of reward issuance / redemption postings.' });

  // 10 — reimbursement payable account equals what is still owed
  const payAcc = n((await sql<Row>`SELECT coalesce(sum(l.credit_cents - l.debit_cents), 0) AS v FROM rewards_journal_lines l WHERE l.account = 'reimbursement_payable'`.execute(db)).rows[0]?.v);
  push({ checkType: 'payables_vs_journal', outcome: payAcc === n(owed?.v) ? 'PASS' : 'FAILED', expected: n(owed?.v), actual: payAcc, detail: payAcc === n(owed?.v) ? 'Reimbursement payable account equals the payables still owed' : 'Reimbursement payable account differs from payables still owed', action: payAcc === n(owed?.v) ? null : 'Finance review of payable postings.' });
  return out;
}

/** Start (or return) the run for `runKey`; one checker for manual + scheduled. */
export async function runBooksCheck(db: Kysely<any>, a: { trigger: 'scheduled' | 'manual'; runKey?: string; cutoff?: Date; requestedBy?: string | null }): Promise<{ runId: string; status: string; replay: boolean }> {
  const cutoff = a.cutoff ?? new Date();
  const runKey = a.runKey ?? `manual:${randomUUID()}`;
  const claimed = (await sql<Row>`INSERT INTO rewards_recon_runs (run_key, trigger, cutoff_at, requested_by) VALUES (${runKey}, ${a.trigger}, ${cutoff.toISOString()}::timestamptz, ${a.requestedBy ?? null})
    ON CONFLICT (run_key) DO UPDATE SET status = 'RUNNING', attempts = rewards_recon_runs.attempts + 1, error = NULL, started_at = now()
      WHERE ${canMoveToSql(REWARDS_RECON_RUN, 'RUNNING', 'rewards_recon_runs')} RETURNING id`.execute(db)).rows[0];
  if (!claimed) {
    const prior = (await sql<Row>`SELECT r.id, r.status FROM rewards_recon_runs r WHERE r.run_key = ${runKey}`.execute(db)).rows[0];
    return { runId: String(prior.id), status: String(prior.status), replay: true };
  }
  const runId = String(claimed.id); const t0 = Date.now();
  try {
    const fs = await collectFindings(db, cutoff);
    const failed = fs.filter((f) => f.outcome === 'FAILED').length, warn = fs.filter((f) => f.outcome === 'WARNING').length, unknown = fs.filter((f) => f.outcome === 'UNKNOWN').length;
    const status = failed ? 'FAILED' : warn ? 'WARNING' : unknown ? 'UNKNOWN' : 'PASS';
    await db.transaction().execute(async (trx) => {
      for (const f of fs) {
        await sql`INSERT INTO rewards_recon_findings (run_id, check_type, outcome, severity, tenant_id, expected_cents, actual_cents, delta_cents, affected_ids, detail, recommended_action, review_status)
          VALUES (${runId}::uuid, ${f.checkType}, ${f.outcome}, ${sev(f.outcome)}, ${f.tenantId ?? null}, ${f.expected ?? null}, ${f.actual ?? null},
            ${f.expected != null && f.actual != null ? f.actual - f.expected : null}, ${JSON.stringify(f.affected ?? [])}::jsonb, ${f.detail}, ${f.action ?? null}, ${f.outcome === 'PASS' ? 'RESOLVED' : 'OPEN'})`.execute(trx);
      }
      await sql`UPDATE rewards_recon_runs r SET status = ${status}, checks_total = ${fs.length}, checks_failed = ${failed}, checks_warning = ${warn}, finished_at = now(), duration_ms = ${Date.now() - t0}
        WHERE r.id = ${runId}::uuid AND ${canMoveToSql(REWARDS_RECON_RUN, status, 'r')}`.execute(trx);
      // notify the platform (Super Admin → Alerts) — never auto-correct; one alert per run
      if (failed) await sql`INSERT INTO alerts (title, message, type, severity, status, related_module, related_record_id, dedupe_key)
        VALUES ('Rewards books check FAILED', ${`${failed} check(s) failed in run ${runKey}. Review the Loyalty Network integrity dashboard.`}, 'billing', 'critical', 'unread', 'loyalty', ${runId}, ${'rewards_books:' + runKey})
        ON CONFLICT (dedupe_key) DO NOTHING`.execute(trx);
    });
    // signals are best-effort; the books result stands on its own (a detector failure is logged, never hidden)
    try { await detectFraud(db); } catch (fe) { logException(fe, { where: 'global-rewards.detect-fraud', runId }); }
    return { runId, status, replay: false };
  } catch (e) {
    await sql`UPDATE rewards_recon_runs r SET status = 'ERROR', error = ${String((e as Error)?.message ?? e).slice(0, 500)}, finished_at = now(), duration_ms = ${Date.now() - t0} WHERE r.id = ${runId}::uuid AND ${canMoveToSql(REWARDS_RECON_RUN, 'ERROR', 'r')}`.execute(db);
    await sql`INSERT INTO alerts (title, message, type, severity, status, related_module, related_record_id, dedupe_key)
      VALUES ('Rewards books check could not run', ${`Run ${runKey} errored; it will be retried.`}, 'system', 'high', 'unread', 'loyalty', ${runId}, ${'rewards_books_error:' + runKey + ':' + Date.now()})
      ON CONFLICT (dedupe_key) DO NOTHING`.execute(db);
    throw e;
  }
}

/** The daily job: today's run at the accounting cutoff + catch-up of up to 3 missed days. */
export async function dailyBooksCheck(db: Kysely<any>, now = new Date()): Promise<{ ran: string[] }> {
  const ran: string[] = [];
  for (let back = 3; back >= 0; back--) {
    const { day, cutoff } = accountingDay(new Date(now.getTime() - back * 86_400_000));
    if (cutoff.getTime() > now.getTime()) continue;
    const r = await runBooksCheck(db, { trigger: 'scheduled', runKey: `daily:${day}`, cutoff });
    if (!r.replay) ran.push(day);
  }
  return { ran };
}

/** Review-first fraud signals (§09). Each alert carries its evidence and a confidence; nothing is changed on any account. */
export async function detectFraud(db: Kysely<any>, now = new Date()): Promise<number> {
  let raised = 0;
  const raise = async (signal: string, severity: 'low' | 'medium' | 'high', confidence: number, key: string, identityId: string | null, tenantId: string | null, evidence: Record<string, unknown>) => {
    const r = (await sql<Row>`INSERT INTO loyalty_fraud_alerts (signal, severity, confidence, dedupe_key, identity_id, tenant_id, evidence)
      VALUES (${signal}, ${severity}, ${confidence}, ${key}, ${identityId}, ${tenantId}, ${JSON.stringify(evidence)}::jsonb) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`.execute(db)).rows[0];
    if (r) raised++;
  };
  const since = new Date(now.getTime() - 24 * 3600_000).toISOString();
  // concurrent cross-salon attempts: holds for one customer at ≥ 2 salons within 10 minutes
  for (const r of (await sql<Row>`SELECT a.identity_id, a.id AS a_id, b.id AS b_id, a.tenant_id AS ta, b.tenant_id AS tb FROM reward_redemptions a JOIN reward_redemptions b
      ON b.identity_id = a.identity_id AND b.tenant_id <> a.tenant_id AND b.id > a.id AND abs(extract(epoch FROM b.created_at - a.created_at)) < 600
      WHERE a.created_at > ${since}::timestamptz LIMIT 100`.execute(db)).rows) {
    await raise('concurrent_cross_salon', 'medium', 0.6, `ccs:${r.a_id}:${r.b_id}`, String(r.identity_id), null, { redemptionIds: [String(r.a_id), String(r.b_id)], salons: 2, windowSeconds: 600 });
  }
  // hold churn: ≥ 5 released / expired holds for one customer in 24 h
  for (const r of (await sql<Row>`SELECT r.identity_id, count(*) AS c FROM reward_redemptions r WHERE r.status IN ('RELEASED', 'EXPIRED') AND r.created_at > ${since}::timestamptz
      GROUP BY r.identity_id HAVING count(*) >= 5 LIMIT 100`.execute(db)).rows) {
    await raise('hold_churn', 'low', 0.4, `churn:${r.identity_id}:${since.slice(0, 10)}`, String(r.identity_id), null, { releasedOrExpired24h: n(r.c) });
  }
  // refund cycles: ≥ 3 redemption reversals for one customer in 24 h
  for (const r of (await sql<Row>`SELECT g.identity_id, count(*) AS c FROM global_points_ledger g WHERE g.entry_type IN ('redeem_reversal', 'earn_reversal') AND g.created_at > ${since}::timestamptz
      GROUP BY g.identity_id HAVING count(*) >= 3 LIMIT 100`.execute(db)).rows) {
    await raise('refund_cycle', 'medium', 0.5, `refund:${r.identity_id}:${since.slice(0, 10)}`, String(r.identity_id), null, { reversals24h: n(r.c) });
  }
  // unusual spend: one customer redeeming > $200 in 24 h
  for (const r of (await sql<Row>`SELECT r.identity_id, sum(r.value_cents) AS v, count(*) AS c FROM reward_redemptions r WHERE r.status = 'CONFIRMED_REDEEMED' AND r.confirmed_at > ${since}::timestamptz
      GROUP BY r.identity_id HAVING sum(r.value_cents) > 20000 LIMIT 100`.execute(db)).rows) {
    await raise('unusual_spend', 'low', 0.3, `spend:${r.identity_id}:${since.slice(0, 10)}`, String(r.identity_id), null, { redeemedCents24h: n(r.v), redemptions: n(r.c), thresholdCents: 20000 });
  }
  return raised;
}

// ── Super Admin integrity dashboard (guide §08): ledger-backed aggregates + drilldowns ─────────────────────────────
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());
const pageOf = (page?: number, size?: number) => { const s = Math.max(1, Math.min(100, Math.floor(Number(size)) || 25)); const p = Math.max(1, Math.min(10_000, Math.floor(Number(page)) || 1)); return { s, p, off: (p - 1) * s }; };

export async function integritySummary(db: Kysely<any>) {
  const program = await new GlobalRewardsRepository(db).program();
  const cpt = centsPerPointTenth(program);
  const funding = (await sql<Row>`SELECT coalesce(sum(CASE WHEN i.status = 'FUNDS_VERIFIED' THEN i.token_cents END), 0) AS verified,
      coalesce(sum(CASE WHEN i.status IN ('REQUESTED', 'PROCESSING', 'UNKNOWN', 'PAYMENT_CONFIRMED', 'SETTLEMENT_PENDING') THEN i.token_cents END), 0) AS pending,
      count(*) FILTER (WHERE i.status IN ('FAILED', 'DECLINED', 'REVERSED', 'CHARGED_BACK')) AS failed FROM token_purchase_intents i`.execute(db)).rows[0];
  const wallets = (await sql<Row>`SELECT coalesce(sum(w.available_cents), 0) AS available, coalesce(sum(w.lifetime_allocated_cents), 0) AS consumed, coalesce(sum(w.deficit_cents), 0) AS deficit FROM tenant_token_wallets w`.execute(db)).rows[0];
  const points = (await sql<Row>`SELECT coalesce(sum(ga.available_tenths), 0) AS a, coalesce(sum(ga.reserved_tenths), 0) AS h, count(*) AS accounts FROM global_rewards_accounts ga`.execute(db)).rows[0];
  const holds = (await sql<Row>`SELECT count(*) AS c, coalesce(sum(r.point_tenths), 0) AS t, coalesce(sum(r.value_cents), 0) AS v,
      count(*) FILTER (WHERE r.expires_at < now()) AS past_deadline, count(*) FILTER (WHERE r.expires_at >= now() AND r.expires_at < now() + interval '5 minutes') AS expiring_soon
      FROM reward_redemptions r WHERE r.status = 'HELD'`.execute(db)).rows[0];
  const journal = (await sql<Row>`SELECT l.account, coalesce(sum(l.credit_cents - l.debit_cents), 0) AS v FROM rewards_journal_lines l GROUP BY l.account`.execute(db)).rows;
  const bal = Object.fromEntries(journal.map((r) => [String(r.account), n(r.v)]));
  const owed = (await sql<Row>`SELECT m.status, count(*) AS c, coalesce(sum(m.amount_cents - m.adjusted_cents), 0) AS v,
      coalesce(sum(CASE WHEN m.created_at < now() - interval '30 days' THEN m.amount_cents - m.adjusted_cents END), 0) AS aged30 FROM merchant_reimbursements m GROUP BY m.status`.execute(db)).rows;
  const paid = (await sql<Row>`SELECT count(*) AS c, coalesce(sum(pa.settled_amount_cents), 0) AS v FROM payout_attempts pa WHERE pa.status = 'SETTLED'`.execute(db)).rows[0];
  const lastRun = (await sql<Row>`SELECT r.id, r.run_key, r.trigger, r.status, r.started_at, r.finished_at, r.duration_ms, r.checks_total, r.checks_failed, r.checks_warning, r.attempts
      FROM rewards_recon_runs r ORDER BY r.started_at DESC LIMIT 1`.execute(db)).rows[0];
  const lastDaily = (await sql<Row>`SELECT r.run_key, r.status, r.finished_at FROM rewards_recon_runs r WHERE r.trigger = 'scheduled' ORDER BY r.started_at DESC LIMIT 1`.execute(db)).rows[0];
  const open = (await sql<Row>`SELECT f.severity, count(*) AS c, min(f.created_at) AS oldest FROM rewards_recon_findings f WHERE f.outcome <> 'PASS' AND f.review_status IN ('OPEN', 'INVESTIGATING') GROUP BY f.severity`.execute(db)).rows;
  const fraud = (await sql<Row>`SELECT a.severity, count(*) AS c FROM loyalty_fraud_alerts a WHERE a.status IN ('OPEN', 'INVESTIGATING') GROUP BY a.severity`.execute(db)).rows;
  const outstandingValue = (n(points?.a) + n(points?.h)) * cpt;
  const owedRows = owed.map((r) => ({ status: String(r.status), count: n(r.c), amountCents: n(r.v), aged30Cents: n(r.aged30) }));
  const owedNow = owedRows.filter((r) => ['ACCRUED_OWED', 'PAYOUT_ELIGIBLE', 'PAYOUT_FAILED', 'ON_HOLD'].includes(r.status)).reduce((s, r) => s + r.amountCents, 0);
  const pendingPayout = owedRows.filter((r) => r.status === 'PAYOUT_PENDING').reduce((s, r) => s + r.amountCents, 0);
  return {
    generatedAt: new Date().toISOString(), currency: 'USD', tokenValueCents: program.tokenValueCents,
    funding: { verifiedCents: n(funding?.verified), pendingCents: n(funding?.pending), failedCount: n(funding?.failed), walletAvailableCents: n(wallets?.available), consumedCents: n(wallets?.consumed), deficitCents: n(wallets?.deficit), prepaidLiabilityCents: bal.merchant_prepaid_liability ?? 0 },
    points: { accounts: n(points?.accounts), availableTenths: n(points?.a), heldTenths: n(points?.h), redemptionValueCents: outstandingValue },
    holds: { count: n(holds?.c), pointTenths: n(holds?.t), valueCents: n(holds?.v), pastDeadline: n(holds?.past_deadline), expiringSoon: n(holds?.expiring_soon) },
    liability: { journalCents: bal.rewards_liability ?? 0, outstandingValueCents: outstandingValue, deltaCents: (bal.rewards_liability ?? 0) - outstandingValue },
    payables: { owedCents: owedNow, pendingPayoutCents: pendingPayout, byStatus: owedRows, journalCents: bal.reimbursement_payable ?? 0 },
    payouts: { providerConfigured: !!payoutProviderFromEnv(), state: payoutProviderFromEnv() ? 'CONFIGURED' : 'BLOCKED_EXTERNAL', settledCount: n(paid?.c), settledCents: n(paid?.v) },
    books: { lastRun: lastRun ? { id: String(lastRun.id), runKey: lastRun.run_key, trigger: lastRun.trigger, status: lastRun.status, startedAt: iso(lastRun.started_at), finishedAt: iso(lastRun.finished_at), durationMs: lastRun.duration_ms == null ? null : n(lastRun.duration_ms), checks: n(lastRun.checks_total), failed: n(lastRun.checks_failed), warnings: n(lastRun.checks_warning), attempts: n(lastRun.attempts) } : null,
      lastDaily: lastDaily ? { runKey: lastDaily.run_key, status: lastDaily.status, finishedAt: iso(lastDaily.finished_at) } : null, nextDailyAt: accountingDay(new Date(Date.now() + 86_400_000)).cutoff.toISOString() },
    discrepancies: open.map((r) => ({ severity: String(r.severity), open: n(r.c), oldestAt: iso(r.oldest) })),
    fraud: fraud.map((r) => ({ severity: String(r.severity), open: n(r.c) })),
  };
}

export async function listRuns(db: Kysely<any>, q: { page?: number; pageSize?: number }) {
  const { s, p, off } = pageOf(q.page, q.pageSize);
  const total = n((await sql<Row>`SELECT count(*) AS c FROM rewards_recon_runs`.execute(db)).rows[0]?.c);
  const rows = (await sql<Row>`SELECT r.id, r.run_key, r.trigger, r.status, r.started_at, r.finished_at, r.duration_ms, r.checks_total, r.checks_failed, r.checks_warning, r.attempts, r.error
    FROM rewards_recon_runs r ORDER BY r.started_at DESC, r.id DESC LIMIT ${s} OFFSET ${off}`.execute(db)).rows;
  return { total, page: p, pageSize: s, pageCount: Math.max(1, Math.ceil(total / s)), items: rows.map((r) => ({ id: String(r.id), runKey: r.run_key, trigger: r.trigger, status: r.status, startedAt: iso(r.started_at), finishedAt: iso(r.finished_at),
    durationMs: r.duration_ms == null ? null : n(r.duration_ms), checks: n(r.checks_total), failed: n(r.checks_failed), warnings: n(r.checks_warning), attempts: n(r.attempts), error: r.error ?? null })) };
}

export async function listFindings(db: Kysely<any>, q: { runId?: string | null; outcome?: string | null; reviewStatus?: string | null; tenantId?: string | null; page?: number; pageSize?: number }) {
  const { s, p, off } = pageOf(q.page, q.pageSize);
  const where = sql.join([
    sql`true`,
    q.runId ? sql`f.run_id = ${q.runId}::uuid` : sql`true`,
    q.outcome ? sql`f.outcome = ${q.outcome}` : sql`f.outcome <> 'PASS'`,
    q.reviewStatus ? sql`f.review_status = ${q.reviewStatus}` : sql`true`,
    q.tenantId ? sql`f.tenant_id = ${q.tenantId}::uuid` : sql`true`,
  ], sql` AND `);
  const total = n((await sql<Row>`SELECT count(*) AS c FROM rewards_recon_findings f WHERE ${where}`.execute(db)).rows[0]?.c);
  const rows = (await sql<Row>`SELECT f.id, f.run_id, r.run_key, f.check_type, f.outcome, f.severity, f.tenant_id, t.display_name, f.expected_cents, f.actual_cents, f.delta_cents, f.affected_ids, f.detail, f.recommended_action,
      f.review_status, f.reviewed_by, f.reviewed_at, f.review_note, f.created_at FROM rewards_recon_findings f JOIN rewards_recon_runs r ON r.id = f.run_id LEFT JOIN tenants t ON t.id = f.tenant_id
    WHERE ${where} ORDER BY CASE f.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, f.created_at DESC, f.id DESC LIMIT ${s} OFFSET ${off}`.execute(db)).rows;
  return { total, page: p, pageSize: s, pageCount: Math.max(1, Math.ceil(total / s)), items: rows.map((r) => ({ id: String(r.id), runId: String(r.run_id), runKey: r.run_key, checkType: r.check_type, outcome: r.outcome, severity: r.severity,
    tenantId: r.tenant_id ? String(r.tenant_id) : null, salon: r.display_name ?? null, expectedCents: r.expected_cents == null ? null : n(r.expected_cents), actualCents: r.actual_cents == null ? null : n(r.actual_cents), deltaCents: r.delta_cents == null ? null : n(r.delta_cents),
    affectedIds: Array.isArray(r.affected_ids) ? r.affected_ids : [], detail: r.detail, recommendedAction: r.recommended_action ?? null, reviewStatus: r.review_status, reviewedAt: iso(r.reviewed_at), reviewNote: r.review_note ?? null, createdAt: iso(r.created_at) })) };
}

/** Review a finding (assign / investigate / resolve / accept). Never changes any ledger: resolution is a note + status. */
export async function reviewFinding(db: Kysely<any>, a: { findingId: string; to: 'INVESTIGATING' | 'RESOLVED' | 'ACCEPTED' | 'OPEN'; note: string; actorUserId: string }) {
  return db.transaction().execute(async (trx) => {
    const r = (await sql<Row>`UPDATE rewards_recon_findings f SET review_status = ${a.to}, reviewed_by = ${a.actorUserId}::uuid, reviewed_at = now(), review_note = ${a.note}, updated_by = ${a.actorUserId}::uuid, updated_at = now()
      WHERE f.id = ${a.findingId}::uuid AND ${canMoveToSql(REWARDS_RECON_FINDING, a.to, 'f')} RETURNING f.id, f.check_type`.execute(trx)).rows[0];
    if (!r) return null;
    await recordPlatformAuditStrict(trx, { userId: a.actorUserId, role: 'super_admin' },
      { module: 'loyalty', action: 'books_finding_reviewed', resourceType: 'rewards_recon_finding', resourceId: a.findingId, metadata: { to: a.to, note: a.note, checkType: r.check_type } });
    return { id: String(r.id), reviewStatus: a.to };
  });
}

export async function listPayables(db: Kysely<any>, q: { status?: string | null; tenantId?: string | null; page?: number; pageSize?: number }) {
  const { s, p, off } = pageOf(q.page, q.pageSize);
  const where = sql.join([sql`true`, q.status ? sql`m.status = ${q.status}` : sql`true`, q.tenantId ? sql`m.tenant_id = ${q.tenantId}::uuid` : sql`true`], sql` AND `);
  const total = n((await sql<Row>`SELECT count(*) AS c FROM merchant_reimbursements m WHERE ${where}`.execute(db)).rows[0]?.c);
  const rows = (await sql<Row>`SELECT m.id, m.tenant_id, t.display_name, m.redemption_id, m.ticket_id, m.amount_cents, m.adjusted_cents, m.status, m.hold_reason, m.provider, m.provider_ref, m.paid_at, m.created_at,
      r.point_tenths, r.identity_id IS NOT NULL AS has_customer FROM merchant_reimbursements m LEFT JOIN tenants t ON t.id = m.tenant_id LEFT JOIN reward_redemptions r ON r.id = m.redemption_id
    WHERE ${where} ORDER BY m.created_at DESC, m.id DESC LIMIT ${s} OFFSET ${off}`.execute(db)).rows;
  return { total, page: p, pageSize: s, pageCount: Math.max(1, Math.ceil(total / s)), items: rows.map((r) => ({ id: String(r.id), tenantId: String(r.tenant_id), salon: r.display_name ?? null, redemptionId: String(r.redemption_id), ticketId: r.ticket_id ? String(r.ticket_id) : null,
    amountCents: n(r.amount_cents), adjustedCents: n(r.adjusted_cents), owedCents: n(r.amount_cents) - n(r.adjusted_cents), status: r.status, holdReason: r.hold_reason ?? null, providerRef: r.provider_ref ?? null, paidAt: iso(r.paid_at), createdAt: iso(r.created_at), pointTenths: n(r.point_tenths) })) };
}

/** funding → earning → holding → redemption → payable → payout lineage for one redemption (stable references, no PII) */
export async function lineage(db: Kysely<any>, redemptionId: string) {
  const r = (await sql<Row>`SELECT r.id, r.tenant_id, r.ticket_id, r.identity_id, r.payment_id, r.point_tenths, r.value_cents, r.status, r.created_at, r.confirmed_at, r.released_at, r.reversed_cents FROM reward_redemptions r WHERE r.id = ${redemptionId}::uuid`.execute(db)).rows[0];
  if (!r) return null;
  const pay = (await sql<Row>`SELECT m.id, m.status, m.amount_cents, m.adjusted_cents, m.payout_attempt_id FROM merchant_reimbursements m WHERE m.redemption_id = ${redemptionId}::uuid`.execute(db)).rows[0];
  const attempts = pay ? (await sql<Row>`SELECT pa.id, pa.status, pa.provider, pa.amount_cents, pa.settlement_ref, pa.settled_at FROM payout_attempts pa WHERE pa.reimbursement_id = ${pay.id}::uuid ORDER BY pa.created_at`.execute(db)).rows : [];
  const adj = pay ? (await sql<Row>`SELECT a.kind, a.amount_cents, a.source_id, a.created_at FROM reimbursement_adjustments a WHERE a.reimbursement_id = ${pay.id}::uuid ORDER BY a.created_at`.execute(db)).rows : [];
  // where the redeemed points were funded: the customer's earn rows (salon + funding debit), newest first
  const funded = (await sql<Row>`SELECT e.id, e.tenant_id, e.point_tenths, e.backing_cents, e.rule_source, e.rule_version_id, e.created_at FROM reward_earn_transactions e
    WHERE e.identity_id = ${r.identity_id}::uuid AND e.status IN ('EARNED', 'PARTIALLY_REVERSED') AND e.created_at <= ${r.created_at} ORDER BY e.created_at DESC LIMIT 10`.execute(db)).rows;
  const journal = (await sql<Row>`SELECT e.entry_type, e.source_table, e.source_id, e.created_at FROM rewards_journal_entries e WHERE (e.source_table = 'reward_redemptions' AND e.source_id = ${redemptionId})
    OR (e.source_table = 'payout_attempts' AND e.source_id = ANY(${attempts.map((a) => String(a.id))}::text[])) ORDER BY e.created_at`.execute(db)).rows;
  return {
    redemption: { id: String(r.id), redeemingSalonId: String(r.tenant_id), ticketId: String(r.ticket_id), tenderPaymentId: r.payment_id ? String(r.payment_id) : null, pointTenths: n(r.point_tenths), valueCents: n(r.value_cents), status: r.status, heldAt: iso(r.created_at), confirmedAt: iso(r.confirmed_at), releasedAt: iso(r.released_at), reversedCents: n(r.reversed_cents) },
    funding: funded.map((e) => ({ earnId: String(e.id), earningSalonId: String(e.tenant_id), pointTenths: n(e.point_tenths), backingCents: n(e.backing_cents), ruleSource: e.rule_source, ruleVersionId: e.rule_version_id ? String(e.rule_version_id) : null, at: iso(e.created_at) })),
    payable: pay ? { id: String(pay.id), status: pay.status, amountCents: n(pay.amount_cents), adjustedCents: n(pay.adjusted_cents) } : null,
    payouts: attempts.map((a) => ({ id: String(a.id), status: a.status, provider: a.provider, amountCents: n(a.amount_cents), settlementRef: a.settlement_ref ?? null, settledAt: iso(a.settled_at) })),
    adjustments: adj.map((a) => ({ kind: a.kind, amountCents: n(a.amount_cents), source: a.source_id, at: iso(a.created_at) })),
    journal: journal.map((j) => ({ entryType: j.entry_type, source: `${j.source_table}:${j.source_id}`, at: iso(j.created_at) })),
  };
}

export async function listFraudAlerts(db: Kysely<any>, q: { status?: string | null; page?: number; pageSize?: number }) {
  const { s, p, off } = pageOf(q.page, q.pageSize);
  const where = q.status ? sql`a.status = ${q.status}` : sql`a.status IN ('OPEN', 'INVESTIGATING')`;
  const total = n((await sql<Row>`SELECT count(*) AS c FROM loyalty_fraud_alerts a WHERE ${where}`.execute(db)).rows[0]?.c);
  const rows = (await sql<Row>`SELECT a.id, a.signal, a.severity, a.confidence, a.identity_id, a.tenant_id, a.evidence, a.status, a.review_note, a.reviewed_at, a.created_at FROM loyalty_fraud_alerts a
    WHERE ${where} ORDER BY CASE a.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, a.created_at DESC LIMIT ${s} OFFSET ${off}`.execute(db)).rows;
  // the customer is shown by a short reference only (no phone / name): privacy-limited review
  return { total, page: p, pageSize: s, pageCount: Math.max(1, Math.ceil(total / s)), items: rows.map((r) => ({ id: String(r.id), signal: r.signal, severity: r.severity, confidence: Number(r.confidence), customerRef: r.identity_id ? 'C-' + String(r.identity_id).slice(-6) : null,
    tenantId: r.tenant_id ? String(r.tenant_id) : null, evidence: r.evidence ?? {}, status: r.status, reviewNote: r.review_note ?? null, reviewedAt: iso(r.reviewed_at), createdAt: iso(r.created_at) })) };
}

export async function reviewFraudAlert(db: Kysely<any>, a: { alertId: string; to: 'INVESTIGATING' | 'DISMISSED' | 'CONFIRMED' | 'OPEN'; note: string; actorUserId: string }) {
  return db.transaction().execute(async (trx) => {
    const r = (await sql<Row>`UPDATE loyalty_fraud_alerts a SET status = ${a.to}, reviewed_by = ${a.actorUserId}::uuid, reviewed_at = now(), review_note = ${a.note}, updated_by = ${a.actorUserId}::uuid, updated_at = now()
      WHERE a.id = ${a.alertId}::uuid AND ${canMoveToSql(LOYALTY_FRAUD_ALERT, a.to, 'a')} RETURNING a.id, a.signal`.execute(trx)).rows[0];
    if (!r) return null;
    await recordPlatformAuditStrict(trx, { userId: a.actorUserId, role: 'super_admin' },
      { module: 'loyalty', action: 'fraud_alert_reviewed', resourceType: 'loyalty_fraud_alert', resourceId: a.alertId, metadata: { to: a.to, note: a.note, signal: r.signal } });
    return { id: String(r.id), status: a.to };
  });
}

/** CSV of findings (Super Admin scope), audit-logged; cells that start with = + - @ are prefixed (formula injection). */
export async function findingsCsv(db: Kysely<any>, actorUserId: string, q: { runId?: string | null }) {
  const all = await listFindings(db, { runId: q.runId ?? null, outcome: null, pageSize: 100, page: 1 });
  const cell = (v: unknown) => { const s = v == null ? '' : String(v); const safe = /^[=+\-@]/.test(s) ? `'${s}` : s; return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };
  const lines = [['run', 'check', 'outcome', 'severity', 'salon', 'expected_cents', 'actual_cents', 'delta_cents', 'detail', 'review_status', 'created_at'].join(',')]
    .concat(all.items.map((f) => [f.runKey, f.checkType, f.outcome, f.severity, f.salon ?? '', f.expectedCents ?? '', f.actualCents ?? '', f.deltaCents ?? '', f.detail, f.reviewStatus, f.createdAt].map(cell).join(',')));
  await recordPlatformAuditStrict(db, { userId: actorUserId, role: 'super_admin' },
    { module: 'loyalty', action: 'books_findings_exported', resourceType: 'rewards_recon_run', resourceId: q.runId ?? null, metadata: { rows: all.items.length } });
  return lines.join('\n') + '\n';
}
