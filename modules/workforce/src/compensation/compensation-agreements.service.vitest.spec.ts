import { describe, it, expect } from 'vitest';
import { InMemoryAgreementsRepo } from './compensation-agreements.repository';
import { AgreementsService } from './compensation-agreements.service';

const ctx = { tenantId: 't1', userId: 'u1' };
const svc = () => new AgreementsService(new InMemoryAgreementsRepo());

describe('AgreementsService', () => {
  it('creates an agreement (version 1, sent) with its terms snapshot', async () => {
    const a = await svc().create(ctx, { technicianId: 'tech1', title: '2026 comp', terms: { commissionPercent: 60, classification: 'employee' } });
    expect(a).toMatchObject({ technicianId: 'tech1', title: '2026 comp', status: 'sent', version: 1 });
    expect(a.terms).toEqual({ commissionPercent: 60, classification: 'employee' });
  });

  it('validates technicianId and title', async () => {
    await expect(svc().create(ctx, { title: 'x' })).rejects.toThrow(/technicianId/);
    await expect(svc().create(ctx, { technicianId: 't' })).rejects.toThrow(/title/);
  });

  it('supersedes the technician\'s prior agreement and increments the version', async () => {
    const s = svc();
    await s.create(ctx, { technicianId: 'tech1', title: 'v1', terms: {} });
    const v2 = await s.create(ctx, { technicianId: 'tech1', title: 'v2', terms: {} });
    expect(v2.version).toBe(2);
    const list = await s.list(ctx, 'tech1');
    expect(list.find((a) => a.title === 'v1')!.status).toBe('superseded');
    expect(list.find((a) => a.title === 'v2')!.status).toBe('sent');
  });

  it('acknowledge sets status/acknowledged fields and only works on a sent agreement', async () => {
    const s = svc();
    const a = await s.create(ctx, { technicianId: 'tech1', title: 'v1', terms: {} });
    const ack = await s.acknowledge(ctx, a.id, 'tech1');
    expect(ack.status).toBe('acknowledged');
    expect(ack.acknowledgedAt).not.toBeNull();
    await expect(s.acknowledge(ctx, a.id, 'tech1')).rejects.toThrow(/awaiting/); // no longer 'sent'
  });

  it('acknowledge rejects a mismatched technician', async () => {
    const s = svc();
    const a = await s.create(ctx, { technicianId: 'tech1', title: 'v1', terms: {} });
    await expect(s.acknowledge(ctx, a.id, 'other')).rejects.toThrow(/awaiting/);
  });

  it('get 404s on unknown; list filters by technician', async () => {
    const s = svc();
    await expect(s.get(ctx, 'nope')).rejects.toThrow(/not found/i);
    await s.create(ctx, { technicianId: 'tech1', title: 'a', terms: {} });
    await s.create(ctx, { technicianId: 'tech2', title: 'b', terms: {} });
    expect(await s.list(ctx, 'tech1')).toHaveLength(1);
    expect(await s.list(ctx)).toHaveLength(2);
  });

  it('listForUser resolves the user\'s technician and excludes superseded/others', async () => {
    const repo = new InMemoryAgreementsRepo();
    repo.setUserTechnician('user1', 'tech1');
    const s = new AgreementsService(repo);
    await s.create(ctx, { technicianId: 'tech1', title: 'v1', terms: {} }); // becomes superseded
    await s.create(ctx, { technicianId: 'tech1', title: 'v2', terms: {} }); // sent — mine
    await s.create(ctx, { technicianId: 'tech2', title: 'other', terms: {} }); // not mine
    const mine = await s.listForUser(ctx, 'user1');
    expect(mine).toHaveLength(1);
    expect(mine[0].title).toBe('v2');
  });

  it('listForUser returns [] when no technician is linked to the account', async () => {
    expect(await svc().listForUser(ctx, 'unknownUser')).toEqual([]);
  });

  it('acknowledgeAsUser signs off the user\'s own agreement; 403 without a linked profile', async () => {
    const repo = new InMemoryAgreementsRepo();
    repo.setUserTechnician('user1', 'tech1');
    const s = new AgreementsService(repo);
    const a = await s.create(ctx, { technicianId: 'tech1', title: 'v1', terms: {} });
    expect((await s.acknowledgeAsUser(ctx, a.id, 'user1')).status).toBe('acknowledged');
    await expect(s.acknowledgeAsUser(ctx, a.id, 'noProfileUser')).rejects.toThrow(/no technician profile/i);
  });
});
