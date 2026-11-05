// ai-review-reputation-core.ts — PURE review analysis. No I/O, no LLM calls, deterministic and unit-testable. The
// serious-signal layer is SAFETY-CRITICAL and LLM-INDEPENDENT: it always runs (the platform's fallback safety policy),
// and it OVERRIDES rating and any LLM hints — a 5-star review that mentions a chemical burn is still critical + escalated.
// The LLM layer (later stage) may only ENRICH sentiment/category confidence; it can never downgrade a detected risk.
// Review text is UNTRUSTED input: this module classifies it as data and never executes instructions embedded in it.

export type Sentiment = 'positive' | 'neutral' | 'negative' | 'mixed';
export type Severity = 'low' | 'medium' | 'high' | 'critical';

export type ComplaintCategory =
  | 'service_quality' | 'technician_behavior' | 'staff_attitude' | 'long_wait' | 'appointment_delay'
  | 'booking_problem' | 'cancellation_problem' | 'incorrect_service' | 'pricing_dispute' | 'unauthorized_charge'
  | 'tip_dispute' | 'refund_request' | 'product_issue' | 'cleanliness' | 'sanitation' | 'injury_health'
  | 'allergic_reaction' | 'nail_damage' | 'communication_problem' | 'accessibility_concern' | 'discrimination'
  | 'harassment' | 'privacy_concern' | 'fraud_allegation' | 'other';

// Serious signals force escalation + block auto-publish. Each maps to a severity floor.
export type SeriousSignal =
  | 'injury' | 'infection' | 'chemical_burn' | 'allergic_reaction' | 'sanitation' | 'threat' | 'violence'
  | 'harassment' | 'discrimination' | 'fraud' | 'unauthorized_charge' | 'privacy' | 'legal' | 'media' | 'child_safety';

export interface ReviewAnalysisInput {
  text: string | null;
  rating: number | null;          // 1..5 (or null when a source has no star rating)
  llm?: { sentiment?: Sentiment; categories?: ComplaintCategory[]; confidence?: number } | null; // optional enrichment
}

export interface ReviewAnalysis {
  sentiment: Sentiment;
  severity: Severity;
  categories: ComplaintCategory[];
  seriousSignals: SeriousSignal[];
  escalationRequired: boolean;
  autoResponseEligible: boolean;   // narrow low-risk gate (§ controlled auto-response) — computed conservatively
  isSpam: boolean;
  injectionSuspected: boolean;     // review text tried to look like an instruction — flagged, never obeyed
  confidence: number;              // 0..1
  source: 'deterministic' | 'deterministic+llm';
}

const norm = (t: string | null): string => (t || '').toLowerCase().replace(/\s+/g, ' ').trim();
const has = (t: string, terms: string[]): boolean => terms.some((w) => t.includes(w));

// --- deterministic serious-signal detection (SAFETY-CRITICAL, always runs) ---
const SIGNAL_TERMS: Record<SeriousSignal, string[]> = {
  injury: ['injur', 'cut me', 'bleeding', 'bled', 'hurt me', 'wound'],
  infection: ['infection', 'infected', 'pus', 'staph', 'fungal infection'],
  chemical_burn: ['chemical burn', 'burned my', 'burnt my', 'acid burn', 'skin burn'],
  allergic_reaction: ['allergic', 'allergy', 'rash', 'hives', 'swelling', 'reaction to'],
  sanitation: ['dirty tools', 'unsanitary', 'not sanitized', 'not cleaned', 'reused', 'unhygienic', 'dirty foot', 'dirty towel'],
  threat: ['i will sue', 'threat', 'i will report you', 'shut you down'],
  violence: ['assault', 'hit me', 'attacked', 'violent', 'grabbed me'],
  harassment: ['harass', 'inappropriate touch', 'creepy', 'made me uncomfortable', 'sexual'],
  discrimination: ['discriminat', 'racist', 'racism', 'refused to serve', 'because of my race', 'homophob', 'sexist'],
  fraud: ['fraud', 'scam', 'stole', 'stolen', 'ripped me off'],
  unauthorized_charge: ['charged me twice', 'unauthorized charge', 'double charged', 'charged without', 'extra charge i didn'],
  privacy: ['shared my', 'privacy', 'posted my', 'leaked my', 'without my consent'],
  legal: ['lawyer', 'lawsuit', 'legal action', 'attorney', 'court'],
  media: ['news', 'media', 'tv station', 'yelp everyone', 'tell everyone online'],
  child_safety: ['my child', 'my kid', 'minor', 'underage'],
};

