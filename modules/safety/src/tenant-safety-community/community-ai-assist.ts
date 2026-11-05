// community-ai-assist.ts — AI help for writing and moderating advisories, under hard guardrails.
//
// The governing idea: the model's output is UNTRUSTED INPUT, not a decision. The spec permits AI to rewrite
// emotional language, detect personal information, extract the scam method, and suggest a category/severity —
// and forbids it from inventing facts, adding accusations, labelling anyone guilty, revealing customer
// information, or publishing anything. Both halves are enforced structurally here, not by prompt wording alone:
//
//   1. NEVER PUBLISHES. Nothing in this file writes a post, changes a status, or moves the workflow. It returns
//      a *suggestion* the human must accept. (There is no repo and no status argument — it cannot.)
//   2. AI OUTPUT IS RE-SCANNED. A model can hallucinate or echo a phone number back into its "sanitized"
//      rewrite. So every suggestion is passed back through the SAME privacy scan and wording guard the human's
//      own text must pass. If the model's output contains payment/ID data, the suggestion is DISCARDED, not
//      shown. If it contains accusatory language, it is rejected as unusable.
//   3. NO NEW FACTS. A suggestion whose content introduces claims not present in the original (checked by a
//      conservative token-overlap floor) is flagged `unverifiable_additions` and withheld — the model must
//      condense and neutralize, not embellish.
//   4. ADVISORY ONLY. Moderation assistance returns *signals* for a human moderator; it never decides.
import { scanCommunityText, type CommunityPiiCategory } from './community-privacy-scan';
import { checkWording } from './community-permissions';

export interface AiBackend { complete(req: { system: string; prompt: string }): Promise<{ text: string }>; }

// ── Writing assistance ──

export interface DraftSuggestion {
  ok: boolean;
  sanitizedBody: string | null;         // null when the suggestion was withheld
  redactions: CommunityPiiCategory[];   // what the scan removed from the ORIGINAL
  warnings: string[];
  withheldReason?: 'ai_output_contained_payment_data' | 'ai_output_accusatory' | 'unverifiable_additions' | 'ai_unavailable';
  requiresHumanApproval: true;          // always — never auto-publishes
}

const WRITING_SYSTEM = [
  'You rewrite salon safety advisories so they are neutral, factual and safe to share between businesses.',
  'RULES YOU MUST FOLLOW:',
  '- Never invent facts, details, names, amounts or outcomes that are not in the input.',
  '- Never accuse anyone of a crime. Never call a person a scammer, thief, criminal or fraudster.',
  '- Use neutral phrasing: "suspected scam attempt", "pattern requiring caution", "possible fraudulent behavior".',
  '- Never include a customer name, phone number, email, address, card number or any identifier.',
  '- Describe the BEHAVIOR and the METHOD, never the person.',
  '- Output only the rewritten advisory body. No preamble, no commentary.',
].join('\n');

/** Conservative "did the model add content?" check.
 *  Calibration matters here: too strict and every legitimate neutral rewrite is withheld (the assist becomes
 *  useless); too loose and invented facts slip through. So we target INVENTED SPECIFICS rather than vocabulary:
 *    - new quantities/numerals (spelled or digits) that the original never mentioned → invention;
 *    - a large volume of novel content words, ignoring the neutral advisory vocabulary a good rewrite is
 *      expected to introduce ("pattern", "caution", "advisory", "suspected"...).
 */
const NEUTRAL_VOCAB = new Set([
  'pattern', 'caution', 'requiring', 'requested', 'suspected', 'possible', 'advisory', 'recommend', 'recommended',
  'precaution', 'precautions', 'verify', 'verified', 'unverified', 'review', 'reported', 'incident', 'attempt',
  'attempted', 'behavior', 'behaviour', 'method', 'concern', 'staff', 'salon', 'salons', 'declined', 'refused',
]);
const NUMBERS = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozen|dozens|seventeen|twenty|thirty|forty|fifty|hundred|thousand|million)\b/gi;

