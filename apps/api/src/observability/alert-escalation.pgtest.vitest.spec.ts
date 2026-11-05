// alert-escalation.pgtest — BUILD_PLAN Phase 14 C (Constitution 11 §262–265): the on-call chain against the real schema
// (migration 563). Every clock here is fixed; nothing depends on today's date.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import {
  AlertEscalation, alertOwner, chainFor, inQuietHours, nextStep, signAckToken, verifyAckToken, ackKey, maskDestination, validDestination,
  ESCALATE_AFTER_MS, ACK_LINK_TTL_MS, type Contact,
} from './alert-escalation';
import { ackPage } from './oncall';

let pg: any; let db: any;
beforeAll(async () => { pg = await migratedPglite(); db = kyselyFor(pg); });
beforeEach(async () => { await pg.exec(`DELETE FROM alert_escalations; DELETE FROM oncall_contacts; DELETE FROM alerts WHERE tenant_id IS NULL;`); });

const T0 = new Date('2026-03-04T14:00:00Z');                 // 09:00 in New York
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
const SECRET = 'x'.repeat(48);
const ENV = { ALERT_ACK_SECRET: SECRET, PUBLIC_API_BASE_URL: 'https://api.example.com' };

class Outbox { sent: Array<{ to: string; subject?: string; body: string }> = []; fail = false;
  email = { send: async (to: string, subject: string, body: string) => { if (this.fail) throw new Error('down'); this.sent.push({ to, subject, body }); return { id: 'm' } as any; } } as any;
  sms = { send: async (to: string, body: string) => { if (this.fail) throw new Error('down'); this.sent.push({ to, body }); return { sid: 's' }; } } as any;
}
function esc(o: Outbox, env: Record<string, string> = ENV, wire: { email?: boolean; sms?: boolean } = {}) {
  const e = new AlertEscalation(db); e.email = wire.email === false ? null : o.email; e.sms = wire.sms === false ? null : o.sms; e.push = null; e.env = env; return e;
}
async function contact(position: number, channel: string, destination: string, extra: Record<string, unknown> = {}) {
  const r = await pg.query(`INSERT INTO oncall_contacts (position, role, name, channel, destination, owners, quiet_start, quiet_end, timezone)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [position, extra.role ?? (position === 1 ? 'primary' : position === 2 ? 'secondary' : 'incident_commander'), `C${position}`, channel, destination,
     extra.owners ?? [], extra.quietStart ?? null, extra.quietEnd ?? null, extra.timezone ?? 'America/New_York']);
  return r.rows[0].id as string;
}
async function alert(severity = 'critical', opts: { module?: string; component?: string; notified?: boolean; status?: string } = {}) {
  const r = await pg.query(`INSERT INTO alerts (tenant_id, tenant_name, title, message, type, severity, status, related_module, related_record_id, dedupe_key, notified_severity, notified_at)
    VALUES (NULL, 'Platform', 'Database is down', 'Database is down (reason: probe_failed).', 'system', $1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [severity, opts.status ?? 'unread', opts.module ?? 'system_health', opts.component ?? 'database', `t:${Math.random()}`, opts.notified === false ? null : severity, opts.notified === false ? null : T0]);
  return r.rows[0].id as string;
}
const steps = async (id: string) => (await pg.query(`SELECT step, contact_name, channel, outcome, escalated_at, acknowledged_at, acknowledged_via, ack_used_at FROM alert_escalations WHERE alert_id = $1 ORDER BY step`, [id])).rows;
const linkOf = (body: string) => decodeURIComponent(/alert-ack\?t=([^\s]+)/.exec(body)![1]);

describe('pure rules', () => {
  it('§262 owner routing: component owner, SLO component owner, security signals → security', () => {
    expect(alertOwner('system_health', 'checkout')).toBe('payments');
    expect(alertOwner('system_health', 'slo:phone_verification')).toBe('communications');
    expect(alertOwner('system_health', 'backup:staleness')).toBe('platform');
    expect(alertOwner('security_signal', 'SEC-XT-1')).toBe('security');
    expect(alertOwner('system_health', 'something_new')).toBe('platform');
  });
  it('the chain is the active contacts covering the owner, in position order (empty owners = everyone)', () => {
    const c = (id: string, position: number, owners: string[], active = true): Contact => ({ id, position, role: 'primary', name: id, channel: 'email', destination: 'a@b.co', owners, quietStart: null, quietEnd: null, timezone: 'UTC', active });
    expect(chainFor([c('ic', 3, []), c('pay', 1, ['payments']), c('sec', 2, ['security']), c('off', 0, [], false)], 'payments').map((x) => x.id)).toEqual(['pay', 'ic']);
  });
  it('quiet hours in the contact\'s own zone, including a window that crosses midnight', () => {
    const q = { quietStart: '22:00', quietEnd: '07:00', timezone: 'America/New_York' };
    expect(inQuietHours(q, new Date('2026-03-04T04:00:00Z'))).toBe(true);    // 23:00 New York
    expect(inQuietHours(q, new Date('2026-03-04T11:30:00Z'))).toBe(true);    // 06:30
    expect(inQuietHours(q, new Date('2026-03-04T12:00:00Z'))).toBe(false);   // 07:00 — end is exclusive
    expect(inQuietHours({ quietStart: '12:00', quietEnd: '13:00', timezone: 'UTC' }, new Date('2026-03-04T12:30:00Z'))).toBe(true);
    expect(inQuietHours({ quietStart: null, quietEnd: null, timezone: 'UTC' }, T0)).toBe(false);
  });
  it('nextStep: first now; wait inside the window; next after it; straight on after an undelivered step; stop when acknowledged or exhausted', () => {
    const s = (step: number, outcome: any, min: number, ack = false) => ({ step, outcome, notifiedAt: at(min), acknowledgedAt: ack ? at(min) : null });
    expect(nextStep([], 'critical', T0)).toBe(1);
    expect(nextStep([s(1, 'sent', 0)], 'critical', at(9))).toBeNull();
    expect(nextStep([s(1, 'sent', 0)], 'critical', at(ESCALATE_AFTER_MS.critical / 60_000))).toBe(2);
    expect(nextStep([s(1, 'sent', 0)], 'high', at(11))).toBeNull();          // P2 waits 30 min
    expect(nextStep([s(1, 'sent', 0)], 'high', at(30))).toBe(2);
    expect(nextStep([s(1, 'failed', 0)], 'critical', at(0))).toBe(2);
    expect(nextStep([s(1, 'skipped_quiet_hours', 0)], 'high', at(0))).toBe(2);
    expect(nextStep([s(1, 'sent', 0, true)], 'critical', at(60))).toBeNull();
    expect(nextStep([s(1, 'sent', 0), s(2, 'chain_exhausted', 10)], 'critical', at(60))).toBeNull();
    expect(nextStep([s(1, 'sent', 0)], 'medium', at(600))).toBeNull();        // only P1 / P2 escalate
  });
  it('destinations are validated and masked', () => {
    expect(validDestination('sms', '+16095551234')).toBe(true);
    expect(validDestination('sms', '6095551234')).toBe(false);
    expect(validDestination('email', 'kevin@example.com')).toBe(true);
    expect(validDestination('push', 'not-a-uuid')).toBe(false);
    expect(maskDestination('sms', '+16095551234')).toBe('+1******1234');
    expect(maskDestination('email', 'kevin@example.com')).toBe('k***@example.com');
  });
});

describe('the signed link', () => {
  const key = ackKey(ENV)!;
  it('round-trips, and refuses a tampered body, another key, a truncated signature and an expired token', () => {
    const t = signAckToken(key, 'e1', T0.getTime() + 1000, 'nonce');
    expect(verifyAckToken(key, t, T0.getTime())).toEqual({ ok: true, escalationId: 'e1', nonce: 'nonce' });
    const [body, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ e: 'e2', x: T0.getTime() + 1000, n: 'nonce' })).toString('base64url');
    expect(verifyAckToken(key, `${forged}.${sig}`, T0.getTime())).toMatchObject({ ok: false, reason: 'bad_signature' });
    expect(verifyAckToken(ackKey({ ALERT_ACK_SECRET: 'y'.repeat(48) }), t, T0.getTime())).toMatchObject({ ok: false, reason: 'bad_signature' });
    expect(verifyAckToken(key, `${body}.${sig.slice(0, 10)}`, T0.getTime())).toMatchObject({ ok: false, reason: 'bad_signature' });
    expect(verifyAckToken(key, t, T0.getTime() + 1000)).toMatchObject({ ok: false, reason: 'expired' });
    expect(verifyAckToken(key, 'garbage', T0.getTime())).toMatchObject({ ok: false, reason: 'malformed' });
  });
  it('no secret → no key → nothing is ever signed or accepted; a short secret is not a secret', () => {
    expect(ackKey({})).toBeNull();
    expect(ackKey({ ALERT_ACK_SECRET: 'short' })).toBeNull();
    expect(verifyAckToken(null, 'a.b', 0)).toMatchObject({ ok: false, reason: 'not_configured' });
  });
  it('the session secret is never used as the HMAC key directly (derived with HKDF)', () => {
    const s = 'z'.repeat(40);
    expect(ackKey({ AUTH_SESSION_SECRET: s })!.equals(Buffer.from(s))).toBe(false);
    expect(ackKey({ AUTH_SESSION_SECRET: s })!.length).toBe(32);
  });
  it('the confirmation page escapes the alert title', () => {
    expect(ackPage('confirm', { ok: true, alertTitle: '<script>x</script>' }, 't')).not.toContain('<script>x');
  });
});

