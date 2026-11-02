// alert-notifier.pgtest — Constitution 11 §262–266: platform alerts reach a human, exactly once, against the real schema.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { AlertNotifier, pageText, REMINDER_AFTER_MS, MAX_FAILURES } from './alert-notifier';
import { setLogSink, type LogRecord } from '@aipowersalon/observability';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

let pg: any; let db: any;
beforeAll(async () => { pg = await migratedPglite(); db = kyselyFor(pg); });
beforeEach(async () => {
  await pg.exec(`DELETE FROM alerts WHERE tenant_id IS NULL; DELETE FROM users WHERE email LIKE '%@notify.test';`);
  await pg.exec(`INSERT INTO users (id, tenant_id, full_name, email, password_hash, status, role) VALUES
    (gen_random_uuid(), NULL, 'Kevin', 'kevin@notify.test', 'x', 'active', 'SUPER_ADMIN'),
    (gen_random_uuid(), NULL, 'Former', 'former@notify.test', 'x', 'inactive', 'SUPER_ADMIN')`);
});
const NOW = new Date('2026-09-21T03:00:00Z');
async function alert(severity: string, over: Record<string, string> = {}) {
  const cols = { status: 'unread', ...over };
  return (await pg.query(`INSERT INTO alerts (tenant_id, tenant_name, title, message, type, severity, status, related_module, related_record_id, dedupe_key)
    VALUES (NULL, 'Platform', 'Database is down', 'probe_failed. Runbook: RUNBOOKS.md#database-outage', 'system', $1, $2, 'system_health', 'database', $3) RETURNING id`,
    [severity, cols.status, 'n-' + Math.random()])).rows[0].id;
}
function notifier(opts: { email?: boolean; sms?: boolean; phone?: string; failEmail?: boolean } = {}) {
  const sent: Array<{ ch: string; to: string; text: string }> = [];
  const n = new AlertNotifier(db);
  n.email = opts.email === false ? null : { send: async (to, subject) => { if (opts.failEmail) throw new Error('sendgrid down'); sent.push({ ch: 'email', to, text: subject }); return { id: 'e' }; } };
  n.sms = opts.sms === false ? null : { send: async (to, body) => { sent.push({ ch: 'sms', to, text: body }); return { sid: 's' }; } };
  n.env = { ONCALL_PHONE: opts.phone ?? '+18565550142' };
  return { n, sent };
}

