import { describe, it, expect } from 'vitest';
import { feedbackForSend } from './notificationsMessages';

describe('feedbackForSend', () => {
  it('success when sent', () => {
    expect(feedbackForSend({ sent: true, status: 'sent' }).tone).toBe('success');
  });
  it('warns on over_limit with a credits message', () => {
    const f = feedbackForSend({ sent: false, status: 'blocked', reason: 'over_limit' });
    expect(f.tone).toBe('warning');
    expect(f.message.toLowerCase()).toContain('credit');
  });
  it('warns on opted_out', () => {
    const f = feedbackForSend({ sent: false, status: 'blocked', reason: 'opted_out' });
    expect(f.tone).toBe('warning');
    expect(f.message.toLowerCase()).toContain('opted out');
  });
  it('errors on failed', () => {
    expect(feedbackForSend({ sent: false, status: 'failed', reason: 'sms_failed:21610' }).tone).toBe('error');
  });
  it('errors on null', () => {
    expect(feedbackForSend(null).tone).toBe('error');
  });
});
