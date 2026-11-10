// ai-center.service.ts — composes the AI Center overview from the repo's real signals + assembleOverview's honest
// projection. Scope is taken from the caller's session ctx by the controller and passed through unchanged.
import { assembleOverview, type AiCenterOverview } from './ai-center.dto';
import type { AiCenterRepo, AiCenterScope } from './ai-center.repository';

export interface AiCenterCtx { tenantId: string; branchId: string | null; userId?: string; role?: string; permissions?: string[]; }
export type AiCenterRange = AiCenterScope['range'];

export class AiCenterService {
  constructor(private readonly repo: AiCenterRepo, private readonly assistantsActive?: (scope: AiCenterScope) => Promise<number | null>) {}

  async overview(ctx: AiCenterCtx, range?: AiCenterRange): Promise<AiCenterOverview> {
    const scope: AiCenterScope = { tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, ...(range ? { range } : {}) };
    const raw = await this.repo.load(scope);
    if (raw.assistantsActive == null && this.assistantsActive) {
      try { raw.assistantsActive = await this.assistantsActive(scope); } catch { raw.assistantsActive = null; }
    }
    return { ...assembleOverview(raw), window: raw.window ?? null };
  }
}
