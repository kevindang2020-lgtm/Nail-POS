// ai-agent.vitest.spec.ts — Front Desk agent config lifecycle. Covers: name validation, permission gating on writes,
// safe greeting/behavior defaults on create, the draft-only status machine (an agent can't jump to 'ready'/'live'
// without provider provisioning — the honest boundary), and version snapshots on create/update.
import { describe, it, expect } from 'vitest';
import { AiAgentService, InMemoryAgentRepo } from './ai-agent.service';
import { normalizeAgentConfig, canTransitionAgent, AgentValidationError, DEFAULT_GREETING, DEFAULT_BEHAVIOR } from './ai-agent-core';

const owner = { tenantId: 't1', branchId: null, userId: 'u1', role: 'OWNER', permissions: ['ai.manage'] };
const viewer = { tenantId: 't1', branchId: null, userId: 'u2', role: 'RECEPTION', permissions: ['ai.use'] };

describe('ai-agent-core', () => {
  it('requires a name and normalizes call type + language', () => {
    expect(() => normalizeAgentConfig({})).toThrow(AgentValidationError);
    const cfg = normalizeAgentConfig({ name: '  Main Desk  ' });
    expect(cfg).toMatchObject({ name: 'Main Desk', callType: 'inbound', language: 'en' });
    expect(() => normalizeAgentConfig({ name: 'X', callType: 'sideways' })).toThrow(AgentValidationError);
  });
  it('the status machine is draft-only — no jump to ready/live without provisioning', () => {
    expect(canTransitionAgent('draft', 'archived')).toBe(true);
    expect(canTransitionAgent('draft', 'paused')).toBe(true);
    expect(canTransitionAgent('draft', 'ready')).toBe(false);  // provider-gated
    expect(canTransitionAgent('draft', 'live')).toBe(false);   // provider-gated
    expect(canTransitionAgent('archived', 'draft')).toBe(false); // terminal
  });
});

describe('AiAgentService', () => {
  const svc = () => new AiAgentService(new InMemoryAgentRepo());

  it('creates a config-only draft with safe defaults', async () => {
    const a = await svc().createDraft(owner as any, { name: 'Main Front Desk' });
    expect(a.status).toBe('draft');
    expect(a.provider).toBeNull();                        // not provisioned
    expect(a.greeting).toBe(DEFAULT_GREETING);
    expect(a.behavior).toBe(DEFAULT_BEHAVIOR);
  });

  it('refuses writes without ai.manage', async () => {
    await expect(svc().createDraft(viewer as any, { name: 'X' })).rejects.toMatchObject({ name: 'AgentForbiddenError' });
  });

  it('lists only the calling tenant\u2019s agents', async () => {
    const s = svc();
    await s.createDraft(owner as any, { name: 'A' });
    await s.createDraft({ ...owner, tenantId: 't2' } as any, { name: 'B' });
    const mine = await s.list(owner as any);
    expect(mine.map((r) => r.name)).toEqual(['A']);
  });

  it('updates config and bumps the version', async () => {
    const s = svc();
    const a = await s.createDraft(owner as any, { name: 'A' });
    const u = await s.update(owner as any, a.id, { name: 'A2', useCase: 'After-hours' });
    expect(u.name).toBe('A2');
    expect(u.useCase).toBe('After-hours');
    expect(u.knowledgeVersion).toBe(2);
  });

  it('enforces the status machine on setStatus', async () => {
    const s = svc();
    const a = await s.createDraft(owner as any, { name: 'A' });
    await expect(s.setStatus(owner as any, a.id, 'live')).rejects.toBeInstanceOf(AgentValidationError); // can't go live from draft
    const paused = await s.setStatus(owner as any, a.id, 'paused');
    expect(paused.status).toBe('paused');
    const archived = await s.setStatus(owner as any, a.id, 'archived');
    expect(archived.status).toBe('archived');
    await expect(s.update(owner as any, a.id, { name: 'nope' })).rejects.toBeInstanceOf(AgentValidationError); // archived is read-only
  });

  it('404s on a missing or cross-tenant agent', async () => {
    const s = svc();
    const a = await s.createDraft(owner as any, { name: 'A' });
    await expect(s.get({ ...owner, tenantId: 't2' } as any, a.id)).rejects.toMatchObject({ name: 'AgentNotFoundError' });
  });
});
