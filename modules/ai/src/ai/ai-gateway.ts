// ai-gateway.ts — shared AI provider abstraction so no endpoint calls a provider directly. A provider port with a
import { selectRealProvider } from './ai-providers';
// deterministic Mock (used in tests and whenever no API key is configured), an env-driven factory, and a usage-logger
// port. Real OpenAI/Anthropic/Gemini adapters are Phase 2 (same port). Keys never leave the backend.

export interface AiCompletionRequest { system: string; prompt: string; maxTokens?: number }
export interface AiVisionRequest { system: string; prompt: string; imageBase64: string; mimeType: string; maxTokens?: number }
export interface AiCompletionResult { text: string; inputTokens: number; outputTokens: number; provider: string; model: string }

export interface AiProvider { name: string; model: string; complete(req: AiCompletionRequest): Promise<AiCompletionResult>; completeVision?(req: AiVisionRequest): Promise<AiCompletionResult> }

/** Deterministic, network-free provider. Real responses come from Phase-2 adapters behind this same port. */
export class MockAiProvider implements AiProvider {
  name = 'mock';
  model = 'mock-1';
  async complete(req: AiCompletionRequest): Promise<AiCompletionResult> {
    const inputTokens = Math.ceil((req.system.length + req.prompt.length) / 4);
    const text = `[mock:${this.model}] ${req.prompt.slice(0, 120)}`;
    return { text, inputTokens, outputTokens: Math.ceil(text.length / 4), provider: this.name, model: this.model };
  }
  async completeVision(req: AiVisionRequest): Promise<AiCompletionResult> {
    // Deterministic fake receipt JSON so the OCR flow is fully exercisable offline / in tests. Real extraction comes
    // from a vision adapter when an API key is set. Shape matches parseReceiptJson's schema.
    const json = JSON.stringify({ vendor: 'Sample Beauty Supply', date: '2026-06-23',
      items: [{ name: 'Gel Polish', quantity: 2, unitPriceCents: 1200, totalCents: 2400 }, { name: 'Acetone 1gal', quantity: 1, unitPriceCents: 1800, totalCents: 1800 }],
      subtotalCents: 4200, taxCents: 290, totalCents: 4490, currency: 'USD' });
    const inputTokens = Math.ceil((req.system.length + req.prompt.length) / 4) + 280; // + approx image tokens
    return { text: json, inputTokens, outputTokens: Math.ceil(json.length / 4), provider: this.name, model: this.model };
  }
}

/** Resolve the configured provider. Returns the Mock when no key is set, so dev/test/CI run without external calls. */
export function resolveAiProvider(env: NodeJS.ProcessEnv = process.env): AiProvider {
  // When OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY (+ optional AI_DEFAULT_PROVIDER/AI_DEFAULT_MODEL) is set,
  // use that real adapter (same port). With no key, fall back to the Mock so dev/test/CI run without external calls.
  return selectRealProvider(env) ?? new MockAiProvider();
}

export type AiUsageStatus = 'success' | 'failed' | 'blocked_unpaid' | 'blocked_limit' | 'blocked_permission' | 'provider_error';

export interface AiUsageEntry {
  tenantId: string; userId: string | null; packageCode: string; action: string;
  modelProvider: string | null; modelName: string | null;
  inputTokens: number; outputTokens: number; usageUnit: string; usageAmount: number; costMicroUsd: number;
  status: AiUsageStatus; errorMessage?: string | null; createdAt: string;
  /**
   * Constitution 10 §218: WHICH price version valued this row. Recomputing cost from today's table is how a
   * provider rate change silently re-values last quarter's usage; storing the version means a historical row
   * knows what it was charged under whatever the table says later. Optional: rows written by the legacy gated
   * path have none.
   */
  priceVersionId?: string | null;
  /** Phase 14 (Constitution 12, webhook dedupe): the metering idempotency key. A row with the same (tenant, package,
   *  requestId) is metered ONCE (uq_ai_usage_logs_request, migration 565) — a provider that re-delivers the same call
   *  is not billed twice. Optional: per-request rows (one per AI call) need none. */
  requestId?: string | null;
}

export interface AiUsageLogger { log(entry: AiUsageEntry): Promise<void> }

export class InMemoryAiUsageLogger implements AiUsageLogger {
  public entries: AiUsageEntry[] = [];
  async log(entry: AiUsageEntry): Promise<void> { this.entries.push(entry); }
}

/** Thin gateway: runs a completion through the resolved provider and reports timeouts/errors honestly. */
export class AiGatewayService {
  constructor(private readonly provider: AiProvider = resolveAiProvider()) {}
  get providerName() { return this.provider.name; }
  get modelName() { return this.provider.model; }
  complete(req: AiCompletionRequest): Promise<AiCompletionResult> {
    return this.provider.complete({ ...req, maxTokens: req.maxTokens ?? (Number(process.env.AI_MAX_TOKENS) || 800) });
  }
  completeVision(req: AiVisionRequest): Promise<AiCompletionResult> {
    if (!this.provider.completeVision) throw Object.assign(new Error('vision_unsupported'), { status: 502 });
    return this.provider.completeVision({ ...req, maxTokens: req.maxTokens ?? (Number(process.env.AI_MAX_TOKENS) || 1200) });
  }
}