describe('§263 who gets paged, and for what', () => {
  it('a P1 emails every ACTIVE Super Admin and texts the on-call phone', async () => {
    await alert('critical'); const { n, sent } = notifier();
    expect((await n.dispatch(NOW)).paged).toBe(1);
    expect(sent.filter((s) => s.ch === 'email').map((s) => s.to)).toEqual(['kevin@notify.test']);     // not the inactive one
    expect(sent.find((s) => s.ch === 'sms')).toMatchObject({ to: '+18565550142', text: '[SEV1] Database is down' });
  });
  it('a P2 emails but does NOT text — SMS is for SEV1 only', async () => {
    await alert('high'); const { n, sent } = notifier();
    await n.dispatch(NOW);
    expect(sent.map((s) => s.ch)).toEqual(['email']);
  });
  it('§103 P3 and P4 page nobody — the screen only', async () => {
    await alert('medium'); await alert('low'); const { n, sent } = notifier();
    expect((await n.dispatch(NOW)).paged).toBe(0); expect(sent).toEqual([]);
  });
  it('a TENANT alert is never paged to the platform', async () => {
    const T = 'b8b8b8b8-0000-4000-8000-000000000001';
    await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'N LLC', 'N', 'n-t', 'NTEN1', 'active') ON CONFLICT DO NOTHING`);
    await pg.exec(`INSERT INTO alerts (tenant_id, tenant_name, title, message, type, severity, status, related_module, related_record_id, dedupe_key) VALUES ('${T}', 'N', 'x', 'm', 'tenant', 'critical', 'unread', 'system_health', 'x', 'tenant-page')`);
    const { n, sent } = notifier(); await n.dispatch(NOW);
    expect(sent).toEqual([]);
  });
});

describe('exactly once', () => {
  it('ten dispatches page once', async () => {
    await alert('critical'); const { n, sent } = notifier();
    for (let i = 0; i < 10; i++) await n.dispatch(NOW);
    expect(sent.filter((s) => s.ch === 'sms')).toHaveLength(1);
  });
  it('TWO instances dispatching concurrently page once — the claim decides', async () => {
    await alert('critical'); const a = notifier(); const b = notifier();
    await Promise.all([a.n.dispatch(NOW), b.n.dispatch(NOW)]);
    expect([...a.sent, ...b.sent].filter((s) => s.ch === 'sms')).toHaveLength(1);
  });
  it('escalation from P2 to P1 pages AGAIN (now with SMS) — but P1 back to P2 never re-pages', async () => {
    const id = await alert('high'); const { n, sent } = notifier();
    await n.dispatch(NOW);
    await pg.exec(`UPDATE alerts SET severity = 'critical' WHERE id = '${id}'`);
    await n.dispatch(NOW);
    expect(sent.filter((s) => s.ch === 'sms')).toHaveLength(1);
    await pg.exec(`UPDATE alerts SET severity = 'high' WHERE id = '${id}'`);
    const before = sent.length; await n.dispatch(NOW);
    expect(sent.length).toBe(before);
  });
});

describe('§264–265 reminder and recovery', () => {
  it('an UNACKNOWLEDGED P1 gets one reminder after 15 minutes — and only one', async () => {
    await alert('critical'); const { n, sent } = notifier();
    await n.dispatch(NOW);
    await n.dispatch(new Date(NOW.getTime() + REMINDER_AFTER_MS - 1000));
    expect(sent.filter((s) => s.text.includes('STILL UNACKNOWLEDGED'))).toHaveLength(0);
    await n.dispatch(new Date(NOW.getTime() + REMINDER_AFTER_MS + 1000));
    await n.dispatch(new Date(NOW.getTime() + REMINDER_AFTER_MS * 3));
    expect(sent.filter((s) => s.ch === 'sms' && s.text.includes('STILL UNACKNOWLEDGED'))).toHaveLength(1);
  });
  it('an ACKNOWLEDGED P1 (read) gets no reminder', async () => {
    const id = await alert('critical'); const { n, sent } = notifier();
    await n.dispatch(NOW);
    await pg.exec(`UPDATE alerts SET status = 'read' WHERE id = '${id}'`);
    await n.dispatch(new Date(NOW.getTime() + REMINDER_AFTER_MS * 2));
    expect(sent.some((s) => s.text.includes('STILL UNACKNOWLEDGED'))).toBe(false);
  });
  it('a paged alert that resolves sends one "resolved" notice; an unpaged one sends none — on ANY channel', async () => {
    // The first version counted only SMS, so a bogus "resolved" EMAIL for a never-paged alert slipped past it
    // (a mutation removing the paged-only condition survived). Every channel is checked now.
    const paged = await alert('critical');
    const unpaged = await alert('medium', { status: 'resolved' });
    await pg.exec(`UPDATE alerts SET title = 'AI Features is degraded' WHERE id = '${unpaged}'`);
    const { n, sent } = notifier();
    await n.dispatch(NOW);
    await pg.exec(`UPDATE alerts SET status = 'resolved' WHERE id = '${paged}'`);
    await n.dispatch(NOW); await n.dispatch(NOW);
    expect(sent.filter((s) => s.text.includes('[RESOLVED]') && s.text.includes('Database is down') && s.ch === 'sms')).toHaveLength(1);
    expect(sent.filter((s) => s.text.includes('AI Features'))).toEqual([]);
  });
});

describe('failure is bounded and never silent', () => {
  it('a failed send releases the claim and retries next tick — at most MAX_FAILURES times', async () => {
    await alert('high'); const { n } = notifier({ failEmail: true, sms: false });
    for (let i = 0; i < MAX_FAILURES + 5; i++) await n.dispatch(NOW);
    expect((await pg.query(`SELECT notify_failures, notified_severity FROM alerts WHERE tenant_id IS NULL`)).rows[0]).toEqual({ notify_failures: MAX_FAILURES, notified_severity: null });
  });
  it('no channel configured: nothing is claimed as sent, and it says so in the log', async () => {
    await alert('critical'); const lines: LogRecord[] = []; setLogSink({ write: (r) => lines.push(r) });
    const { n } = notifier({ email: false, sms: false });
    expect((await n.dispatch(NOW)).paged).toBe(0);
    setLogSink(null);
    expect(lines.some((l) => l.msg === 'page.no_channel')).toBe(true);
  });
  it('an invalid on-call phone is not texted', async () => {
    await alert('critical'); const { n, sent } = notifier({ phone: '856-555-0142' });
    await n.dispatch(NOW);
    expect(sent.some((s) => s.ch === 'sms')).toBe(false);
  });
});

describe('page text', () => {
  it('carries SEV level, title and the runbook — nothing tenant-specific', () => {
    const t = pageText({ title: 'Payments is down', severity: 'critical', component: 'payments', message: 'outage:cardpointe. Runbook: RUNBOOKS.md#payment-processor-outage' }, 'page');
    expect(t.subject).toBe('[SEV1] AIPowerSalon: Payments is down');
    expect(t.body).toMatch(/Runbook: RUNBOOKS\.md#payment-processor-outage/);
    expect(t.sms.length).toBeLessThanOrEqual(300);
  });
});
