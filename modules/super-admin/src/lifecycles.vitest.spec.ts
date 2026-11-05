// BUILD_PLAN Phase 12 (#27): the Super Admin lifecycle machines (lifecycles.ts). Every machine names a real vocabulary
// column and only states its CHECK allows; the machines that reuse a service-side transition table are EXACTLY that
// table (so the service's check and the conditional UPDATE can never disagree); each machine allows today's moves
// and refuses the ones Phase 12 closed (reviving a finished record, re-applying money, re-deciding a decision).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { assertTransition, InvalidStateTransitionError, type StateMachine } from '@aipowersalon/database';
import * as L from './lifecycles';
import { canDeliveryTransition } from './super-admin-ai-reports/report-delivery-core';
import { canScheduleTransition } from './super-admin-ai-reports/report-schedule-core';
import { canVersionTransition } from './super-admin-ai-reports/narrative-provenance-core';
import { canTransitionLegalStatus } from './super-admin-legal/legal-document-core';
import { canGrantTransition } from './super-admin-security/grant-core';
import { canTransition as canIncidentTransition } from './super-admin-security/incident-core';
import { canLockdownTransition } from './super-admin-security/lockdown-core';
import { canBlockTransition } from './super-admin-security/ip-block-core';
import { canTransition as canTenantTransition } from './super-admin-tenants/super-admin-tenants-core';
import { canTransitionSettlement } from '@aipowersalon/gift-cards';
import { decideTransition } from './super-admin-platform/access-request-core';

const VOCAB: Record<string, string[]> = JSON.parse(readFileSync(new URL('../../../apps/api/db/state-vocabularies.generated.json', import.meta.url), 'utf8')).vocabularies;
const machines = Object.entries(L).filter(([, v]) => v && typeof v === 'object' && 'sourcesOf' in (v as object)) as Array<[string, StateMachine<string>]>;
const moves = (m: StateMachine<string>) => m.states.flatMap((f) => m.states.map((t) => [f, t] as const));

