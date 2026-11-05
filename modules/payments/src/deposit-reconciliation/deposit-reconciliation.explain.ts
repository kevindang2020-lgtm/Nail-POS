// deposit-reconciliation.explain.ts — the PURE, deterministic explanation builder. It composes a factual,
// plain-language explanation of a settlement's reconciliation state using ONLY verified components (expected vs
// actual deposit, matched record, fee expected vs actual). This is the source of truth; the AI layer only
// rephrases this — it can never introduce a fact that isn't here. Versioned so outputs are reproducible.
import type { ReconRow } from './deposit-reconciliation.dto';
import type { FeeReconRow } from './deposit-reconciliation.fees';

export const EXPLANATION_PROMPT_VERSION = 'recon-explain-v1';

const money = (c: number | null | undefined): string => (c == null ? 'n/a' : `$${(Math.abs(c) / 100).toFixed(2)}`);
const day = (iso: string | null): string => (iso ? String(iso).slice(0, 10) : 'an unknown date');

export interface ExplanationFacts {
  summary: string;              // the deterministic, factual explanation
  components: Record<string, string | number | null>;
  confidence: number;
  unverified: boolean;          // true when a component could not be verified (never claimed as a difference)
  promptVersion: string;
}

// Build the factual explanation for a settlement from its (deterministic) reconciliation + fee rows.
export function buildReconFacts(recon: ReconRow, fee: FeeReconRow | null): ExplanationFacts {
  const parts: string[] = [];
  let unverified = false;
  const proc = recon.processorType || 'the processor';

  // Deposit matching
  if (recon.status === 'matched') {
    parts.push(`This ${proc} settlement of ${money(recon.expectedNetCents)} (settled ${day(recon.settledAt)}) was matched to a bank deposit of ${money(recon.actualCents)} with no difference.`);
  } else if (recon.status === 'matched_with_tolerance') {
    const diff = recon.differenceCents;
    parts.push(`This ${proc} settlement of ${money(recon.expectedNetCents)} was matched to a bank deposit of ${money(recon.actualCents)}, a difference of ${money(diff)} ${diff < 0 ? 'less' : 'more'} than expected — within the configured tolerance${recon.matchType === 'reference' ? ', matched on the processor reference' : ''}.`);
  } else if (recon.status === 'missing_deposit') {
    parts.push(`No bank deposit has been matched to this ${proc} settlement of ${money(recon.expectedNetCents)} (settled ${day(recon.settledAt)}). It is past the expected funding window, so it is flagged as a missing deposit for review.`);
  } else {
    parts.push(`This ${proc} settlement of ${money(recon.expectedNetCents)} (settled ${day(recon.settledAt)}) does not yet have a matching bank deposit, but is still within the expected funding window.`);
  }

  // Fee reconciliation
  if (fee) {
    if (fee.status === 'matched') {
      parts.push(`The processing fee of ${money(fee.actualFeeCents)} matches the expected fee under schedule version ${fee.scheduleVersion}.`);
    } else if (fee.status === 'fee_difference') {
      const d = fee.differenceCents ?? 0;
      parts.push(`The processing fee of ${money(fee.actualFeeCents)} is ${money(d)} ${d > 0 ? 'higher' : 'lower'} than the expected ${money(fee.expectedFeeCents)} under schedule version ${fee.scheduleVersion}.`);
    } else if (fee.status === 'unverified') {
      unverified = true;
      parts.push(`The processing fee could not be fully verified: ${fee.unverifiedReason}. It is not being treated as a difference.`);
    } else {
      unverified = true;
      parts.push(`No fee schedule is configured for this processor and date, so the ${money(fee.actualFeeCents)} fee could not be checked.`);
    }
  }

  return {
    summary: parts.join(' '),
    components: {
      status: recon.status, expectedNetCents: recon.expectedNetCents, actualCents: recon.actualCents,
      differenceCents: recon.differenceCents, matchType: recon.matchType,
      feeStatus: fee?.status ?? null, feeExpectedCents: fee?.expectedFeeCents ?? null, feeActualCents: fee?.actualFeeCents ?? null,
    },
    confidence: Math.min(recon.confidence || 0, fee ? (fee.confidence || 0) : 1) || (recon.status === 'matched' ? 1 : 0.6),
    unverified,
    promptVersion: EXPLANATION_PROMPT_VERSION,
  };
}

// System prompt for the AI rephrase layer. Constrains the model to the provided facts only.
export const EXPLANATION_SYSTEM = [
  'You explain payment-reconciliation results to a salon owner in clear, plain business language.',
  'Use ONLY the facts provided. Do NOT invent fee terms, processor rules, bank events, contract details,',
  'amounts, or resolutions. Do not speculate about fraud. If a value is marked unverified, say it could not be',
  'verified rather than asserting a problem. Keep it to 2-3 sentences.',
].join(' ');
