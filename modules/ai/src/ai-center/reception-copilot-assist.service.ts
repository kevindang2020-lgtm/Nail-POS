// reception-copilot-assist.service.ts — closes the remaining spec §1 Copilot capabilities that weren't built:
//   (1) display actions already completed by the AI Phone Receptionist  → recentAiPhoneActivity
//   (2) live-call takeover (display + handoff status; true telephony transfer is provider-gated) → recentAiPhoneActivity
//   (3) explain services and approved policies → explainService
//   (4) suggest waitlist / standby placement → recommendWaitlist (the queue "waiting" stage IS the waitlist)
//   (5) show safe recommended next actions → recommendNextActions
// All tenant/branch-scoped, advisory-only (no mutations — placement/booking still go through existing domain services),
// and reusing existing data/services rather than duplicating. Reads degrade to empty on a null DB.
import { Injectable, Inject, Optional } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { ServicesService } from '@aipowersalon/catalog';
import { ReceptionCopilotContextService, type CopilotCtx, type CopilotIntent } from './reception-copilot-context.service';
import { CopilotSettingsService } from './copilot-settings.service';
import { KyselyKnowledgeRetriever, type KnowledgeRetriever } from '../ai/ai-knowledge.kysely';   // Phase 14: §143–§150 retrieval
import { toPromptContext, type RetrievedContext } from '../ai/ai-knowledge';

const MAX_CALLS = 25;

export interface AiPhoneActivityItem {
  callId: string; startedAt: string | null; endedAt: string | null; durationSeconds: number | null;
  intents: string[]; bookingOutcome: string | null; handoffOutcome: string | null; summary: string | null;
  followUpRequired: boolean; handedOffToHuman: boolean;
}
export interface NextAction { action: string; label: string; reason: string }

@Injectable()
export class ReceptionCopilotAssistService {
  constructor(
    @Inject(DATABASE) private readonly db: AppDatabase | null,
    private readonly services: ServicesService,
    private readonly context: ReceptionCopilotContextService,
    @Optional() private readonly settings?: CopilotSettingsService,
  ) { this.knowledge = db ? new KyselyKnowledgeRetriever(db) : null; }
  /** BUILD_PLAN Phase 14: the salon's PUBLISHED knowledge (tenant + branch filtered in SQL before ranking). Replaceable in tests. */
  knowledge: KnowledgeRetriever | null;

  // Resolve a §47 toggle; defaults to allow when settings are unavailable (dev/offline or not injected).
  private async allowed(ctx: CopilotCtx, key: 'allowAiPhoneActivity' | 'allowExplainServices' | 'allowWaitlist'): Promise<boolean> {
    if (!this.settings) return true;
    const s = await this.settings.get({ tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions, branchId: ctx.branchId }).catch(() => null);
    return s ? s[key] !== false : true;
  }

  /** (1)(2) Recent AI Phone Receptionist calls for THIS tenant/branch — what the phone AI already did, incl. handoff
   * status. Displaying this is the Copilot's "take over" surface; initiating a live transfer is telephony-provider-gated
   * (Retell/Twilio) and is NOT faked here — handedOffToHuman reflects what the voice system actually recorded. */
  async recentAiPhoneActivity(ctx: CopilotCtx, opts: { limit?: number } = {}): Promise<{ available: boolean; calls: AiPhoneActivityItem[] }> {
    if (!(await this.allowed(ctx, 'allowAiPhoneActivity'))) return { available: false, calls: [] };
    if (!this.db) return { available: false, calls: [] };
    const limit = Math.min(MAX_CALLS, Math.max(1, opts.limit ?? 10));
    const branchFilter = ctx.branchId ? sql`AND branch_id = ${ctx.branchId}` : sql``;
    const res: any = await sql`
      SELECT provider_call_id, started_at, ended_at, duration_seconds, intents, booking_outcome, handoff_outcome, summary, follow_up_required
      FROM voice_call_outcomes
      WHERE tenant_id = ${ctx.tenantId} ${branchFilter}
      ORDER BY created_at DESC LIMIT ${limit}
    `.execute(this.db as any).catch(() => ({ rows: [] }));
    const calls: AiPhoneActivityItem[] = (res.rows ?? []).map((r: any) => ({
      callId: r.provider_call_id,
      startedAt: r.started_at ? new Date(r.started_at).toISOString() : null,
      endedAt: r.ended_at ? new Date(r.ended_at).toISOString() : null,
      durationSeconds: r.duration_seconds ?? null,
      intents: Array.isArray(r.intents) ? r.intents : [],
      bookingOutcome: r.booking_outcome ?? null,
      handoffOutcome: r.handoff_outcome ?? null,
      summary: r.summary ?? null,
      followUpRequired: !!r.follow_up_required,
      handedOffToHuman: !!r.handoff_outcome && r.handoff_outcome !== 'none',
    }));
    return { available: true, calls };
  }

