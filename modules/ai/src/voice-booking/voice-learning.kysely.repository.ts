// voice-learning.kysely.repository.ts — production persistence for the improvement loop over the 300 migration.
// The partial unique index uq_voice_prompt_active is the DB backstop for "one active version per (tenant, scope)";
// the service archives the prior active before activating the next, so the index is never violated.
import { sql, type Kysely } from 'kysely';
import type { LearningRepo, Suggestion, PromptVersion } from './voice-learning.service';
import type { PromptStatus } from './voice-learning-core';

const ms = (v: any): number => (v == null ? Date.now() : new Date(v).getTime());
const msn = (v: any): number | null => (v == null ? null : new Date(v).getTime());

function toSug(r: any): Suggestion {
  return { id: r.id, tenantId: r.tenant_id, sourceCallId: r.source_call_id ?? null, category: r.category, targetType: r.target_type, detail: r.detail, status: r.status, reviewedBy: r.reviewed_by ?? null, resultingVersionId: r.resulting_version_id ?? null, createdMs: ms(r.created_at) };
}
function toVer(r: any): PromptVersion {
  return { id: r.id, tenantId: r.tenant_id, scope: r.scope, versionLabel: r.version_label, body: r.body, status: r.status, parentVersionId: r.parent_version_id ?? null, createdBy: r.created_by ?? null, approvedBy: r.approved_by ?? null, activatedMs: msn(r.activated_at), createdMs: ms(r.created_at) };
}

export class KyselyLearningRepo implements LearningRepo {
  constructor(private readonly db: Kysely<any>) {}

  async addSuggestion(s: any): Promise<Suggestion> {
    const r = (await sql`INSERT INTO voice_improvement_suggestions (tenant_id, source_call_id, category, target_type, detail, status, reviewed_by, resulting_version_id)
      VALUES (${s.tenantId}, ${s.sourceCallId}, ${s.category}, ${s.targetType}, ${s.detail}, ${s.status}, ${s.reviewedBy}, ${s.resultingVersionId}) RETURNING *`.execute(this.db)).rows[0];
    return toSug(r);
  }
  async getSuggestion(t: string, id: string): Promise<Suggestion | null> {
    const r = (await sql`SELECT * FROM voice_improvement_suggestions WHERE tenant_id=${t} AND id=${id} LIMIT 1`.execute(this.db)).rows[0];
    return r ? toSug(r) : null;
  }
  async updateSuggestion(t: string, id: string, p: any): Promise<Suggestion | null> {
    const r = (await sql`UPDATE voice_improvement_suggestions SET status=COALESCE(${p.status ?? null}, status), reviewed_by=COALESCE(${p.reviewedBy ?? null}, reviewed_by), resulting_version_id=COALESCE(${p.resultingVersionId ?? null}, resulting_version_id), updated_at=now() WHERE tenant_id=${t} AND id=${id} RETURNING *`.execute(this.db)).rows[0];
    return r ? toSug(r) : null;
  }
  async listSuggestions(t: string, status?: string): Promise<Suggestion[]> {
    const rows = status
      ? (await sql`SELECT * FROM voice_improvement_suggestions WHERE tenant_id=${t} AND status=${status} ORDER BY created_at DESC`.execute(this.db)).rows
      : (await sql`SELECT * FROM voice_improvement_suggestions WHERE tenant_id=${t} ORDER BY created_at DESC`.execute(this.db)).rows;
    return rows.map(toSug);
  }
  async addPromptVersion(v: any): Promise<PromptVersion> {
    const r = (await sql`INSERT INTO voice_prompt_versions (tenant_id, scope, version_label, body, status, parent_version_id, created_by, approved_by, activated_at)
      VALUES (${v.tenantId}, ${v.scope}, ${v.versionLabel}, ${v.body}, ${v.status}, ${v.parentVersionId}, ${v.createdBy}, ${v.approvedBy}, ${v.activatedMs ? new Date(v.activatedMs).toISOString() : null}) RETURNING *`.execute(this.db)).rows[0];
    return toVer(r);
  }
  async getPromptVersion(t: string, id: string): Promise<PromptVersion | null> {
    const r = (await sql`SELECT * FROM voice_prompt_versions WHERE tenant_id=${t} AND id=${id} LIMIT 1`.execute(this.db)).rows[0];
    return r ? toVer(r) : null;
  }
  async setPromptStatus(t: string, id: string, status: PromptStatus, p: any = {}): Promise<PromptVersion | null> {
    const r = (await sql`UPDATE voice_prompt_versions SET status=${status}, approved_by=COALESCE(${p.approvedBy ?? null}, approved_by), activated_at=${p.activatedMs ? new Date(p.activatedMs).toISOString() : null}, updated_at=now() WHERE tenant_id=${t} AND id=${id} RETURNING *`.execute(this.db)).rows[0];
    return r ? toVer(r) : null;
  }
  async getActive(t: string, scope: string): Promise<PromptVersion | null> {
    const r = (await sql`SELECT * FROM voice_prompt_versions WHERE tenant_id=${t} AND scope=${scope} AND status='active' LIMIT 1`.execute(this.db)).rows[0];
    return r ? toVer(r) : null;
  }
  async listPromptVersions(t: string, scope: string): Promise<PromptVersion[]> {
    const rows = (await sql`SELECT * FROM voice_prompt_versions WHERE tenant_id=${t} AND scope=${scope} ORDER BY created_at DESC`.execute(this.db)).rows;
    return rows.map(toVer);
  }
}
