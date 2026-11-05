// ai-providers.ts — real provider adapters behind the AiProvider port. Uses the global fetch (no vendor SDKs), enforces a
// timeout, and reports honest token counts from each provider's usage block (estimating only if absent). The gateway
// falls back to the Mock when no key is configured, so dev/test/CI never make external calls.
//
// Import note: the port types are imported type-only (erased at runtime), so the runtime dependency is one-way
// (ai-gateway → ai-providers) with no cycle.
import type { AiProvider, AiCompletionRequest, AiCompletionResult, AiVisionRequest } from './ai-gateway';

const estTokens = (s: string) => Math.ceil((s || '').length / 4);

async function postJson(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
    const text = await res.text();
    let json: any = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    if (!res.ok) throw new Error(`${url.split('/')[2]} ${res.status}: ${(json?.error?.message || json?.message || text || 'request failed').toString().slice(0, 200)}`);
    return json;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('ai_provider_timeout');
    throw e;
  } finally { clearTimeout(t); }
}

export class OpenAiProvider implements AiProvider {
  name = 'openai';
  constructor(public model: string, private apiKey: string, private timeoutMs: number) {}
  async complete(req: AiCompletionRequest): Promise<AiCompletionResult> {
    const j = await postJson('https://api.openai.com/v1/chat/completions', { authorization: `Bearer ${this.apiKey}` }, {
      model: this.model, max_tokens: req.maxTokens,
      messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.prompt }],
    }, this.timeoutMs);
    const text = j?.choices?.[0]?.message?.content ?? '';
    return { text, provider: this.name, model: this.model, inputTokens: j?.usage?.prompt_tokens ?? estTokens(req.system + req.prompt), outputTokens: j?.usage?.completion_tokens ?? estTokens(text) };
  }
  async completeVision(req: AiVisionRequest): Promise<AiCompletionResult> {
    const j = await postJson('https://api.openai.com/v1/chat/completions', { authorization: `Bearer ${this.apiKey}` }, {
      model: this.model, max_tokens: req.maxTokens,
      messages: [{ role: 'system', content: req.system }, { role: 'user', content: [
        { type: 'text', text: req.prompt },
        { type: 'image_url', image_url: { url: `data:${req.mimeType};base64,${req.imageBase64}` } },
      ] }],
    }, this.timeoutMs);
    const text = j?.choices?.[0]?.message?.content ?? '';
    return { text, provider: this.name, model: this.model, inputTokens: j?.usage?.prompt_tokens ?? estTokens(req.system + req.prompt), outputTokens: j?.usage?.completion_tokens ?? estTokens(text) };
  }
}

export class AnthropicProvider implements AiProvider {
  name = 'anthropic';
  constructor(public model: string, private apiKey: string, private timeoutMs: number) {}
  async complete(req: AiCompletionRequest): Promise<AiCompletionResult> {
    const j = await postJson('https://api.anthropic.com/v1/messages', { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' }, {
      model: this.model, max_tokens: req.maxTokens ?? 800, system: req.system,
      messages: [{ role: 'user', content: req.prompt }],
    }, this.timeoutMs);
    const text = Array.isArray(j?.content) ? j.content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('') : '';
    return { text, provider: this.name, model: this.model, inputTokens: j?.usage?.input_tokens ?? estTokens(req.system + req.prompt), outputTokens: j?.usage?.output_tokens ?? estTokens(text) };
  }
  async completeVision(req: AiVisionRequest): Promise<AiCompletionResult> {
    const j = await postJson('https://api.anthropic.com/v1/messages', { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' }, {
      model: this.model, max_tokens: req.maxTokens ?? 1200, system: req.system,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: req.mimeType, data: req.imageBase64 } },
        { type: 'text', text: req.prompt },
      ] }],
    }, this.timeoutMs);
    const text = Array.isArray(j?.content) ? j.content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('') : '';
    return { text, provider: this.name, model: this.model, inputTokens: j?.usage?.input_tokens ?? estTokens(req.system + req.prompt), outputTokens: j?.usage?.output_tokens ?? estTokens(text) };
  }
}