const SIGNAL_SEVERITY: Record<SeriousSignal, Severity> = {
  injury: 'critical', infection: 'critical', chemical_burn: 'critical', allergic_reaction: 'critical',
  violence: 'critical', threat: 'high', child_safety: 'critical',
  sanitation: 'high', harassment: 'high', discrimination: 'high', fraud: 'high', unauthorized_charge: 'high',
  privacy: 'high', legal: 'high', media: 'high',
};

export function detectSeriousSignals(text: string | null): SeriousSignal[] {
  const t = norm(text);
  if (!t) return [];
  const out: SeriousSignal[] = [];
  for (const sig of Object.keys(SIGNAL_TERMS) as SeriousSignal[]) if (has(t, SIGNAL_TERMS[sig])) out.push(sig);
  return out;
}

// --- deterministic complaint-category baseline (LLM may add more; safety categories always come from signals) ---
const CATEGORY_TERMS: Partial<Record<ComplaintCategory, string[]>> = {
  long_wait: ['waited', 'long wait', 'waiting', 'took forever', 'hour late'],
  appointment_delay: ['late appointment', 'behind schedule', 'delayed'],
  booking_problem: ['booking', 'couldn\u2019t book', 'could not book', 'reservation'],
  cancellation_problem: ['cancel', 'cancelled', 'canceled my'],
  incorrect_service: ['wrong service', 'not what i asked', 'wrong color', 'wrong shape'],
  pricing_dispute: ['overcharged', 'too expensive', 'price', 'charged more', 'cost more'],
  tip_dispute: ['tip', 'gratuity'],
  refund_request: ['refund', 'money back', 'want my money'],
  product_issue: ['product', 'polish', 'gel', 'chipped', 'peeled', 'peeling'],
  cleanliness: ['dirty', 'messy', 'gross', 'unclean'],
  nail_damage: ['damaged my nail', 'broke my nail', 'ruined my nail', 'nail damage'],
  communication_problem: ['rude', 'didn\u2019t listen', 'did not listen', 'ignored me', 'no one answered'],
  staff_attitude: ['attitude', 'rude staff', 'unprofessional', 'disrespect'],
  technician_behavior: ['technician was', 'my tech', 'nail tech'],
  accessibility_concern: ['wheelchair', 'accessible', 'disability', 'accommodat'],
  service_quality: ['sloppy', 'poor quality', 'bad job', 'terrible service', 'awful'],
};

const SIGNAL_TO_CATEGORY: Partial<Record<SeriousSignal, ComplaintCategory>> = {
  injury: 'injury_health', infection: 'injury_health', chemical_burn: 'injury_health', allergic_reaction: 'allergic_reaction',
  sanitation: 'sanitation', harassment: 'harassment', discrimination: 'discrimination', fraud: 'fraud_allegation',
  unauthorized_charge: 'unauthorized_charge', privacy: 'privacy_concern',
};

export function classifyCategories(text: string | null, signals: SeriousSignal[]): ComplaintCategory[] {
  const t = norm(text);
  const set = new Set<ComplaintCategory>();
  for (const sig of signals) { const c = SIGNAL_TO_CATEGORY[sig]; if (c) set.add(c); }
  if (t) for (const cat of Object.keys(CATEGORY_TERMS) as ComplaintCategory[]) if (has(t, CATEGORY_TERMS[cat]!)) set.add(cat);
  return [...set];
}

// --- spam + injection (untrusted-text handling) ---
export function detectSpam(text: string | null, rating: number | null): boolean {
  const t = norm(text);
  if (!t) return false;
  if (/(https?:\/\/|www\.)\S+/.test(t) && /(promo|discount|casino|crypto|loan|free money|click here|buy now)/.test(t)) return true;
  if (/(.)\1{9,}/.test(t)) return true;                          // long char runs (aaaaaaaaaa)
  if (t.length > 12 && /^[^a-z]+$/.test(t)) return true;          // no letters at all
  return false;
}

