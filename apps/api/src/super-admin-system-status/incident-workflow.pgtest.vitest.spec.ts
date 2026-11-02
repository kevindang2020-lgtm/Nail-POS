// incident-workflow.pgtest — Constitution 11 §168–176 against the real schema (migration 445).
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { IncidentWorkflowService } from './incident-workflow';
import { checkIncidentTransition, postmortemsOwed } from './system-status-core';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

let pg: any; let db: any; let svc: IncidentWorkflowService;
beforeAll(async () => { pg = await migratedPglite(); db = kyselyFor(pg); svc = new IncidentWorkflowService(db); });
beforeEach(async () => { await pg.exec(`DELETE FROM status_incident_events; DELETE FROM status_incidents; DELETE FROM alerts WHERE tenant_id IS NULL; DELETE FROM status_post_incident_reports;`); });
async function incident(severity: string, status = 'investigating', commander: string | null = null, ref = 'INC-T1') {
  return (await pg.query(`INSERT INTO status_incidents (title, status, impact, severity, incident_reference, recovery_owner) VALUES ('t', $1, 'minor', $2, $3, $4) RETURNING id`, [status, severity, ref, commander])).rows[0].id;
}
const entries = async (id: string) => (await svc.timeline(id)).entries.map((e) => e.kind);

describe('migration 445', () => {
  it('"mitigating" can be stored — the funnel no longer has to fake it', async () => {
    const id = await incident('medium', 'mitigating');
    expect((await pg.query(`SELECT status FROM status_incidents WHERE id = $1`, [id])).rows[0].status).toBe('mitigating');
  });
  it('exactly one status check remains, and it still refuses nonsense', async () => {
    const r = await pg.query(`SELECT count(*)::int c FROM pg_constraint WHERE conrelid = 'status_incidents'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%investigating%'`);
    expect(r.rows[0].c).toBe(1);
    await expect(pg.exec(`INSERT INTO status_incidents (title, status, impact) VALUES ('x', 'fixed', 'minor')`)).rejects.toThrow();
  });
});

describe('§169–175 the single rule set', () => {
  it('forward only — a resolved incident is never reopened', () => {
    expect(checkIncidentTransition({ status: 'resolved', severity: 'low', commander: 'a' }, 'investigating')).toEqual(['Cannot move an incident from resolved back to investigating.']);
  });
  it('§171 a SEV1 cannot move past Investigating without a commander', () => {
    expect(checkIncidentTransition({ status: 'investigating', severity: 'critical', commander: null }, 'identified')[0]).toMatch(/SEV1 incident needs an incident commander/);
    expect(checkIncidentTransition({ status: 'investigating', severity: 'critical', commander: 'Kevin' }, 'identified')).toEqual([]);
  });
  it('a SEV3 needs no commander — the rule is for serious incidents', () => {
    expect(checkIncidentTransition({ status: 'investigating', severity: 'medium', commander: null }, 'resolved')).toEqual([]);
  });
  it('§168/§175 a SEV2 cannot be resolved without a written resolution', () => {
    expect(checkIncidentTransition({ status: 'monitoring', severity: 'high', commander: 'a' }, 'resolved', '  ')[0]).toMatch(/needs a written resolution/);
    expect(checkIncidentTransition({ status: 'monitoring', severity: 'high', commander: 'a' }, 'resolved', 'Rolled back 4.2.8')).toEqual([]);
  });
});

describe('§170 the timeline is a by-product of doing the work', () => {
  it('every transition, commander and note lands in order', async () => {
    const id = await incident('critical');
    await svc.assignCommander(id, 'Kevin', 'u1');
    await svc.transition(id, 'identified', { actor: 'u1' });
    await svc.addEntry(id, 'provider_update', 'Twilio: investigating elevated errors', 'u1', 'https://status.twilio.com');
    await svc.transition(id, 'mitigating', { actor: 'u1' });
    await svc.transition(id, 'resolved', { actor: 'u1', resolution: 'Provider recovered; verified OTP delivery' });
    expect(await entries(id)).toEqual(['commander_assigned', 'status_change', 'provider_update', 'status_change', 'resolution']);
    const row = (await pg.query(`SELECT status, resolution, resolved_at FROM status_incidents WHERE id = $1`, [id])).rows[0];
    expect(row.status).toBe('resolved'); expect(row.resolution).toMatch(/verified OTP delivery/); expect(row.resolved_at).not.toBeNull();
  });
  it('a REFUSED transition writes nothing and changes nothing', async () => {
    const id = await incident('critical');                                     // no commander
    const r = await svc.transition(id, 'identified');
    expect(r.ok).toBe(false);
    expect((await pg.query(`SELECT status FROM status_incidents WHERE id = $1`, [id])).rows[0].status).toBe('investigating');
    expect(await entries(id)).toEqual([]);
  });
  it('an incident can be addressed by its reference as well as its id', async () => {
    await incident('low', 'investigating', null, 'INC-REF9');
    expect((await svc.transition('INC-REF9', 'identified')).ok).toBe(true);
  });
  it('an unknown incident is a 404, not a silent no-op', async () => {
    await expect(svc.transition('nope', 'identified')).rejects.toThrow(/Incident not found/);
  });
});

