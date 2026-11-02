// r2e-state-machines.pgtest — BUILD_PLAN Phase 12 round 2 (#27): the workforce, communications and apps/api status
// machines, on the MIGRATED schema.
//   (1 and 2 — vocabulary, the written-out tables, the refused dangerous moves — are r2e-state-machines.vitest.spec.ts.)
//   3. on the real tables, for every machine: an allowed move lands, a refused move is a 409 and leaves the row, and two
//      writers that read the same state cannot both move it — the second gets 409 INVALID_STATE_TRANSITION (no lost update);
//   4. the writers themselves: a removed showcase post is not re-published, a canceled pay-rule version is not approved
//      again, a late provider callback does not move a delivered SMS back to sent, a decided report is not re-opened.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { transitionStatus, InvalidStateTransitionError, type StateMachine } from '@aipowersalon/database';
import * as WF from '@aipowersalon/workforce';
import * as CM from '@aipowersalon/communications';
import { API_OPERATION } from './async-export/operation-lifecycle';
import { OUTBOX_EVENT, EVENT_DEAD_LETTER } from '../events/event-lifecycles';
import { WEBHOOK_DELIVERY } from '../api-webhooks/webhook-delivery-lifecycle';
import { DISPLAY_RECEIPT } from '../customer-display/display-receipt-lifecycle';
import { STATUS_COMPONENT } from '../observability/status-component-lifecycle';
import { STATUS_INCIDENT } from '../super-admin-system-status/incident-lifecycle';

const W = WF as any, C = CM as any;
const WORKFORCE: StateMachine[] = [W.APPROVAL_REQUEST, W.ACCESS_REVIEW, W.COMPENSATION_AGREEMENT, W.BONUS_RULE, W.TIER_PLAN, W.COMPENSATION_POLICY_VERSION,
  W.NAIL_SHOWCASE_POST, W.NAIL_SHOWCASE_COMMENT, W.NAIL_SHOWCASE_REPORT, W.TECH_SALON_MEMBERSHIP, W.TECH_PORTFOLIO_PHOTO, W.TECH_DM_THREAD, W.TECH_DM_REPORT];
const COMMS: StateMachine[] = [C.CAMPAIGN, C.PLATFORM_ANNOUNCEMENT, C.CAMPAIGN_TEMPLATE, C.CAMPAIGN_COMPLIANCE_FLAG, C.TENANT_MESSAGING_LIMIT, C.COMMUNICATION_PROVIDER,
  C.MESSAGE_TEMPLATE_VERSION, C.MESSAGE_TEMPLATE, C.COMMUNICATION_THREAD, C.FOLLOW_UP_TASK, C.FOLLOW_UP_GENERATION_RUN, C.NOTIFICATION, C.SMS_RECONCILIATION_FINDING, C.TENANT_MESSAGING_CREDENTIALS];
const API: StateMachine[] = [API_OPERATION, OUTBOX_EVENT, EVENT_DEAD_LETTER, WEBHOOK_DELIVERY, DISPLAY_RECEIPT, STATUS_COMPONENT, STATUS_INCIDENT];
const ALL = [...WORKFORCE, ...COMMS, ...API];
const VOCAB = JSON.parse(readFileSync(join(__dirname, '..', '..', 'db/state-vocabularies.generated.json'), 'utf8')).vocabularies;

let pg: any; let db: any;
beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.query(`SET session_replication_role = replica`);   // rows without their parents: the FKs are not what is under test
}, 180_000);

/** Columns a table's other CHECKs need (rows are inserted bare, without their parents). */
const NOW = new Date().toISOString();
const EXTRA: Record<string, (status: string) => Record<string, unknown>> = {
  tenant_approval_requests: () => ({ kind: 'refund', subject_type: 'payment' }),
  campaign_compliance_flags: () => ({ flag_type: 'abusive', subject_type: 'tenant_campaign' }),
  communication_providers: () => ({ channel: 'sms' }), message_templates: () => ({ channel: 'sms' }), notifications: () => ({ channel: 'sms' }),
  sms_reconciliation_findings: () => ({ finding_type: 'counter_ledger_mismatch' }), api_operations: () => ({ realm: 'pos' }),
  event_dead_letters: () => ({ error_class: 'TRANSIENT' }), customer_display_sessions: () => ({ receipt_choice: 'sms', receipt_at: NOW }),
  access_reviews: (st) => (st === 'open' ? {} : { completed_at: NOW }),
};
const MOVE_SET: Record<string, (to: string) => Record<string, unknown>> = { access_reviews: (to) => (to === 'open' ? {} : { completed_at: NOW }) };
const pkOf = async (table: string): Promise<string> => (await pg.query(`select a.attname c from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
   where i.indrelid = $1::regclass and i.indisprimary`, [table])).rows[0]?.c ?? 'id';

