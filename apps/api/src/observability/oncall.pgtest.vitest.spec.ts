// oncall.pgtest — BUILD_PLAN Phase 14 C: the Super Admin On-call surface and the public acknowledgement link.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OnCallService, AlertAckPublicController } from './oncall';
import { AlertEscalation } from './alert-escalation';

let pg: any; let db: any;
beforeAll(async () => { pg = await migratedPglite(); db = kyselyFor(pg); });
beforeEach(async () => { await pg.exec(`DELETE FROM alert_escalations; DELETE FROM oncall_contacts; DELETE FROM synthetic_monitoring_settings; DELETE FROM alerts WHERE tenant_id IS NULL;`); });

const audit = () => { const entries: any[] = []; return { entries, recordPlatform: async (e: any) => { entries.push(e); } }; };
const actor = { userId: '00000000-0000-4000-8000-0000000000aa' };
const base = { position: 1, role: 'primary', name: 'Kevin', channel: 'sms', destination: '+16095551234', reason: 'on call this week' };

describe('contacts', () => {
  it('adds, edits and removes — each audited with a masked destination and the reason', async () => {
    const a = audit(); const s = new OnCallService(db, undefined, undefined, a as any);
    const r = await s.upsert(null, { ...base, owners: ['payments', 'payments'], quietStart: '22:00', quietEnd: '06:00' }, actor);
    expect(r.contacts).toHaveLength(1);
    expect(r.contacts[0]).toMatchObject({ owners: ['payments'], quietStart: '22:00', timezone: 'America/New_York', active: true });
    const id = r.contacts[0].id;
    await s.upsert(id, { ...base, role: 'secondary', position: 2 }, actor);
    expect((await s.contacts()).contacts[0]).toMatchObject({ role: 'secondary', position: 2 });
    await s.remove(id, { reason: 'left' }, actor);
    expect((await s.contacts()).contacts).toEqual([]);
    expect(a.entries.map((e) => e.action)).toEqual(['oncall_contact_added', 'oncall_contact_updated', 'oncall_contact_removed']);
    expect(a.entries[0].summary).toContain('+1******1234');
    expect(a.entries[0].summary).not.toContain('+16095551234');
    expect(a.entries[0].reason).toBe('on call this week');
  });
  it('refuses a bad destination, half quiet hours, an unknown time zone and a blank reason', async () => {
    const s = new OnCallService(db);
    await expect(s.upsert(null, { ...base, destination: '609-555-1234' }, actor)).rejects.toThrow(/E\.164/);
    await expect(s.upsert(null, { ...base, channel: 'email', destination: 'nope' }, actor)).rejects.toThrow(/email/);
    await expect(s.upsert(null, { ...base, quietStart: '22:00' }, actor)).rejects.toThrow(/both/);
    await expect(s.upsert(null, { ...base, timezone: 'Mars/Olympus' }, actor)).rejects.toThrow(/time zone/);
    await expect(s.upsert(null, { ...base, reason: '  ' }, actor)).rejects.toThrow(/reason/);
    expect((await s.contacts()).contacts).toEqual([]);
  });
});

