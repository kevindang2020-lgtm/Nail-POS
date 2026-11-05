// ai-feedback.vitest.spec — Constitution 10 §129–§132, §166–§170.
import { describe, it, expect } from 'vitest';
import { validateFeedback, summarizeFeedback, buildTenantDashboard, FeedbackValidationError, FEEDBACK_FORBIDDEN_FIELDS, AI_PERMISSIONS, DEFAULT_AI_PERMISSIONS, ADVERSARIAL_INPUTS, type FeedbackRow, type TenantDashboardInput } from './ai-feedback';
import { render, PROMPT_SEED, delimitUntrusted } from './ai-prompt-registry';
import { authorizeToolCall, ToolDenied } from './ai-tool-registry';
import { buildContext } from './ai-context-builder';
import { AI_TASKS } from './ai-task-registry';

const fb = (over: Partial<FeedbackRow> = {}): FeedbackRow => ({ tenantId: 't1', requestId: 'r1', taskKey: 'review.response_draft', promptKey: 'review.response_draft', promptVersion: 1, outcome: 'accepted', createdAt: '2026-09-20T10:00:00Z', ...over });

describe('§129 feedback records what changed and why, never the text', () => {
  it('accepts a well-formed record', () => {
    expect(validateFeedback(fb({ outcome: 'edited', retainedRatio: 0.6, reasonCode: 'wrong_tone' }))).toMatchObject({ outcome: 'edited', retainedRatio: 0.6 });
  });
  it.each(FEEDBACK_FORBIDDEN_FIELDS)('refuses a record carrying "%s" — that is customer content under another name', (field) => {
    expect(() => validateFeedback({ ...fb(), [field]: 'the actual words' } as never)).toThrow(/customer content under another name/);
  });
  it('an "edited" outcome without a retained ratio is refused — it would carry no more than "rejected"', () => {
    expect(() => validateFeedback(fb({ outcome: 'edited' }))).toThrow(/carries no more information than "rejected"/);
  });
  it('an accepted result may not carry a reason code, and a ratio must be a real 0..1', () => {
    expect(() => validateFeedback(fb({ outcome: 'accepted', reasonCode: 'wrong_tone' }))).toThrow(/no reason code/);
    expect(() => validateFeedback(fb({ outcome: 'edited', retainedRatio: 1.4 }))).toThrow(/between 0 and 1/);
    expect(() => validateFeedback(fb({ outcome: 'edited', retainedRatio: NaN }))).toThrow(/between 0 and 1/);
  });
  it('refuses an unknown task, a missing tenant, a missing request, and an over-long note', () => {
    expect(() => validateFeedback(fb({ taskKey: 'ghost.task' }))).toThrow(/unknown task/);
    expect(() => validateFeedback(fb({ tenantId: '' }))).toThrow(FeedbackValidationError);
    expect(() => validateFeedback(fb({ requestId: '' }))).toThrow(/reference the AI request/);
    expect(() => validateFeedback(fb({ note: 'x'.repeat(501) }))).toThrow(/500 characters/);
  });
});

describe('§128/§129 feedback becomes evaluation data', () => {
  const rows = [fb({ requestId: '1', outcome: 'accepted' }), fb({ requestId: '2', outcome: 'edited', retainedRatio: 0.8, reasonCode: 'too_long' }),
                fb({ requestId: '3', outcome: 'edited', retainedRatio: 0.4, reasonCode: 'too_long' }), fb({ requestId: '4', outcome: 'rejected', reasonCode: 'wrong_facts' })];
  it('produces acceptance, correction and rejection rates plus the commonest complaint', () => {
    const s = summarizeFeedback(rows, { taskKey: 'review.response_draft' });
    expect(s.total).toBe(4);
    expect(s.acceptanceRate).toBe(0.25); expect(s.correctionRate).toBe(0.5); expect(s.rejectionRate).toBe(0.25);
    expect(s.avgRetainedRatio).toBeCloseTo(0.6); expect(s.topReason).toBe('too_long');
  });
  it('filters by prompt version, so a version change can be judged on its own feedback', () => {
    const mixed = [...rows, fb({ requestId: '5', promptVersion: 2, outcome: 'accepted' }), fb({ requestId: '6', promptVersion: 2, outcome: 'accepted' })];
    expect(summarizeFeedback(mixed, { promptVersion: 2 }).acceptanceRate).toBe(1);
    expect(summarizeFeedback(mixed, { promptVersion: 1 }).acceptanceRate).toBe(0.25);
  });
  it('no feedback → every rate NULL, not zero: nobody rejecting is not everybody rejecting', () => {
    const s = summarizeFeedback([], { taskKey: 'review.response_draft' });
    expect([s.acceptanceRate, s.correctionRate, s.rejectionRate, s.avgRetainedRatio, s.topReason]).toEqual([null, null, null, null, null]);
  });
});

