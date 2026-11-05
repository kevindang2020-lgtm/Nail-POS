/**
 * compensation-agreements.service.ts — §19 owner captures a technician's compensation terms as an agreement; the
 * technician later acknowledges it. Validates inputs; the store handles versioning/supersede. Recording only — it does
 * not change how pay is computed.
 */
import type { AgreementsRepo, AgreementCtx } from './compensation-agreements.repository';

export class AgreementsError extends Error {
  constructor(msg: string, public status = 400) { super(msg); this.name = 'AgreementsError'; }
}

export class AgreementsService {
  constructor(private readonly repo: AgreementsRepo) {}

  list(ctx: AgreementCtx, technicianId?: string) { return this.repo.list(ctx, technicianId); }

  async get(ctx: AgreementCtx, id: string) {
    const r = await this.repo.get(ctx, id);
    if (!r) throw new AgreementsError('Agreement not found', 404);
    return r;
  }

  async create(ctx: AgreementCtx, body: any) {
    if (!body?.technicianId) throw new AgreementsError('technicianId is required');
    if (!body?.title || !String(body.title).trim()) throw new AgreementsError('A title is required');
    const terms = body?.terms && typeof body.terms === 'object' ? (body.terms as Record<string, unknown>) : {};
    return this.repo.create(ctx, { technicianId: body.technicianId, title: String(body.title).trim(), terms, effectiveStart: body?.effectiveStart ?? null });
  }

  /** §19 technician sign-off. Only a 'sent' agreement for that technician can be acknowledged. */
  async acknowledge(ctx: AgreementCtx, id: string, technicianId: string) {
    if (!technicianId) throw new AgreementsError('technicianId is required');
    const r = await this.repo.acknowledge(ctx, id, technicianId, ctx.userId ?? null);
    if (!r) throw new AgreementsError('No matching agreement is awaiting your acknowledgment', 404);
    return r;
  }

  /** Tech-facing: the current user's own agreements (excludes superseded/draft), resolved from their account. */
  async listForUser(ctx: AgreementCtx, userId: string | null | undefined) {
    const technicianId = await this.repo.resolveTechnicianIdForUser(ctx.tenantId, userId);
    if (!technicianId) return [];
    return (await this.repo.list(ctx, technicianId)).filter((a) => a.status === 'sent' || a.status === 'acknowledged');
  }

  /** Tech-facing: acknowledge one of the current user's own agreements. */
  async acknowledgeAsUser(ctx: AgreementCtx, id: string, userId: string | null | undefined) {
    const technicianId = await this.repo.resolveTechnicianIdForUser(ctx.tenantId, userId);
    if (!technicianId) throw new AgreementsError('No technician profile is linked to this account', 403);
    return this.acknowledge(ctx, id, technicianId);
  }
}