describe('Super Admin lifecycle machines', () => {
  it('there are 64 of them (62 from round 2 + ALERT and TENANT_WEBHOOK at integration), each on a vocabulary column, with only CHECK-allowed states', () => {
    expect(machines).toHaveLength(64);
    expect(machines.map(([k]) => k)).toEqual(expect.arrayContaining(['ALERT', 'TENANT_WEBHOOK']));
    for (const [k, m] of machines) {
      const v = VOCAB[`${m.table}.${m.column}`];
      expect(v, `${k}: ${m.table}.${m.column} has a vocabulary`).toBeTruthy();
      for (const s of m.states) expect(v, `${k}: state ${s}`).toContain(s);
    }
  });

  // the service-side transition tables these machines reuse: identical decisions for every pair of states
  const same: Array<[StateMachine<string>, (f: string, t: string) => boolean]> = [
    [L.AI_REPORT_DELIVERY, canDeliveryTransition], [L.AI_REPORT_SCHEDULE, canScheduleTransition], [L.AI_NARRATIVE_MODEL_VERSION, canVersionTransition],
    [L.LEGAL_DOCUMENT_VERSION, (f, t) => canTransitionLegalStatus(f as any, t as any)], [L.PRIVILEGED_ACCESS_GRANT, canGrantTransition],
    [L.SECURITY_INCIDENT, canIncidentTransition], [L.EMERGENCY_LOCKDOWN, canLockdownTransition], [L.IP_BLOCK_RULE, canBlockTransition],
    [L.GIFT_CARD_SETTLEMENT_BATCH, canTransitionSettlement],
  ];
  for (const [m, fn] of same) it(`${m.name} is exactly the service's own transition table`, () => {
    for (const [f, t] of moves(m)) expect(m.can(f, t), `${f} → ${t}`).toBe(fn(f, t));
  });
  it('tenant is exactly canTransition (super-admin-tenants-core) for every action target', () => {
    for (const [f, t] of moves(L.TENANT)) {
      const viaAction = (['activate', 'reactivate', 'suspend', 'cancel'] as const).some((a) => { const r = canTenantTransition(f as any, a); return r.ok && r.to === t; });
      expect(L.TENANT.can(f, t), `${f} → ${t}`).toBe(viaAction);
    }
  });
  it('access_request is exactly decideTransition (access-request-core) + the approved → expired sweep', () => {
    for (const [f, t] of moves(L.ACCESS_REQUEST)) {
      const viaAction = (['review', 'approve', 'reject', 'cancel'] as const).some((a) => { const r = decideTransition(f, a); return r.ok && r.next === t; });
      expect(L.ACCESS_REQUEST.can(f, t), `${f} → ${t}`).toBe(viaAction || (f === 'approved' && t === 'expired'));
    }
  });

  const cases: Array<[StateMachine<string>, string, string, boolean, string?]> = [
    // money
    [L.REVENUE_ADJUSTMENT, 'pending_approval', 'applied', true], [L.REVENUE_ADJUSTMENT, 'pending_second_approval', 'applied', true],
    [L.REVENUE_ADJUSTMENT, 'applied', 'applied', false, 'applied once (one ledger entry)'], [L.REVENUE_ADJUSTMENT, 'reversed', 'reversed', false, 'reversed once'],
    [L.REVENUE_ADJUSTMENT, 'rejected', 'applied', false], [L.REVENUE_ADJUSTMENT, 'applied', 'reversed', true],
    [L.BILLING_INVOICE, 'open', 'paid', true], [L.BILLING_INVOICE, 'void', 'paid', false, 'a void invoice never comes back as paid'],
    [L.BILLING_INVOICE, 'refunded', 'failed', false], [L.BILLING_INVOICE, 'draft', 'open', true], [L.BILLING_INVOICE, 'paid', 'open', false],
    [L.BILLING_CREDIT, 'applied', 'active', false, 'a used credit is never re-activated'], [L.BILLING_CREDIT, 'active', 'applied', true],
    [L.PARTNER_PAYOUT, 'calculated', 'approved', true], [L.PARTNER_PAYOUT, 'approved', 'approved', false], [L.PARTNER_PAYOUT, 'paid', 'approved', false],
    [L.TENANT_INCENTIVE, 'approved', 'approved', false], [L.REVENUE_ACCOUNTING_PERIOD, 'locked', 'locked', false], [L.REVENUE_ACCOUNTING_PERIOD, 'locked', 'reopened', true],
    [L.GIFT_CARD_CLEARING_ENTRY, 'pending', 'ready', true], [L.GIFT_CARD_CLEARING_ENTRY, 'settled', 'approved', false], [L.GIFT_CARD_CLEARING_ENTRY, 'reversed', 'settled', false],
    // decisions decided once
    [L.WORKER_TRANSFER_REQUEST, 'requested', 'approved', true], [L.WORKER_TRANSFER_REQUEST, 'rejected', 'approved', false, 'a rejected transfer never moves the worker'],
    [L.WORKER_CROSS_TENANT_TRANSFER_REQUEST, 'approved', 'rejected', false], [L.CUSTOMER_DELETION_REQUEST, 'approved', 'executed', true],
    [L.CUSTOMER_DELETION_REQUEST, 'requested', 'executed', false, 'never executed without a second reviewer'], [L.CUSTOMER_DELETION_REQUEST, 'executed', 'rejected', false],
    [L.ONBOARDING_APPROVAL, 'pending', 'pending', true, 'first half of a two-person approval'], [L.ONBOARDING_APPROVAL, 'approved', 'rejected', false],
    [L.ONBOARDING_DOCUMENT, 'approved', 'rejected', false], [L.GLOBAL_TECH_DELETE_REQUEST, 'rejected', 'completed', false], [L.GLOBAL_TECH_DELETE_REQUEST, 'approved', 'completed', true],
    [L.INTEGRATION_OAUTH_STATE, 'consumed', 'consumed', false, 'an OAuth state is single use'], [L.INTEGRATION_CREDENTIAL, 'revoked', 'active', false],
    // imports / jobs run once
    [L.CUSTOMER_IMPORT_ROW, 'valid', 'imported', true], [L.CUSTOMER_IMPORT_ROW, 'imported', 'imported', false, 'a row is imported once'],
    [L.CUSTOMER_IMPORT_JOB, 'approved', 'processing', true], [L.CUSTOMER_IMPORT_JOB, 'processing', 'processing', false, 'two workers cannot claim one job'],
    [L.PRODUCT_IMPORT_JOB, 'cancelled', 'imported', false, 'a cancelled import is never approved'], [L.PRODUCT_IMPORT_JOB, 'ready', 'imported', true],
    [L.BILLING_EXPORT_JOB, 'pending', 'processing', true], [L.BILLING_EXPORT_JOB, 'ready', 'processing', false], [L.REVENUE_EXPORT_JOB, 'completed', 'failed', false],
    // lifecycles
    [L.AI_INSIGHT, 'new', 'in_review', true], [L.AI_INSIGHT, 'dismissed', 'in_review', false, 'bulk review no longer re-opens a dismissed insight'],
    [L.AI_INSIGHT, 'resolved', 'follow_up_assigned', false], [L.CUSTOMER_PRIVACY_REQUEST, 'completed', 'processing', false, 'a closed privacy request stays closed'],
    [L.CUSTOMER_PRIVACY_REQUEST, 'new', 'completed', true], [L.TENANT, 'cancelled', 'active', false], [L.TENANT, 'suspended', 'active', true],
    [L.TENANT_AI_PLAN_SUBSCRIPTION, 'cancelled', 'trialing', true], [L.GLOBAL_TECH_PROFILE, 'anonymized', 'active', false], [L.GLOBAL_TECH_PROFILE, 'merged', 'suspended', false],
    [L.GLOBAL_TECH_PROFILE, 'locked', 'active', true], [L.AUDIT_LEGAL_HOLD, 'released', 'active', false], [L.SERVICE_TEMPLATE, 'retired', 'published', false],
    [L.CHARGEBACK_EVIDENCE, 'expired', 'submitted', false], [L.CHARGEBACK_EVIDENCE, 'collecting', 'submitted', true], [L.BOOKING_CHECKIN_FAILED_EVENT, 'not_retryable', 'retrying', false],
    [L.PAYROLL_SYNC_EVENT, 'synced', 'retrying', false], [L.TENANT_WARNING_DELIVERY, 'sent', 'sent', false], [L.SECURITY_AUDIT_FINDING, 'resolved', 'reopened', true],
  ];
  for (const [m, from, to, ok, why] of cases) it(`${m.name}: ${from} → ${to} ${ok ? 'allowed' : 'refused'}${why ? ` (${why})` : ''}`, () => {
    if (ok) expect(() => assertTransition(m, from, to)).not.toThrow();
    else {
      let err: unknown; try { assertTransition(m, from, to); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(InvalidStateTransitionError);
      expect((err as InvalidStateTransitionError).status).toBe(409);
    }
  });
});
