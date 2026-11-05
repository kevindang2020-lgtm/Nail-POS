import { describe, it, expect } from 'vitest';
import { TicketRemovalService, TicketRemovalError, type TicketRemovalRepo, type RemovalAuditSink, type AdminCtx } from './ticket-removal.service';
import { testProviderSecrets } from '@aipowersalon/testing';   // real AES-GCM under a fixed test key (the API's sealer is wire-tested in common/provider-secrets)
const deletion = testProviderSecrets;
const decryptDeletionCode = (enc: string) => deletion.decrypt(enc);

const ctx: AdminCtx = { userId: 'sa' };

function makeHarness(ticketState: { tenantId: string; removedAt: string | null } | null = { tenantId: 'T', removedAt: null }) {
  const store: { codeEnc?: string; revealed?: number; removed?: { reason: string } } = {};
  const audits: any[] = [];
  const repo: TicketRemovalRepo = {
    ticket: async () => (ticketState ? { tenantId: ticketState.tenantId, removedAt: store.removed ? new Date().toISOString() : ticketState.removedAt } : null),
    codeRow: async () => (store.codeEnc ? { codeEnc: store.codeEnc } : null),
    upsertCode: async (i) => { store.codeEnc = i.codeEnc; },
    markRevealed: async () => { store.revealed = (store.revealed || 0) + 1; },
    remove: async (i) => { store.removed = { reason: i.reason }; },
  };
  const audit: RemovalAuditSink = { record: async (a) => { audits.push(a); } };
  return { svc: new TicketRemovalService(repo, audit, deletion), store, audits };
}

describe('TicketRemovalService — deletion code + logical removal (epic Req §10)', () => {
  it('generates an encrypted code without returning or logging the plaintext', async () => {
    const h = makeHarness();
    expect(await h.svc.generateCode(ctx, 'tk1')).toEqual({ generated: true });
    // Stored sealed, never plaintext. The wire FORMAT ('v1:') is the API sealer's and is asserted beside it
    // (common/ticket-deletion-crypto.vitest.spec); this module only sees the SECRET_SEALERS port.
    const plain = decryptDeletionCode(h.store.codeEnc!);
    expect(plain).toMatch(/^\d{6}$/);
    expect(h.store.codeEnc).not.toBe(plain); expect(h.store.codeEnc).not.toContain(plain);
    const gen = h.audits.find((a) => a.actionType === 'ticket_deletion_code_generated');
    expect(gen).toBeTruthy();
    expect(JSON.stringify(gen.metadata)).not.toContain(plain);          // the code is never in any audit row
  });

  it('reveals the code (audited) without writing it to the audit metadata', async () => {
    const h = makeHarness();
    await h.svc.generateCode(ctx, 'tk1');
    const plain = decryptDeletionCode(h.store.codeEnc!);
    expect((await h.svc.revealCode(ctx, 'tk1')).code).toBe(plain);
    expect(h.store.revealed).toBe(1);
    const rev = h.audits.find((a) => a.actionType === 'ticket_deletion_code_revealed');
    expect(JSON.stringify(rev.metadata)).not.toContain(plain);
  });

  it('removes only with the correct code + a reason; rejects wrong code, missing reason, and double removal', async () => {
    const h = makeHarness();
    await h.svc.generateCode(ctx, 'tk1');
    const code = decryptDeletionCode(h.store.codeEnc!);
    const wrong = code === '000000' ? '111111' : '000000';
    await expect(h.svc.removeTicket(ctx, 'tk1', { code, reason: '' })).rejects.toThrow(/reason/i);
    await expect(h.svc.removeTicket(ctx, 'tk1', { code: wrong, reason: 'dup charge' })).rejects.toThrow(TicketRemovalError);
    expect(await h.svc.removeTicket(ctx, 'tk1', { code, reason: 'Duplicate ticket created in error' })).toEqual({ removed: true });
    expect(h.store.removed?.reason).toBe('Duplicate ticket created in error');
    await expect(h.svc.removeTicket(ctx, 'tk1', { code, reason: 'again' })).rejects.toThrow(/already been removed/i);
  });

  it('rejects reveal/remove when no code exists, and removal of a missing ticket', async () => {
    const h = makeHarness();
    await expect(h.svc.revealCode(ctx, 'tk1')).rejects.toThrow(/no deletion code/i);
    await expect(h.svc.removeTicket(ctx, 'tk1', { code: '123456', reason: 'x' })).rejects.toThrow(/generate the deletion/i);
    const missing = makeHarness(null);
    await expect(missing.svc.removeTicket(ctx, 'tk1', { code: '123456', reason: 'x' })).rejects.toThrow(/not found/i);
  });
});
