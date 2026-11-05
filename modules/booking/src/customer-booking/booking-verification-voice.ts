// booking-verification-voice.ts — keeping a six-digit code out of a recorded phone call.
//
// ══ THE HARDEST REQUIREMENT IN THE SPEC, AND WHY ══════════════════════════════════════════════════════════
//
// A caller reads a code aloud. That audio is transcribed, and the transcript then feeds an AI prompt, a call
// summary, a search index, and a stored recording. A verification code that lands in ANY of those is a
// permanent, searchable authentication secret sitting in a salon's call history.
//
// I probed the platform's existing redactor with the cases a real call actually produces:
//
//   "My verification code is 123456"   → REDACTED   (keyword and value in one string)
//   "123456"                            → LEAKED
//   "one two three four five six"       → LEAKED
//   "it's 1 2 3 4 5 6"                  → LEAKED
//   "four eight two nine one seven"     → LEAKED
//
// Four out of five. And the one that passes is the artificial one — because a real exchange splits the keyword
// from the value across two turns:
//
//   AI:     "Please say your six-digit code."     ← the keyword lives HERE
//   Caller: "one two three four five six"         ← the value lives HERE
//
// `redactSegments` redacts each segment independently, so the anchor and the value are never visible to the same
// regex. That is not a tuning problem. It is structural.
//
// ══ LAYER 1: DON'T PUT THE CODE IN THE AUDIO ══════════════════════════════════════════════════════════════
//
// DTMF. The caller types the code on the keypad; the digits arrive on a SEPARATE channel and never reach the
// speech recogniser, so there is nothing in the audio to transcribe, summarise, index, or leak. This is the
// answer. `dtmfGather()` below is the path the receptionist should always take.
//
// Redacting spoken digits is, by its nature, best-effort — ASR mishears, accents vary, "oh" and "zero" and "nought"
// are the same digit, and a caller may pause mid-code. A redactor that is 95% effective on an authentication
// secret is not a security control; it is a 5% leak. So DTMF is not "preferred". It is the mechanism, and Layer 2
// exists only because a caller may ignore the prompt and speak the digits anyway.
//
// ══ LAYER 2: IF IT IS SPOKEN ANYWAY, SCRUB IT ═════════════════════════════════════════════════════════════
//
// `redactVerificationTurns()` is STATEFUL across segments, which is the whole point: it remembers that the
// assistant just asked for a code, and scrubs the caller's next digit-bearing turn — the exact case the existing
// per-segment redactor structurally cannot see.

/** Spoken digit words, including the ones ASR actually produces. "oh" and "nought" are zeros; people say them. */
const DIGIT_WORDS: Record<string, string> = {
  zero: '0', oh: '0', o: '0', nought: '0', naught: '0',
  one: '1', won: '1',
  two: '2', to: '2', too: '2',
  three: '3', tree: '3',
  four: '4', for: '4', fore: '4',
  five: '5',
  six: '6', sicks: '6',
  seven: '7',
  eight: '8', ate: '8',
  nine: '9', niner: '9',
};

export const OTP_PLACEHOLDER = '[REDACTED_OTP]';

/** Does this turn ASK for a code? The assistant's prompt is what arms the redactor for the next turn. */
const CODE_PROMPT = /\b(verification code|six[- ]?digit|6[- ]?digit|confirmation code|the code|your code|one[- ]?time (?:code|password)|otp|passcode|pin)\b/i;

/** Is this turn CLAIMING to give a code? Anchors that work when the value is in the same breath. */
const CODE_ANSWER_ANCHOR = /\b(code is|it'?s|that'?s|my code|the code is|reads?)\b/i;

const isDigitWord = (w: string) => Object.prototype.hasOwnProperty.call(DIGIT_WORDS, w.toLowerCase());

/**
 * Does this text carry something that COULD be a 4–8 digit code?
 *
 * Deliberately broad on the digit count. A code is six digits, but ASR drops and doubles digits constantly, and
 * a redactor that only fires on exactly six would sail straight past "one two three four five" — a mis-heard
 * code that still reveals five sixths of the secret.
 */
export function looksLikeSpokenCode(text: string): boolean {
  if (/\b\d{4,8}\b/.test(text)) return true;                                   // "123456"
  const tokens = text.split(/[\s,.-]+/).filter(Boolean);
  let run = 0;
  for (const t of tokens) {
    // A bare single digit ("1") counts as part of a spoken run: "it's 1 2 3 4 5 6".
    if (isDigitWord(t) || /^\d$/.test(t)) { run++; if (run >= 4) return true; }
    else run = 0;
  }
  return false;
}

/**
 * Scrub digit runs from ONE piece of text.
 *
 * Over-redacts on purpose. The existing redactor is careful to PRESERVE 10-digit phone numbers, clock times and
 * prices, because the salon needs them — and that care is exactly why a six-digit code slips through it. Here the
 * trade runs the other way: losing a price from one turn of a transcript costs the salon almost nothing; leaving
 * an authentication code in it is permanent.
 */
