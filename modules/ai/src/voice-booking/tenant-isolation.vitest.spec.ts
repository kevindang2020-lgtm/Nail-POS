// tenant-isolation.vitest.spec.ts — the consolidated cross-tenant security suite the spec demands: Tenant A must never
// read or mutate Tenant B's agents, follow-ups, FAQs, settings, or provisioning jobs, and list queries must be
// bounded. Every service takes its tenant from a server-derived context; these tests confirm passing Tenant B's ctx
// against Tenant A's rows yields nothing (reads) or NotFound (mutations). Uses the in-memory repos, which mirror the
// same tenant_id filtering as the kysely repos (verified separately against real Postgres in per-feature specs).
import { describe, it, expect } from 'vitest';
import { AiAgentService, InMemoryAgentRepo } from './ai-agent.service';
import { AiFollowUpService, InMemoryFollowUpRepo } from './ai-follow-up.service';
import { AiFaqService, InMemoryFaqRepo } from './ai-faq.service';
import { AiSettingsService, InMemorySettingsRepo } from './ai-settings.service';
import { AiProvisioningService, InMemoryProvJobRepo } from './ai-provisioning.service';
import { resolveVoiceProvider } from './provider-ports';

const A = { tenantId: 'tenantA', branchId: null, userId: 'uA', role: 'OWNER', permissions: ['ai.manage'] };
const B = { tenantId: 'tenantB', branchId: null, userId: 'uB', role: 'OWNER', permissions: ['ai.manage'] };

describe('cross-tenant isolation — agents', () => {
  it('B cannot read, edit, provision, or change status of A\u2019s agent', async () => {
    const svc = new AiAgentService(new InMemoryAgentRepo());
    const a = await svc.createDraft(A as any, { name: 'A Front Desk' });
    expect((await svc.list(B as any)).length).toBe(0);                       // B lists nothing
    await expect(svc.get(B as any, a.id)).rejects.toMatchObject({ name: 'AgentNotFoundError' });
    await expect(svc.update(B as any, a.id, { name: 'hacked' })).rejects.toMatchObject({ name: 'AgentNotFoundError' });
    await expect(svc.setStatus(B as any, a.id, 'archived')).rejects.toMatchObject({ name: 'AgentNotFoundError' });
    // A's agent is untouched
    expect((await svc.get(A as any, a.id)).name).toBe('A Front Desk');
  });
});

describe('cross-tenant isolation — follow-ups', () => {
  it('B cannot see, assign, note, or resolve A\u2019s follow-up', async () => {
    const svc = new AiFollowUpService(new InMemoryFollowUpRepo());
    const fu = await svc.createManual(A as any, { reason: 'COMPLAINT' });
    expect((await svc.list(B as any, {})).length).toBe(0);
    await expect(svc.assign(B as any, fu.id, 'uB')).rejects.toMatchObject({ name: 'FollowUpNotFoundError' });
    await expect(svc.addNote(B as any, fu.id, 'x')).rejects.toMatchObject({ name: 'FollowUpNotFoundError' });
    await expect(svc.setStatus(B as any, fu.id, 'resolved')).rejects.toMatchObject({ name: 'FollowUpNotFoundError' });
  });
  it('follow-up list is bounded even within a tenant', async () => {
    const svc = new AiFollowUpService(new InMemoryFollowUpRepo());
    for (let i = 0; i < 250; i++) await svc.createManual(A as any, { reason: 'OTHER' });
    const withCap = await svc.list(A as any, { limit: 50 });
    expect(withCap.length).toBe(50);
    const defaultCap = await svc.list(A as any, {});
    expect(defaultCap.length).toBeLessThanOrEqual(200);                     // default bound applies
  });
});

describe('cross-tenant isolation — FAQs', () => {
  it('B cannot update or delete A\u2019s FAQ', async () => {
    const svc = new AiFaqService(new InMemoryFaqRepo());
    const f = await svc.create(A as any, { question: 'q?', answer: 'a.' });
    expect((await svc.list(B as any)).length).toBe(0);
    await expect(svc.update(B as any, f.id, { answer: 'hacked' })).rejects.toMatchObject({ name: 'FaqNotFoundError' });
    await expect(svc.remove(B as any, f.id)).rejects.toMatchObject({ name: 'FaqNotFoundError' });
  });
});

describe('cross-tenant isolation — settings', () => {
  it('A and B keep separate settings; B\u2019s write never affects A', async () => {
    const svc = new AiSettingsService(new InMemorySettingsRepo());
    await svc.update(A as any, { enabled: true });
    // A9 Nov 6: recording needs B's owner to approve B's notice first — and that approval is B's alone
    await svc.approveConsent({ ...(B as any), role: 'OWNER' }, (await svc.get(B as any)).recordingConsentMessage);
    await svc.update(B as any, { enabled: false, recordingEnabled: true });
    expect((await svc.get(A as any)).meta?.consent?.approved).toBe(false);
    expect((await svc.get(A as any)).enabled).toBe(true);
    expect((await svc.get(A as any)).recordingEnabled).toBe(false);         // B's change didn't leak into A
    expect((await svc.get(B as any)).recordingEnabled).toBe(true);
  });
});

describe('cross-tenant isolation — provisioning jobs', () => {
  it('B cannot read A\u2019s provisioning job', async () => {
    const jobs = new InMemoryProvJobRepo();
    const agents = { get: async () => ({ id: 'agent_1', name: 'A', language: 'en', greeting: 'hi', behavior: 'b' }), setProvisioned: async () => {} };
    const svc = new AiProvisioningService(jobs as any, agents as any, resolveVoiceProvider({} as any));
    const job = await svc.start(A as any, 'agent_1');
    await new Promise((r) => setTimeout(r, 5));
    await expect(svc.get(B as any, job.id)).rejects.toMatchObject({ name: 'ProvNotFoundError' });
    expect((await svc.get(A as any, job.id)).id).toBe(job.id);              // A still sees its own
  });
});