/** Insert a row of `m.table` in state `status`, filling every NOT NULL column that has no default; returns its key. */
async function rowIn(m: StateMachine, status: string): Promise<{ key: string; id: string }> {
  const cols = (await pg.query(`select column_name c, data_type t, udt_name u from information_schema.columns
     where table_schema = 'public' and table_name = $1 and is_nullable = 'NO' and column_default is null`, [m.table])).rows as any[];
  const key = await pkOf(m.table);
  const id = randomUUID(); const vals: Record<string, unknown> = { [key]: id, [m.column]: status, ...(EXTRA[m.table]?.(status) ?? {}) };
  for (const { c, t, u } of cols) {
    if (c in vals) continue;
    const v = VOCAB[`${m.table}.${c}`];
    vals[c] = v ? v[0] : u === 'uuid' ? randomUUID() : /int|numeric|double|real/.test(t) ? 0 : t === 'boolean' ? false : /timestamp|date/.test(t) ? NOW
      : /json/.test(t) ? '{}' : t === 'ARRAY' ? '{}' : `x-${c}-${id.slice(0, 8)}`;
  }
  const keys = Object.keys(vals);
  await pg.query(`insert into ${m.table} (${keys.map((k) => `"${k}"`).join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')})`, keys.map((k) => vals[k]));
  return { key, id };
}
const stateOf = async (m: StateMachine, r: { key: string; id: string }) => (await pg.query(`select ${m.column} s from ${m.table} where "${r.key}" = $1`, [r.id])).rows[0]?.s;

describe('R2-E machines — on the real tables: allowed lands, refused is 409, a concurrent second writer is 409', () => {
  for (const m of ALL) {
    const allowed = m.states.flatMap((f) => m.states.filter((t) => m.can(f, t) && f !== t).map((t) => [f, t] as const));
    const refused = m.states.flatMap((f) => m.states.filter((t) => !m.can(f, t)).map((t) => [f, t] as const));
    it(`${m.name} (${m.table}.${m.column})`, async () => {
      if (allowed.length) {
        const [f, t] = allowed[0];
        const r = await rowIn(m, f); const where = { [r.key]: r.id }; const set = MOVE_SET[m.table]?.(t) ?? {};
        expect(await transitionStatus(db, m, { where, from: f, to: t, set })).toEqual({ from: f });
        expect(await stateOf(m, r)).toBe(t);
        // a second writer that read the same `from` (the row has moved underneath it): 409, the row keeps the first move
        const err = await transitionStatus(db, m, { where, from: f, to: t, set }).catch((e) => e);
        expect(err).toBeInstanceOf(InvalidStateTransitionError); expect(err.status).toBe(409); expect(err.code).toBe('INVALID_STATE_TRANSITION');
        expect(await stateOf(m, r)).toBe(t);
      }
      if (refused.length) {
        const [f, t] = refused[refused.length - 1];
        const r = await rowIn(m, f);
        const err = await transitionStatus(db, m, { where: { [r.key]: r.id }, to: t }).catch((e) => e);
        expect(err).toBeInstanceOf(InvalidStateTransitionError);
        expect(await stateOf(m, r)).toBe(f);
      }
    }, 60_000);
  }
});

describe('R2-E writers — the fixes on the real schema', () => {
  it('a removed showcase post is not re-published or hidden (approve after a platform removal)', async () => {
    const { KyselyNailShowcaseRepository } = W;
    const repo = new KyselyNailShowcaseRepository(db);
    const r = await rowIn(W.NAIL_SHOWCASE_POST, 'published'); const id = r.id;
    await repo.softDeletePost(id);
    expect(await stateOf(W.NAIL_SHOWCASE_POST, r)).toBe('removed');
    await expect(repo.setPostStatus(id, 'published')).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION', status: 409 });
    await expect(repo.setPostStatus(id, 'hidden')).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
    expect(await stateOf(W.NAIL_SHOWCASE_POST, r)).toBe('removed');
    await repo.softDeletePost(id);   // removing again stays a no-op move
  });
  it('a decided report is not re-opened', async () => {
    const repo = new W.KyselyNailShowcaseRepository(db);
    const r = await rowIn(W.NAIL_SHOWCASE_REPORT, 'open');
    await repo.resolveReport(r.id, 'action_taken', randomUUID());
    await expect(repo.resolveReport(r.id, 'open', randomUUID())).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
    expect(await stateOf(W.NAIL_SHOWCASE_REPORT, r)).toBe('action_taken');
  });
  it('a late provider callback does not move a delivered SMS back to sent', async () => {
    const repo = new C.KyselyNotificationsRepository(db);
    const r = await rowIn(C.NOTIFICATION, 'sent'); const sid = `SM${r.id.replace(/-/g, '')}`;
    await pg.query(`update notifications set provider_id = $1 where id = $2`, [sid, r.id]);
    expect((await repo.updateDeliveryByProvider(sid, 'delivered', null, new Date().toISOString())).updated).toBe(1);
    expect((await repo.updateDeliveryByProvider(sid, 'sent', null, null)).updated).toBe(0);
    expect(await stateOf(C.NOTIFICATION, r)).toBe('delivered');
    expect((await repo.updateDeliveryByProvider(sid, 'delivered', null, new Date().toISOString())).updated).toBe(1);   // a repeat stays harmless
  });
});
