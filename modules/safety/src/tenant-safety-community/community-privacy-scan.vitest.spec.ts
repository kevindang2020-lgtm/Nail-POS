// community-privacy-scan.vitest.spec — BUILD_PLAN Phase 8 (agent A): names, social handles and dates of birth are
// redacted + flagged (`name` / `dob`) like phones and emails; card / SSN / bank / gov-id stay BLOCKED; ordinary words
// ("customer called", "confirmation scam", an incident date) are left alone.
import { describe, it, expect } from 'vitest';
import { scanCommunityText, scanDisposition } from './community-privacy-scan';

const red = (t: string) => scanCommunityText(t).redactedText;
const cats = (t: string) => [...scanCommunityText(t).categories].sort();

describe('names + handles', () => {
  it.each([
    ['customer Jane Smith wanted a refund', 'customer [REDACTED_NAME] wanted a refund'],
    ['the client Maria asked twice', 'the client [REDACTED_NAME] asked twice'],
    ['Mr. Lee called twice', '[REDACTED_NAME] called twice'],
    ['Mrs Jane Doe paid in cash', '[REDACTED_NAME] paid in cash'],
    ['her name is jane and she paid', 'her name is [REDACTED_NAME] and she paid'],
    ['a client named Bob Ross booked', 'a client named [REDACTED_NAME] booked'],
    ['contact @nailqueen99 on insta', 'contact [REDACTED_HANDLE] on insta'],
  ])('%s', (input, out) => {
    expect(red(input)).toBe(out);
    expect(cats(input)).toEqual(['name']);
    expect(scanDisposition(scanCommunityText(input))).toBe('needs_review');
  });
  it('leaves ordinary words alone', () => {
    for (const t of ['The customer Then left', 'the customer called the desk', 'customer service was slow', 'Gift card confirmation scam', 'confirm a booking today', 'Incident on 10/02/2026'])
      expect(scanCommunityText(t)).toMatchObject({ redactedText: t, flagged: false });
  });
});

describe('dates of birth', () => {
  it.each([
    ['DOB 01/02/1990 given', 'DOB [REDACTED_DOB] given'],
    ['date of birth: 1990-02-01', 'date of birth [REDACTED_DOB]'],
    ['born on March 3, 1985', 'born on [REDACTED_DOB]'],
    ['birthday 3 Mar 1985 ok', 'birthday [REDACTED_DOB] ok'],
  ])('%s', (input, out) => {
    expect(red(input)).toBe(out);
    expect(cats(input)).toEqual(['dob']);
  });
});

describe('payment / ID data stays blocked; codes need a digit', () => {
  it('card + SSN block', () => {
    expect(scanCommunityText('card 4111 1111 1111 1111').blocked).toBe(true);
    expect(scanCommunityText('ssn 123-45-6789').blocked).toBe(true);
  });
  it('appointment codes', () => {
    expect(red('booking #K3J9Q2 was cancelled')).toBe('booking [REDACTED_CODE] was cancelled');
    expect(red('appointment 55821 moved')).toBe('appointment [REDACTED_CODE] moved');
  });
  it('several kinds at once', () => {
    expect(cats('customer Jane Smith, DOB 01/02/1990, 201-555-0148, jane@x.com')).toEqual(['dob', 'email', 'name', 'phone']);
  });
});

describe('credential detection (Phase 8 browser-proof false positive)', () => {
  it('redacts a credential after a separator or a token with a digit, not an ordinary word', async () => {
    const { scanCommunityText } = await import('./community-privacy-scan');
    expect(scanCommunityText('asked to read back the login code sent to the owner').redactedText).toBe('asked to read back the login code sent to the owner');
    expect(scanCommunityText('the password: hunter22 was given').redactedText).not.toContain('hunter22');
    expect(scanCommunityText('pin=4821 please').redactedText).not.toContain('4821');
    expect(scanCommunityText('gave the login 993112 over the phone').redactedText).not.toContain('993112');
    expect(scanCommunityText('the otp 552910 arrived').redactedText).not.toContain('552910');
  });
});
