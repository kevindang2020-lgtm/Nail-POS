// ai-governance.kysely.repository.ts — Postgres AiGovernanceRepo. Upsert on (tenant_id, assistant_key). Tenant-scoped.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { AiGovernanceRepo, ModeRow } from './ai-governance.repository';
import type { ControlMode } from './ai-governance.dto';

export class KyselyAiGovernanceRepo implements AiGovernanceRepo {
  constructor(private readonly db: Kysely<DB>) {}
  async list(tenantId: string): Promise<ModeRow[]> {
    const rows: any[] = await this.db.selectFrom('ai_control_modes').where('tenant_id', '=', tenantId)
      .select(['assistant_key', 'mode', 'updated_by_user_id', 'updated_at']).execute().catch(() => []);
    return rows.map((x) => ({ assistantKey: x.assistant_key, mode: x.mode as ControlMode, updatedByUserId: x.updated_by_user_id,
      updatedAt: typeof x.updated_at === 'string' ? x.updated_at : (x.updated_at ? new Date(x.updated_at).toISOString() : null) }));
  }
  async set(tenantId: string, assistantKey: string, mode: ControlMode, userId: string | null): Promise<void> {
    await sql`
      insert into ai_control_modes (tenant_id, assistant_key, mode, updated_by_user_id, updated_at)
      values (${tenantId}, ${assistantKey}, ${mode}, ${userId}, now())
      on conflict (tenant_id, assistant_key) do update set mode = excluded.mode, updated_by_user_id = excluded.updated_by_user_id, updated_at = now()
    `.execute(this.db as any);
  }
}