export function redactSpokenDigits(text: string): { text: string; applied: boolean } {
  let applied = false;

  // Bare digit runs of 4–8 (a 10-digit phone is longer and survives; a 3-digit price does not match).
  let out = text.replace(/\b\d{4,8}\b/g, () => { applied = true; return OTP_PLACEHOLDER; });

  // Spaced digits: "1 2 3 4 5 6".
  out = out.replace(/\b(?:\d[\s,.-]+){3,}\d\b/g, () => { applied = true; return OTP_PLACEHOLDER; });

  // Spoken digit words: "one two three four five six", "four eight two nine one seven".
  const tokens = out.split(/(\s+)/);
  const result: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length >= 4) { result.push(OTP_PLACEHOLDER); applied = true; }
    else result.push(...run);
    run = [];
  };
  for (const t of tokens) {
    if (/^\s+$/.test(t)) { if (run.length) run.push(t); else result.push(t); continue; }
    const word = t.replace(/[^a-z0-9]/gi, '');
    if (isDigitWord(word) || /^\d$/.test(word)) { run.push(t); }
    else { flush(); result.push(t); }
  }
  flush();

  return { text: result.join(''), applied };
}

export interface VoiceTurn {
  /** 'assistant' = the AI receptionist; 'caller' = the human. */
  speaker: 'assistant' | 'caller' | string;
  text: string;
}

export interface VoiceRedactionResult {
  turns: VoiceTurn[];
  /** True if ANY turn was scrubbed — the caller marks the segment sensitive and excludes it from AI summaries. */
  applied: boolean;
  /** Indexes of the turns that were scrubbed, so the recording can be marked sensitive at those offsets. */
  redactedTurns: number[];
}

/**
 * Scrub a verification code out of a call transcript.
 *
 * STATEFUL, which is the entire reason this exists. The assistant asks for the code in one turn and the caller
 * answers in the next, so a per-segment redactor can never see both. This one remembers.
 *
 * The `armed` flag stays set for exactly TWO caller turns after the prompt — enough for a correction ("sorry,
 * four eight two nine one seven") but not so long that the rest of the call is scrubbed of every number the
 * salon actually needs.
 */
export function redactVerificationTurns(turns: VoiceTurn[]): VoiceRedactionResult {
  const out: VoiceTurn[] = [];
  const redactedTurns: number[] = [];
  let armed = 0;
  let applied = false;

  turns.forEach((turn, i) => {
    const isAssistant = turn.speaker === 'assistant';

    if (isAssistant && CODE_PROMPT.test(turn.text)) {
      // The assistant is ASKING for a code. Whatever the caller says next is a candidate secret.
      armed = 2;
      out.push(turn);                                   // the QUESTION is not a secret and stays readable
      return;
    }

    const selfAnchored = CODE_ANSWER_ANCHOR.test(turn.text) && looksLikeSpokenCode(turn.text);
    const shouldScrub = (armed > 0 && !isAssistant && looksLikeSpokenCode(turn.text)) || selfAnchored;

    if (shouldScrub) {
      const r = redactSpokenDigits(turn.text);
      out.push({ ...turn, text: r.text });
      if (r.applied) { applied = true; redactedTurns.push(i); }
      if (armed > 0) armed--;
      return;
    }

    if (armed > 0 && !isAssistant) armed--;             // the caller said something that was not a code
    out.push(turn);
  });

  return { turns: out, applied, redactedTurns };
}

// ══ LAYER 1: the DTMF path ═══════════════════════════════════════════════════════════════════════════════

export interface DtmfGatherOptions {
  /** Where Twilio POSTs the digits. MUST be https and MUST be ours. */
  actionUrl: string;
  /** What the receptionist says before the keypad prompt. NEVER contains the code — we do not have it. */
  prompt?: string;
  numDigits?: number;
  timeoutSeconds?: number;
  language?: string;
}

/**
 * TwiML for collecting the code on the KEYPAD.
 *
 * `input="dtmf"` only — speech is NOT accepted, deliberately. Allowing `dtmf speech` would let a caller answer
 * by voice and put the code straight back into the audio, which is the whole thing we are avoiding. If the caller
 * cannot use a keypad, the honest fallback is to send them to the SMS/web verification page, not to take the code
 * by voice and hope the redactor holds.
 *
 * Note also what is NOT in this TwiML: the code. We never possess it (Twilio Verify holds it), so we cannot
 * accidentally read it back to the caller, log it, or put it in a prompt.
 */
export function dtmfGather(o: DtmfGatherOptions): string {
  const digits = o.numDigits ?? 6;
  const timeout = o.timeoutSeconds ?? 20;
  const lang = o.language ?? 'en-US';
  const prompt = o.prompt ?? `Please enter the ${digits} digit verification code we just sent you, using your keypad.`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Response>',
    `  <Gather input="dtmf" numDigits="${digits}" timeout="${timeout}" action="${escapeXml(o.actionUrl)}" method="POST" finishOnKey="">`,
    `    <Say language="${escapeXml(lang)}">${escapeXml(prompt)}</Say>`,
    '  </Gather>',
    '  <Say>We did not receive your code. Goodbye.</Say>',
    '</Response>',
  ].join('\n');
}

function escapeXml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * Digits that arrived by DTMF must NEVER be echoed into a log line, a prompt, a transcript, or an audit record.
 * They are the secret itself. This exists so a caller can log THAT a code was entered without logging WHAT it was.
 */
export function safeDtmfLog(digits: string): string {
  const n = String(digits ?? '').replace(/\D/g, '').length;
  return n ? `[${n} digits entered]` : '[no digits]';
}
