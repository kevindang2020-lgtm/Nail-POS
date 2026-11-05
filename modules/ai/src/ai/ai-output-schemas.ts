// ai-output-schemas.ts — Constitution 10 Phase 10: structured output (§72–§76, §136, §285–§286).
//
// THE RULE THIS FILE EXISTS FOR (§285/§286): a provider returning 200 does not complete an AI task. The text is
// untrusted (§136) until it parses, matches the task's declared schema, passes business checks, and is
// persisted with its usage. Anything else is FAILED_VALIDATION — never COMPLETED, never a fake result (§303).
//
// Schemas are closed and small, so this is a purpose-built validator rather than a new dependency. Every rule
// is one of: required, enum, string with max length, number in a range, integer, boolean, array of X with a
// max length, nested object. Nothing dynamic — the model cannot introduce a key the schema does not name
// (extra keys are STRIPPED, not passed through, so a hallucinated field never reaches a domain service).

export type Rule =
  | { t: 'string'; max?: number; min?: number; nullable?: boolean }
  | { t: 'enum'; values: readonly string[]; nullable?: boolean }
  | { t: 'number'; min?: number; max?: number; integer?: boolean; nullable?: boolean }
  | { t: 'boolean' }
  | { t: 'array'; of: Rule; max: number; min?: number }
  | { t: 'object'; fields: Record<string, Rule>; optional?: readonly string[] };

export interface OutputSchema { key: string; taskKey: string; root: Rule; /** §75 where confidence comes from for this schema, if anywhere. */ confidence: 'model' | 'validation' | 'none' }

export class AiOutputSchemaInvalid extends Error {
  readonly code = 'AI_OUTPUT_SCHEMA_INVALID';   // §73
  readonly status = 502;
  constructor(readonly schemaKey: string, readonly problems: string[]) {
    super(`AI output failed schema ${schemaKey}: ${problems.slice(0, 3).join('; ')}${problems.length > 3 ? ` (+${problems.length - 3})` : ''}`);
    this.name = 'AiOutputSchemaInvalid';
  }
}

const S = (max: number, extra: Partial<Extract<Rule, { t: 'string' }>> = {}): Rule => ({ t: 'string', max, ...extra });
const E = (values: readonly string[], nullable = false): Rule => ({ t: 'enum', values, nullable });
const N = (min: number, max: number, integer = false, nullable = false): Rule => ({ t: 'number', min, max, integer, nullable });
const A = (of: Rule, max: number, min = 0): Rule => ({ t: 'array', of, max, min });
const O = (fields: Record<string, Rule>, optional: readonly string[] = []): Rule => ({ t: 'object', fields, optional });
const CONF = N(0, 1);
const CENTS = N(0, 100_000_000, true, true);   // ≤ $1,000,000, integer, may be null when unreadable (§47)

