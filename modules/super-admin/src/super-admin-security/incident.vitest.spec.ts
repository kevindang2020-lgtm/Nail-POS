import { describe, it, expect, beforeEach } from 'vitest';
import { IncidentService, IncidentError } from './incident.service';
import { InMemoryIncidentRepository } from './incident.repository';

let repo: InMemoryIncidentRepository; let svc: IncidentService;
const actor = { userId: 'admin1', role: 'SUPER_ADMIN', name: 'Admin', ip: '10.0.0.1' };
beforeEach(() => { repo = new InMemoryIncidentRepository(); svc = new IncidentService(repo); });

describe('IncidentService', () => {
  it('creates an incident (ref, detected, initial event) with normalized vocab', async () => {
    const r = await svc.create({ title: 'Credential stuffing burst', severity: 'Critical', category: 'Network' }, actor);
    expect(r.incidentRef).toMatch(/^INC-\d{4}-\d{3}$/); expect(r.status).toBe('detected'); expect(r.severity).toBe('critical'); expect(r.category).toBe('network');
    const d = await svc.get(r.id); expect(d.events).toHaveLength(1); expect(d.events[0].toStatus).toBe('detected');
    expect(repo.audits[0]).toMatchObject({ action: 'security_incident_opened' });
  });

  it('rejects a title-less incident', async () => {
    await expect(svc.create({ title: '' }, actor)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('advances through the valid workflow and records each transition', async () => {
    const r = await svc.create({ title: 'X' }, actor);
    await svc.transition(r.id, 'investigating', null, actor);
    await svc.transition(r.id, 'contained', null, actor);
    await svc.transition(r.id, 'remediating', null, actor);
    const closed = await svc.transition(r.id, 'closed', 'remediated + verified', actor);
    expect(closed!.status).toBe('closed');
    const d = await svc.get(r.id);
    expect(d.events.map((e) => e.toStatus)).toEqual(['detected', 'investigating', 'contained', 'remediating', 'closed']);
    expect(d.resolvedAt).toBeTruthy();
  });

  it('REJECTS an invalid transition (no skipping stages)', async () => {
    const r = await svc.create({ title: 'X' }, actor);
    await expect(svc.transition(r.id, 'remediating', null, actor)).rejects.toMatchObject({ code: 'conflict' });
    const d = await svc.get(r.id); expect(d.status).toBe('detected'); // unchanged
  });

  it('requires a reason to close or reopen', async () => {
    const r = await svc.create({ title: 'X' }, actor);
    await svc.transition(r.id, 'investigating', null, actor);
    await svc.transition(r.id, 'contained', null, actor);
    await svc.transition(r.id, 'remediating', null, actor);
    await expect(svc.transition(r.id, 'closed', '', actor)).rejects.toMatchObject({ code: 'conflict' });
    await svc.transition(r.id, 'closed', 'done', actor);
    await expect(svc.transition(r.id, 'reopened', '', actor)).rejects.toMatchObject({ code: 'conflict' });
    const re = await svc.transition(r.id, 'reopened', 'recurrence detected', actor);
    expect(re!.status).toBe('reopened');
  });

  it('workflow counts fold monitoring into closed and report open count; 404 on unknown', async () => {
    await svc.create({ title: 'A' }, actor);
    const b = await svc.create({ title: 'B' }, actor);
    await svc.transition(b.id, 'investigating', null, actor);
    const w = await svc.workflow();
    expect(w.stages.detected).toBe(1); expect(w.stages.investigating).toBe(1); expect(w.openCount).toBe(2);
    await expect(svc.get('ghost')).rejects.toBeInstanceOf(IncidentError);
  });
});
