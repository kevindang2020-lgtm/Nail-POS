// ai-scheduling-explanation.ts — BUILD_PLAN Phase 7 (agent B): the words for a recommendation (SchedExplanationPort).
//
// The deterministic engine has ALREADY decided everything. The LLM (registered task `schedule.explain_suggestion`, through
// AiPlatform — the same gateway every AI module uses, which checks the package, the safety switches, renders the
// registered prompt and logs the call's real cost) only WORDS that result for staff. It receives ONLY the
// recommendation's computed facts — type, from / to slot, whether the technician changes, benefits, downsides, confidence,
// the simulation deltas — never a customer name, phone, id or a technician's name.
// Any error, no AI package, the optimizer's platform kill switch, an empty answer → the deterministic template.
// Every explanation is metered (usage action 'explanation'; the LLM call's cost is on AiPlatform's own row).
import type { SchedRecommendation, SchedRecType } from '@aipowersalon/api-contracts/tenant';
import type { SchedCtx, SchedExplanationPort, SchedPlatformSwitchPort, SchedUsagePort } from './ai-scheduling.ports';
import { uuidOrNull } from './ai-scheduling-ops.common';

const TYPE_LABEL: Record<SchedRecType, string> = {
  move_appointment: 'Move the appointment', change_technician: 'Change the technician', offer_alternate_time: 'Offer another time',
  open_availability: 'Open availability', close_availability: 'Close availability', add_buffer: 'Add a buffer', adjust_duration: 'Adjust the duration',
  add_staffing: 'Add staffing', move_break: 'Move a break', fill_gap: 'Fill a gap', resolve_overbooking: 'Resolve an overbooking', preserve_schedule: 'Keep the schedule as it is',
};

/** The ONLY data the model sees: computed facts, no identities. Exported for the test that proves no PII gets in. */
export function explanationFacts(rec: SchedRecommendation) {
  const cur = rec.currentState, prop = rec.proposedState;
  return {
    type: rec.type,
    from: cur ? { date: cur.date, startTime: cur.startTime, endTime: cur.endTime } : null,
    to: prop ? { date: prop.date, startTime: prop.startTime, endTime: prop.endTime } : null,
    technicianChanges: !!(cur && prop && (cur.technicianId ?? null) !== (prop.technicianId ?? null)),
    benefits: (rec.expectedBenefit || []).slice(0, 6).map((s) => String(s).slice(0, 160)),
    downsides: (rec.possibleDownside || []).slice(0, 6).map((s) => String(s).slice(0, 160)),
    confidence: Math.round(Number(rec.confidence || 0) * 100) / 100,
    dataQuality: rec.dataQuality,
    deltas: rec.simulation ? rec.simulation.deltas : null,
    requiresCustomerApproval: !!rec.requiresCustomerApproval,
  };
}

/** Deterministic, always-available wording. */
export function templateExplanation(rec: SchedRecommendation): string {
  const f = explanationFacts(rec);
  const parts: string[] = [];
  const move = f.from && f.to && (f.from.date !== f.to.date || f.from.startTime !== f.to.startTime)
    ? ` from ${f.from.date === f.to.date ? f.from.startTime : `${f.from.date} ${f.from.startTime}`} to ${f.from.date === f.to.date ? f.to.startTime : `${f.to.date} ${f.to.startTime}`}` : '';
  parts.push(`${TYPE_LABEL[f.type] ?? 'Schedule change'}${move}${f.technicianChanges ? ' with a different technician' : ''}.`);
  if (f.benefits.length) parts.push(`Why: ${f.benefits.join('; ')}.`);
  else parts.push('No measurable improvement — keep the schedule as it is.');
  if (f.downsides.length) parts.push(`Trade-off: ${f.downsides.join('; ')}.`);
  if (f.requiresCustomerApproval) parts.push('The customer must approve before anything changes.');
  parts.push(`Confidence ${Math.round(f.confidence * 100)}%${f.dataQuality !== 'good' ? ` (data ${f.dataQuality})` : ''}.`);
  return sanitizeExplanation(parts.join(' '));
}

export function sanitizeExplanation(text: string): string {
  return String(text ?? '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600);
}

/** The narrow slice of AiPlatform this needs (bound in the providers file). */
export interface SchedExplainLlmPort {
  explain(req: { tenantId: string; branchId: string | null; userId: string | null; facts: ReturnType<typeof explanationFacts> }): Promise<{ text: string; model: string | null; costMicroUsd: number; language?: 'en' | 'vi' } | null>;
}
/** §120: the joiners the server puts between the model's three fields, in the language the model wrote in. */
const JOIN: Record<'en' | 'vi', { benefit: string; tradeoff: string }> = { en: { benefit: 'Benefit', tradeoff: 'Trade-off' }, vi: { benefit: 'Lợi ích', tradeoff: 'Đánh đổi' } };
/** AiPlatform → SchedExplainLlmPort. */
export function platformExplainAdapter(platform: { execute: (req: any) => Promise<any> }): SchedExplainLlmPort {
  return {
    async explain(req) {
      const r = await platform.execute({ taskKey: 'schedule.explain_suggestion', tenantId: req.tenantId, branchId: req.branchId, userId: req.userId, variables: { suggestion_json: req.facts } });
      const d = r?.data ?? null;
      if (!d) return null;
      // §120: AiPlatform asked for the reader's POS language (the user's, or the salon default for a job) — it says which
      const language: 'en' | 'vi' = r?.language === 'vi' ? 'vi' : 'en';
      const w = JOIN[language];
      const text = [d.explanation, d.benefit ? `${w.benefit}: ${d.benefit}.` : '', d.tradeoff ? `${w.tradeoff}: ${d.tradeoff}.` : ''].filter(Boolean).join(' ');
      return { text, model: r?.provenance?.model ?? null, costMicroUsd: Number(r?.usage?.costMicroUsd ?? 0), language };
    },
  };
}

export class SchedExplanationService implements SchedExplanationPort {
  constructor(private readonly llm: SchedExplainLlmPort | null, private readonly usage: SchedUsagePort, private readonly platform: SchedPlatformSwitchPort | null) {}

  async explain(ctx: SchedCtx, rec: SchedRecommendation): Promise<{ text: string; source: 'llm' | 'template'; language: 'en' | 'vi' }> {
    const fallback = templateExplanation(rec);
    // the template is English text (the POS words it from explanationCoded in the screen's language)
    let out: { text: string; source: 'llm' | 'template'; language: 'en' | 'vi' } = { text: fallback, source: 'template', language: 'en' };
    let model: string | null = null;
    let status: 'ok' | 'error' = 'ok';
    const killed = this.platform ? await this.platform.isKilled().catch(() => false) : false;
    if (this.llm && !killed) {
      try {
        const r = await this.llm.explain({ tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, userId: uuidOrNull(ctx.userId), facts: explanationFacts(rec) });
        const text = sanitizeExplanation(r?.text ?? '');
        if (text) { out = { text, source: 'llm', language: r?.language === 'vi' ? 'vi' : 'en' }; model = r?.model ?? null; }
      } catch { status = 'error'; /* the template stands */ }
    }
    await this.usage.record(ctx, 'explanation', { model, status: out.source === 'llm' ? 'ok' : status === 'error' ? 'error' : 'ok' });
    return out;
  }
}
