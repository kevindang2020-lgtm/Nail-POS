import { describe, it, expect, vi, afterEach } from 'vitest';
import { getAiPrompt, aiPromptCoverage } from './ai-prompts';
import { selectRealProvider, OpenAiProvider } from './ai-providers';
import { resolveAiProvider, MockAiProvider } from './ai-gateway';
import { AI_PACKAGE_CODES } from './ai-catalog';

describe('ai-prompts registry', () => {
  it('has a prompt for every catalog package', () => {
    const cov = aiPromptCoverage();
    expect(cov).toHaveLength(AI_PACKAGE_CODES.length);
    expect(cov.every((c) => c.hasPrompt)).toBe(true);
  });
  it('scopes the system prompt to the salon and is advisory-only', () => {
    const { system } = getAiPrompt('ai_booking_assistant', { tenantId: 't-123' });
    expect(system).toContain('t-123');
    expect(system.toLowerCase()).toContain('never execute');
  });
  it('lets a package raise its token budget', () => {
    expect(getAiPrompt('ai_marketing_assistant', { tenantId: 't1' }).maxTokens).toBe(1000);
    expect(getAiPrompt('ai_booking_assistant', { tenantId: 't1' }).maxTokens).toBeUndefined();
  });
});

describe('provider selection', () => {
  it('returns null when no key is configured', () => {
    expect(selectRealProvider({} as any)).toBeNull();
  });
  it('resolveAiProvider falls back to the Mock with empty env', () => {
    expect(resolveAiProvider({} as any)).toBeInstanceOf(MockAiProvider);
  });
  it('picks the explicit provider + model when its key is present', () => {
    const p = selectRealProvider({ AI_DEFAULT_PROVIDER: 'openai', AI_DEFAULT_MODEL: 'gpt-4o', OPENAI_API_KEY: 'sk-x' } as any);
    expect(p).toBeInstanceOf(OpenAiProvider); expect(p!.model).toBe('gpt-4o');
  });
  it('infers the provider from whichever key exists', () => {
    const p = selectRealProvider({ ANTHROPIC_API_KEY: 'sk-a' } as any);
    expect(p?.name).toBe('anthropic');
  });
});

describe('OpenAiProvider (mocked fetch)', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('parses text + token usage on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'hello' } }], usage: { prompt_tokens: 11, completion_tokens: 3 } }) })));
    const out = await new OpenAiProvider('gpt-4o-mini', 'sk', 5000).complete({ system: 's', prompt: 'p', maxTokens: 50 });
    expect(out).toMatchObject({ text: 'hello', provider: 'openai', model: 'gpt-4o-mini', inputTokens: 11, outputTokens: 3 });
  });
  it('throws an honest error on a non-200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, text: async () => JSON.stringify({ error: { message: 'rate limited' } }) })));
    await expect(new OpenAiProvider('gpt-4o-mini', 'sk', 5000).complete({ system: 's', prompt: 'p' })).rejects.toThrow(/429/);
  });
});
