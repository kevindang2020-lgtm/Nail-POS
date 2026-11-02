import { describe, it, expect } from 'vitest';
import { evaluateAiReadiness } from './ai-readiness-core';

describe('evaluateAiReadiness', () => {
  it('not_configured with no keys — drafts fall back to templates (still functional)', () => {
    const r = evaluateAiReadiness({ hasOpenAI: false, hasAnthropic: false, hasGemini: false });
    expect(r.overall).toBe('not_configured');
    expect(r.provider).toBeNull();
    expect(r.draftsPolished).toBe(false);
    expect(r.checks.find((c) => c.key === 'drafts')!.detail).toMatch(/templates/i);
  });
  it('ready when a key is set; drafts become LLM-polished', () => {
    const r = evaluateAiReadiness({ hasOpenAI: true, hasAnthropic: false, hasGemini: false });
    expect(r.overall).toBe('ready');
    expect(r.provider).toBe('openai');
    expect(r.draftsPolished).toBe(true);
  });
  it('picks the provider by priority order openai → anthropic → gemini', () => {
    expect(evaluateAiReadiness({ hasOpenAI: false, hasAnthropic: true, hasGemini: true }).provider).toBe('anthropic');
    expect(evaluateAiReadiness({ hasOpenAI: false, hasAnthropic: false, hasGemini: true }).provider).toBe('gemini');
  });
  it('always reports the ai_reception_copilot package as available', () => {
    const r = evaluateAiReadiness({ hasOpenAI: false, hasAnthropic: false, hasGemini: false });
    expect(r.copilotPackage.code).toBe('ai_reception_copilot');
    expect(r.copilotPackage.available).toBe(true);
  });
});
