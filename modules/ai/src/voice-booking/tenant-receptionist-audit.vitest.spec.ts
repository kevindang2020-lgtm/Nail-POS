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
  // agent create / status audit moved with the routes to the AI Front Desk center (front-desk-center.pgtest: audit_events
  // module 'ai_front_desk' for every activation / pause / archive / restore / rollback, written in the same transaction).

  it('records a settings-update event listing which keys changed', async () => {
    const { c, req, events } = make();
    await c.updateSettings(req, { enabled: true, recordingEnabled: true });
    const ev = events.find((e) => e.input.action === 'settings.updated');
    expect(ev.input.metadata.changed).toEqual(['enabled', 'recordingEnabled']);
  });
});
