/**
 * compensation-classification.repository.ts — stores the owner-set worker classification per technician (spec §18,
 * table technician_classifications). One row per technician, upserted on change. Never auto-derived.
 */
import type { ClassificationRow } from '@aipowersalon/api-contracts/tenant';
export type { ClassificationRow };   // owned by packages/api-contracts (Constitution 13 §13)
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { WorkerClassification } from './compensation-compliance';

export interface ClassificationCtx { tenantId: string; userId?: string | null }

const CLASSES: WorkerClassification[] = ['employee', 'contractor', 'booth_renter'];
export function normalizeClassification(v: any): WorkerClassification | null { return CLASSES.includes(v) ? v : null; }

const iso = (v: any): string => (v instanceof Date ? v.toISOString() : String(v));
const mapRow = (r: any): ClassificationRow => ({ technicianId: r.technician_id, classification: r.classification, updatedAt: iso(r.updated_at) });

export interface ClassificationRepo {
  list(ctx: ClassificationCtx): Promise<ClassificationRow[]>;
  get(ctx: ClassificationCtx, technicianId: string): Promise<WorkerClassification | null>;
  set(ctx: ClassificationCtx, technicianId: string, classification: WorkerClassification): Promise<ClassificationRow>;
}

export class KyselyClassificationRepo implements ClassificationRepo {
  constructor(private readonly db: Kysely<DB>) {}
  async list(ctx: ClassificationCtx): Promise<ClassificationRow[]> {
    const rows = await this.db.selectFrom('technician_classifications').selectAll().where('tenant_id', '=', ctx.tenantId).orderBy('updated_at', 'desc').execute().catch(() => [] as any[]);
    return rows.map(mapRow);
  }
  async get(ctx: ClassificationCtx, technicianId: string): Promise<WorkerClassification | null> {
    const r: any = await this.db.selectFrom('technician_classifications').select(['classification']).where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', technicianId).executeTakeFirst().catch(() => null);
    return r ? normalizeClassification(r.classification) : null;
  }
  async set(ctx: ClassificationCtx, technicianId: string, classification: WorkerClassification): Promise<ClassificationRow> {
    const r: any = await this.db.insertInto('technician_classifications')
      .values({ tenant_id: ctx.tenantId, technician_id: technicianId, classification, set_by: ctx.userId ?? null })
      .onConflict((oc) => oc.columns(['tenant_id', 'technician_id']).doUpdateSet({ classification, set_by: ctx.userId ?? null, updated_at: sql`now()` }))
      .returningAll().executeTakeFirstOrThrow();
    return mapRow(r);
  }
}

export class InMemoryClassificationRepo implements ClassificationRepo {
  private rows = new Map<string, any>();
  private key(t: string, tech: string) { return `${t}:${tech}`; }
  async list(ctx: ClassificationCtx): Promise<ClassificationRow[]> { return [...this.rows.values()].filter((r) => r.tenant_id === ctx.tenantId).map(mapRow); }
  async get(ctx: ClassificationCtx, technicianId: string): Promise<WorkerClassification | null> { const r = this.rows.get(this.key(ctx.tenantId, technicianId)); return r ? normalizeClassification(r.classification) : null; }
  async set(ctx: ClassificationCtx, technicianId: string, classification: WorkerClassification): Promise<ClassificationRow> {
    const r = { tenant_id: ctx.tenantId, technician_id: technicianId, classification, updated_at: new Date().toISOString() };
    this.rows.set(this.key(ctx.tenantId, technicianId), r); return mapRow(r);
  }
}