describe('the synthetic test salon', () => {
  it('defaults to none; designating needs a real salon and a reason; clearing works; audited', async () => {
    const a = audit(); const s = new OnCallService(db, undefined, undefined, a as any);
    expect((await s.synthetic()).testTenant).toBeNull();
    await expect(s.setSynthetic({ testTenantId: '00000000-0000-4000-8000-00000000dead', reason: 'x' }, actor)).rejects.toThrow(/not found/);
    await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('5e000000-0000-4000-8000-0000000000d1', 'Probe LLC', 'Probe Salon', 'probe-s', 'PROB1', 'active') ON CONFLICT DO NOTHING`);
    expect((await s.setSynthetic({ testTenantId: '5e000000-0000-4000-8000-0000000000d1', reason: 'Kevin\'s test salon' }, actor)).testTenant).toMatchObject({ name: 'Probe Salon' });
    expect((await s.setSynthetic({ testTenantId: null, reason: 'retired' }, actor)).testTenant).toBeNull();
    expect(a.entries.map((e) => e.action)).toEqual(['synthetic_test_salon_changed', 'synthetic_test_salon_changed']);
    await expect(s.setSynthetic({ testTenantId: null, reason: '' }, actor)).rejects.toThrow(/reason/);
  });
});

describe('guards on the routes', () => {
  const src = readFileSync(new URL('./oncall.ts', import.meta.url), 'utf8');
  const route = (verb: string, path: string) => new RegExp(`@RequireStepUp\\(\\)\\s*\\n\\s*@${verb}\\('${path.replace(/\//g, '\\/')}'\\)`);
  it('editing the chain and designating the test salon need step-up and system.manage', () => {
    for (const [v, p] of [['Post', 'contacts'], ['Put', 'contacts/:id'], ['Post', 'contacts/:id/remove'], ['Put', 'synthetic']]) expect(src, `${v} ${p}`).toMatch(route(v, p));
    expect(src.match(/@(Post|Put)\('(contacts|contacts\/:id|contacts\/:id\/remove|synthetic)'\) @RequirePermission\('super_admin\.system\.manage'\)/g)).toHaveLength(4);
  });
  it('acknowledging needs system.manage but NOT step-up (incident friction); reads need system_operations.view', () => {
    expect(src).toMatch(/@Post\('alerts\/:id\/acknowledge'\) @RequirePermission\('super_admin\.system\.manage'\)/);
    expect(src).not.toMatch(/@RequireStepUp\(\)\s*\n\s*@Post\('alerts\/:id\/acknowledge'\)/);
    for (const p of ['contacts', 'alerts', 'synthetic', 'backups', 'slos']) expect(src).toMatch(new RegExp(`@Get\\('${p}'\\) @RequirePermission\\('super_admin\\.system_operations\\.view'\\)`));
  });
});

describe('the public link controller', () => {
  function res() { const r: any = { headers: {} as Record<string, string>, body: '', setHeader(k: string, v: string) { this.headers[k.toLowerCase()] = v; }, send(b: string) { this.body = b; } }; return r; }
  it('GET renders a confirmation page and acknowledges nothing; POST acknowledges; the page allows a form to itself only', async () => {
    await pg.exec(`INSERT INTO oncall_contacts (position, role, name, channel, destination) VALUES (1, 'primary', 'P', 'email', 'p@example.com')`);
    await pg.query(`INSERT INTO alerts (tenant_id, tenant_name, title, message, type, severity, status, related_module, related_record_id, dedupe_key, notified_severity, notified_at)
      VALUES (NULL, 'Platform', 'API is down', 'x', 'system', 'critical', 'unread', 'system_health', 'api', 'k1', 'critical', $1)`, [new Date('2026-01-01T00:00:00Z')]);
    const sent: string[] = [];
    const e = new AlertEscalation(db); e.env = { ALERT_ACK_SECRET: 'k'.repeat(40), PUBLIC_API_BASE_URL: 'https://api.example.com' };
    e.email = { send: async (_t: string, _s: string, b: string) => { sent.push(b); return {} as any; } } as any; e.sms = null; e.push = null;
    await e.tick(new Date());                                       // real clock: the controller redeems with "now"
    const token = decodeURIComponent(/alert-ack\?t=(\S+)/.exec(sent[0])![1]);
    const c = new AlertAckPublicController(e);
    const g = res(); await c.confirm(token, g);
    expect(g.body).toContain('Acknowledge alert?');
    expect(g.headers['content-security-policy']).toContain("form-action 'self'");
    expect(g.headers['cache-control']).toBe('no-store');
    expect((await pg.query(`SELECT status FROM alerts WHERE dedupe_key = 'k1'`)).rows[0].status).toBe('unread');
    const p = res(); await c.acknowledge(token, p);
    expect(p.body).toContain('Acknowledged');
    expect((await pg.query(`SELECT status FROM alerts WHERE dedupe_key = 'k1'`)).rows[0].status).toBe('read');
    const again = res(); await c.acknowledge(token, again);
    expect(again.body).toContain('already been used');
    const bad = res(); await c.confirm('nonsense', bad);
    expect(bad.body).toContain('not valid');
  });
});
