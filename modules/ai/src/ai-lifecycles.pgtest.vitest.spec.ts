// BUILD_PLAN Phase 12 (#27): the AI lifecycles. (1) The schedule_recommendation machine IS the workflow table (every
// event and every composite staff decision), and the pure tables the services kept now read from the machines.
// (2) On the REAL schema, the dangerous moves the old unconditional writes allowed are refused: a closed follow-up is not
// re-opened by assigning it, an archived agent is not revived by provisioning, a deleted transcript is not revived by a
// replayed ingest, a resolved investigation is not resolved again, a learning suggestion is approved once, an applied
// recommendation does not go back.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { permissionsFor } from '@aipowersalon/permissions';
import { transition as recTransition } from './ai-scheduling-optimizer/ai-scheduling-workflow';
import {
  SCHEDULE_RECOMMENDATION, AI_RECEPTIONIST_AGENT, AI_RECEPTIONIST_FOLLOW_UP, MONEY_PROTECTION_INVESTIGATION, REVIEW_ESCALATION, TENANT_AI_SUBSCRIPTION, AI_BILLING_RECONCILIATION_RUN,
} from './ai-lifecycles';
import { canTransitionAgent } from './voice-booking/ai-agent-core';
import { canTransitionFollowUp, AiFollowUpService, KyselyFollowUpRepo } from './voice-booking/ai-follow-up.service';
import { KyselyAgentRepo } from './voice-booking/ai-agent.service';
import { KyselyVoiceTranscriptionRepository } from './ai-voice-transcription/ai-voice-transcription.kysely.repository';
import { KyselyInvestigationRepository } from './ai-money-protection/ai-money-protection-investigations.kysely.repository';
import { STATUS_TRANSITIONS } from './ai-money-protection/ai-money-protection-investigations.dto';
import { transitionEscalation } from './ai-review-reputation/ai-review-reputation-recovery';
import { ReceptionCopilotLearningService } from './ai-center/reception-copilot-learning.service';
import { KyselySchedStore } from './ai-scheduling-optimizer/ai-scheduling.kysely.repository';
import { applyAiBillingEvent } from './ai/ai-subscription-billing-core';

describe('the machines are the tables the services use', () => {
  it('schedule_recommendation: every workflow edge is a machine move; nothing reaches applied except through application_pending or the automation', () => {
    const events = ['submit_for_review', 'start_review', 'accept', 'partial_accept', 'reject', 'return', 'customer_approve', 'customer_reject', 'queue_application', 'apply_ok', 'apply_fail', 'retry', 'rollback', 'expire', 'supersede'] as const;
    for (const s of SCHEDULE_RECOMMENDATION.states) for (const e of events) for (const rc of [true, false]) {
      const t = recTransition(s as any, e as any, { requiresCustomerApproval: rc });
      if (t.ok) expect(SCHEDULE_RECOMMENDATION.can(s, t.state), `${s} -${e}-> ${t.state}`).toBe(true);
    }
    expect(SCHEDULE_RECOMMENDATION.sourcesOf('applied').sort()).toEqual(['application_pending', 'generated', 'review_required']);
    expect(SCHEDULE_RECOMMENDATION.can('review_required', 'customer_approval_required')).toBe(true);   // the composite staff accept
    expect(SCHEDULE_RECOMMENDATION.can('applied', 'generated')).toBe(false);
  });
  it('agents / follow-ups / investigations / escalations read their table from the machine (one table each)', () => {
    // AI Front Desk guide (Oct 31): the plain status route never makes an agent live — that move exists only in front-desk-center
    // (routing evidence + owner approval); the machine itself still allows it there
    expect(canTransitionAgent('ready', 'live')).toBe(false); expect(AI_RECEPTIONIST_AGENT.can('ready', 'live')).toBe(true); expect(canTransitionAgent('draft', 'ready')).toBe(false); expect(canTransitionAgent('archived', 'draft')).toBe(false);
    expect(AI_RECEPTIONIST_AGENT.can('archived', 'ready')).toBe(false);
    expect(canTransitionFollowUp('closed', 'assigned')).toBe(false); expect(AI_RECEPTIONIST_FOLLOW_UP.can('open', 'assigned')).toBe(true);
    expect(STATUS_TRANSITIONS.RESOLVED).toEqual([...MONEY_PROTECTION_INVESTIGATION.transitions.RESOLVED!]); expect(STATUS_TRANSITIONS.OPEN).not.toContain('RESOLVED');
    expect(MONEY_PROTECTION_INVESTIGATION.can('RESOLVED', 'RESOLVED')).toBe(false); expect(MONEY_PROTECTION_INVESTIGATION.can('CLOSED', 'RESOLVED')).toBe(false);
    expect(() => transitionEscalation('resolved', 'acknowledged')).toThrow(); expect(REVIEW_ESCALATION.can('open', 'resolved')).toBe(true);
    // the billing event table never asks for a move the subscription machine does not list
    for (const s of TENANT_AI_SUBSCRIPTION.states) for (const e of ['payment_succeeded', 'payment_failed', 'refunded', 'subscription_cancelled', 'trial_expired', 'paused', 'resumed', 'disabled', 'enabled']) {
      const t = applyAiBillingEvent(s as any, e); if (t.ok) expect(TENANT_AI_SUBSCRIPTION.can(s, t.status)).toBe(true);
    }
  });
});

