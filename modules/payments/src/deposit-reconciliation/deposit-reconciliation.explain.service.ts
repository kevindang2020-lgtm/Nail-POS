// deposit-reconciliation.explain.service.ts — AI explanation of a settlement's reconciliation. The deterministic
// facts (buildReconFacts) are the source of truth; the AI provider only rephrases them, constrained by the
// system prompt to the provided facts. With no real provider (mock) or on provider error, the factual
// deterministic explanation is returned — never a fabricated one. Usage is always logged. AI never resolves.
import { buildReconState, DEFAULT_RECON_OPTIONS, type ReconContext, type ReconRow, type ReconOptions } from './deposit-reconciliation.dto';
import { reconcileFee, applicableSchedule, DEFAULT_FEE_OPTIONS } from './deposit-reconciliation.fees';
import { buildReconFacts, EXPLANATION_SYSTEM, EXPLANATION_PROMPT_VERSION, type ExplanationFacts } from './deposit-reconciliation.explain';
import type { ReconRepositoryPort } from './deposit-reconciliation.repository';
import type { FeeScheduleRepositoryPort } from './deposit-reconciliation.fees.repository';
import type { AiProvider } from '@aipowersalon/ai';
import type { ExplainUsageLogger } from './deposit-reconciliation.explain.usage';
import { ReconForbiddenError, ReconValidationError } from './deposit-reconciliation.service';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export interface ExplanationResult {
  settlementId: string;
  explanation: string;
  source: 'ai' | 'deterministic';
  facts: ExplanationFacts;
  model: string;
  provider: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
}

export class AiExplanationService {
  constructor(
    private readonly recon: ReconRepositoryPort,
    private readonly fees: FeeScheduleRepositoryPort,
    private readonly provider: AiProvider,
    private readonly usage: ExplainUsageLogger,
  ) {}

  private options(): ReconOptions { return { ...DEFAULT_RECON_OPTIONS, nowIso: new Date().toISOString() }; }

  async explainSettlement(ctx: ReconContext, settlementId: string): Promise<ExplanationResult> {
    if (!ctx?.userId || !ctx?.tenantId) throw new ReconForbiddenError('Not authenticated');
    const settlement = await this.recon.findSettlement(ctx, settlementId);
    if (!settlement) throw withCode(new ReconValidationError('Settlement not found'), 'SETTLEMENT_NOT_FOUND');

    const [deposits, allSettlements, schedules] = await Promise.all([this.recon.listDeposits(ctx), this.recon.listSettlements(ctx), this.fees.listFeeSchedules(ctx)]);
    const state = buildReconState(allSettlements, deposits, this.options());
    const reconRow: ReconRow = state.rows.find((r) => r.settlementId === settlementId)
      ?? { settlementId, processorType: settlement.processorType, settledAt: settlement.settledAt, grossCents: settlement.grossCents, feeCents: settlement.feeCents, expectedNetCents: settlement.netCents, depositId: null, actualCents: null, differenceCents: 0, status: 'unmatched_settlement', matchType: 'none', confidence: 0, dateDiffDays: null };
    const feeRow = reconcileFee(applicableSchedule(schedules, settlement), settlement, DEFAULT_FEE_OPTIONS);

    const facts = buildReconFacts(reconRow, feeRow);

    // Ask the AI to rephrase the factual summary. On any error, fall back to the deterministic facts.
    let explanation = facts.summary;
    let source: 'ai' | 'deterministic' = 'deterministic';
    let provider = this.provider.name; let model = this.provider.model;
    let inputTokens = 0; let outputTokens = 0; let status: 'success' | 'provider_error' = 'success';
    try {
      const res = await this.provider.complete({ system: EXPLANATION_SYSTEM, prompt: JSON.stringify({ instruction: 'Explain these reconciliation facts in 2-3 plain sentences using only what is given.', facts: facts.components, factual_summary: facts.summary }) });
      provider = res.provider; model = res.model; inputTokens = res.inputTokens; outputTokens = res.outputTokens;
      // A mock provider echoes the prompt; only use real AI output, otherwise keep the deterministic summary.
      const usedReal = res.text && !res.text.startsWith('[mock');
      if (usedReal) { explanation = res.text.trim(); source = 'ai'; }
    } catch {
      status = 'provider_error';
    }

    await this.usage.log({ tenantId: ctx.tenantId, provider, model, inputTokens, outputTokens, costCents: 0, status });

    return { settlementId, explanation, source, facts, model, provider, promptVersion: EXPLANATION_PROMPT_VERSION, inputTokens, outputTokens };
  }
}
