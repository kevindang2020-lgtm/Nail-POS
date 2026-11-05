// ai-safety-policy.vitest.spec — Constitution 10 §109–§118.
import { describe, it, expect } from 'vitest';
import { evaluateSafety, stricter, permitsAutomaticAction, citedFactorsAreReal, PLATFORM_MAX_AUTOMATION, AUTOMATION_LEVELS, KILL_SWITCH_CEILING, AUDIT_FORBIDDEN_KEYS, type AiAuditRecord, type AutomationLevel } from './ai-safety-policy';
import { AI_TASKS, MIN_APPROVAL_FOR_RISK, type TaskDefinition } from './ai-task-registry';

describe('§111/§112 automation levels', () => {
  it('every task has a platform ceiling, and the §112 examples are exactly as written', () => {
    for (const k of Object.keys(AI_TASKS)) expect(PLATFORM_MAX_AUTOMATION[k], k).toBeDefined();
    expect(PLATFORM_MAX_AUTOMATION['review.response_draft']).toBe('DRAFT');              // may create a draft
    expect(PLATFORM_MAX_AUTOMATION['queue.explain_recommendation']).toBe('SUGGEST_ONLY'); // may recommend
    expect(PLATFORM_MAX_AUTOMATION['schedule.explain_suggestion']).toBe('APPROVAL_REQUIRED'); // may propose
  });
  it('no ceiling contradicts the task\'s own approval policy — a REVIEW_BEFORE_USE task is never AUTOMATIC', () => {
    for (const [k, t] of Object.entries(AI_TASKS) as [string, TaskDefinition][]) {
      const lvl = PLATFORM_MAX_AUTOMATION[k];
      if (t.approval !== 'NO_APPROVAL') expect(['OFF', 'SUGGEST_ONLY', 'DRAFT', 'APPROVAL_REQUIRED'], `${k} (${t.approval})`).toContain(lvl);
      expect(MIN_APPROVAL_FOR_RISK[t.risk]).toContain(t.approval);
    }
  });
  it('no HIGH-risk task may act automatically', () => {
    for (const [k, t] of Object.entries(AI_TASKS) as [string, TaskDefinition][]) {
      if (t.risk === 'HIGH') expect(permitsAutomaticAction(evaluateSafety(k)), k).toBe(false);
    }
  });
  it('stricter() picks the less autonomous of two levels', () => {
    expect(stricter('AUTOMATIC', 'DRAFT')).toBe('DRAFT');
    expect(stricter('OFF', 'AUTOMATIC')).toBe('OFF');
    expect(stricter('DRAFT', 'DRAFT')).toBe('DRAFT');
    expect(AUTOMATION_LEVELS[0]).toBe('OFF');   // the ordering IS the comparison
  });
});

describe('§110 a tenant may tighten safety, never weaken it', () => {
  it('a tenant CAN tighten below the platform ceiling', () => {
    const d = evaluateSafety('review.response_draft', { tenant: { automation: { 'review.response_draft': 'SUGGEST_ONLY' } } });
    expect(d.automation).toBe('SUGGEST_ONLY'); expect(d.boundBy).toBe('tenant');
  });
  it('a tenant asking for MORE automation gets the platform ceiling, and is told so', () => {
    const d = evaluateSafety('review.response_draft', { tenant: { automation: { 'review.response_draft': 'AUTOMATIC' } } });
    expect(d.automation).toBe('DRAFT'); expect(d.boundBy).toBe('platform');
    expect(d.reasons.join(' ')).toMatch(/platform ceiling DRAFT stands/);
  });
  it('no tenant setting can raise ANY task above its platform ceiling', () => {
    for (const k of Object.keys(AI_TASKS)) {
      const forced = evaluateSafety(k, { tenant: { automation: { [k]: 'AUTOMATIC' } } });
      expect(AUTOMATION_LEVELS.indexOf(forced.automation), k).toBeLessThanOrEqual(AUTOMATION_LEVELS.indexOf(PLATFORM_MAX_AUTOMATION[k]));
    }
  });
  it('a tenant may disable a task entirely (tightening), and a platform suspension does the same', () => {
    expect(evaluateSafety('marketing.content_draft', { tenant: { disabledTasks: ['marketing.content_draft'] } })).toMatchObject({ allowed: false, automation: 'OFF', boundBy: 'task_off' });
    expect(evaluateSafety('marketing.content_draft', { platform: { suspendedTasks: ['marketing.content_draft'] } }).allowed).toBe(false);
  });
  it('§109 tools and PII compose by REMOVAL only', () => {
    const d = evaluateSafety('receptionist.reply_draft', { tenant: { disabledTools: ['booking.search_availability'], allowPiiInText: ['PHONE', 'EMAIL'] } });
    expect(d.allowedTools).toEqual([]);                    // task grants none; a tenant cannot add
    expect(d.allowPiiInText).toEqual([]);                  // platform allows none, so the intersection is empty
  });
});

