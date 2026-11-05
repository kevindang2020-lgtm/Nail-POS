// adapters.test — the two provider adapters speak their provider's wire format and fail loudly (Constitution 12:
// a failed send is never recorded as sent).
import { describe, it, expect } from 'vitest';
import { TwilioSmsSender, MockSmsSender, SendGridEmailSender, MockEmailSender } from './index';

describe('@aipowersalon/notifications', () => {
  it('Twilio: a Messaging Service SID as the sender goes out as MessagingServiceSid, never From (wave 3 PAYI §60)', async () => {
    let seen: any; const http = async (_u: string, init: any) => { seen = { init }; return new Response(JSON.stringify({ sid: 'SM2' }), { status: 201 }); };
    await new TwilioSmsSender({ accountSid: 'AC1', authToken: 't', from: '+15550000000' }, http as any).send('+15551112222', 'hi', 'MG0123456789abcdef0123456789abcdef');
    expect(String(seen.init.body)).toContain('MessagingServiceSid=MG0123456789abcdef0123456789abcdef');
    expect(String(seen.init.body)).not.toContain('From=');
    const cfg = new TwilioSmsSender({ accountSid: 'AC1', authToken: 't', from: 'MGfedcba9876543210fedcba9876543210' }, http as any);
    await cfg.send('+15551112222', 'hi');
    expect(String(seen.init.body)).toContain('MessagingServiceSid=MGfedcba9876543210fedcba9876543210');
  });
  it('Twilio: form-encoded POST to the account Messages endpoint, per-tenant From honoured, sid returned', async () => {
    let seen: any;
    const http: any = async (url: string, init: any) => { seen = { url, init }; return { ok: true, json: async () => ({ sid: 'SM1' }) }; };
    const r = await new TwilioSmsSender({ accountSid: 'AC1', authToken: 't', from: '+15550000000' }, http).send('+15551112222', 'hi', '+15553334444');
    expect(r.sid).toBe('SM1');
    expect(seen.url).toContain('/Accounts/AC1/Messages.json');
    expect(String(seen.init.body)).toContain('From=%2B15553334444');
  });
  it('Twilio: a provider error THROWS (never a fake success)', async () => {
    const http: any = async () => ({ ok: false, status: 400, json: async () => ({ message: 'bad number' }) });
    await expect(new TwilioSmsSender({ accountSid: 'AC1', authToken: 't', from: '+1' }, http).send('x', 'y')).rejects.toThrow(/sms_failed:bad number/);
  });
  it('SendGrid: a non-2xx THROWS', async () => {
    const http: any = async () => ({ ok: false, status: 401, headers: { get: () => null } });
    await expect(new SendGridEmailSender({ apiKey: 'k', from: 'a@b' }, http).send('c@d', 's', 'b')).rejects.toThrow(/email_failed:401/);
  });
  it('mocks record what was sent', async () => {
    const s = new MockSmsSender(); await s.send('+1', 'x'); expect(s.sent).toHaveLength(1);
    const e = new MockEmailSender(); await e.send('a@b', 's', 'b'); expect(e.sent[0].subject).toBe('s');
  });
});
