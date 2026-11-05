# AI Phase 3 — real provider adapters + prompt registry (scaffold)

Wires real OpenAI / Anthropic / Gemini calls behind the existing `AiProvider` port, plus a typed per-assistant prompt
registry. Nothing changes at runtime until a provider key is set — with no key the deterministic Mock still runs, so this
is safe to deploy as-is.

## Files
- `apps/api/src/ai/ai-prompts.ts` (new) — per-assistant system prompts (one per packageCode) + token overrides; pure
- `apps/api/src/ai/ai-providers.ts` (new) — `OpenAiProvider`, `AnthropicProvider`, `GeminiProvider` + `selectRealProvider(env)`
- `apps/api/src/ai/ai-gateway.ts` — `resolveAiProvider` now returns the real adapter when configured, else Mock
- `apps/api/src/ai/ai-assistant.service.ts` — uses the prompt registry (system + maxTokens) instead of an inline string
- `apps/api/src/ai/ai-providers.vitest.spec.ts` (new) — 9 tests

## How it resolves a provider (pure, env-driven)
`selectRealProvider(env)`:
- explicit `AI_DEFAULT_PROVIDER` (`openai`|`anthropic`|`gemini`) wins when its key is present; otherwise the provider is
  inferred from whichever key exists (openai → anthropic → gemini);
- model = `AI_DEFAULT_MODEL` or a per-provider default (`gpt-4o-mini` / `claude-3-5-haiku-latest` / `gemini-1.5-flash`);
- timeout = `AI_TIMEOUT_MS` (default 20s);
- returns `null` when nothing is configured → `resolveAiProvider` falls back to `MockAiProvider`.

## Adapters
Each implements the same port (`complete({ system, prompt, maxTokens }) → { text, inputTokens, outputTokens, provider,
model }`), uses the global `fetch` (no vendor SDK dependency), enforces the timeout via `AbortController`, and reads
**honest token counts** from each provider's usage block (estimating only if absent). Non-2xx and timeouts throw a
descriptive error, which the gateway already maps to a `provider_error` usage row (no charge) — so the existing
enforcement, logging, and money-safety paths are unchanged.

## Prompt registry
One tenant-scoped, advisory-only system prompt per packageCode (the runtime prompt carries the case-specific context).
Every prompt embeds the salon-scope + "draft/recommend, never execute bookings/payments/messages" rules. A coverage test
(`aiPromptCoverage`) fails if a catalog package ever ships without a prompt. Marketing and review get a larger token
budget; the rest use the default.

## Environment (set these to go live; until then the Mock runs)
```
AI_DEFAULT_PROVIDER=openai|anthropic|gemini
AI_DEFAULT_MODEL=...                # optional; sensible per-provider default otherwise
AI_TIMEOUT_MS=20000                 # optional
AI_MAX_TOKENS=800                   # optional gateway default
OPENAI_API_KEY=... | ANTHROPIC_API_KEY=... | GEMINI_API_KEY=...
```

## Verification
API: `tsc` clean; **538 tests** (+9: registry coverage + salon-scoping + token budget; provider selection null/explicit/
inferred/model; OpenAI adapter parses text+usage and throws an honest error on non-200 via mocked `fetch`); the existing
13 AI tests still pass (Mock path unchanged); `RESULT: PASS`.

## Honest limits (need your environment / keys — NOT verifiable in this sandbox)
- **No real network call was made here** (no keys). The request/response mapping, auth headers, and error shapes are unit-
  verified against mocked `fetch`, but you must validate one real call per provider once keys are set.
- **No streaming** — single-shot completions only. Add streaming later if a UI needs token-by-token output.
- **Cost tracking** logs token counts but does not yet convert them to dollars (`AI_COST_TRACKING_ENABLED` is reserved,
  not consumed). Per-model pricing → a cost figure is a small follow-up.
- Default model names are reasonable but may drift; set `AI_DEFAULT_MODEL` explicitly for production.

## Platform status
Built + verified here: gate (P1) → real-data gate (P2) → **provider adapters + prompt registry (P3, scaffold)** →
Super-Admin API + screen (P4a/b) → tenant API + owner screen (P4c) → POS panel + fan-out (P5). The only items left are
those that inherently need your environment: validating real provider calls (drop in a key), **Phase 4d** billing/webhook
sync + paid activation, and purpose-built surfaces for the 7 assistants with no POS home.
