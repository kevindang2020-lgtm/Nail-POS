// ai-prompt-store.kysely.ts — the PromptStore over ai_prompt_versions (migration 436).
//
// Reads are the seed UNION the table: a version row in the database overrides the in-code seed for the same
// (promptKey, version), and higher database versions extend it. That way a fresh database serves the seed
// immediately (§270 local testing) and a Super Admin's later versions take precedence without a redeploy.
// Writes touch only lifecycle columns; the trigger in 436 refuses anything else (§22).
import type { Kysely } from 'kysely';
import { assertTransition, canMoveToSql, InvalidStateTransitionError, type DB } from '@aipowersalon/database';
import { AI_PROMPT_VERSION } from '../ai-lifecycles';
import { PROMPT_SEED, type PromptStore, type PromptVersion, type PromptStatus } from './ai-prompt-registry';

export class KyselyPromptStore implements PromptStore {
  constructor(private readonly db: Kysely<DB>) {}

  async versionsFor(promptKey: string): Promise<PromptVersion[]> {
    const rows = await this.db.selectFrom('ai_prompt_versions').selectAll().where('prompt_key', '=', promptKey).execute();
    const byVersion = new Map<number, PromptVersion>();
    for (const s of PROMPT_SEED) if (s.promptKey === promptKey) byVersion.set(s.version, { ...s });
    for (const r of rows) byVersion.set(r.version, {
      promptKey: r.prompt_key, module: r.module, taskKey: r.task_key, version: r.version, systemInstructions: r.system_instructions, template: r.template,
      variables: (r.variables as PromptVersion['variables']) ?? [], outputSchemaKey: r.output_schema_key, languageBehavior: r.language_behavior as PromptVersion['languageBehavior'],
      status: r.status as PromptStatus, rolloutTenantIds: r.rollout_tenant_ids ?? [], rolloutPercent: r.rollout_percent, createdBy: r.created_by_user_id, approvedBy: r.approved_by_user_id, contentSha256: r.content_sha256,
    });
    return [...byVersion.values()];
  }

  async setStatus(promptKey: string, version: number, status: PromptStatus): Promise<void> {
    const cur = await this.db.selectFrom('ai_prompt_versions').select('status').where('prompt_key', '=', promptKey).where('version', '=', version).executeTakeFirst();
    if (cur) assertTransition(AI_PROMPT_VERSION, String(cur.status), status);   // Phase 12 (#27): the prompt lifecycle; the write stays conditional on it
    const updated = await this.db.updateTable('ai_prompt_versions').set({ status }).where('prompt_key', '=', promptKey).where('version', '=', version).where(canMoveToSql(AI_PROMPT_VERSION, status) as any).executeTakeFirst();
    if (cur && Number(updated.numUpdatedRows ?? 0) === 0) throw new InvalidStateTransitionError(AI_PROMPT_VERSION, String(cur.status), status, 'concurrent');
    if (Number(updated.numUpdatedRows ?? 0) === 0) {
      // A seed-only version has no row yet: materialise it so its lifecycle can be tracked. Content is copied verbatim.
      const seed = PROMPT_SEED.find((s) => s.promptKey === promptKey && s.version === version);
      if (!seed) throw new Error(`no ${promptKey} v${version}`);
      await this.db.insertInto('ai_prompt_versions').values({
        prompt_key: seed.promptKey, module: seed.module, task_key: seed.taskKey, version: seed.version, system_instructions: seed.systemInstructions, template: seed.template,
        variables: JSON.stringify(seed.variables) as never, output_schema_key: seed.outputSchemaKey, language_behavior: seed.languageBehavior, status,
        rollout_tenant_ids: seed.rolloutTenantIds, rollout_percent: seed.rolloutPercent, content_sha256: seed.contentSha256, created_by_user_id: null, approved_by_user_id: null,
      }).execute();
    }
  }

  async recordRollback(r: { promptKey: string; fromVersion: number; toVersion: number; reason: string; actorUserId: string }): Promise<void> {
    await this.db.insertInto('ai_prompt_rollbacks').values({ prompt_key: r.promptKey, from_version: r.fromVersion, to_version: r.toVersion, reason: r.reason, actor_user_id: r.actorUserId }).execute();
  }
}