/** §73: one schema per task output key. The keys are what AI_TASKS[*].outputSchema and the prompt seed name. */
export const OUTPUT_SCHEMAS: Readonly<Record<string, OutputSchema>> = Object.freeze({
  'review.sentiment.v1': { key: 'review.sentiment.v1', taskKey: 'review.sentiment_analyze', confidence: 'model',
    root: O({ sentiment: E(['positive', 'neutral', 'negative']), theme: S(80), confidence: CONF }) },
  'review.response.v1': { key: 'review.response.v1', taskKey: 'review.response_draft', confidence: 'none',
    root: O({ reply: S(700, { min: 10 }), tone: S(20) }) },
  'voice.transcript.v1': { key: 'voice.transcript.v1', taskKey: 'voice.transcribe', confidence: 'none',
    root: O({ text: S(60_000) }) },
  'voice.summary.v1': { key: 'voice.summary.v1', taskKey: 'voice.summarize', confidence: 'none',
    root: O({ intent: S(200), service: S(120, { nullable: true }), requested_time: S(120, { nullable: true }), follow_up: S(300, { nullable: true }), summary: S(600) }) },
  'ocr.receipt.v1': { key: 'ocr.receipt.v1', taskKey: 'ocr.receipt_extract', confidence: 'model',
    root: O({ vendor: S(160, { nullable: true }), date: S(10, { nullable: true }),
      line_items: A(O({ description: S(200), quantity: N(0, 10_000, false, true), unit_price_cents: CENTS, line_total_cents: CENTS }), 200),
      subtotal_cents: CENTS, tax_cents: CENTS, total_cents: CENTS, confidence: CONF }) },
  'forecast.explanation.v1': { key: 'forecast.explanation.v1', taskKey: 'forecast.explain', confidence: 'none',
    root: O({ explanation: S(900), key_driver: S(120) }) },
  'queue.explanation.v1': { key: 'queue.explanation.v1', taskKey: 'queue.explain_recommendation', confidence: 'none',
    root: O({ explanation: S(600), key_factor: S(120) }) },
  'schedule.explanation.v1': { key: 'schedule.explanation.v1', taskKey: 'schedule.explain_suggestion', confidence: 'none',
    root: O({ explanation: S(900), benefit: S(160), tradeoff: S(160, { nullable: true }) }) },
  'reconciliation.explanation.v1': { key: 'reconciliation.explanation.v1', taskKey: 'reconciliation.explain_exception', confidence: 'none',
    root: O({ likely_causes: A(O({ cause: S(240), check: S(240) }), 6, 1), summary: S(300) }) },
  'money.explanation.v1': { key: 'money.explanation.v1', taskKey: 'money.explain_alert', confidence: 'none',
    root: O({ explanation: S(900), first_check: S(160) }) },
  'receptionist.reply.v1': { key: 'receptionist.reply.v1', taskKey: 'receptionist.reply_draft', confidence: 'none',
    root: O({ reply: S(700, { min: 5 }), needs_human: { t: 'boolean' }, reason: S(200, { nullable: true }) }) },
  // CORRECTED in the Phase 23 marketing port. This first declared {headline, body, cta} — a generic ad shape
  // that fits none of the three channels the module actually supports: SMS is one line, push is title + body,
  // email is subject + body. `subject` is the email subject or the push title, and null for SMS; the service
  // composes them back into the exact text validateDraft() has always checked.
  'marketing.content.v1': { key: 'marketing.content.v1', taskKey: 'marketing.content_draft', confidence: 'none',
    root: O({ subject: S(160, { nullable: true }), message: S(1500, { min: 5 }) }) },
  'business.narrative.v1': { key: 'business.narrative.v1', taskKey: 'business.report_narrate', confidence: 'none',
    root: O({ narrative: S(2000), highlights: A(S(200), 8) }) },
  'checkout.upsell.v1': { key: 'checkout.upsell.v1', taskKey: 'checkout.upsell_suggest', confidence: 'none',
    root: O({ suggestions: A(O({ item_id: S(64), pitch: S(200) }), 2) }) },
});

// ---------------------------------------------------------------------------------------------------------------
// Parsing: the model was told "JSON only" but models wrap in fences, prepend prose, or trail commentary.
// This is the ONLY leniency: locate the outermost {...}. Nothing inside is repaired here.
// ---------------------------------------------------------------------------------------------------------------
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf('{'), end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new AiOutputSchemaInvalid('(parse)', ['no JSON object in provider text']);
  try { return JSON.parse(body.slice(start, end + 1)); }
  catch (e) { throw new AiOutputSchemaInvalid('(parse)', [`invalid JSON: ${(e as Error).message.slice(0, 80)}`]); }
}

/**
 * Validate + coerce. Returns a NEW value containing only schema-named keys. Throws AiOutputSchemaInvalid.
 *
 * `rule` lets a caller validate against an inline schema instead of the output registry — the Tool Registry
 * (§134) needs exactly this validator for tool ARGUMENTS, and a second implementation of the same rules would
 * be a place for the two to disagree about what "valid" means.
 */
export function validate<T = unknown>(schemaKey: string, value: unknown, rule?: Rule): T {
  const root = rule ?? OUTPUT_SCHEMAS[schemaKey]?.root;
  if (!root) throw new AiOutputSchemaInvalid(schemaKey, ['unknown schema key — declare it in OUTPUT_SCHEMAS (§73)']);
  const problems: string[] = [];
  const out = walk(root, value, '$', problems);
  if (problems.length) throw new AiOutputSchemaInvalid(schemaKey, problems);
  return out as T;
}

