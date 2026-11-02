import { describe, it, expect } from 'vitest';
import { InMemoryGiftCardProgramsRepo } from './gift-card-programs.repository';
import { GiftCardProgramsService } from './gift-card-programs.service';

const svc = () => new GiftCardProgramsService(new InMemoryGiftCardProgramsRepo());

describe('GiftCardProgramsService', () => {
  it('creates a program with a valid scope and lists it', async () => {
    const s = svc();
    const p = await s.createProgram({ name: 'AI PowerSalon Network', ownerTenantId: 't_owner', scope: 'network', sharedLiability: true });
    expect(p.scope).toBe('network');
    const state = await s.getState();
    expect(state.programs.length).toBe(1);
    expect(state.programs[0].name).toBe('AI PowerSalon Network');
    expect(state.programs[0].memberCount).toBe(0);
  });

  it('rejects a program without a name, owner, or with an invalid scope', async () => {
    await expect(svc().createProgram({ ownerTenantId: 't', scope: 'network' })).rejects.toThrow(/name/i);
    await expect(svc().createProgram({ name: 'X', ownerTenantId: 't', scope: 'galaxy' as any })).rejects.toThrow(/scope/i);
    await expect(svc().createProgram({ name: 'X', scope: 'network' })).rejects.toThrow(/owner/i);
  });

  it('adds a member idempotently and counts active members', async () => {
    const s = svc();
    const p = await s.createProgram({ name: 'Net', ownerTenantId: 'o', scope: 'network', sharedLiability: false });
    await s.addMember(p.id, { tenantId: 't_a' });
    const dup = await s.addMember(p.id, { tenantId: 't_a' });
    expect(dup.reason).toBe('already_member');
    await s.addMember(p.id, { tenantId: 't_b' });
    expect((await s.getState()).programs[0].memberCount).toBe(2);
  });

  it('suspends a member, dropping the active count', async () => {
    const s = svc();
    const p = await s.createProgram({ name: 'Net', ownerTenantId: 'o', scope: 'network', sharedLiability: false });
    await s.addMember(p.id, { tenantId: 't_a' });
    await s.setMemberStatus(p.id, 't_a', { status: 'suspended' });
    const state = await s.getState();
    expect(state.programs[0].memberCount).toBe(0);
    expect(state.programs[0].members[0].status).toBe('suspended');
  });

  it('updates program scope + status with validation', async () => {
    const s = svc();
    const p = await s.createProgram({ name: 'Net', ownerTenantId: 'o', scope: 'tenant_only', sharedLiability: false });
    const up = await s.updateProgram(p.id, { scope: 'network', status: 'paused' });
    expect(up.scope).toBe('network'); expect(up.status).toBe('paused');
    await expect(s.updateProgram(p.id, { status: 'bogus' })).rejects.toThrow(/status/i);
    await expect(s.updateProgram('nope', { scope: 'network' })).rejects.toThrow(/not found/i);
  });

  it('rejects adding a member to a missing program and an invalid member status', async () => {
    const s = svc();
    await expect(s.addMember('nope', { tenantId: 't' })).rejects.toThrow(/not found/i);
    const p = await s.createProgram({ name: 'Net', ownerTenantId: 'o', scope: 'network', sharedLiability: false });
    await s.addMember(p.id, { tenantId: 't_a' });
    await expect(s.setMemberStatus(p.id, 't_a', { status: 'weird' })).rejects.toThrow(/status/i);
  });
});