export class GeminiProvider implements AiProvider {
  name = 'gemini';
  constructor(public model: string, private apiKey: string, private timeoutMs: number) {}
  async complete(req: AiCompletionRequest): Promise<AiCompletionResult> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const j = await postJson(url, {}, {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
      generationConfig: { maxOutputTokens: req.maxTokens ?? 800 },
    }, this.timeoutMs);
    const text = j?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? '').join('') ?? '';
    return { text, provider: this.name, model: this.model, inputTokens: j?.usageMetadata?.promptTokenCount ?? estTokens(req.system + req.prompt), outputTokens: j?.usageMetadata?.candidatesTokenCount ?? estTokens(text) };
  }
  async completeVision(req: AiVisionRequest): Promise<AiCompletionResult> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const j = await postJson(url, {}, {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts: [{ text: req.prompt }, { inline_data: { mime_type: req.mimeType, data: req.imageBase64 } }] }],
      generationConfig: { maxOutputTokens: req.maxTokens ?? 1200 },
    }, this.timeoutMs);
    const text = j?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? '').join('') ?? '';
    return { text, provider: this.name, model: this.model, inputTokens: j?.usageMetadata?.promptTokenCount ?? estTokens(req.system + req.prompt), outputTokens: j?.usageMetadata?.candidatesTokenCount ?? estTokens(text) };
  }
}

const DEFAULT_MODELS: Record<string, string> = { openai: 'gpt-4o-mini', anthropic: 'claude-3-5-haiku-latest', gemini: 'gemini-1.5-flash' };

/** Pick a real provider from env, or null when none is configured (caller falls back to the Mock). Pure given env. */
/**
 * Constitution 10 §12/§17: the router picks provider+model per TASK, so the platform needs an adapter for an
 * arbitrary (provider, model) pair — not only the env default. Same file as selectRealProvider so the
 * key-handling stays inside the one approved adapter boundary (check:ai-platform). Returns null when that
 * provider has no key: the router treats a null as "not integrated here" and picks the next alternative.
 */
export function providerFor(provider: string, model: string, env: NodeJS.ProcessEnv = process.env): AiProvider | null {
  const timeoutMs = Number(env.AI_TIMEOUT_MS || 30000);
  if (provider === 'openai' && env.OPENAI_API_KEY) return new OpenAiProvider(model, env.OPENAI_API_KEY, timeoutMs);
  if (provider === 'anthropic' && env.ANTHROPIC_API_KEY) return new AnthropicProvider(model, env.ANTHROPIC_API_KEY, timeoutMs);
  if (provider === 'gemini' && env.GEMINI_API_KEY) return new GeminiProvider(model, env.GEMINI_API_KEY, timeoutMs);
  return null;
}

export function selectRealProvider(env: NodeJS.ProcessEnv): AiProvider | null {
  const keys: Record<string, string | undefined> = { openai: env.OPENAI_API_KEY, anthropic: env.ANTHROPIC_API_KEY, gemini: env.GEMINI_API_KEY };
  // Explicit provider wins; otherwise infer from whichever key is present (openai → anthropic → gemini).
  const want = (env.AI_DEFAULT_PROVIDER || '').toLowerCase();
  const provider = (want && keys[want]) ? want : (['openai', 'anthropic', 'gemini'].find((p) => keys[p]) ?? '');
  const key = keys[provider];
  if (!provider || !key) return null;
  const model = env.AI_DEFAULT_MODEL || DEFAULT_MODELS[provider];
  const timeoutMs = Number(env.AI_TIMEOUT_MS) || 20000;
  if (provider === 'openai') return new OpenAiProvider(model, key, timeoutMs);
  if (provider === 'anthropic') return new AnthropicProvider(model, key, timeoutMs);
  if (provider === 'gemini') return new GeminiProvider(model, key, timeoutMs);
  return null;
}
