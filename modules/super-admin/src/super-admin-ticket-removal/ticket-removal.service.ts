// ticket-removal.service.ts — the highest-risk capability (epic Req §10), behind SuperAdminGuard. Three gated ops:
//   generateCode  → CSPRNG six-digit code, encrypted at rest (plaintext never stored, never returned here)
//   revealCode    → decrypts + returns the code; this is the reveal gate and is audited every time
//   removeTicket  → verifies the supplied code, then LOGICALLY removes the ticket (stamps removed_at/by/reason +
//                   a ticket_removed revision). It NEVER destroys receipt/payment/payroll/tax/commission/audit data —
//                   the ticket remains in the DB and searchable. The six-digit code is never written to any audit row.
import type { ProviderSecrets } from '@aipowersalon/security';
import { generateDeletionCode, verifyDeletionCode } from './deletion-code';

export interface AdminCtx { userId?: string; email?: string; ip?: string }
export class TicketRemovalError extends Error { constructor(public code: 'not_found' | 'invalid' | 'forbidden', msg: string) { super(msg); this.name = 'TicketRemovalError'; } }

export interface TicketRemovalRepo {
  ticket(ticketId: string): Promise<{ tenantId: string; removedAt: string | null } | null>;
  codeRow(ticketId: string): Promise<{ codeEnc: string } | null>;
  upsertCode(input: { ticketId: string; tenantId: string; codeEnc: string; byUserId?: string }): Promise<void>;
  markRevealed(ticketId: string, byUserId?: string): Promise<void>;
  remove(input: { ticketId: string; tenantId: string; byUserId?: string; reason: string }): Promise<void>;
}
export interface RemovalAuditSink { record(a: { userId?: string; actionType: string; entityType: string; entityId?: string; metadata?: Record<string, unknown>; ip?: string }): Promise<void>; }

const reqId = (v: unknown): string => { const s = String(v ?? '').trim(); if (!s) throw new TicketRemovalError('invalid', 'A ticket id is required.'); return s; };

export class TicketRemovalService {
  constructor(private readonly repo: TicketRemovalRepo, private readonly audit: RemovalAuditSink, private readonly sealer?: ProviderSecrets) {}
  private sealed(): ProviderSecrets { if (!this.sealer) throw new TicketRemovalError('invalid', 'Deletion-code sealing is not wired (SECRET_SEALERS).'); return this.sealer; }
  private readCode(stored: string): string { try { return this.sealed().decrypt(stored); } catch { return ''; } }

  /** Generate (or regenerate) the six-digit deletion code for a ticket. The code is encrypted; it is NOT returned here. */
  async generateCode(ctx: AdminCtx, ticketId: string): Promise<{ generated: true }> {
    const id = reqId(ticketId);
    const t = await this.repo.ticket(id);
    if (!t) throw new TicketRemovalError('not_found', 'Ticket not found.');
    if (t.removedAt) throw new TicketRemovalError('invalid', 'This ticket has already been removed.');
    const code = generateDeletionCode();
    await this.repo.upsertCode({ ticketId: id, tenantId: t.tenantId, codeEnc: this.sealed().encrypt(code), byUserId: ctx.userId });
    await this.audit.record({ userId: ctx.userId, actionType: 'ticket_deletion_code_generated', entityType: 'ticket', entityId: id, metadata: {}, ip: ctx.ip });
    return { generated: true };
  }

  /** Reveal the plaintext code (the reveal gate). Audited every time; the code is never written to the audit row. */
  async revealCode(ctx: AdminCtx, ticketId: string): Promise<{ code: string }> {
    const id = reqId(ticketId);
    const t = await this.repo.ticket(id);
    if (!t) throw new TicketRemovalError('not_found', 'Ticket not found.');
    const row = await this.repo.codeRow(id);
    if (!row) throw new TicketRemovalError('invalid', 'No deletion code has been generated for this ticket.');
    const code = this.readCode(row.codeEnc);
    if (!code) throw new TicketRemovalError('invalid', 'The stored deletion code could not be read.');
    await this.repo.markRevealed(id, ctx.userId);
    await this.audit.record({ userId: ctx.userId, actionType: 'ticket_deletion_code_revealed', entityType: 'ticket', entityId: id, metadata: {}, ip: ctx.ip });
    return { code };
  }

  /** Verify the supplied code, then LOGICALLY remove the ticket. Financial/audit data is preserved (never destroyed). */
  async removeTicket(ctx: AdminCtx, ticketId: string, body: { code?: string; reason?: string }): Promise<{ removed: true }> {
    const id = reqId(ticketId);
    const reason = String(body?.reason ?? '').trim();
    if (!reason) throw new TicketRemovalError('invalid', 'A reason is required to remove a ticket.');
    const t = await this.repo.ticket(id);
    if (!t) throw new TicketRemovalError('not_found', 'Ticket not found.');
    if (t.removedAt) throw new TicketRemovalError('invalid', 'This ticket has already been removed.');
    const row = await this.repo.codeRow(id);
    if (!row) throw new TicketRemovalError('invalid', 'Generate the deletion authorization code first.');
    if (!verifyDeletionCode(String(body?.code ?? ''), this.readCode(row.codeEnc))) throw new TicketRemovalError('forbidden', 'The deletion authorization code is incorrect.');
    await this.repo.remove({ ticketId: id, tenantId: t.tenantId, byUserId: ctx.userId, reason: reason.slice(0, 280) });
    await this.audit.record({ userId: ctx.userId, actionType: 'ticket_removed', entityType: 'ticket', entityId: id, metadata: { reason: reason.slice(0, 280) }, ip: ctx.ip });
    return { removed: true };
  }
}
