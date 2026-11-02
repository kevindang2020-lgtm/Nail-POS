// ai-model-registry.ts — Constitution 10 Phases 5–6: providers and models as DATA, not scattered strings.
//
// §14/§15: a model has a provider, a key, capabilities, a status and cost metadata. §15's rule is the reason this
// file exists: "do not hard-code model availability throughout modules." A DEGRADED or DISABLED model is
// changed here once and every task stops routing to it; nothing in a module knows a model name.
//
// Cost metadata deliberately comes from the EXISTING price table (ai-pricing.ts) rather than a second copy —
// §96 wants one cost registry, and this tree already had one keyed by model string.
//
// §16: providers are listed "based on actual integrations" — and the keys are the ADAPTER's names (openai,
// anthropic, gemini), because that string is what selectRealProvider() matches on. A first draft of this file
// called the third provider 'google' and marked it DISABLED for "having no adapter"; GeminiProvider had been
// sitting 60 lines further down ai-providers.ts the whole time. Read the whole file before declaring an absence.
import { priceForModel, type ModelPrice } from './ai-pricing';
import type { Capability } from './ai-task-registry';

/** §15. */
export type ModelStatus = 'ACTIVE' | 'BETA' | 'DEGRADED' | 'DISABLED' | 'DEPRECATED';
/** §16. Named after the adapter that exists, not the vendor's marketing. */
export type ProviderKey = 'openai' | 'anthropic' | 'gemini' | 'mock';

export interface ModelDefinition {
  provider: ProviderKey;
  /** The exact string the adapter sends over the wire. */
  key: string;
  displayName: string;
  capabilities: Capability[];
  status: ModelStatus;
  contextWindowTokens: number;
  /** §14 feature flags the router consults (§12: "structured-output support", "context size"). */
  structuredOutput: boolean;
  vision: boolean;
  tools: boolean;
  /** §13: the router's tiebreak between two capable models. Higher = stronger reasoning, dearer. */
  tier: 'fast' | 'balanced' | 'strong';
  /** Typical p50 latency class, for §12 "latency". */
  latency: 'low' | 'medium' | 'high';
  /** §63: what the provider does with the data — surfaced to tenant settings, never assumed. */
  privacy: { trainsOnData: boolean; region: string };
}

const M = (d: ModelDefinition) => d;

export const AI_MODELS: Readonly<Record<string, ModelDefinition>> = Object.freeze({
  'gpt-4o-mini': M({ provider: 'openai', key: 'gpt-4o-mini', displayName: 'GPT-4o mini', capabilities: ['text.generate', 'text.classify', 'text.summarize', 'vision.extract'],
    status: 'ACTIVE', contextWindowTokens: 128_000, structuredOutput: true, vision: true, tools: true, tier: 'fast', latency: 'low', privacy: { trainsOnData: false, region: 'us' } }),
  'gpt-4o': M({ provider: 'openai', key: 'gpt-4o', displayName: 'GPT-4o', capabilities: ['text.generate', 'text.classify', 'text.summarize', 'vision.extract'],
    status: 'ACTIVE', contextWindowTokens: 128_000, structuredOutput: true, vision: true, tools: true, tier: 'strong', latency: 'medium', privacy: { trainsOnData: false, region: 'us' } }),
  'whisper-1': M({ provider: 'openai', key: 'whisper-1', displayName: 'Whisper', capabilities: ['audio.transcribe'],
    status: 'ACTIVE', contextWindowTokens: 0, structuredOutput: false, vision: false, tools: false, tier: 'balanced', latency: 'high', privacy: { trainsOnData: false, region: 'us' } }),
  'claude-3-5-haiku-latest': M({ provider: 'anthropic', key: 'claude-3-5-haiku-latest', displayName: 'Claude 3.5 Haiku', capabilities: ['text.generate', 'text.classify', 'text.summarize', 'vision.extract'],
    status: 'ACTIVE', contextWindowTokens: 200_000, structuredOutput: true, vision: true, tools: true, tier: 'fast', latency: 'low', privacy: { trainsOnData: false, region: 'us' } }),
  'claude-3-5-sonnet-latest': M({ provider: 'anthropic', key: 'claude-3-5-sonnet-latest', displayName: 'Claude 3.5 Sonnet', capabilities: ['text.generate', 'text.classify', 'text.summarize', 'vision.extract'],
    status: 'ACTIVE', contextWindowTokens: 200_000, structuredOutput: true, vision: true, tools: true, tier: 'strong', latency: 'medium', privacy: { trainsOnData: false, region: 'us' } }),
  'gemini-1.5-flash': M({ provider: 'gemini', key: 'gemini-1.5-flash', displayName: 'Gemini 1.5 Flash', capabilities: ['text.generate', 'text.classify', 'text.summarize', 'vision.extract'],
    status: 'ACTIVE', contextWindowTokens: 1_000_000, structuredOutput: true, vision: true, tools: true, tier: 'fast', latency: 'low', privacy: { trainsOnData: false, region: 'us' } }),
  'gemini-1.5-pro': M({ provider: 'gemini', key: 'gemini-1.5-pro', displayName: 'Gemini 1.5 Pro', capabilities: ['text.generate', 'text.classify', 'text.summarize', 'vision.extract'],
    status: 'ACTIVE', contextWindowTokens: 2_000_000, structuredOutput: true, vision: true, tools: true, tier: 'strong', latency: 'medium', privacy: { trainsOnData: false, region: 'us' } }),
  // §268 test provider: the Mock. Never selectable in production — the router refuses it when NODE_ENV=production.
  'mock-1': M({ provider: 'mock', key: 'mock-1', displayName: 'Mock (test only)', capabilities: ['text.generate', 'text.classify', 'text.summarize', 'vision.extract', 'audio.transcribe', 'embedding.create'],
    status: 'BETA', contextWindowTokens: 32_000, structuredOutput: true, vision: true, tools: true, tier: 'fast', latency: 'low', privacy: { trainsOnData: false, region: 'local' } }),
});

/** §15: a model that may be routed to right now. */
export const ROUTABLE_STATUSES: ReadonlySet<ModelStatus> = new Set(['ACTIVE', 'BETA']);

export function modelsFor(capability: Capability, opts: { providers?: readonly string[]; allowedModels?: readonly string[]; includeMock?: boolean } = {}): ModelDefinition[] {
  return Object.values(AI_MODELS).filter((m) =>
    m.capabilities.includes(capability)
    && ROUTABLE_STATUSES.has(m.status)
    && (m.provider !== 'mock' || opts.includeMock)
    && (!opts.providers || opts.providers.includes(m.provider))
    && (!opts.allowedModels?.length || opts.allowedModels.includes(m.key)));
}

export function modelCost(key: string): ModelPrice { return priceForModel(key); }

/** The set of providers that actually have an adapter (§16 "based on actual integrations"). */
export const INTEGRATED_PROVIDERS: ReadonlySet<ProviderKey> = new Set(['openai', 'anthropic', 'gemini', 'mock']);
