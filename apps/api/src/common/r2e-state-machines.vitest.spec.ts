// r2e-state-machines.vitest — BUILD_PLAN Phase 12 round 2 (#27): the workforce, communications and apps/api status
// machines, on the MIGRATED schema.
//   1. every machine's table.column has a vocabulary CHECK and every state is in it; the static scan sees every machine;
//   2. each machine's transition table, written out (a changed table is a reviewed change), with the dangerous moves the
//      old unconditional writers allowed now REFUSED;
// (3 and 4 — the real tables and the writers — are r2e-state-machines.pgtest.vitest.spec.ts.)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StateMachine } from '@aipowersalon/database';
import * as WF from '@aipowersalon/workforce';
import * as CM from '@aipowersalon/communications';
import { API_OPERATION } from './async-export/operation-lifecycle';
import { OUTBOX_EVENT, EVENT_DEAD_LETTER } from '../events/event-lifecycles';
import { WEBHOOK_DELIVERY } from '../api-webhooks/webhook-delivery-lifecycle';
import { DISPLAY_RECEIPT } from '../customer-display/display-receipt-lifecycle';
import { STATUS_COMPONENT } from '../observability/status-component-lifecycle';
import { STATUS_INCIDENT } from '../super-admin-system-status/incident-lifecycle';
const { inventory }: any = await import('../../scripts/audit-state-transitions.mjs');

const W = WF as any, C = CM as any;
const WORKFORCE: StateMachine[] = [W.APPROVAL_REQUEST, W.ACCESS_REVIEW, W.COMPENSATION_AGREEMENT, W.BONUS_RULE, W.TIER_PLAN, W.COMPENSATION_POLICY_VERSION,
  W.NAIL_SHOWCASE_POST, W.NAIL_SHOWCASE_COMMENT, W.NAIL_SHOWCASE_REPORT, W.TECH_SALON_MEMBERSHIP, W.TECH_PORTFOLIO_PHOTO, W.TECH_DM_THREAD, W.TECH_DM_REPORT];
const COMMS: StateMachine[] = [C.CAMPAIGN, C.PLATFORM_ANNOUNCEMENT, C.CAMPAIGN_TEMPLATE, C.CAMPAIGN_COMPLIANCE_FLAG, C.TENANT_MESSAGING_LIMIT, C.COMMUNICATION_PROVIDER,
  C.MESSAGE_TEMPLATE_VERSION, C.MESSAGE_TEMPLATE, C.COMMUNICATION_THREAD, C.FOLLOW_UP_TASK, C.FOLLOW_UP_GENERATION_RUN, C.NOTIFICATION, C.SMS_RECONCILIATION_FINDING, C.TENANT_MESSAGING_CREDENTIALS];
const API: StateMachine[] = [API_OPERATION, OUTBOX_EVENT, EVENT_DEAD_LETTER, WEBHOOK_DELIVERY, DISPLAY_RECEIPT, STATUS_COMPONENT, STATUS_INCIDENT];
const ALL = [...WORKFORCE, ...COMMS, ...API];
const VOCAB = JSON.parse(readFileSync(join(__dirname, '..', '..', 'db/state-vocabularies.generated.json'), 'utf8')).vocabularies;

describe('R2-E machines — vocabulary and the static scan', () => {
  it('every machine governs a CHECKed column and every state is in it', () => {
    for (const m of ALL) {
      const v = VOCAB[`${m.table}.${m.column}`];
      expect(v, `${m.name}`).toBeTruthy();
      for (const s of m.states) expect(v, `${m.name} '${s}'`).toContain(s);
    }
  });
  it('every transition table, written out (a changed move is a reviewed snapshot change)', () => {
    const moves = (m: StateMachine) => m.states.flatMap((f) => m.states.filter((t) => m.can(f, t)).map((t) => `${f}>${t}`)).sort();
    expect(Object.fromEntries(ALL.map((m) => [m.name, moves(m)]))).toMatchSnapshot();
  });
  it('the static scan (check:state-transitions) finds every machine', () => {
    const names = new Set(inventory().machines.map((x: any) => x.name));
    for (const m of ALL) expect(names.has(m.name), m.name).toBe(true);
  });
});

