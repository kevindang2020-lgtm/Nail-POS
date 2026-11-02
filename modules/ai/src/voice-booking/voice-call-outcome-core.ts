// Wire types owned by @aipowersalon/api-contracts/platform (Constitution 13 §15).
export type { NormalizedCallOutcome } from '@aipowersalon/api-contracts/platform';
import type { NormalizedCallOutcome } from '@aipowersalon/api-contracts/platform';
// voice-call-outcome-core.ts — pure, testable normalization of a call-outcome payload before persistence. No I/O.
// Honest handling: unmodeled/absent fields become null (never fabricated), counts clamp to >= 0, arrays are sanitized.
export interface CallOutcomeInput {
  providerCallId: string;
  promptVersion?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  durationSeconds?: number | null;
  language?: string | null;
  intents?: unknown;
  toolCalls?: unknown;
  bookingOutcome?: string | null;
  handoffOutcome?: string | null;
  sentiment?: string | null;
  errorCategory?: string | null;
  interruptionCount?: number | null;
  repeatedQuestionCount?: number | null;
  abandoned?: boolean;
  followUpRequired?: boolean;
  summary?: string | null;
}


export class CallOutcomeValidationError extends Error {}

const str = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const nonNegInt = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; };
const nullableInt = (v: unknown): number | null => { if (v == null) return null; const n = Number(v); return Number.isFinite(n) ? Math.floor(n) : null; };

function normIntents(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => str(x, 60)).filter((x): x is string => !!x).slice(0, 20);
}
function normToolCalls(v: unknown): { name: string; ok: boolean }[] {
  if (!Array.isArray(v)) return [];
  return v.map((x: any) => ({ name: str(x?.name, 60) ?? 'unknown', ok: x?.ok === true })).slice(0, 50);
}

/** Normalize + validate. Throws only when the dedup key (providerCallId) is missing — everything else degrades to null. */
export function normalizeCallOutcome(input: CallOutcomeInput): NormalizedCallOutcome {
  const providerCallId = str(input?.providerCallId, 128);
  if (!providerCallId) throw new CallOutcomeValidationError('providerCallId is required');
  return {
    providerCallId,
    promptVersion: str(input.promptVersion, 60),
    startedAt: str(input.startedAt, 40),
    endedAt: str(input.endedAt, 40),
    durationSeconds: nullableInt(input.durationSeconds),
    language: str(input.language, 20),
    intents: normIntents(input.intents),
    toolCalls: normToolCalls(input.toolCalls),
    bookingOutcome: str(input.bookingOutcome, 40),
    handoffOutcome: str(input.handoffOutcome, 40),
    sentiment: str(input.sentiment, 20),
    errorCategory: str(input.errorCategory, 60),
    interruptionCount: nonNegInt(input.interruptionCount),
    repeatedQuestionCount: nonNegInt(input.repeatedQuestionCount),
    abandoned: input.abandoned === true,
    followUpRequired: input.followUpRequired === true,
    summary: str(input.summary, 2000),
  };
}
