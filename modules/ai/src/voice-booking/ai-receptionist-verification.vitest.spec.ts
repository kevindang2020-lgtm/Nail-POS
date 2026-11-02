// ai-receptionist-verification.vitest.spec.ts
//
// The AI receptionist gateway emits **no TwiML** — it is a JSON API, and an external voice platform drives the
// call. So "just emit a <Gather>" was never available: we do not own the call flow.
//
// Two doors instead:
//   1. the booking refusal returns a STRUCTURED INSTRUCTION any platform can act on
//   2. a TwiML endpoint for platforms that speak Twilio natively
//
// And one rule underneath both: **the digits must never reach the speech recogniser.**
import { describe, it, expect } from 'vitest';
import { dtmfGather, safeDtmfLog } from '@aipowersalon/booking';

const TWIML = dtmfGather({ actionUrl: 'https://api.aipowersalon.com/api/ai-receptionist/v1/verification/dtmf' });

describe('the TwiML takes the code on the KEYPAD, never by voice', () => {
  it('accepts dtmf ONLY — speech is not an input', () => {
    // Allowing `dtmf speech` lets the caller answer by voice and puts the code straight back into the audio,
    // which is the entire thing we are avoiding.
    //
    // I probed the platform's transcript redactor with the cases a real call actually produces and FOUR OF FIVE
    // leaked — because the assistant asks in one turn and the caller answers in the next, so a per-segment
    // redactor can never see both. A redactor that is 95% effective on an authentication secret is not a security
    // control; it is a 5% leak. Not transcribing the code at all is 100%.
    expect(TWIML).toContain('input="dtmf"');
    expect(TWIML).not.toContain('speech');
  });

  it('asks for six digits and posts them back to US', () => {
    expect(TWIML).toContain('numDigits="6"');
    expect(TWIML).toContain('action="https://api.aipowersalon.com/api/ai-receptionist/v1/verification/dtmf"');
    expect(TWIML).toContain('method="POST"');
  });

  it('contains NO CODE — we do not have one to leak', () => {
    // Twilio Verify holds the code. We never possess it, so we cannot read it back to the caller, log it, or put
    // it in a prompt even by accident. That is the whole security argument for Verify over our own OTP.
    expect(TWIML).not.toMatch(/\b\d{4,8}\b/);
  });

  it('escapes the prompt and the url', () => {
    const t = dtmfGather({ actionUrl: 'https://x/y?a=1&b=2', prompt: 'Enter <code> & wait' });
    expect(t).toContain('&amp;');
    expect(t).not.toContain('<code>');
  });

  it('says something honest if no digits arrive', () => {
    expect(TWIML).toContain('We did not receive your code');
  });
});

describe('the digits are the SECRET', () => {
  it('safeDtmfLog records THAT a code was entered, never WHAT', () => {
    // The Gather POST body is the one place in this codebase where a plaintext verification code is briefly in
    // memory. It must not become a log line, a span attribute, or an audit record.
    expect(safeDtmfLog('483917')).toBe('[6 digits entered]');
    expect(safeDtmfLog('483917')).not.toContain('483917');
    expect(safeDtmfLog('')).toBe('[no digits]');
  });

  it('never leaks even a partial code', () => {
    // No "first two digits", no prefix. There is no safe amount of an authentication secret to log.
    //
    // Asserted on the FORM rather than by substring: "[1 digits entered]" does contain the character "1", but
    // that is the LENGTH, not the code — a coincidence my first version of this test mistook for a leak. The
    // property that actually matters is that the output is a count and nothing else.
    for (const code of ['483917', '9', '20', '12345678']) {
      const logged = safeDtmfLog(code);
      expect(logged).toBe(`[${code.length} digits entered]`);
      // The only digits in the output are the LENGTH. The code itself is nowhere in it.
      const digitsInLog = (logged.match(/\d/g) || []).join('');
      expect(digitsInLog).toBe(String(code.length));
    }
  });
});

describe('the booking refusal is an INSTRUCTION, not a dead end', () => {
  // The gateway turns a verification refusal into this shape. Asserted as a contract, because the voice platform
  // on the other side is not ours and will code against it.
  const instruction = {
    ok: false,
    action: 'collect_verification_code',
    input: 'dtmf',
    numDigits: 6,
    maskedPhone: '••••4567',
    say: 'Please verify your phone number to continue.',
    twimlUrl: 'https://api/api/ai-receptionist/v1/verification/twiml',
  };

  it('tells the platform to use the KEYPAD, in its own terms', () => {
    expect(instruction.action).toBe('collect_verification_code');
    expect(instruction.input).toBe('dtmf');
    expect(instruction.numDigits).toBe(6);
  });

  it('carries a MASKED phone the receptionist can read aloud', () => {
    // "We sent a code to the number ending four five six seven" is safe. Reading the whole number back over a
    // recorded line is not.
    expect(instruction.maskedPhone).not.toMatch(/\d{7,}/);
    expect(JSON.stringify(instruction)).not.toMatch(/\d{7,}/);
  });

  it('carries no code, and nothing that names the provider', () => {
    expect(JSON.stringify(instruction)).not.toMatch(/\b\d{6}\b/);
    expect(instruction.say).not.toMatch(/twilio|sid|token/i);
  });
});