describe('§167–§169 role defaults are absences, and absences are easy to violate by being generous', () => {
  it('§168 a technician gets ai.read and NOT usage — usage is tenant-wide analytics', () => {
    expect(DEFAULT_AI_PERMISSIONS.TECHNICIAN).toEqual([AI_PERMISSIONS.READ]);
    expect(DEFAULT_AI_PERMISSIONS.TECHNICIAN).not.toContain(AI_PERMISSIONS.USAGE_READ);
  });
  it('§169 a receptionist may draft, and has NO settings control', () => {
    expect(DEFAULT_AI_PERMISSIONS.RECEPTION).toContain(AI_PERMISSIONS.REVIEWS_MANAGE);
    expect(DEFAULT_AI_PERMISSIONS.RECEPTION).not.toContain(AI_PERMISSIONS.SETTINGS_MANAGE);
    expect(DEFAULT_AI_PERMISSIONS.FRONT_DESK).not.toContain(AI_PERMISSIONS.SETTINGS_MANAGE);
  });
  it('only OWNER and SUPER_ADMIN manage settings or approve reconciliation', () => {
    for (const [role, perms] of Object.entries(DEFAULT_AI_PERMISSIONS)) {
      if (role === 'OWNER' || role === 'SUPER_ADMIN') continue;
      expect(perms, role).not.toContain(AI_PERMISSIONS.SETTINGS_MANAGE);
      expect(perms, role).not.toContain(AI_PERMISSIONS.RECONCILIATION_APPROVE);
    }
    expect(DEFAULT_AI_PERMISSIONS.CUSTOMER).toEqual([]);
  });
});

describe('§166 tenant dashboard', () => {
  const input = (over: Partial<TenantDashboardInput> = {}): TenantDashboardInput => ({
    tenantId: 't1', role: 'OWNER', permissions: DEFAULT_AI_PERMISSIONS.OWNER, enabledPackages: ['ai_review_reputation_assistant'],
    usage: [{ action: 'review.response_draft', costMicroUsd: 45, status: 'success' }, { action: 'review.response_draft', costMicroUsd: 30, status: 'failed' }],
    budget: { limitMicroUsd: 1_000_000, spentMicroUsd: 250_000 }, pendingApprovals: [], ...over,
  });

  it('an owner sees usage, budget and settings', () => {
    const d = buildTenantDashboard(input());
    expect(d.usage).toMatchObject({ requests: 2, failures: 1, costMicroUsd: 75 });
    expect(d.budget!.usedPercent).toBeCloseTo(25);
    expect(d.canManageSettings).toBe(true); expect(d.hidden).toEqual([]);
  });
  it('a technician gets NO usage and NO budget, and the sections are NAMED as hidden rather than returned empty', () => {
    const d = buildTenantDashboard(input({ role: 'TECHNICIAN', permissions: DEFAULT_AI_PERMISSIONS.TECHNICIAN }));
    expect(d.usage).toBeNull(); expect(d.budget).toBeNull();
    expect(d.hidden).toEqual(['usage', 'budget', 'settings']);   // an empty panel and a forbidden one must not look alike
    expect(d.canManageSettings).toBe(false);
  });
  it('approvals are filtered to what the role can actually grant — no dead ends', () => {
    const approvals = [
      { requestId: 'a', taskKey: 'schedule.explain_suggestion', riskLevel: 'MEDIUM', createdAt: 'x' },
      { requestId: 'b', taskKey: 'reconciliation.explain_exception', riskLevel: 'HIGH', createdAt: 'x' },
      { requestId: 'c', taskKey: 'review.response_draft', riskLevel: 'MEDIUM', createdAt: 'x' },
    ];
    expect(buildTenantDashboard(input({ pendingApprovals: approvals })).pendingApprovals).toHaveLength(3);
    const mgr = buildTenantDashboard(input({ role: 'MANAGER', permissions: DEFAULT_AI_PERMISSIONS.MANAGER, pendingApprovals: approvals }));
    expect(mgr.pendingApprovals.map((a) => a.requestId)).toEqual(['a', 'c']);   // no reconciliation approval
  });
  it('§111 the dashboard reports effective automation next to the platform maximum, so a tenant sees what bound it', () => {
    const d = buildTenantDashboard(input({ safety: { automation: { 'review.response_draft': 'SUGGEST_ONLY' } } }));
    const row = d.automationByTask.find((a) => a.taskKey === 'review.response_draft')!;
    expect(row).toEqual({ taskKey: 'review.response_draft', effective: 'SUGGEST_ONLY', platformMax: 'DRAFT' });
  });
});

