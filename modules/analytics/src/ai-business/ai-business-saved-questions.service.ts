// ai-business-saved-questions.service.ts — CRUD for saved questions (§35). Validates the bounded intent, requires a
// title, and delegates persistence to the repo (in-memory or Kysely). Tenant + user come only from the trusted ctx.
import { AiBusinessError, AiBusinessErrorCode, AiBusinessForbiddenError, type AiBusinessContext } from './ai-business.dto';
import { isIntent } from './ai-business-intents';
import type {
  SavedQuestion, SavedQuestionsRepositoryPort, CreateSavedQuestionInput, SharingScope,
} from './ai-business-saved-questions.repository';

const MAX_TITLE = 120;

export class AiBusinessSavedQuestionsService {
  constructor(private readonly repo: SavedQuestionsRepositoryPort) {}

  private sctx(ctx: AiBusinessContext) {
    if (!ctx?.tenantId || !ctx?.userId) throw new AiBusinessForbiddenError('Not authenticated');
    return { tenantId: ctx.tenantId, userId: ctx.userId };
  }

  list(ctx: AiBusinessContext): Promise<SavedQuestion[]> {
    return this.repo.list(this.sctx(ctx));
  }

  create(ctx: AiBusinessContext, input: CreateSavedQuestionInput): Promise<SavedQuestion> {
    const s = this.sctx(ctx);
    const title = (input?.title ?? '').trim();
    if (!title) throw new AiBusinessError(AiBusinessErrorCode.INVALID_DATE_RANGE, 'A title is required');
    if (title.length > MAX_TITLE) throw new AiBusinessError(AiBusinessErrorCode.INVALID_DATE_RANGE, 'Title is too long');
    if (!isIntent(input?.intent)) throw new AiBusinessError(AiBusinessErrorCode.METRIC_NOT_FOUND, 'Unknown assistant intent');
    const sharingScope: SharingScope = input.sharingScope === 'tenant' ? 'tenant' : 'private';
    return this.repo.create(s, {
      title, intent: input.intent, preset: input.preset ?? null, comparePreset: input.comparePreset ?? null,
      question: (input.question ?? null) as string | null, sharingScope,
    });
  }

  async remove(ctx: AiBusinessContext, id: string): Promise<{ deleted: boolean }> {
    const deleted = await this.repo.remove(this.sctx(ctx), id);
    if (!deleted) throw new AiBusinessError(AiBusinessErrorCode.METRIC_NOT_FOUND, 'Saved question not found');
    return { deleted: true };
  }

  async touch(ctx: AiBusinessContext, id: string): Promise<SavedQuestion> {
    const row = await this.repo.touch(this.sctx(ctx), id);
    if (!row) throw new AiBusinessError(AiBusinessErrorCode.METRIC_NOT_FOUND, 'Saved question not found');
    return row;
  }
}
