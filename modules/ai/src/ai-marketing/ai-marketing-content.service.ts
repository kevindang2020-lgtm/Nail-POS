// ai-marketing-content.service.ts — draft generation. REUSES the existing AI provider layer (AiGatewayService
// → Mock/OpenAI/Anthropic/Gemini) through a thin port; it does not add a second AI client. It generates an
// EDITABLE DRAFT only — it never sends, never persists a campaign, and never invents an offer. The model's
// output is always run through validateDraft() before it is returned.
import {
  buildPrompt, buildPromptVariables,
  validateDraft,
  validateDraftRequest,
  ContentValidationError,
  type DraftValidation,
} from './ai-marketing-content';
import type { AiMarketingContext } from './ai-marketing.dto';

// Minimal completion port. Tests inject a deterministic fake.
//
// It now carries `tenantId` / `userId`, and that is not cosmetic: this port used to be bound straight to
// AiGatewayService, which calls the model with NO subscription check and NO usage row — a tenant whose $59/mo
// Marketing package had lapsed could keep generating drafts for free, invisibly. The port is bound to
// GatedAiCompletion instead (ai/ai-gated-completion.ts), and a gate needs to know WHO is asking.
//
// Constitution 10 Phase 23 completes that move: the port is now AiPlatform.execute('marketing.content_draft'),
// so entitlement, routing, prompt versioning, schema validation and usage all happen in one place.
/** §18: the narrow slice of the AI Platform this module uses. ai-marketing.module binds it to AiPlatform. */
export interface AiMarketingDraftPort {
  draft(req: { tenantId: string; userId: string | null; variables: Record<string, string> }): Promise<{ subject: string | null; message: string; usage: { inputTokens: number; outputTokens: number; provider: string; model: string } } | null>;
}

export class ContentForbiddenError extends Error {}

export interface ContentDraft {
  channel: 'sms' | 'email' | 'push';
  text: string; // raw model text (for push/email the first line is title/subject by convention)
  validation: DraftValidation;
  usage: { inputTokens: number; outputTokens: number; provider: string; model: string };
  hasApprovedOffer: boolean;
  generatedAt: string;
}

const VIEW_PERMISSION = 'pos.marketing.view';

/** Rebuild the exact text validateDraft() has always received, from the validated {subject, message}. */
export function composeChannelText(channel: string, out: { subject: string | null; message: string } | null): string {
  if (!out) return '';
  if (channel === 'email') return out.subject ? `${out.subject}\n\n${out.message}` : out.message;
  if (channel === 'push') return out.subject ? `${out.subject}\n${out.message}` : out.message;
  return out.message;   // sms
}

export class AiMarketingContentService {
  constructor(private readonly gateway: AiMarketingDraftPort) {}

  async generateDraft(ctx: AiMarketingContext, raw: unknown): Promise<ContentDraft> {
    if (!ctx || !ctx.tenantId) throw new ContentValidationError('Missing tenant context');
    this.assertCanView(ctx);

    const req = validateDraftRequest(raw); // throws ContentValidationError on bad input
    // Constitution 10 Phase 23: the registered marketing.content_draft prompt version carries the invariant
    // rules; buildPromptVariables supplies the per-request ones. The platform validates the reply against
    // marketing.content.v1 ({subject, message}) — but validateDraft has always checked the COMPOSED channel
    // text, so we rebuild exactly the string it expects. Changing what validateDraft sees would silently
    // weaken every rule it enforces (invented offers, unknown tokens, raw URLs, opt-out wording, length).
    const out = await this.gateway.draft({ tenantId: ctx.tenantId, userId: ctx.userId ?? null, variables: buildPromptVariables(req) });
    const text = composeChannelText(req.channel, out).trim();
    const validation = validateDraft(req.channel, text, req.offer != null);

    return {
      channel: req.channel,
      text,
      validation,
      usage: out?.usage ?? { inputTokens: 0, outputTokens: 0, provider: 'none', model: 'none' },
      hasApprovedOffer: req.offer != null,
      generatedAt: new Date().toISOString(),
    };
  }

  private assertCanView(ctx: AiMarketingContext): void {
    const perms = ctx.permissions || [];
    const ok =
      perms.indexOf(VIEW_PERMISSION) >= 0 ||
      perms.indexOf('marketing.view') >= 0 ||
      perms.indexOf('marketing.manage') >= 0;
    if (!ok) throw new ContentForbiddenError('Insufficient permission for AI Marketing content');
  }
}
