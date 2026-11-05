import { describe, it, expect } from 'vitest';
import { validateTemplateInput, canPublish, nextVersion } from './campaign-template-core';

describe('campaign-template engine', () => {
  it('requires a name, valid channel, and some content', () => {
    const e = validateTemplateInput({ name: '', channel: 'fax' });
    expect(e.errors).toContain('A template name is required.');
    expect(e.errors.some((x) => x.includes('Channel must be'))).toBe(true);
    expect(e.errors.some((x) => x.includes('Provide some content'))).toBe(true);
  });

  it('accepts an email template with subject/body', () => {
    expect(validateTemplateInput({ name: 'Mother\'s Day', channel: 'email', subject: 'Treat Mom', body: 'Book now' }).errors).toHaveLength(0);
  });

  it('accepts an sms template with sms content only', () => {
    expect(validateTemplateInput({ name: 'Flash', channel: 'sms', smsContent: 'Today only!' }).errors).toHaveLength(0);
  });

  it('gates publishing and bumps versions monotonically', () => {
    expect(canPublish('draft')).toBe(true);
    expect(canPublish('archived')).toBe(false);
    expect(nextVersion(1)).toBe(2);
    expect(nextVersion(0)).toBe(2);
  });
});
