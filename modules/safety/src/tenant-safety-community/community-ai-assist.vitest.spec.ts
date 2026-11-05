// community-ai-assist.vitest.spec.ts — proves the AI guardrails hold even when the MODEL misbehaves. The model
// is stubbed to return adversarial output (echoing a card number, accusing someone, inventing facts) and each
// time the suggestion must be WITHHELD rather than shown. Also proves AI never publishes and never decides.
import { describe, it, expect } from 'vitest';
import { suggestSanitizedDraft, moderationSignals, introducesNewClaims, type AiBackend } from './community-ai-assist';

const model = (text: string): AiBackend => ({ async complete() { return { text }; } });
const brokenModel: AiBackend = { async complete() { throw new Error('provider down'); } };

describe('AI writing assistance — guardrails', () => {
  it('returns a sanitized suggestion that still requires human approval', async () => {
    const r = await suggestSanitizedDraft(model('A caller requested gift cards to release a booking. Pattern requiring caution.'),
      'THIS GUY CALLED AND DEMANDED GIFT CARDS!! so angry');
    expect(r.ok).toBe(true);
    expect(r.sanitizedBody).toContain('gift cards');
    expect(r.requiresHumanApproval).toBe(true);   // ALWAYS — never auto-publishes
  });

  it('WITHHOLDS the suggestion if the model echoes payment data back', async () => {
    // adversarial model: leaks a card number into its "sanitized" rewrite
    const r = await suggestSanitizedDraft(model('The caller used card 4111 1111 1111 1111 to book.'), 'a caller booked and disputed');
    expect(r.ok).toBe(false);
    expect(r.sanitizedBody).toBeNull();           // never shown to the user
    expect(r.withheldReason).toBe('ai_output_contained_payment_data');
  });

  it('WITHHOLDS the suggestion if the model accuses someone', async () => {
    const r = await suggestSanitizedDraft(model('This customer is a scammer and a thief.'), 'a caller asked for a refund after service');
    expect(r.ok).toBe(false);
    expect(r.withheldReason).toBe('ai_output_accusatory');
  });

  it('WITHHOLDS the suggestion if the model invents facts not in the original', async () => {
    const r = await suggestSanitizedDraft(
      model('The perpetrator operated a nationwide syndicate targeting seventeen salons across three states using forged identification documents and laundered proceeds through cryptocurrency exchanges.'),
      'someone called asking for a gift card');
    expect(r.ok).toBe(false);
    expect(r.withheldReason).toBe('unverifiable_additions');
  });

  it('degrades honestly when the model is unavailable — no fabricated suggestion', async () => {
    const r = await suggestSanitizedDraft(brokenModel, 'a caller asked for gift cards');
    expect(r.ok).toBe(false);
    expect(r.sanitizedBody).toBeNull();
    expect(r.withheldReason).toBe('ai_unavailable');
  });

  it('the model never sees raw customer PII — only the redacted text', async () => {
    let sawPrompt = '';
    const spy: AiBackend = { async complete(req) { sawPrompt = req.prompt; return { text: 'A caller requested gift cards.' }; } };
    await suggestSanitizedDraft(spy, 'caller was 201-555-0148 and emailed jane@x.com demanding gift cards');
    expect(sawPrompt).not.toContain('201-555-0148');
    expect(sawPrompt).not.toContain('jane@x.com');
    expect(sawPrompt).toContain('[REDACTED_PHONE]');
  });

  it('still surfaces the original scan warnings to the human', async () => {
    const r = await suggestSanitizedDraft(model('A caller requested gift cards.'), 'caller 201-555-0148 wanted gift cards');
    expect(r.redactions).toContain('phone');
    expect(r.warnings.join(' ')).toContain('redacted');
  });
});

describe('new-claim detection', () => {
  it('allows condensing and neutral rephrasing', () => {
    expect(introducesNewClaims('the caller angrily demanded gift cards to release the booking', 'A caller requested gift cards to release a booking.')).toBe(false);
  });
  it('flags heavy invention', () => {
    expect(introducesNewClaims('someone called asking for a gift card',
      'The perpetrator operated a nationwide syndicate targeting seventeen salons using forged identification documents and cryptocurrency laundering schemes.')).toBe(true);
  });
});

describe('AI moderation assistance — advisory only', () => {
  it('NEVER returns a decision', () => {
    expect(moderationSignals('anything at all').decision).toBeNull();
  });
  it('flags payment data, PII and accusatory language deterministically', () => {
    const s = moderationSignals('this scammer used card 4111 1111 1111 1111 and called from 201-555-0148');
    expect(s.paymentDataDetected).toBe(true);
    expect(s.personalInfoDetected).toContain('phone');
    expect(s.accusatoryLanguage).toBe('scammer');
    expect(s.advisory.join(' ')).toContain('cannot be published');
  });
  it('a clean post yields no false alarms', () => {
    const s = moderationSignals('A caller requested gift cards to release a booking. Pattern requiring caution.');
    expect(s.paymentDataDetected).toBe(false);
    expect(s.accusatoryLanguage).toBeNull();
    expect(s.advisory[0]).toContain('No automated safety signals');
  });
});
