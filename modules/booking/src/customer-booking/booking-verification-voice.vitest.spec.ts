// booking-verification-voice.vitest.spec.ts
//
// The five cases below are the ones I PROBED against the platform's existing redactor before writing this. Four
// of the five leaked:
//
//   "My verification code is 123456"   → REDACTED
//   "123456"                            → LEAKED
//   "one two three four five six"       → LEAKED
//   "it's 1 2 3 4 5 6"                  → LEAKED
//   "four eight two nine one seven"     → LEAKED
//
// They leaked because a real exchange splits the keyword from the value across two turns — the assistant asks,
// the caller answers — and the existing redactor works on one segment at a time, so it can never see both. This
// spec exists to make sure they stay closed.
import { describe, it, expect } from 'vitest';
import {
  redactVerificationTurns, redactSpokenDigits, looksLikeSpokenCode, dtmfGather, safeDtmfLog, OTP_PLACEHOLDER,
  type VoiceTurn,
} from './booking-verification-voice';

const ask: VoiceTurn = { speaker: 'assistant', text: 'Please say your six-digit verification code.' };
const noCode = (t: string): boolean => !/\d/.test(t) && !/\b(one|two|three|four|five|six|seven|eight|nine|zero|oh)\b/i.test(t);

describe('the four cases that used to leak', () => {
  const leaked = [
    '123456',
    'one two three four five six',
    "it's 1 2 3 4 5 6",
    'four eight two nine one seven',
  ];

  for (const text of leaked) {
    it(`is scrubbed when the assistant just asked for a code: ${JSON.stringify(text)}`, () => {
      const r = redactVerificationTurns([ask, { speaker: 'caller', text }]);
      expect(r.applied).toBe(true);
      expect(r.turns[1].text).toContain(OTP_PLACEHOLDER);
      // The secret must not survive in ANY form.
      expect(noCode(r.turns[1].text), r.turns[1].text).toBe(true);
    });
  }

  it('the ASSISTANT\u2019s question is NOT scrubbed — it is not a secret', () => {
    const r = redactVerificationTurns([ask, { speaker: 'caller', text: '123456' }]);
    expect(r.turns[0].text).toBe(ask.text);
  });
});

describe('a mis-heard code is still a leak', () => {
  it('scrubs a FIVE-digit run — five sixths of a secret is not safe', () => {
    // ASR drops digits constantly. A redactor that only fires on exactly six sails straight past a mis-heard
    // code that still reveals most of it.
    const r = redactVerificationTurns([ask, { speaker: 'caller', text: 'one two three four five' }]);
    expect(r.applied).toBe(true);
    expect(noCode(r.turns[1].text)).toBe(true);
  });

  it('handles the ways people actually say zero', () => {
    for (const text of ['oh four two nine one seven', 'zero four two nine one seven', 'nought four two nine one seven']) {
      const r = redactVerificationTurns([ask, { speaker: 'caller', text }]);
      expect(r.applied, text).toBe(true);
    }
  });

  it('handles ASR homophones (to/too, for/fore, ate, won, niner)', () => {
    const r = redactVerificationTurns([ask, { speaker: 'caller', text: 'won too for ate niner three' }]);
    expect(r.applied).toBe(true);
    expect(noCode(r.turns[1].text)).toBe(true);
  });
});

describe('it stays armed just long enough for a correction', () => {
  it('scrubs a corrected code on the second attempt', () => {
    const r = redactVerificationTurns([
      ask,
      { speaker: 'caller', text: 'sorry, hang on' },
      { speaker: 'caller', text: 'four eight two nine one seven' },
    ]);
    expect(r.applied).toBe(true);
    expect(noCode(r.turns[2].text)).toBe(true);
  });

  it('does NOT keep scrubbing the rest of the call', () => {
    // Over-scrubbing costs the salon the numbers it actually needs — an appointment time, a price, a phone
    // number. The arming window is deliberately short.
    const r = redactVerificationTurns([
      ask,
      { speaker: 'caller', text: 'one two three four five six' },
      { speaker: 'assistant', text: 'Thank you. You are booked.' },
      { speaker: 'caller', text: 'my number is 5551234567' },
    ]);
    expect(r.turns[3].text).toContain('5551234567');   // a phone number survives, as it must
  });
});