describe('§264 the chain against the real schema', () => {
  it('primary at once, secondary after the P1 window, incident commander after the next — each exactly once', async () => {
    await contact(1, 'email', 'primary@example.com'); await contact(2, 'sms', '+16095550001'); await contact(3, 'email', 'ic@example.com');
    const id = await alert('critical'); const o = new Outbox(); const e = esc(o);
    await e.tick(at(0));
    expect((await steps(id)).map((s: any) => [s.step, s.outcome])).toEqual([[1, 'sent']]);
    expect(o.sent.map((m) => m.to)).toEqual(['primary@example.com']);
    await e.tick(at(5));                                                           // inside the window: nothing
    expect(o.sent).toHaveLength(1);
    await e.tick(at(10));
    expect(o.sent.map((m) => m.to)).toEqual(['primary@example.com', '+16095550001']);
    const s = await steps(id);
    expect(s[0].escalated_at).not.toBeNull();
    await e.tick(at(20));
    expect(o.sent.map((m) => m.to)).toEqual(['primary@example.com', '+16095550001', 'ic@example.com']);
    await e.tick(at(30));                                                          // past the last contact: recorded once
    await e.tick(at(40));
    expect((await steps(id)).map((x: any) => x.outcome)).toEqual(['sent', 'sent', 'sent', 'chain_exhausted']);
    expect(o.sent).toHaveLength(3);
  });

  it('acknowledged on the screen → the chain stops, the alert reads acknowledged, and outstanding links are spent', async () => {
    await contact(1, 'email', 'p@example.com'); await contact(2, 'email', 's@example.com');
    const id = await alert('critical'); const o = new Outbox(); const e = esc(o);
    await e.tick(at(0));
    expect(await e.acknowledge(id, '00000000-0000-4000-8000-000000000001', at(3))).toEqual({ acknowledged: true });
    await e.tick(at(15));
    expect(o.sent).toHaveLength(1);
    const s = await steps(id);
    expect(s[0]).toMatchObject({ acknowledged_via: 'screen' });
    expect(s[0].ack_used_at).not.toBeNull();
    expect((await pg.query(`SELECT status FROM alerts WHERE id = $1`, [id])).rows[0].status).toBe('read');
    expect(await e.acknowledgeByToken(linkOf(o.sent[0].body), at(4))).toMatchObject({ ok: false, reason: 'used_or_unknown' });
  });

  it('marking the alert read anywhere (the alerts screen) also stops it', async () => {
    await contact(1, 'email', 'p@example.com'); await contact(2, 'email', 's@example.com');
    const id = await alert('critical'); const o = new Outbox(); const e = esc(o);
    await e.tick(at(0));
    await pg.query(`UPDATE alerts SET status = 'read' WHERE id = $1`, [id]);
    await e.tick(at(30));
    expect(o.sent).toHaveLength(1);
  });

  it('the emailed link: GET-equivalent peek changes nothing; POST acknowledges once; a second click is refused', async () => {
    await contact(1, 'email', 'p@example.com'); await contact(2, 'email', 's@example.com');
    const id = await alert('critical'); const o = new Outbox(); const e = esc(o);
    await e.tick(at(0));
    expect(o.sent[0].body).toContain('https://api.example.com/api/v1/public/alert-ack?t=');
    const t = linkOf(o.sent[0].body);
    expect(await e.peekToken(t, at(1))).toMatchObject({ ok: true, alertTitle: 'Database is down' });
    expect((await steps(id))[0].acknowledged_at).toBeNull();                          // peek wrote nothing
    expect(await e.acknowledgeByToken(t, at(2))).toMatchObject({ ok: true });
    expect(await e.acknowledgeByToken(t, at(2))).toMatchObject({ ok: false, reason: 'used_or_unknown' });
    expect((await steps(id))[0]).toMatchObject({ acknowledged_via: 'email_link' });
    await e.tick(at(30));
    expect(o.sent).toHaveLength(1);
  });

  it('two clicks at once redeem the link once', async () => {
    await contact(1, 'email', 'p@example.com');
    await alert('critical'); const o = new Outbox(); const e = esc(o);
    await e.tick(at(0));
    const t = linkOf(o.sent[0].body);
    const r = await Promise.all([e.acknowledgeByToken(t, at(1)), esc(o).acknowledgeByToken(t, at(1))]);
    expect(r.filter((x) => x.ok)).toHaveLength(1);
  });

  it('an expired link is refused even though it was never used', async () => {
    await contact(1, 'email', 'p@example.com');
    const id = await alert('critical'); const o = new Outbox(); const e = esc(o);
    await e.tick(at(0));
    expect(await e.acknowledgeByToken(linkOf(o.sent[0].body), at(ACK_LINK_TTL_MS / 60_000 + 1))).toMatchObject({ ok: false, reason: 'expired' });
    expect((await pg.query(`SELECT status FROM alerts WHERE id = $1`, [id])).rows[0].status).toBe('unread');
  });

  it('a link revoked in the database (expiry moved into the past) is refused even though its signed expiry has not passed', async () => {
    await contact(1, 'email', 'p@example.com');
    const id = await alert('critical'); const o = new Outbox(); const e = esc(o);
    await e.tick(at(0));
    await pg.query(`UPDATE alert_escalations SET ack_expires_at = $1 WHERE alert_id = $2`, [at(1), id]);
    expect(await e.acknowledgeByToken(linkOf(o.sent[0].body), at(5))).toMatchObject({ ok: false, reason: 'used_or_unknown' });
    expect((await pg.query(`SELECT status FROM alerts WHERE id = $1`, [id])).rows[0].status).toBe('unread');
  });

  it('with no signing secret, no link is sent — the message says to use the screen', async () => {
    await contact(1, 'email', 'p@example.com');
    await alert('critical'); const o = new Outbox();
    await esc(o, { PUBLIC_API_BASE_URL: 'https://api.example.com' }).tick(at(0));
    expect(o.sent[0].body).not.toContain('alert-ack');
    expect(o.sent[0].body).toContain('Acknowledge it in Super Admin → On-call.');
  });

  it('a channel that is not configured is recorded as such and the next contact is tried at once', async () => {
    await contact(1, 'sms', '+16095550001'); await contact(2, 'email', 's@example.com');
    const id = await alert('critical'); const o = new Outbox();
    await esc(o, ENV, { sms: false }).tick(at(0));
    expect((await steps(id)).map((s: any) => [s.channel, s.outcome])).toEqual([['sms', 'not_configured'], ['email', 'sent']]);
  });

  it('a failed send is recorded as failed — never as sent', async () => {
    await contact(1, 'email', 'p@example.com');
    const id = await alert('critical'); const o = new Outbox(); o.fail = true;
    await esc(o).tick(at(0));
    expect((await steps(id)).map((s: any) => s.outcome)).toEqual(['failed', 'chain_exhausted']);
  });

  it('quiet hours hold back a P2 (next contact at once) but never a P1', async () => {
    await contact(1, 'email', 'night@example.com', { quietStart: '08:00', quietEnd: '10:00' });    // T0 is 09:00 New York
    await contact(2, 'email', 'day@example.com');
    const p2 = await alert('high'); const o = new Outbox();
    await esc(o).tick(at(0));
    expect((await steps(p2)).map((s: any) => s.outcome)).toEqual(['skipped_quiet_hours', 'sent']);
    expect(o.sent.map((m) => m.to)).toEqual(['day@example.com']);
    await pg.exec(`DELETE FROM alert_escalations; DELETE FROM alerts WHERE tenant_id IS NULL`); o.sent = [];
    await alert('critical');
    await esc(o).tick(at(0));
    expect(o.sent.map((m) => m.to)).toEqual(['night@example.com']);
  });

  it('§262 a contact covering only payments is not woken for a security signal', async () => {
    await contact(1, 'email', 'pay@example.com', { owners: ['payments'] }); await contact(2, 'email', 'sec@example.com', { owners: ['security'] });
    await alert('high', { module: 'security_signal', component: 'SEC-OBS-401-2026030414' }); const o = new Outbox();
    await esc(o).tick(at(0));
    expect(o.sent.map((m) => m.to)).toEqual(['sec@example.com']);
  });

  it('not yet paged, medium, resolved and tenant alerts are left alone', async () => {
    await contact(1, 'email', 'p@example.com');
    await alert('critical', { notified: false }); await alert('medium'); await alert('critical', { status: 'resolved' });
    const o = new Outbox(); await esc(o).tick(at(0));
    expect(o.sent).toHaveLength(0);
    expect((await pg.query(`SELECT count(*)::int c FROM alert_escalations`)).rows[0].c).toBe(0);
  });

  it('two instances ticking together send each step once', async () => {
    await contact(1, 'email', 'p@example.com'); await contact(2, 'email', 's@example.com');
    await alert('critical'); const o = new Outbox();
    await Promise.all([esc(o).tick(at(0)), esc(o).tick(at(0)), esc(o).tick(at(0))]);
    expect(o.sent.map((m) => m.to)).toEqual(['p@example.com']);
  });

  it('the board reports created → acknowledged → resolved (§265)', async () => {
    await contact(1, 'email', 'p@example.com');
    const id = await alert('critical'); const o = new Outbox(); const e = esc(o);
    await e.tick(at(0)); await e.acknowledge(id, null, at(2));
    const b = await e.board(at(3));
    const row = b.alerts.find((a: any) => a.id === id)!;
    expect(row).toMatchObject({ owner: 'platform', acknowledgedVia: 'screen' });
    expect(row.acknowledgedAt).toBe(at(2).toISOString());
    expect(row.steps).toEqual([expect.objectContaining({ step: 1, outcome: 'sent', channel: 'email' })]);
  });
});
