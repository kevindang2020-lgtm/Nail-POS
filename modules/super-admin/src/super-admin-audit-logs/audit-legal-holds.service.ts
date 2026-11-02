// audit-legal-holds.service.ts — Place Logs Under Legal Hold + release (§ "Place logs under legal hold"). Placing a
// hold requires a reason and a scope; it protects the matching slice of audit_events from retention purges WITHOUT
// altering any log row. Releasing requires its own reason and is audited at warning severity. protectedCount reports
// how many current events a hold would protect — proving holds cover a slice, not that they mutate anything.
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import { AuditLegalHoldsRepository, type LegalHoldRow } from './audit-legal-holds.kysely.repository';
import { holdCovers } from './audit-logs-core';

export interface AdminCtx { userId?: string; email?: string; ip?: string }
const SCOPES = ['global', 'tenant', 'user', 'action', 'date_range'];
const validUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const shape = (r: LegalHoldRow) => ({ id: r.id, holdRef: r.hold_ref, scopeType: r.scope_type, scopeValue: r.scope_value, reason: r.reason, legalAuthority: r.legal_authority, status: r.status, createdAt: r.created_at, reviewDate: r.review_date, expirationDate: r.expiration_date, releasedAt: r.released_at, releaseReason: r.release_reason });

export class AuditLegalHoldsService {
  constructor(private readonly repo: AuditLegalHoldsRepository, private readonly db: AppDatabase) {}

  async list(status?: string) { return { holds: (await this.repo.list(status)).map(shape) }; }

  async place(ctx: AdminCtx, body: any) {
    const scopeType = String(body?.scopeType ?? '');
    if (!SCOPES.includes(scopeType)) throw new BadRequestException('invalid scopeType');
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 3) throw new BadRequestException('a reason is required to place a legal hold');
    let scopeValue: string | null = typeof body?.scopeValue === 'string' ? body.scopeValue.trim() : null;
    if (scopeType === 'global') scopeValue = null;
    else if (!scopeValue) throw new BadRequestException(`scopeValue is required for a ${scopeType} hold`);
    const legalAuthority = typeof body?.legalAuthority === 'string' && body.legalAuthority.trim() ? body.legalAuthority.trim() : null;
    const holdRef = `LH-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const row = await this.repo.insert({ holdRef, scopeType, scopeValue, reason, legalAuthority, createdBy: ctx.userId && validUuid(ctx.userId) ? ctx.userId : null, reviewDate: body?.reviewDate || null, expirationDate: body?.expirationDate || null });
    const protectedCount = await this.protectedCount(shape(row));
    const tenantForAudit = scopeType === 'tenant' && scopeValue && validUuid(scopeValue) ? scopeValue : null;
    await this.repo.writeAudit(tenantForAudit, ctx, 'legal_hold_placed', `Legal hold ${holdRef} placed (${scopeType}${scopeValue ? ':' + scopeValue : ''})`, 'warning', { holdRef, scopeType, scopeValue, reason });
    return { ok: true, hold: shape(row), protectedCount };
  }

  async release(ctx: AdminCtx, id: string, body: any) {
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 3) throw new BadRequestException('a reason is required to release a legal hold');
    const existing = await this.repo.get(id);
    if (!existing) throw new NotFoundException('hold not found');
    if (existing.status !== 'active') throw new BadRequestException('only active holds can be released');
    await this.repo.release(id, ctx.userId && validUuid(ctx.userId) ? ctx.userId : null, reason);
    const after = await this.repo.get(id);
    const tenantForAudit = existing.scope_type === 'tenant' && existing.scope_value && validUuid(existing.scope_value) ? existing.scope_value : null;
    await this.repo.writeAudit(tenantForAudit, ctx, 'legal_hold_released', `Legal hold ${existing.hold_ref} released: ${reason}`, 'warning', { holdRef: existing.hold_ref, reason });
    return { ok: true, hold: after ? shape(after) : null };
  }

  /** How many CURRENT audit events this hold protects from purge (coverage check; reads only, mutates nothing). */
  private async protectedCount(hold: { status: string; scopeType: string; scopeValue: string | null }): Promise<number> {
    let events: { tenantId: string | null; actorUserId: string | null; action: string | null; occurredAt: string }[] = [];
    try {
      const rows = (await sql`select tenant_id::text as tenant_id, actor_user_id::text as actor_user_id, action, occurred_at::text as occurred_at from audit_events limit 5000`.execute(this.db as any)).rows as any[];
      events = rows.map((r) => ({ tenantId: r.tenant_id, actorUserId: r.actor_user_id, action: r.action, occurredAt: r.occurred_at }));
    } catch { return 0; }
    return events.filter((e) => holdCovers({ status: hold.status, scopeType: hold.scopeType, scopeValue: hold.scopeValue }, e)).length;
  }
}