const id = (n: number) => `a1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), U = id(2);
let pg: any; let db: any; let seq = 100;
const q = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows as any[];
const ctx = { tenantId: T, branchId: null, userId: U, role: 'OWNER', permissions: [...permissionsFor('OWNER' as any), 'ai.manage', 'ai.use', 'reception_copilot.approve_learning'] };

beforeAll(async () => {
  pg = await migratedPglite();
  db = kyselyFor(pg);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'AI Life LLC','AI Life','ai-life','AILIFE','active')`, [T]);
  await q(`insert into users (id, tenant_id, role, email, full_name, status) values ($1,$2,'OWNER','o@ai-life.test','Olive','active')`, [U, T]);
}, 120_000);

describe('AI billing reconciliation runs', () => {
  it('a run finishes once: running → succeeded | partial | failed; a finished run is never re-finished', () => {
    expect(['succeeded', 'partial', 'failed'].map((t) => AI_BILLING_RECONCILIATION_RUN.can('running', t))).toEqual([true, true, true]);
    expect(AI_BILLING_RECONCILIATION_RUN.can('succeeded', 'failed')).toBe(false);
    expect(AI_BILLING_RECONCILIATION_RUN.can('failed', 'running')).toBe(false);
  });
});

describe('the machines on the real schema', () => {
  it('a CLOSED follow-up is not re-opened by assigning it (the assignee changes, the status stays); an open one moves to assigned', async () => {
    const svc = new AiFollowUpService(new KyselyFollowUpRepo(db));
    const closed = id(seq++), open = id(seq++);
    await q(`insert into ai_receptionist_follow_ups (id, tenant_id, reason, status) values ($1,$3,'CALLBACK','closed'), ($2,$3,'CALLBACK','open')`, [closed, open, T]);
    expect((await svc.assign(ctx as any, closed, U)).status).toBe('closed');
    expect((await q(`select status, assigned_user_id from ai_receptionist_follow_ups where id = $1`, [closed]))[0]).toEqual({ status: 'closed', assigned_user_id: U });
    expect((await svc.assign(ctx as any, open, U)).status).toBe('assigned');
  });
  it('provisioning never revives an ARCHIVED agent; a paused one moves to ready', async () => {
    const repo = new KyselyAgentRepo(db);
    const archived = id(seq++), paused = id(seq++);
    await q(`insert into ai_receptionist_agents (id, tenant_id, name, status) values ($1,$3,'Old','archived'), ($2,$3,'Front','paused')`, [archived, paused, T]);
    await expect(repo.setProvisioned(T, archived, 'agent_x')).rejects.toThrow(/archived/);
    await repo.setProvisioned(T, paused, 'agent_y');
    expect((await q(`select status from ai_receptionist_agents where id in ($1,$2) order by name`, [paused, archived])).map((r) => r.status)).toEqual(['ready', 'archived']);
  });
  it('a DELETED transcript is not revived by a replayed ingest (status kept, nothing re-written)', async () => {
    const repo = new KyselyVoiceTranscriptionRepository(db);
    await q(`insert into call_transcripts (tenant_id, provider, provider_call_id, status, redaction_status, deleted_at) values ($1,'retell','call_del','deleted','not_required', now())`, [T]);
    const { header, created } = await repo.upsertTranscript({ tenantId: T, branchId: null } as any, {
      provider: 'retell', providerCallId: 'call_del', customerId: null, direction: 'inbound', handler: 'ai', status: 'completed', primaryLanguage: 'en', languageConfidence: 0.9,
      mixedLanguage: false, redactionStatus: 'pending', confidence: 0.9, durationSeconds: 60, providerTranscriptRef: null, retentionExpiresAt: null,
    } as any);
    expect(created).toBe(false);
    expect(header.status).toBe('deleted');
    expect((await q(`select status from call_transcripts where tenant_id = $1 and provider_call_id = 'call_del'`, [T]))[0].status).toBe('deleted');
  });
  it('a RESOLVED investigation is not resolved again (its recovery amount kept); a stale writer gets null', async () => {
    const repo = new KyselyInvestigationRepository(db);
    const inv = id(seq++);
    await q(`insert into money_protection_investigations (id, tenant_id, title, created_by_user_id, status, recovery_amount_cents) values ($1,$2,'Voids',$3,'RESOLVED',2500)`, [inv, T, U]);
    expect(await repo.update(ctx as any, inv, { status: 'RESOLVED', fromStatus: 'RESOLVED', recoveryAmountCents: 9999 } as any)).toBeNull();
    expect(await repo.update(ctx as any, inv, { status: 'CLOSED', fromStatus: 'INVESTIGATING' } as any)).toBeNull();
    expect((await q(`select status, recovery_amount_cents from money_protection_investigations where id = $1`, [inv]))[0]).toEqual({ status: 'RESOLVED', recovery_amount_cents: 2500 });
    expect((await repo.update(ctx as any, inv, { status: 'CLOSED', fromStatus: 'RESOLVED' } as any))?.status).toBe('CLOSED');
  });
  it('a learning suggestion is approved ONCE: the second approval is told it is no longer open, one knowledge version', async () => {
    const svc = new ReceptionCopilotLearningService(db, {} as any);
    const sid = id(seq++);
    await q(`insert into reception_copilot_learning_suggestions (id, tenant_id, kind, suggestion, status) values ($1,$2,'faq','We close at 7','open')`, [sid, T]);
    expect((await svc.approveSuggestion(ctx as any, sid)).approved).toBe(true);
    await expect(svc.approveSuggestion(ctx as any, sid)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await q(`select count(*)::int n from reception_copilot_knowledge_versions where tenant_id = $1 and source_suggestion_id = $2`, [T, sid]))[0].n).toBe(1);
  });
  it('an APPLIED recommendation cannot be moved back to review (the conditional write refuses it)', async () => {
    const store = new KyselySchedStore(db);
    const rid = id(seq++);
    await q(`insert into schedule_optimization_recommendations (id, tenant_id, type, status, version) values ($1,$2,'reschedule','applied',3)`, [rid, T]);
    expect(await store.casRec(T, rid, 3, ['applied'], { status: 'review_required' } as any)).toBeNull();
    expect((await store.casRec(T, rid, 3, ['applied'], { status: 'rolled_back' } as any))?.status).toBe('rolled_back');
  });
});
