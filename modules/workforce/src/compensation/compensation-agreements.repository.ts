/**
 * compensation-agreements.repository.ts — persistence for technician compensation agreements (spec §19, table
 * compensation_agreements). Create supersedes the technician's prior agreement (versioned history); acknowledge records
 * the technician's sign-off. terms_json is a free-form snapshot of what was agreed.
 */
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { canMoveToSql } from '@aipowersalon/database';
import { COMPENSATION_AGREEMENT } from '../workforce-lifecycles';

export interface AgreementCtx { tenantId: string; userId?: string | null }
export interface AgreementInput { technicianId: string; title: string; terms: Record<string, unknown>; effectiveStart?: string | null }
export interface AgreementRow {
  id: string; technicianId: string; title: string; terms: Record<string, unknown>; status: string; version: number;
  effectiveStart: string; createdAt: string; acknowledgedAt: string | null; acknowledgedBy: string | null;
}

const parseTerms = (raw: any): Record<string, unknown> => { try { const v = typeof raw === 'string' ? JSON.parse(raw) : raw; return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
const iso = (v: any): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const mapRow = (r: any): AgreementRow => ({
  id: r.id, technicianId: r.technician_id, title: r.title, terms: parseTerms(r.terms_json), status: r.status,
  version: Number(r.version ?? 1), effectiveStart: iso(r.effective_start)!, createdAt: iso(r.created_at)!,
  acknowledgedAt: iso(r.acknowledged_at), acknowledgedBy: r.acknowledged_by ?? null,
});

export interface AgreementsRepo {
  list(ctx: AgreementCtx, technicianId?: string): Promise<AgreementRow[]>;
  get(ctx: AgreementCtx, id: string): Promise<AgreementRow | null>;
  create(ctx: AgreementCtx, input: AgreementInput): Promise<AgreementRow>;
  acknowledge(ctx: AgreementCtx, id: string, technicianId: string, byUserId: string | null): Promise<AgreementRow | null>;
  /** the active technician id owned by a user account, for tech-facing calls (null if none). */
  resolveTechnicianIdForUser(tenantId: string, userId: string | null | undefined): Promise<string | null>;
}

export class KyselyAgreementsRepo implements AgreementsRepo {
  constructor(private readonly db: Kysely<DB>) {}
  async list(ctx: AgreementCtx, technicianId?: string): Promise<AgreementRow[]> {
    let q = this.db.selectFrom('compensation_agreements').selectAll().where('tenant_id', '=', ctx.tenantId);
    if (technicianId) q = q.where('technician_id', '=', technicianId);
    const rows = await q.orderBy('created_at', 'desc').execute().catch(() => [] as any[]);
    return (rows as any[]).map(mapRow);
  }
  async get(ctx: AgreementCtx, id: string): Promise<AgreementRow | null> {
    const r: any = await this.db.selectFrom('compensation_agreements').selectAll().where('tenant_id', '=', ctx.tenantId).where('id', '=', id).executeTakeFirst().catch(() => null);
    return r ? mapRow(r) : null;
  }
  async create(ctx: AgreementCtx, input: AgreementInput): Promise<AgreementRow> {
    return this.db.transaction().execute(async (trx) => {
      const mx: any = await trx.selectFrom('compensation_agreements').select((eb) => eb.fn.max('version').as('m')).where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', input.technicianId).executeTakeFirst();
      const version = Number(mx?.m ?? 0) + 1;
      await trx.updateTable('compensation_agreements').set({ status: 'superseded' } as any).where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', input.technicianId).where(canMoveToSql(COMPENSATION_AGREEMENT, 'superseded') as any).execute();
      const r: any = await trx.insertInto('compensation_agreements').values({
        tenant_id: ctx.tenantId, technician_id: input.technicianId, title: input.title,
        terms_json: sql`${JSON.stringify(input.terms || {})}::jsonb`, status: 'sent', version,
        effective_start: (input.effectiveStart ?? undefined) as any, created_by: ctx.userId ?? null,
      } as any).returningAll().executeTakeFirstOrThrow();
      return mapRow(r);
    });
  }
  async acknowledge(ctx: AgreementCtx, id: string, technicianId: string, byUserId: string | null): Promise<AgreementRow | null> {
    const r: any = await this.db.updateTable('compensation_agreements')
      .set({ status: 'acknowledged', acknowledged_at: sql`now()`, acknowledged_by: byUserId ?? null } as any)
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', id).where('technician_id', '=', technicianId).where('status', '=', 'sent').where(canMoveToSql(COMPENSATION_AGREEMENT, 'acknowledged') as any)
      .returningAll().executeTakeFirst().catch(() => null);
    return r ? mapRow(r) : null;
  }
  async resolveTechnicianIdForUser(tenantId: string, userId: string | null | undefined): Promise<string | null> {
    if (!userId) return null;
    const r: any = await this.db.selectFrom('technicians').select('id').where('tenant_id', '=', tenantId).where('user_id', '=', userId).where('is_active', '=', true).executeTakeFirst().catch(() => null);
    return r?.id ?? null;
  }
}

export class InMemoryAgreementsRepo implements AgreementsRepo {
  private rows: any[] = [];
  private seq = 0;
  private userTech = new Map<string, string>();
  setUserTechnician(userId: string, technicianId: string) { this.userTech.set(userId, technicianId); }
  async resolveTechnicianIdForUser(_tenantId: string, userId: string | null | undefined): Promise<string | null> { return userId ? this.userTech.get(userId) ?? null : null; }
  async list(ctx: AgreementCtx, technicianId?: string): Promise<AgreementRow[]> { return this.rows.filter((r) => r.tenant_id === ctx.tenantId && (!technicianId || r.technician_id === technicianId)).map(mapRow); }
  async get(ctx: AgreementCtx, id: string): Promise<AgreementRow | null> { const r = this.rows.find((x) => x.tenant_id === ctx.tenantId && x.id === id); return r ? mapRow(r) : null; }
  async create(ctx: AgreementCtx, input: AgreementInput): Promise<AgreementRow> {
    const prior = this.rows.filter((r) => r.tenant_id === ctx.tenantId && r.technician_id === input.technicianId);
    for (const p of prior) if (['draft', 'sent', 'acknowledged'].includes(p.status)) p.status = 'superseded';
    const version = prior.reduce((m, p) => Math.max(m, p.version || 0), 0) + 1;
    const r = { id: 'ag_' + (++this.seq), tenant_id: ctx.tenantId, technician_id: input.technicianId, title: input.title, terms_json: input.terms || {}, status: 'sent', version, effective_start: input.effectiveStart ?? new Date().toISOString(), created_at: new Date().toISOString(), acknowledged_at: null, acknowledged_by: null };
    this.rows.push(r); return mapRow(r);
  }
  async acknowledge(ctx: AgreementCtx, id: string, technicianId: string, byUserId: string | null): Promise<AgreementRow | null> {
    const r = this.rows.find((x) => x.tenant_id === ctx.tenantId && x.id === id && x.technician_id === technicianId && x.status === 'sent');
    if (!r) return null; r.status = 'acknowledged'; r.acknowledged_at = new Date().toISOString(); r.acknowledged_by = byUserId ?? null; return mapRow(r);
  }
}
