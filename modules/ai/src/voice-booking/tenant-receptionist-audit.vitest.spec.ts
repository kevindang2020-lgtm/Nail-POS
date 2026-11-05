// tenant-receptionist-audit.vitest.spec.ts — high-risk AI Receptionist write actions emit audit events through the
// shared AuditService, scoped to the caller's server-derived tenant. Constructs the controller with stubbed services
// and a recording AuditService, and checks the emitted event shape for a couple of representative actions.
import { describe, it, expect, vi } from 'vitest';
import { TenantReceptionistController } from './tenant-receptionist.controller';

function make() {
  const events: any[] = [];
  const audit = { record: vi.fn(async (ctx: any, input: any) => { events.push({ ctx, input }); return { id: 'ev' }; }) };
  const agents = {
    createDraft: vi.fn(async () => ({ id: 'agent_1', name: 'Main Front Desk', status: 'draft' })),
    setStatus: vi.fn(async () => ({ id: 'agent_1', name: 'Main Front Desk', status: 'archived' })),
  };
  const settings = { update: vi.fn(async () => ({ enabled: true })) };
  const provisioning = {}; const followUps = {}; const faqs = {}; const svc = {};
  const c = new TenantReceptionistController(svc as any, agents as any, followUps as any, faqs as any, settings as any, provisioning as any, audit as any);
  const req = { ctx: { tenantId: 'ten_1', branchId: 'br_1', userId: 'user_1', role: 'OWNER', permissions: ['ai.manage'] } };
  return { c, req, events, audit };
}

describe('AI Receptionist audit logging', () => {
  it('records a tenant-scoped event when an agent is created', async () => {
    const { c, req, events } = make();
    await c.createAgent(req, { name: 'Main Front Desk' });
    const ev = events.find((e) => e.input.action === 'agent.created');
    expect(ev).toBeTruthy();
    expect(ev.ctx).toMatchObject({ tenantId: 'ten_1', branchId: 'br_1', userId: 'user_1' }); // server-derived scope
    expect(ev.input).toMatchObject({ module: 'ai_receptionist', resourceId: 'agent_1' });
  });

  it('records a status-change event with the new status in metadata', async () => {
    const { c, req, events } = make();
    await c.setStatus(req, 'agent_1', { status: 'archived' });
    const ev = events.find((e) => e.input.action === 'agent.status_changed');
    expect(ev.input.metadata).toMatchObject({ status: 'archived' });
  });

  it('records a settings-update event listing which keys changed', async () => {
    const { c, req, events } = make();
    await c.updateSettings(req, { enabled: true, recordingEnabled: true });
    const ev = events.find((e) => e.input.action === 'settings.updated');
    expect(ev.input.metadata.changed).toEqual(['enabled', 'recordingEnabled']);
  });
});