export function introducesNewClaims(original: string, suggestion: string): boolean {
  const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'at', 'for', 'was', 'were', 'is', 'are', 'be', 'been', 'they', 'we', 'our', 'their', 'it', 'this', 'that', 'with', 'from', 'as', 'by', 'but', 'not', 'no', 'had', 'has', 'have', 'who', 'when', 'then', 'there', 'about', 'after', 'before', 'would', 'could', 'said', 'asked', 'caller', 'customer', 'client', 'called', 'call']);
  const words = (s: string) => new Set((s.toLowerCase().match(/[a-z]{4,}/g) || []).filter((w) => !STOP.has(w)));

  // 1) Invented quantities/specifics — a rewrite must never introduce a number the original didn't state.
  const origNums = new Set((original.toLowerCase().match(NUMBERS) || []).map((n) => n.toLowerCase()));
  const suggNums = (suggestion.toLowerCase().match(NUMBERS) || []).map((n) => n.toLowerCase());
  if (suggNums.some((n) => !origNums.has(n))) return true;

  // 2) Heavy novel content, discounting the neutral vocabulary a good rewrite legitimately adds.
  const orig = words(original);
  const sugg = [...words(suggestion)];
  if (!sugg.length) return false;
  const novel = sugg.filter((w) => !orig.has(w) && !NEUTRAL_VOCAB.has(w));
  return novel.length >= 8 && novel.length / sugg.length > 0.5;
}

/**
 * Suggest a sanitized advisory body. The result ALWAYS requires human approval and can never publish.
 * The AI's own output is treated as untrusted and re-screened before it is ever shown.
 */
export async function suggestSanitizedDraft(ai: AiBackend, originalBody: string): Promise<DraftSuggestion> {
  const scan = scanCommunityText(originalBody || '');
  const warnings: string[] = [];
  if (scan.blocked) warnings.push('Payment or ID data was found and removed. This post cannot be published until it is rewritten.');
  else if (scan.flagged) warnings.push('Customer information was found and redacted. A reviewer must confirm before publication.');

  let text: string;
  try {
    // The model only ever sees the REDACTED text — raw customer PII is never sent to a provider.
    const res = await ai.complete({ system: WRITING_SYSTEM, prompt: scan.redactedText });
    text = (res?.text || '').trim();
  } catch {
    return { ok: false, sanitizedBody: null, redactions: scan.categories, warnings, withheldReason: 'ai_unavailable', requiresHumanApproval: true };
  }
  if (!text) return { ok: false, sanitizedBody: null, redactions: scan.categories, warnings, withheldReason: 'ai_unavailable', requiresHumanApproval: true };

  // Guardrail 2: re-scan the MODEL'S output — it may have echoed an identifier back.
  const outScan = scanCommunityText(text);
  if (outScan.blocked) {
    return { ok: false, sanitizedBody: null, redactions: scan.categories, warnings, withheldReason: 'ai_output_contained_payment_data', requiresHumanApproval: true };
  }
  // Guardrail 2b: the model must not accuse.
  const wording = checkWording(outScan.redactedText, { officialReportReferenced: false, moderationApprovedWording: false });
  if (!wording.ok) {
    return { ok: false, sanitizedBody: null, redactions: scan.categories, warnings, withheldReason: 'ai_output_accusatory', requiresHumanApproval: true };
  }
  // Guardrail 3: the model must not invent.
  if (introducesNewClaims(scan.redactedText, outScan.redactedText)) {
    return { ok: false, sanitizedBody: null, redactions: scan.categories, warnings, withheldReason: 'unverifiable_additions', requiresHumanApproval: true };
  }

  return { ok: true, sanitizedBody: outScan.redactedText, redactions: scan.categories, warnings, requiresHumanApproval: true };
}

// ── Moderation assistance (signals for a human — never a decision) ──

export interface ModerationSignals {
  personalInfoDetected: CommunityPiiCategory[];
  paymentDataDetected: boolean;
  accusatoryLanguage: string | null;
  advisory: string[];                 // human-readable notes for the moderator
  decision: null;                     // structurally: AI NEVER decides. Always null.
}

/** Deterministic signals the moderator can act on. Intentionally NOT model-dependent for the safety-critical
 *  parts (PII / payment / accusation are computed by the same deterministic scanners used everywhere else), so
 *  a hallucination can never cause a moderator to see a false "clean". */
export function moderationSignals(text: string): ModerationSignals {
  const scan = scanCommunityText(text || '');
  const wording = checkWording(text || '', { officialReportReferenced: false, moderationApprovedWording: false });
  const advisory: string[] = [];
  if (scan.blocked) advisory.push('Contains payment or ID data — cannot be published as written.');
  if (scan.flagged && !scan.blocked) advisory.push('Contains customer information that was redacted — confirm the redaction is sufficient.');
  if (!wording.ok) advisory.push(`Accusatory wording ("${wording.matched}") — requires an official report reference or a rewrite.`);
  if (!advisory.length) advisory.push('No automated safety signals. Review on the merits.');
  return {
    personalInfoDetected: scan.categories.filter((c) => !['card', 'cvv', 'ssn', 'bank', 'gov_id'].includes(c)),
    paymentDataDetected: scan.blocked,
    accusatoryLanguage: wording.ok ? null : (wording.matched ?? null),
    advisory,
    decision: null,     // the human decides. Always.
  };
}
