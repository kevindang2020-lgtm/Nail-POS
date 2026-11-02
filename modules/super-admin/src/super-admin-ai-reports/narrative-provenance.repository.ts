// Repository port for model/prompt versions + narrative provenance (port + in-memory + Kysely).
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import { canMoveToSql } from '@aipowersalon/database';
import { AI_NARRATIVE_MODEL_VERSION } from '../lifecycles';

export interface ModelVersionRow { id: string; modelName: string; promptVersion: string; promptHash: string; status: string; notes: string | null; createdAt: string | null }
export interface NarrativeRow { id: string; runId: string; templateId: string | null; templateVersion: number | null; modelVersionId: string | null; allGrounded: boolean; groundingOk: boolean; offendingCount: number; createdAt: string | null }
export interface InsertModelVersionInput { modelName: string; promptVersion: string; promptHash: string; notes: string | null }
export interface InsertNarrativeInput { runId: string; templateId: string | null; templateVersion: number | null; modelVersionId: string | null; allGrounded: boolean; groundingOk: boolean; offendingCount: number }

export interface NarrativeProvenanceRepositoryPort {
  insertModelVersion(i: InsertModelVersionInput): Promise<ModelVersionRow>;
  getModelVersion(id: string): Promise<ModelVersionRow | null>;
  listModelVersions(): Promise<ModelVersionRow[]>;
  setModelVersionStatus(id: string, status: string): Promise<ModelVersionRow | null>;
  retireOtherActive(modelName: string, exceptId: string): Promise<void>;
  insertNarrative(i: InsertNarrativeInput): Promise<NarrativeRow>;
  getNarrativeByRun(runId: string): Promise<NarrativeRow | null>;
}

export class InMemoryNarrativeProvenanceRepository implements NarrativeProvenanceRepositoryPort {
  versions: ModelVersionRow[] = []; narratives: NarrativeRow[] = [];
  private vs = 1; private ns = 1;
  async insertModelVersion(i: InsertModelVersionInput) { const row: ModelVersionRow = { id: `mv${this.vs++}`, modelName: i.modelName, promptVersion: i.promptVersion, promptHash: i.promptHash, status: 'draft', notes: i.notes, createdAt: new Date().toISOString() }; this.versions.push(row); return row; }
  async getModelVersion(id: string) { return this.versions.find((v) => v.id === id) || null; }
  async listModelVersions() { return this.versions; }
  async setModelVersionStatus(id: string, status: string) { const v = this.versions.find((x) => x.id === id); if (!v) return null; v.status = status; return v; }
  async retireOtherActive(modelName: string, exceptId: string) { for (const v of this.versions) if (v.modelName === modelName && v.id !== exceptId && v.status === 'active') v.status = 'retired'; }
  async insertNarrative(i: InsertNarrativeInput) { const existing = this.narratives.find((n) => n.runId === i.runId); if (existing) return existing; const row: NarrativeRow = { id: `nr${this.ns++}`, ...i, createdAt: new Date().toISOString() }; this.narratives.push(row); return row; }
  async getNarrativeByRun(runId: string) { return this.narratives.find((n) => n.runId === runId) || null; }
}

const iso = (v: unknown) => { if (!v) return null; try { return new Date(v as any).toISOString(); } catch { return null; } };
const mapV = (r: any): ModelVersionRow => ({ id: String(r.id), modelName: r.model_name, promptVersion: r.prompt_version, promptHash: r.prompt_hash, status: r.status, notes: r.notes ?? null, createdAt: iso(r.created_at) });
const mapN = (r: any): NarrativeRow => ({ id: String(r.id), runId: String(r.run_id), templateId: r.template_id ? String(r.template_id) : null, templateVersion: r.template_version == null ? null : Number(r.template_version), modelVersionId: r.model_version_id ? String(r.model_version_id) : null, allGrounded: r.all_grounded === true, groundingOk: r.grounding_ok === true, offendingCount: Number(r.offending_count) || 0, createdAt: iso(r.created_at) });

export class KyselyNarrativeProvenanceRepository implements NarrativeProvenanceRepositoryPort {
  constructor(private readonly db: AppDatabase) {}
  async insertModelVersion(i: InsertModelVersionInput) { const r: any = await sql`insert into ai_narrative_model_versions (model_name, prompt_version, prompt_hash, status, notes) values (${i.modelName}, ${i.promptVersion}, ${i.promptHash}, 'draft', ${i.notes}) returning *`.execute(this.db as any).then((x) => x.rows[0]); return mapV(r); }
  async getModelVersion(id: string) { const r: any = await sql`select * from ai_narrative_model_versions where id = ${id} limit 1`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined); return r ? mapV(r) : null; }
  async listModelVersions() { const rows: any[] = await sql`select * from ai_narrative_model_versions order by created_at desc`.execute(this.db as any).then((x) => x.rows).catch(() => []); return rows.map(mapV); }
  async setModelVersionStatus(id: string, status: string) { const r: any = await sql`update ai_narrative_model_versions set status = ${status}, updated_at = now() where id = ${id} and ${canMoveToSql(AI_NARRATIVE_MODEL_VERSION, status)} returning *`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined); return r ? mapV(r) : null; }
  async retireOtherActive(modelName: string, exceptId: string) { await sql`update ai_narrative_model_versions set status = 'retired', updated_at = now() where model_name = ${modelName} and id <> ${exceptId} and status = 'active' and ${canMoveToSql(AI_NARRATIVE_MODEL_VERSION, 'retired')}`.execute(this.db as any).catch(() => undefined); }
  async insertNarrative(i: InsertNarrativeInput) { const r: any = await sql`insert into ai_report_narratives (run_id, template_id, template_version, model_version_id, all_grounded, grounding_ok, offending_count) values (${i.runId}, ${i.templateId}, ${i.templateVersion}, ${i.modelVersionId}, ${i.allGrounded}, ${i.groundingOk}, ${i.offendingCount}) on conflict (run_id) do update set updated_at = now() returning *`.execute(this.db as any).then((x) => x.rows[0]); return mapN(r); }
  async getNarrativeByRun(runId: string) { const r: any = await sql`select * from ai_report_narratives where run_id = ${runId} limit 1`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined); return r ? mapN(r) : null; }
}
