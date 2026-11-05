// retell-voice.provider.ts — the LIVE Retell adapter implementing VoiceProvisioningPort. Real HTTP against the Retell REST
// API (https://api.retellai.com, Bearer auth). createAgent provisions a Response Engine (Retell LLM) from the agent's
// behavior+knowledge, then creates the agent referencing it; updateAgent/registerWebhook use update-agent; deleteAgent
// removes it. fetch is injectable for unit testing without a real account. Wired in resolveVoiceProvider() only when
// RETELL_API_KEY is set, so with no key the honest NotConnected default is used (no real calls, no provisioning).
import type { VoiceProvisioningPort, ProviderStatus, CreateVoiceAgentInput, VoiceAgentHandle } from './provider-ports';

type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; status: number; json: () => Promise<any>; text: () => Promise<string> }>;

export interface RetellConfig { apiKey: string; defaultVoiceId?: string; webhookUrl?: string | null }

export class RetellApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = 'RetellApiError'; }
}

const BASE = 'https://api.retellai.com';

export class RetellVoiceProvider implements VoiceProvisioningPort {
  constructor(private readonly cfg: RetellConfig, private readonly fetchImpl: FetchLike = fetch as any) {}

  status(): ProviderStatus { return { state: 'connected', provider: 'retell', detail: 'Connected (Retell API key configured)' }; }

  private async call(method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<any> {
    const res = await this.fetchImpl(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) return null;
    let json: any = null;
    try { json = await res.json(); } catch { /* delete may be empty */ }
    if (!res.ok) {
      const msg = (json && (json.message || json.error)) || `Retell request failed (${res.status})`;
      throw new RetellApiError(res.status, msg);
    }
    return json;
  }

  /** Build the customer-facing system prompt from behavior + curated knowledge (already sanitized upstream). */
  private buildPrompt(input: CreateVoiceAgentInput): string {
    return [input.behavior, input.knowledge ? `\n\nBusiness knowledge:\n${input.knowledge}` : ''].filter(Boolean).join('');
  }

  async createAgent(input: CreateVoiceAgentInput): Promise<VoiceAgentHandle> {
    // 1) Response Engine (Retell LLM) carrying the prompt + greeting.
    const llm = await this.call('POST', '/create-retell-llm', { general_prompt: this.buildPrompt(input), begin_message: input.greeting });
    const llmId = llm?.llm_id;
    if (!llmId) throw new RetellApiError(502, 'Retell did not return an llm_id.');
    // 2) Agent referencing the response engine.
    const agent = await this.call('POST', '/create-agent', {
      response_engine: { type: 'retell-llm', llm_id: llmId },
      voice_id: this.cfg.defaultVoiceId || '11labs-Adrian',
      agent_name: input.name,
      language: input.language === 'es' ? 'es-ES' : input.language === 'vi' ? 'vi-VN' : 'en-US',
      ...(this.cfg.webhookUrl ? { webhook_url: this.cfg.webhookUrl } : {}),
    });
    if (!agent?.agent_id) throw new RetellApiError(502, 'Retell did not return an agent_id.');
    return { providerAgentId: agent.agent_id };
  }

  async updateAgent(providerAgentId: string, input: Partial<CreateVoiceAgentInput>): Promise<VoiceAgentHandle> {
    const patch: Record<string, unknown> = {};
    if (input.name) patch.agent_name = input.name;
    if (input.language) patch.language = input.language === 'es' ? 'es-ES' : input.language === 'vi' ? 'vi-VN' : 'en-US';
    await this.call('PATCH', `/update-agent/${providerAgentId}`, patch);
    return { providerAgentId };
  }

  async deleteAgent(providerAgentId: string): Promise<void> {
    await this.call('DELETE', `/delete-agent/${providerAgentId}`);
  }

  async registerWebhook(providerAgentId: string, url: string): Promise<void> {
    await this.call('PATCH', `/update-agent/${providerAgentId}`, { webhook_url: url });
  }
}
