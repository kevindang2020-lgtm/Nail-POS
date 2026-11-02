// ai-task-registry.vitest.spec — Constitution 10 §9–§11, §36–§42. These are INVARIANTS over the whole registry,
// not examples: they hold every row that exists today and every row added later, which is the point.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AI_TASKS, resolveTask, UnknownTaskError, MIN_APPROVAL_FOR_RISK, type TaskDefinition } from './ai-task-registry';

const tasks = Object.values(AI_TASKS) as TaskDefinition[];

describe('§9 the registry is the only vocabulary', () => {
  it('an unknown task key is refused, not guessed', () => {
    expect(() => resolveTask('review.sentiment_analyze')).not.toThrow();
    expect(() => resolveTask('review.sentiment_analyse')).toThrow(UnknownTaskError);   // a plausible misspelling
    expect(() => resolveTask('')).toThrow(UnknownTaskError);
    try { resolveTask('nope.nope'); } catch (e) { expect((e as UnknownTaskError).status).toBe(400); }
  });
  it('there is NO arbitrary-prompt task — an open prompt endpoint is how injection becomes a system instruction (§27/§303)', () => {
    for (const k of Object.keys(AI_TASKS)) expect(k).not.toMatch(/arbitrary|raw_prompt|run_prompt|freeform|passthrough/i);
  });
  it('every key is `domain.verb`, unique, and matches its own `key` field', () => {
    const keys = Object.keys(AI_TASKS);
    expect(new Set(keys).size).toBe(keys.length);
    for (const [k, t] of Object.entries(AI_TASKS)) { expect(t.key).toBe(k); expect(k).toMatch(/^[a-z][a-z_]*\.[a-z][a-z_]*$/); }
  });
});

describe('§10 every task declares what the platform needs BEFORE a provider is contacted', () => {
  it('capability, providers, schema, risk, mode, ceilings and a rationale are all present and sane', () => {
    for (const t of tasks) {
      expect(t.allowedProviders.length, t.key).toBeGreaterThan(0);
      expect(t.outputSchema, t.key).toMatch(/\.v\d+$/);                       // §73 versioned schema key
      expect(t.maxOutputTokens, t.key).toBeGreaterThan(0);
      expect(t.maxOutputTokens, t.key).toBeLessThanOrEqual(4_000);            // §183 token explosion ceiling
      expect(t.timeoutMs, t.key).toBeGreaterThanOrEqual(15_000);
      expect(t.timeoutMs, t.key).toBeLessThanOrEqual(120_000);                // §84
      expect(t.temperature, t.key).toBeGreaterThanOrEqual(0);
      expect(t.temperature, t.key).toBeLessThanOrEqual(1);
      expect(t.riskRationale.length, t.key).toBeGreaterThan(30);              // §117: the judgement is written down
      expect(['sync', 'async']).toContain(t.mode);
    }
  });
  it('a declared default model is one of the task\'s allowed models', () => {
    for (const t of tasks) if (t.defaultModel && t.allowedModels.length) expect(t.allowedModels, t.key).toContain(t.defaultModel);
  });
});

describe('§36–§41 risk and approval', () => {
  it('no task sits below the minimum approval policy for its risk level', () => {
    for (const t of tasks) expect(MIN_APPROVAL_FOR_RISK[t.risk], `${t.key} (${t.risk})`).toContain(t.approval);
  });
  it('MEDIUM and above is never NO_APPROVAL — a recommendation a human cannot see is an action', () => {
    for (const t of tasks) if (t.risk !== 'LOW') expect(t.approval, t.key).not.toBe('NO_APPROVAL');
  });
  it('§40 the registry declares NO CRITICAL task: payment, refund, permissions and suspension are not AI tasks at all', () => {
    expect(tasks.filter((t) => t.risk === 'CRITICAL')).toEqual([]);
    for (const k of Object.keys(AI_TASKS)) expect(k).not.toMatch(/payment_capture|refund|permission_(change|grant)|suspend|terminate|verify_identity/i);
  });
  it('§278 deterministic tasks run cold: extraction and financial explanation never sample', () => {
    for (const t of tasks) {
      if (t.capability === 'vision.extract' || t.capability === 'audio.transcribe' || t.capability === 'text.classify') expect(t.temperature, t.key).toBe(0);
      if (t.risk === 'HIGH') expect(t.temperature, t.key).toBe(0);
    }
  });
});

describe('§42/§303 deterministic engines keep their jobs', () => {
  it('there is no task that makes an LLM the forecaster, the scheduler, the eligibility engine or the reconciler', () => {
    const keys = Object.keys(AI_TASKS);
    expect(keys).not.toContain('forecast.appointment_demand');      // §44/§303: numbers are not generated
    expect(keys).not.toContain('forecast.revenue');
    expect(keys).not.toContain('schedule.optimize');                // §43: the solver optimizes; AI explains
    expect(keys).not.toContain('queue.assign');                     // §45: the engine assigns
    expect(keys).not.toContain('queue.recommend_assignment');       // …and the engine RANKS too; AI only explains (Phase 23 correction)
    expect(keys).not.toContain('reconciliation.resolve');           // §46: explain an exception, never resolve it
    // The ones that DO exist are explain/recommend/draft shaped:
    for (const t of tasks) expect(t.key, t.key).toMatch(/_(analyze|draft|extract|transcribe|summarize|narrate|explain|suggest|recommendation|assignment|exception|alert|suggestion)$|\.(transcribe|summarize|explain)$/);
  });
  it('no task grants a tool yet — §32/§135 tool authorization with server-derived context does not exist, so nothing may call one', () => {
    for (const t of tasks) expect(t.allowedTools, t.key).toEqual([]);
  });
});

describe('§303 the registry source itself', () => {
  it('contains no provider key, model secret or hardcoded endpoint', () => {
    const src = readFileSync(resolve(__dirname, 'ai-task-registry.ts'), 'utf8');
    // `sk-[a-zA-Z0-9]` alone matched the word "ai-task-registry" in a comment. A real key is long.
    expect(src).not.toMatch(/API_KEY|sk-[a-zA-Z0-9]{20,}|api\.openai\.com|api\.anthropic\.com/);
  });
});