describe('§176 alert → incident promotion', () => {
  async function alert(severity = 'critical', record = 'database') {
    return (await pg.query(`INSERT INTO alerts (tenant_id, tenant_name, title, message, type, severity, status, related_module, related_record_id, dedupe_key, created_at)
      VALUES (NULL, 'Platform', 'Database is down', 'probe failed', 'system', $1, 'unread', 'system_health', $2, $3, now() - interval '7 minutes') RETURNING id, created_at`,
      [severity, record, 'promo-' + Math.random()])).rows[0];
  }
  it('creates the incident with the alert\'s severity and component, and DETECTED at the alert\'s time (MTTD from monitoring, not the click)', async () => {
    const a = await alert();
    const r = await svc.promoteAlert(a.id, 'u1');
    expect(r.created).toBe(true);
    const inc = (await pg.query(`SELECT severity, component_key, status, detected_at, promoted_from_alert_id FROM status_incidents WHERE id = $1`, [r.incidentId])).rows[0];
    expect(inc).toMatchObject({ severity: 'critical', component_key: 'database', status: 'investigating', promoted_from_alert_id: a.id });
    expect(new Date(inc.detected_at).getTime()).toBe(new Date(a.created_at).getTime());
    expect(await entries(r.incidentId)).toEqual(['detected', 'promoted_from_alert']);
  });
  it('promoting the same alert twice returns the SAME incident — never a second one', async () => {
    const a = await alert();
    const first = await svc.promoteAlert(a.id); const second = await svc.promoteAlert(a.id);
    expect(second).toEqual({ ok: true, incidentId: first.incidentId, created: false });
    expect((await pg.query(`SELECT count(*)::int c FROM status_incidents`)).rows[0].c).toBe(1);
  });
  it('an SLO burn alert promotes with no component (it is not a component)', async () => {
    const a = await alert('high', 'slo:checkout_payment');
    const r = await svc.promoteAlert(a.id);
    expect((await pg.query(`SELECT component_key FROM status_incidents WHERE id = $1`, [r.incidentId])).rows[0].component_key).toBeNull();
  });
  it('a TENANT alert cannot be promoted into a platform incident', async () => {
    const T = 'a9a9a9a9-0000-4000-8000-000000000001';
    await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'P LLC', 'P', 'p-t', 'PTEN1', 'active') ON CONFLICT DO NOTHING`);
    const t = (await pg.query(`INSERT INTO alerts (tenant_id, tenant_name, title, message, type, severity, status, dedupe_key) VALUES ('${T}', 'P', 'x', 'm', 'tenant', 'high', 'unread', 'tenant-promo') RETURNING id`)).rows[0];
    await expect(svc.promoteAlert(t.id)).rejects.toThrow(/Platform alert not found/);
  });
});

describe('§175 postmortems owed', () => {
  it('lists serious resolved incidents without a report — and not minor ones, or ones already reported', async () => {
    await incident('critical', 'resolved', 'k', 'INC-SEV1');
    await incident('high', 'resolved', 'k', 'INC-SEV2-DONE');
    await incident('low', 'resolved', null, 'INC-SEV4');
    await incident('critical', 'monitoring', 'k', 'INC-OPEN');
    await pg.exec(`INSERT INTO status_post_incident_reports (report_reference, incident_reference, title, owner, status) VALUES ('PIR-1', 'INC-SEV2-DONE', 'pm', 'k', 'draft')`);
    expect((await svc.postmortemsOwed()).owed).toEqual(['INC-SEV1']);
  });
  it('pure helper agrees', () => {
    expect(postmortemsOwed([{ id: '1', reference: 'A', severity: 'high', status: 'resolved' }], new Set())).toEqual(['A']);
  });
});
