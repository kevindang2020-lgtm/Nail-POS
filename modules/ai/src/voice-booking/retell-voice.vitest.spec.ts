// retell-voice.vitest.spec.ts — the live Retell adapter, tested with a mocked fetch (no real account). Verifies the
// create sequence (LLM then agent), Bearer auth, update/delete/webhook calls, and error mapping.
import { describe, it, expect, vi } from 'vitest';
import { RetellVoiceProvider, RetellApiError } from './retell-voice.provider';

function mockFetch(routes: Record<string, { status: number; body: any }>) {
  const calls: { url: string; method: string; auth: string; body: any }[] = [];
  const fn = vi.fn(async (url: string, init: any) => {
    calls.push({ url, method: init.method, auth: init.headers.Authorization, body: init.body ? JSON.parse(init.body) : undefined });
    const key = Object.keys(routes).find((k) => url.includes(k));
    const r = key ? routes[key] : { status: 404, body: { message: 'not mocked' } };
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body, text: async () => JSON.stringify(r.body) } as any;
  });
  return { fn, calls };
}
const cfg = { apiKey: 'key_secret', defaultVoiceId: '11labs-Adrian', webhookUrl: 'https://api.example.com/retell/webhook' };
const agentInput = { name: 'Main Front Desk', language: 'en', greeting: 'Thanks for calling!', behavior: 'Be warm.', knowledge: 'Open 9-7.', tools: [] };

describe('RetellVoiceProvider', () => {
  it('creates a response engine then an agent, with Bearer auth', async () => {
    const { fn, calls } = mockFetch({ '/create-retell-llm': { status: 201, body: { llm_id: 'llm_1' } }, '/create-agent': { status: 201, body: { agent_id: 'agent_1' } } });
    const res = await new RetellVoiceProvider(cfg, fn).createAgent(agentInput);
    expect(res).toEqual({ providerAgentId: 'agent_1' });
    expect(calls[0].url).toContain('/create-retell-llm');
    expect(calls[0].body).toMatchObject({ begin_message: 'Thanks for calling!' });
    expect(calls[0].body.general_prompt).toContain('Be warm.');
    expect(calls[1].url).toContain('/create-agent');
    expect(calls[1].body.response_engine).toEqual({ type: 'retell-llm', llm_id: 'llm_1' });
    expect(calls[1].body.webhook_url).toBe(cfg.webhookUrl);
    expect(calls[0].auth).toBe('Bearer key_secret');
  });

  it('maps language codes', async () => {
    const { fn, calls } = mockFetch({ '/create-retell-llm': { status: 201, body: { llm_id: 'llm_1' } }, '/create-agent': { status: 201, body: { agent_id: 'a' } } });
    await new RetellVoiceProvider(cfg, fn).createAgent({ ...agentInput, language: 'es' });
    expect(calls[1].body.language).toBe('es-ES');
  });

  it('updates, deletes, and registers a webhook', async () => {
    const { fn, calls } = mockFetch({ '/update-agent/agent_1': { status: 200, body: { agent_id: 'agent_1' } }, '/delete-agent/agent_1': { status: 204, body: null } });
    const p = new RetellVoiceProvider(cfg, fn);
    await p.updateAgent('agent_1', { name: 'Renamed' });
    await p.registerWebhook('agent_1', 'https://x/webhook');
    await p.deleteAgent('agent_1');
    expect(calls.find((c) => c.method === 'PATCH' && c.body.agent_name === 'Renamed')).toBeTruthy();
    expect(calls.find((c) => c.method === 'PATCH' && c.body.webhook_url === 'https://x/webhook')).toBeTruthy();
    expect(calls.find((c) => c.method === 'DELETE')).toBeTruthy();
  });

  it('maps a Retell error body to RetellApiError', async () => {
    const { fn } = mockFetch({ '/create-retell-llm': { status: 401, body: { status: 'error', message: 'API key is missing or invalid.' } } });
    await expect(new RetellVoiceProvider(cfg, fn).createAgent(agentInput)).rejects.toMatchObject({ name: 'RetellApiError', status: 401 });
  });

  it('never leaks the api key in status', () => {
    expect(new RetellVoiceProvider(cfg, mockFetch({}).fn).status().detail).not.toContain('key_secret');
  });
});