function walk(rule: Rule, v: unknown, path: string, problems: string[]): unknown {
  const nullable = 'nullable' in rule && rule.nullable;
  if (v === null || v === undefined) { if (nullable) return null; problems.push(`${path}: required`); return undefined; }
  switch (rule.t) {
    case 'string':
      if (typeof v !== 'string') { problems.push(`${path}: expected string`); return undefined; }
      if (rule.max !== undefined && v.length > rule.max) { problems.push(`${path}: longer than ${rule.max}`); return undefined; }
      if (rule.min !== undefined && v.trim().length < rule.min) { problems.push(`${path}: shorter than ${rule.min}`); return undefined; }
      return v;
    case 'enum': {
      // Models drift in case ("Positive", "NEGATIVE"); normalising case is a coercion, not a repair — the SET is fixed.
      const hit = typeof v === 'string' ? rule.values.find((x) => x.toLowerCase() === v.toLowerCase()) : undefined;
      if (!hit) { problems.push(`${path}: expected one of ${rule.values.join('|')}`); return undefined; }
      return hit;
    }
    case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v)) { problems.push(`${path}: expected finite number`); return undefined; }
      if (rule.integer && !Number.isInteger(v)) { problems.push(`${path}: expected integer`); return undefined; }
      if (rule.min !== undefined && v < rule.min) { problems.push(`${path}: below ${rule.min}`); return undefined; }
      if (rule.max !== undefined && v > rule.max) { problems.push(`${path}: above ${rule.max}`); return undefined; }
      return v;
    case 'boolean':
      if (typeof v !== 'boolean') { problems.push(`${path}: expected boolean`); return undefined; }
      return v;
    case 'array': {
      if (!Array.isArray(v)) { problems.push(`${path}: expected array`); return undefined; }
      if (v.length > rule.max) { problems.push(`${path}: more than ${rule.max} items`); return undefined; }
      if (rule.min !== undefined && v.length < rule.min) { problems.push(`${path}: fewer than ${rule.min} items`); return undefined; }
      return v.map((x, i) => walk(rule.of, x, `${path}[${i}]`, problems));
    }
    case 'object': {
      if (typeof v !== 'object' || Array.isArray(v)) { problems.push(`${path}: expected object`); return undefined; }
      const src = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [k, r] of Object.entries(rule.fields)) {
        if (!(k in src) && rule.optional?.includes(k)) continue;
        out[k] = walk(r, src[k], `${path}.${k}`, problems);
      }
      // Extra keys are dropped silently — §136: a hallucinated field must never reach a domain service.
      return out;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// §74 bounded repair. ONE attempt, and only for the kind of failure a re-ask can fix (parse or shape). A value
// that parsed and matched shape but failed a business rule is not "repaired" by asking the model again.
// ---------------------------------------------------------------------------------------------------------------
export interface RepairRequest { schemaKey: string; problems: string[]; originalText: string }
export function repairPrompt(r: RepairRequest): string {
  return [
    `Your previous response did not match the required schema (${r.schemaKey}). Problems:`,
    ...r.problems.slice(0, 8).map((p) => `- ${p}`),
    'Return ONLY the corrected JSON object. No prose, no code fence.',
    'Previous response (for reference, do not repeat its mistakes):',
    r.originalText.slice(0, 2000),
  ].join('\n');
}

/**
 * The full §285 pipeline for one provider text: parse → validate → (one repair) → validated value.
 * `ask` is the bounded re-ask the platform provides (same task, same tenant, temperature 0). Returns the value
 * and whether a repair was used, so the trace can say so (§116). Throws AiOutputSchemaInvalid → the job is
 * FAILED_VALIDATION (§286), never COMPLETED.
 */
export async function validateWithRepair<T>(schemaKey: string, text: string, ask?: (repair: string) => Promise<string>): Promise<{ value: T; repaired: boolean; attempts: number }> {
  try { return { value: validate<T>(schemaKey, extractJson(text)), repaired: false, attempts: 1 }; }
  catch (first) {
    if (!(first instanceof AiOutputSchemaInvalid) || !ask) throw first;
    const second = await ask(repairPrompt({ schemaKey, problems: first.problems, originalText: text }));
    // No third attempt. If the repair is also invalid, that error carries BOTH problem lists.
    try { return { value: validate<T>(schemaKey, extractJson(second)), repaired: true, attempts: 2 }; }
    catch (again) {
      if (again instanceof AiOutputSchemaInvalid) throw new AiOutputSchemaInvalid(schemaKey, [...first.problems.map((p) => `attempt1: ${p}`), ...again.problems.map((p) => `attempt2: ${p}`)]);
      throw again;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// §75/§76 confidence: only from a source the schema declares. Never invented.
// ---------------------------------------------------------------------------------------------------------------
// Two guards ('none' short-circuit, then the 'model' branch) both refuse a volunteered confidence on a schema
// that declares none. Mutation-tested: removing either alone still passes; removing both fails the suite.
export function confidenceOf(schemaKey: string, value: unknown): number | undefined {
  const schema = OUTPUT_SCHEMAS[schemaKey];
  if (!schema || schema.confidence === 'none') return undefined;                       // §75: omit rather than invent
  if (schema.confidence === 'model') {
    const c = (value as { confidence?: unknown })?.confidence;
    return typeof c === 'number' && c >= 0 && c <= 1 ? c : undefined;
  }
  return undefined;
}
/** §76: below this a result is human-review-only and never triggers an automatic action. */
export const LOW_CONFIDENCE = 0.6;
export const isLowConfidence = (c: number | undefined) => c !== undefined && c < LOW_CONFIDENCE;

/** §285: the states a result can be in. There is no path from FAILED_VALIDATION to COMPLETED without a new provider call. */
export type CompletionStatus = 'COMPLETED' | 'FAILED_VALIDATION' | 'FAILED_PROVIDER' | 'NEEDS_REVIEW';