describe('§113 kill switch: stops actions, not insight', () => {
  it('the platform switch clamps automation to SUGGEST_ONLY but leaves the task ALLOWED', () => {
    const before = evaluateSafety('voice.transcribe');
    expect(permitsAutomaticAction(before)).toBe(true);
    const after = evaluateSafety('voice.transcribe', { platform: { autoActionsDisabled: true } });
    expect(after.automation).toBe(KILL_SWITCH_CEILING);
    expect(after.allowed).toBe(true);                       // §113: read-only insight survives
    expect(permitsAutomaticAction(after)).toBe(false);
    expect(after.boundBy).toBe('platform_kill_switch');
  });
  it('the tenant switch does the same, independently', () => {
    const d = evaluateSafety('voice.summarize', { tenant: { autoActionsDisabled: true } });
    expect(d.automation).toBe('SUGGEST_ONLY'); expect(d.allowed).toBe(true); expect(d.boundBy).toBe('tenant_kill_switch');
  });
  it('a kill switch never RAISES a task that was already below the ceiling', () => {
    const d = evaluateSafety('money.explain_alert', { platform: { autoActionsDisabled: true } });
    expect(d.automation).toBe('SUGGEST_ONLY'); expect(d.boundBy).toBe('platform');   // already there; the switch changed nothing
  });
  it('a kill switch does not resurrect a task the tenant switched off', () => {
    expect(evaluateSafety('voice.summarize', { tenant: { disabledTasks: ['voice.summarize'], autoActionsDisabled: true } }).automation).toBe('OFF');
  });
});

describe('§114/§115 audit is not raw prompt logging', () => {
  it('the audit record shape carries version and hash, never content', () => {
    const rec: AiAuditRecord = {
      tenantId: 't1', actorUserId: 'u1', module: 'ai-review-reputation', taskKey: 'review.response_draft', jobId: null,
      provider: 'openai', model: 'gpt-4o-mini', promptKey: 'review.response_draft', promptVersion: 1,
      inputHash: 'a'.repeat(64), inputReferences: ['review:r1'], toolCalls: [], automation: 'DRAFT' as AutomationLevel,
      approvedByUser: null, outcome: 'NEEDS_REVIEW', at: new Date().toISOString(),
    };
    for (const k of AUDIT_FORBIDDEN_KEYS) expect(Object.keys(rec)).not.toContain(k);
    expect(rec.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rec.inputReferences.every((r) => r.includes(':'))).toBe(true);   // pointers, not values
  });
});

describe('§117/§118 an explanation may not invent a factor the engine never computed', () => {
  const facts = { skill_match: 0.9, projected_workload: 12, customer_preference: true };
  it('accepts an explanation citing only real engine factors', () => {
    expect(citedFactorsAreReal(['skill_match', 'customer_preference'], facts)).toEqual({ ok: true, invented: [] });
  });
  it('catches an invented factor — the §118 failure exactly', () => {
    const r = citedFactorsAreReal(['skill_match', 'customer_mood', 'seniority'], facts);
    expect(r.ok).toBe(false); expect(r.invented).toEqual(['customer_mood', 'seniority']);
  });
  it('is case-insensitive but not fuzzy — a near-miss name is still invented', () => {
    expect(citedFactorsAreReal(['SKILL_MATCH'], facts).ok).toBe(true);
    expect(citedFactorsAreReal(['skill_matching'], facts).ok).toBe(false);
  });
  it('an empty engine fact set means every cited factor is invented', () => {
    expect(citedFactorsAreReal(['anything'], {})).toEqual({ ok: false, invented: ['anything'] });
  });
});