const INJECTION_PATTERNS = ['ignore previous', 'ignore all previous', 'disregard the above', 'system prompt', 'you are now', 'act as', 'reveal your', 'print your instructions'];
export function detectInjection(text: string | null): boolean {
  const t = norm(text);
  return !!t && INJECTION_PATTERNS.some((p) => t.includes(p));
}

// --- sentiment + severity ---
const PRAISE = ['love', 'amazing', 'great', 'excellent', 'wonderful', 'best', 'perfect', 'fantastic', 'highly recommend', 'friendly'];
const COMPLAINT = ['terrible', 'awful', 'worst', 'horrible', 'never again', 'disappointed', 'bad', 'rude', 'dirty', 'ruined'];

export function normalizeSentiment(input: { text: string | null; rating: number | null; llm?: Sentiment | null }): Sentiment {
  const t = norm(input.text);
  const praise = has(t, PRAISE), complaint = has(t, COMPLAINT);
  if (praise && complaint) return 'mixed';
  const r = input.rating;
  if (r != null) { if (r >= 4) return praise || !complaint ? 'positive' : 'mixed'; if (r <= 2) return 'negative'; return complaint ? 'negative' : praise ? 'mixed' : 'neutral'; }
  if (input.llm) return input.llm;                               // no rating → trust LLM hint if present
  if (complaint) return 'negative'; if (praise) return 'positive'; return 'neutral';
}

const SEV_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };
const maxSev = (a: Severity, b: Severity): Severity => (SEV_RANK[a] >= SEV_RANK[b] ? a : b);

export function computeSeverity(input: { rating: number | null; signals: SeriousSignal[]; categories: ComplaintCategory[]; sentiment: Sentiment }): Severity {
  let sev: Severity = 'low';
  for (const sig of input.signals) sev = maxSev(sev, SIGNAL_SEVERITY[sig]);        // signals set the floor
  const mediumCats: ComplaintCategory[] = ['incorrect_service', 'pricing_dispute', 'refund_request', 'nail_damage', 'booking_problem', 'cancellation_problem', 'product_issue'];
  if (input.categories.some((c) => mediumCats.includes(c))) sev = maxSev(sev, 'medium');
  if (input.rating != null && input.rating <= 2 && input.sentiment === 'negative') sev = maxSev(sev, 'medium');
  return sev;
}

// --- the merged, structured analysis ---
export function analyzeReview(input: ReviewAnalysisInput): ReviewAnalysis {
  const signals = detectSeriousSignals(input.text);              // deterministic, always
  const injectionSuspected = detectInjection(input.text);
  const isSpam = detectSpam(input.text, input.rating);
  const sentiment = normalizeSentiment({ text: input.text, rating: input.rating, llm: input.llm?.sentiment ?? null });
  let categories = classifyCategories(input.text, signals);
  // LLM may ADD categories, but never removes deterministic (safety) ones
  if (input.llm?.categories?.length) categories = [...new Set([...categories, ...input.llm.categories])];
  const severity = computeSeverity({ rating: input.rating, signals, categories, sentiment });
  const escalationRequired = signals.length > 0 || severity === 'high' || severity === 'critical';

  // auto-response eligibility is DELIBERATELY narrow (real gate lives in the drafting stage; this is the analysis-side veto)
  const autoResponseEligible = !escalationRequired && !isSpam && !injectionSuspected && signals.length === 0
    && categories.length === 0 && sentiment === 'positive' && (input.rating ?? 0) >= 5;

  // confidence: deterministic signals are high-confidence; blend LLM confidence when present
  const detConf = signals.length > 0 ? 0.95 : input.rating != null ? 0.8 : 0.5;
  const confidence = input.llm?.confidence != null ? Math.round(((detConf + input.llm.confidence) / 2) * 100) / 100 : detConf;

  return {
    sentiment, severity, categories, seriousSignals: signals, escalationRequired, autoResponseEligible,
    isSpam, injectionSuspected, confidence, source: input.llm ? 'deterministic+llm' : 'deterministic',
  };
}
