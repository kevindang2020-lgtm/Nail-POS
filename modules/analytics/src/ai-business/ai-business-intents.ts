// ai-business-intents.ts — the bounded intent layer for the assistant. The model NEVER chooses which tool runs or
// which tenant/branch to read (spec §4, §21): the backend resolves a question to exactly one of a fixed set of
// intents, each mapped to one authorized tool. An explicit intent (from a suggested-question button) is used as-is; a
// free-text question is keyword-matched; anything ambiguous returns null so the assistant asks for clarification (§19).

export const AI_BUSINESS_INTENTS = [
  'daily_summary', 'revenue_summary', 'explain_revenue', 'appointments',
  'compare_branches', 'customer_growth', 'technician_performance',
] as const;
export type AiBusinessIntent = (typeof AI_BUSINESS_INTENTS)[number];

export function isIntent(v: unknown): v is AiBusinessIntent {
  return typeof v === 'string' && (AI_BUSINESS_INTENTS as readonly string[]).includes(v);
}

// Ordered rules — more specific patterns first (explain-revenue before generic revenue; daily before generic).
const RULES: { intent: AiBusinessIntent; re: RegExp }[] = [
  { intent: 'explain_revenue', re: /(why|explain|reason).*(revenue|sales|money)|(revenue|sales).*(why|drop|dropped|down|fell|increase|increased|change|changed)/ },
  { intent: 'compare_branches', re: /\b(compare|comparison|versus|vs)\b.*(branch|branches|location|locations|salon|salons)|(branch|branches|location|locations).*(compare|comparison|best|worst)/ },
  { intent: 'technician_performance', re: /technician|\btech\b|staff performance|utiliz|who.*(most|busiest)/ },
  { intent: 'customer_growth', re: /customer|client|retention|returning|repeat|new customers|churn/ },
  { intent: 'appointments', re: /appointment|booking|bookings|cancel|cancellation|no.?show|walk.?in|busiest day|open capacity|open slots/ },
  { intent: 'daily_summary', re: /today|daily|brief|how.*(did|are) we.*(do|doing)|what.*(needs|need) attention|summary of (today|the day)/ },
  { intent: 'revenue_summary', re: /revenue|sales|net sales|average ticket|how much.*(made|earn)/ },
];

/** Resolve a free-text business question to a single intent, or null when no rule matches confidently. */
export function resolveIntent(question: string): AiBusinessIntent | null {
  const q = (question || '').toLowerCase();
  for (const r of RULES) if (r.re.test(q)) return r.intent;
  return null;
}