describe('R2-E machines — the dangerous moves the old writers allowed are refused', () => {
  const refused: Array<[StateMachine, string, string]> = [
    [W.COMPENSATION_POLICY_VERSION, 'canceled', 'scheduled'], [W.COMPENSATION_POLICY_VERSION, 'canceled', 'active'], [W.COMPENSATION_POLICY_VERSION, 'replaced', 'active'],
    [W.NAIL_SHOWCASE_POST, 'removed', 'published'], [W.NAIL_SHOWCASE_POST, 'removed', 'hidden'], [W.NAIL_SHOWCASE_COMMENT, 'removed', 'hidden'],
    [W.NAIL_SHOWCASE_REPORT, 'action_taken', 'open'], [W.NAIL_SHOWCASE_REPORT, 'dismissed', 'reviewed'],
    [W.TECH_SALON_MEMBERSHIP, 'paused', 'pending_salon_approval'], [W.TECH_SALON_MEMBERSHIP, 'suspended', 'active'], [W.TECH_SALON_MEMBERSHIP, 'revoked', 'active'],
    [W.TECH_DM_REPORT, 'resolved', 'resolved'], [W.APPROVAL_REQUEST, 'rejected', 'approved'], [W.APPROVAL_REQUEST, 'executed', 'executed'],
    [C.NOTIFICATION, 'delivered', 'sent'], [C.NOTIFICATION, 'failed', 'sent'], [C.CAMPAIGN_COMPLIANCE_FLAG, 'cleared', 'actioned'],
    [C.FOLLOW_UP_TASK, 'sent', 'skipped'], [C.FOLLOW_UP_TASK, 'sent', 'dismissed'], [C.MESSAGE_TEMPLATE, 'archived', 'published'], [C.CAMPAIGN, 'completed', 'in_progress'],
    [WEBHOOK_DELIVERY, 'delivered', 'pending'], [WEBHOOK_DELIVERY, 'dead', 'pending'], [OUTBOX_EVENT, 'published', 'claimed'], [STATUS_INCIDENT, 'resolved', 'monitoring'],
    [API_OPERATION, 'succeeded', 'running'], [DISPLAY_RECEIPT, 'sent', 'sending'],
  ];
  for (const [m, f, t] of refused) it(`${m.name}: ${f} → ${t} is refused`, () => expect(m.can(f, t)).toBe(false));
  const kept: Array<[StateMachine, string, string]> = [
    [W.COMPENSATION_POLICY_VERSION, 'draft', 'scheduled'], [W.COMPENSATION_POLICY_VERSION, 'scheduled', 'active'], [W.COMPENSATION_POLICY_VERSION, 'active', 'replaced'],
    [W.NAIL_SHOWCASE_POST, 'hidden', 'published'], [W.NAIL_SHOWCASE_POST, 'published', 'removed'], [W.TECH_SALON_MEMBERSHIP, 'former', 'pending_salon_approval'],
    [W.TECH_SALON_MEMBERSHIP, 'paused', 'active'], [W.APPROVAL_REQUEST, 'pending', 'approved'], [W.APPROVAL_REQUEST, 'approved', 'executed'],
    [C.NOTIFICATION, 'sent', 'delivered'], [C.NOTIFICATION, 'delivered', 'delivered'], [C.CAMPAIGN, 'scheduled', 'draft'], [C.FOLLOW_UP_TASK, 'pending', 'expired'],
    [WEBHOOK_DELIVERY, 'failed', 'pending'], [OUTBOX_EVENT, 'claimed', 'pending'], [EVENT_DEAD_LETTER, 'resolved', 'open'], [STATUS_INCIDENT, 'investigating', 'resolved'],
    [API_OPERATION, 'running', 'queued'],
  ];
  for (const [m, f, t] of kept) it(`${m.name}: ${f} → ${t} still works (today's move)`, () => expect(m.can(f, t)).toBe(true));
});