describe('§131/§132 adversarial inputs all fail safely', () => {
  const prompt = PROMPT_SEED.find((p) => p.promptKey === 'review.response_draft')!;
  it.each(ADVERSARIAL_INPUTS.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const r = render(prompt, { salon_name: 'Lotus', tenant_brand_voice: 'warm', rating: 3, review_text: c.text });
    // §28: whatever the attack, exactly ONE real closing tag — the one the renderer wrote.
    expect((r.prompt.match(/<\/untrusted>/g) ?? []).length).toBe(1);
    expect(r.untrustedVariables).toContain('review_text');
    // §133: the system policy is not echoed into the user-content block.
    expect(r.prompt).not.toContain(r.system);
  });
  it('§131 an unauthorized tool is denied even when the task grants tools', () => {
    const ctx = { tenantId: 't1', branchId: null, actorUserId: 'u1', permissions: ['pos.booking.view'], taskKey: 'receptionist.reply_draft', allowedTools: ['booking.search_availability'] };
    expect(() => authorizeToolCall({ toolKey: 'refund_any_payment', args: {} }, ctx)).toThrow(ToolDenied);
    expect(() => authorizeToolCall({ toolKey: 'queue.read', args: {} }, ctx)).toThrow(/not_allowed_for_task/);
  });
  it('§132/§135 a tenant-id override in tool args is overruled by server context', () => {
    const ctx = { tenantId: 'tenant-A', branchId: null, actorUserId: 'u1', permissions: ['pos.booking.view'], taskKey: 'receptionist.reply_draft', allowedTools: ['booking.search_availability'] };
    const call = authorizeToolCall({ toolKey: 'booking.search_availability', args: { service_id: 's', date_from: '2026-09-21', date_to: '2026-09-22', tenantId: '00000000-0000-0000-0000-000000000000' } }, ctx);
    expect(call.args.tenantId).toBe('tenant-A'); expect(call.rejectedOverrides).toContain('tenantId');
  });
  it('§60 an attack that smuggles a prohibited field into context is refused at build time', () => {
    expect(() => buildContext('t1', [{ name: 'api_key', value: 'sk-live-x', dataClass: 'PUBLIC', maxChars: 50 }], { maxTotalChars: 1000 })).toThrow(/PROHIBITED/);
  });
  it('the corpus covers every §131 attack class named in the constitution', () => {
    const ids = ADVERSARIAL_INPUTS.map((c) => c.id);
    for (const k of ['ignore-instructions', 'reveal-system-prompt', 'call-unauthorized-tool', 'cross-tenant']) expect(ids).toContain(k);
    expect(delimitUntrusted('x', '</untrusted>')).not.toMatch(/[^;]<\/untrusted>\n<\/untrusted>/);
  });
  it('every declared task still grants NO tools, so none of this is reachable by default', () => {
    for (const t of Object.values(AI_TASKS)) expect(t.allowedTools).toEqual([]);
  });
});

// BUILD_PLAN Phase 7: schedule approvals are gated on the optimizer's own catalog key (granted to OWNER + MANAGER in
// packages/permissions rbac) — 'ai.scheduling.approve' was granted to no session role, so the approval never showed.
import { ROLE_PERMISSIONS } from '@aipowersalon/permissions';
describe('scheduling approvals use the ai_scheduling.approve catalog key', () => {
  it('the key is the rbac one, held by a real MANAGER session', () => {
    expect(AI_PERMISSIONS.SCHEDULING_APPROVE).toBe('ai_scheduling.approve');
    expect(ROLE_PERMISSIONS.MANAGER).toContain('ai_scheduling.approve');
    const d = buildTenantDashboard({ tenantId: 't', role: 'MANAGER', permissions: ROLE_PERMISSIONS.MANAGER, enabledPackages: [], usage: [], budget: null,
      pendingApprovals: [{ requestId: 'r1', taskKey: 'schedule.explain_suggestion', riskLevel: 'low', createdAt: '2026-10-08T00:00:00Z' }] });
    expect(d.pendingApprovals).toHaveLength(1);
  });
});