  /** (3) Explain a service and the approved policies that apply — reusing the real services catalog. Only real fields are
   * returned; nothing is fabricated. Branch-scoped (services are branch-configured). */
  async explainService(ctx: CopilotCtx, input: { serviceId: string }): Promise<{ found: boolean; service?: any; policies?: string[]; approvedKnowledge?: RetrievedContext }> {
    if (!(await this.allowed(ctx, 'allowExplainServices'))) return { found: false };
    if (!ctx.branchId) return { found: false };
    const sctx = { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions };
    const list = await this.services.list(sctx as any, {} as any).catch(() => [] as any[]);
    const svc = (Array.isArray(list) ? list : []).find((s: any) => s.serviceId === input.serviceId || s.id === input.serviceId);
    if (!svc) return { found: false };
    const policies: string[] = [];
    if (svc.durationMinutes) policies.push(`Runs about ${svc.durationMinutes} minutes — hold the technician for that window.`);
    if (typeof svc.priceCents === 'number') policies.push(`Quoted price is $${(svc.priceCents / 100).toFixed(2)}; confirm any add-ons at checkout.`);
    policies.push('Cancellation and deposit rules follow this salon\u2019s configured booking policy — confirm before quoting exceptions.');
    const out: { found: boolean; service?: any; policies?: string[]; approvedKnowledge?: RetrievedContext } = { found: true, service: { name: svc.name, category: svc.categoryName, durationMinutes: svc.durationMinutes, priceCents: svc.priceCents, description: svc.description ?? null }, policies };
    // BUILD_PLAN Phase 14 (Constitution 10 §143–§150): the salon's own APPROVED (PUBLISHED) knowledge about this service —
    // this salon only (tenant + branch filtered in SQL before ranking), staff-readable classes only, and marked untrusted
    // (tenant-authored text). Nothing found, or the lookup failing, leaves the answer EXACTLY as it was before.
    const hits = this.knowledge ? await this.knowledge.retrieve({ tenantId: ctx.tenantId, branchId: ctx.branchId, role: ctx.role, customerFacing: false }, [svc.name, svc.categoryName].filter(Boolean).join(' '), 3).catch(() => []) : [];
    if (hits.length) out.approvedKnowledge = toPromptContext(hits, 2000);
    return out;
  }

  /** (4) Waitlist / standby guidance. The queue "waiting" stage is the waitlist; this is advisory — actual placement
   * still goes through the existing Queue domain service. */
  async recommendWaitlist(ctx: CopilotCtx): Promise<{ recommended: boolean; waiting: number; estimatedWaitMinutes: number | null; message: string }> {
    if (!(await this.allowed(ctx, 'allowWaitlist'))) return { recommended: false, waiting: 0, estimatedWaitMinutes: null, message: 'Waitlist suggestions are turned off for this salon.' };
    const q = await this.context.queueSummary(ctx).catch(() => null);
    const waiting = q?.waiting ?? 0;
    const est = q?.longestWaitMinutes ?? null;
    return {
      recommended: true,
      waiting,
      estimatedWaitMinutes: est,
      message: est != null
        ? `Offer standby: ${waiting} guest(s) currently waiting, roughly ${est} min. Place on the waitlist and we\u2019ll call when a technician frees up.`
        : `Offer standby: the waitlist is short right now — likely a quick turnaround.`,
    };
  }

  /** (5) Safe recommended next actions from the current context. Deterministic + advisory; each maps to an existing
   * Copilot capability the receptionist can trigger. */
  recommendNextActions(input: { intent?: CopilotIntent | null; hasAvailability?: boolean; duplicateFound?: boolean; customerKnown?: boolean }): NextAction[] {
    const out: NextAction[] = [];
    if (input.duplicateFound) out.push({ action: 'review_duplicates', label: 'Review possible duplicate customer', reason: 'A likely duplicate record was detected.' });
    switch (input.intent) {
      case 'book_appointment':
      case 'check_availability':
        out.push({ action: 'search_availability', label: 'Find available times', reason: 'Caller wants to book or check availability.' });
        if (input.hasAvailability === false) out.push({ action: 'offer_waitlist', label: 'Offer waitlist / standby', reason: 'No suitable slot was found.' });
        break;
      case 'reschedule_appointment':
        out.push({ action: 'find_reschedule_options', label: 'Find reschedule options', reason: 'Caller wants to move an appointment.' });
        break;
      case 'cancel_appointment':
        out.push({ action: 'confirm_cancellation', label: 'Confirm cancellation details', reason: 'Caller wants to cancel — verify before acting.' });
        break;
      case 'send_message':
        out.push({ action: 'draft_message', label: 'Draft a follow-up message', reason: 'Caller needs a confirmation or follow-up.' });
        break;
      case 'queue_status':
        out.push({ action: 'summarize_queue', label: 'Summarize the current queue', reason: 'Caller asked about wait / queue.' });
        break;
      default:
        out.push({ action: 'lookup_customer', label: 'Pull up customer details', reason: 'Start by confirming who is calling.' });
    }
    if (input.customerKnown) out.push({ action: 'draft_message', label: 'Prepare a follow-up SMS', reason: 'Keep the customer informed after the call.' });
    return out.slice(0, 4);
  }
}