describe('a self-anchored code is scrubbed even with no prompt before it', () => {
  it('scrubs "my code is ..." on its own', () => {
    const r = redactVerificationTurns([{ speaker: 'caller', text: 'my code is nine eight seven six five four' }]);
    expect(r.applied).toBe(true);
    expect(noCode(r.turns[0].text)).toBe(true);
  });
});

describe('ordinary numbers are not destroyed', () => {
  it('leaves a normal conversation alone', () => {
    const turns: VoiceTurn[] = [
      { speaker: 'assistant', text: 'What time works for you?' },
      { speaker: 'caller', text: 'Two o clock on Friday please' },
      { speaker: 'assistant', text: 'That will be 45 dollars.' },
    ];
    const r = redactVerificationTurns(turns);
    expect(r.applied).toBe(false);
    expect(r.turns.map((t) => t.text)).toEqual(turns.map((t) => t.text));
  });

  it('a bare year or price is untouched without a code prompt', () => {
    const r = redactVerificationTurns([{ speaker: 'caller', text: 'It cost 45 dollars in 2024' }]);
    expect(r.applied).toBe(false);
  });
});

describe('redactSpokenDigits', () => {
  it('scrubs digit runs but keeps the words around them', () => {
    const r = redactSpokenDigits('the code is one two three four five six thanks');
    expect(r.applied).toBe(true);
    expect(r.text).toContain('the code is');
    expect(r.text).toContain('thanks');
    expect(r.text).toContain(OTP_PLACEHOLDER);
  });
});

describe('looksLikeSpokenCode', () => {
  it('is broad on purpose', () => {
    expect(looksLikeSpokenCode('123456')).toBe(true);
    expect(looksLikeSpokenCode('one two three four')).toBe(true);
    expect(looksLikeSpokenCode('1 2 3 4 5 6')).toBe(true);
    expect(looksLikeSpokenCode('hello there')).toBe(false);
    expect(looksLikeSpokenCode('two o clock')).toBe(false);        // not a run
  });
});

// ══ Layer 1 — the path that actually solves this ═══════════════════════════════════════════════════════════
describe('DTMF is the real answer, not redaction', () => {
  it('accepts KEYPAD input only — never speech', () => {
    const twiml = dtmfGather({ actionUrl: 'https://api.example.com/voice/verify' });
    expect(twiml).toContain('input="dtmf"');
    // Allowing `dtmf speech` would let the caller answer by voice and put the code straight back into the audio
    // — which is the entire thing we are avoiding. Redaction is best-effort; not transcribing it is not.
    expect(twiml).not.toContain('speech');
  });

  it('asks for six digits and posts them to OUR url', () => {
    const twiml = dtmfGather({ actionUrl: 'https://api.example.com/voice/verify' });
    expect(twiml).toContain('numDigits="6"');
    expect(twiml).toContain('action="https://api.example.com/voice/verify"');
  });

  it('never contains a code — we do not have one to leak', () => {
    // Twilio Verify holds the code. We cannot read it back to the caller, log it, or put it in a prompt, because
    // we never possessed it.
    const twiml = dtmfGather({ actionUrl: 'https://x/y' });
    expect(twiml).not.toMatch(/\b\d{4,8}\b/);
  });

  it('escapes the prompt and the url', () => {
    const twiml = dtmfGather({ actionUrl: 'https://x/y?a=1&b=2', prompt: 'Enter <code> & wait' });
    expect(twiml).toContain('&amp;');
    expect(twiml).not.toContain('<code>');
  });
});

describe('safeDtmfLog', () => {
  it('records THAT a code was entered, never WHAT it was', () => {
    // The digits that arrive by DTMF are the secret itself. This is how you log the event without logging it.
    expect(safeDtmfLog('123456')).toBe('[6 digits entered]');
    expect(safeDtmfLog('123456')).not.toContain('123456');
    expect(safeDtmfLog('')).toBe('[no digits]');
  });
});
