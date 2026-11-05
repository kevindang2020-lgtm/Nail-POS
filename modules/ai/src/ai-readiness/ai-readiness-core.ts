// ai-readiness-core.ts — pure evaluation of AI provider configuration for the Reception Copilot. Given only which
// provider keys are present (booleans, never the keys themselves), it reports whether the LLM is wired and therefore
// whether Copilot drafts will be LLM-polished. When no key is set the Copilot still works — drafts fall back to the
// deterministic templates (Slice 25) — so "not_configured" is a degraded-but-functional state, not an error.
export interface AiReadinessCheck { key: string; label: string; ok: boolean; detail: string }
export interface AiReadinessReport {
  overall: 'ready' | 'not_configured';
  provider: 'openai' | 'anthropic' | 'gemini' | null;   // the one that will be used (first configured, in this order)
  draftsPolished: boolean;
  checks: AiReadinessCheck[];
  copilotPackage: { code: string; name: string; available: boolean };
}

export interface AiReadinessInput { hasOpenAI: boolean; hasAnthropic: boolean; hasGemini: boolean }

export function evaluateAiReadiness(i: AiReadinessInput): AiReadinessReport {
  const provider: AiReadinessReport['provider'] = i.hasOpenAI ? 'openai' : i.hasAnthropic ? 'anthropic' : i.hasGemini ? 'gemini' : null;
  const draftsPolished = provider !== null;
  const checks: AiReadinessCheck[] = [
    { key: 'openai', label: 'OpenAI', ok: i.hasOpenAI, detail: i.hasOpenAI ? 'OPENAI_API_KEY set' : 'Set OPENAI_API_KEY to use OpenAI' },
    { key: 'anthropic', label: 'Anthropic', ok: i.hasAnthropic, detail: i.hasAnthropic ? 'ANTHROPIC_API_KEY set' : 'Set ANTHROPIC_API_KEY to use Anthropic' },
    { key: 'gemini', label: 'Gemini', ok: i.hasGemini, detail: i.hasGemini ? 'GEMINI_API_KEY set' : 'Set GEMINI_API_KEY to use Gemini' },
    { key: 'drafts', label: 'Copilot draft polish', ok: draftsPolished, detail: draftsPolished ? `On — drafts refined via ${provider}` : 'Off — drafts use the built-in templates until a provider key is set' },
  ];
  return {
    overall: draftsPolished ? 'ready' : 'not_configured',
    provider, draftsPolished, checks,
    copilotPackage: { code: 'ai_reception_copilot', name: 'AI Reception Copilot', available: true },
  };
}
