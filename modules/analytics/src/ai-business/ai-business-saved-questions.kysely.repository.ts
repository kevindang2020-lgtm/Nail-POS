// ai-business-saved-questions.kysely.repository.ts — Postgres adapter. Tenant + user scoping is server-derived from
// ctx. List returns the caller's own rows plus tenant-shared rows; delete only affects the caller's own rows.
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { AiBusinessIntent } from './ai-business-intents';
import type {
  SavedQuestion, SavedQuestionContext, CreateSavedQuestionInput, SavedQuestionsRepositoryPort, SharingScope,
} from './ai-business-saved-questions.repository';

function toDomain(r: any, userId: string): SavedQuestion {
  return {
    id: String(r.id), title: String(r.title), intent: String(r.intent) as AiBusinessIntent,
    preset: r.preset == null ? null : String(r.preset),
    comparePreset: r.compare_preset == null ? null : String(r.compare_preset),
    question: r.question == null ? null : String(r.question),
    sharingScope: String(r.sharing_scope) as SharingScope,
    ownedByMe: String(r.user_id) === userId,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : '',
    lastUsedAt: r.last_used_at ? new Date(r.last_used_at).toISOString() : null,
  };
}

const COLS = ['id', 'user_id', 'title', 'intent', 'preset', 'compare_preset', 'question', 'sharing_scope', 'created_at', 'last_used_at'] as const;

export class KyselySavedQuestionsRepository implements SavedQuestionsRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}

  async list(ctx: SavedQuestionContext): Promise<SavedQuestion[]> {
    const rows = await this.db.selectFrom('ai_business_saved_questions')
      .where('tenant_id', '=', ctx.tenantId)
      .where((eb: any) => eb.or([eb('user_id', '=', ctx.userId), eb('sharing_scope', '=', 'tenant')]))
      .select(COLS as any).orderBy('created_at', 'desc').limit(500).execute().catch(() => [] as any[]);
    return (rows as any[]).map((r) => toDomain(r, ctx.userId));
  }

  async create(ctx: SavedQuestionContext, input: CreateSavedQuestionInput & { intent: AiBusinessIntent }): Promise<SavedQuestion> {
    const row = await this.db.insertInto('ai_business_saved_questions').values({
      tenant_id: ctx.tenantId, user_id: ctx.userId, title: input.title, intent: input.intent,
      preset: input.preset ?? null, compare_preset: input.comparePreset ?? null, question: input.question ?? null,
      sharing_scope: input.sharingScope ?? 'private',
    } as any).returning(COLS as any).executeTakeFirstOrThrow();
    return toDomain(row, ctx.userId);
  }

  async remove(ctx: SavedQuestionContext, id: string): Promise<boolean> {
    const res = await this.db.deleteFrom('ai_business_saved_questions')
      .where('id', '=', id as any).where('tenant_id', '=', ctx.tenantId).where('user_id', '=', ctx.userId)
      .executeTakeFirst().catch(() => null);
    return !!res && Number((res as any).numDeletedRows ?? 0) > 0;
  }

  async touch(ctx: SavedQuestionContext, id: string): Promise<SavedQuestion | null> {
    const row = await this.db.updateTable('ai_business_saved_questions')
      .set({ last_used_at: new Date() } as any)
      .where('id', '=', id as any).where('tenant_id', '=', ctx.tenantId)
      .where((eb: any) => eb.or([eb('user_id', '=', ctx.userId), eb('sharing_scope', '=', 'tenant')]))
      .returning(COLS as any).executeTakeFirst().catch(() => null);
    return row ? toDomain(row, ctx.userId) : null;
  }
}
