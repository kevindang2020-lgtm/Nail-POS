// ai-assistant.service.ts — orchestrates a single AI assistant call the way EVERY one of the 15 endpoints must:
//   1) load the access snapshot for (tenant, package)   2) run the access gate   3) if denied, log a blocked usage row
//   and return the decision (no provider call, no charge)   4) if allowed, run the prompt through the shared gateway,
//   log a success/provider_error usage row, and return a safe response. The 15 endpoints differ only by packageCode +
//   prompt template; this orchestration is shared so enforcement can never be skipped.
import { evaluateAiAccess, accessReasonLabel, type AiAccessSnapshot, type AiAccessDecision } from './ai-access-gate';
import { getAiPackage, isAiPackageCode } from './ai-catalog';
import { AiGatewayService, type AiUsageLogger, type AiUsageEntry, type AiUsageStatus } from './ai-gateway';
import { getAiPrompt } from './ai-prompts';
import { computeAiCostMicroUsd } from './ai-pricing';
import { RECEIPT_SYSTEM, RECEIPT_PROMPT, parseReceiptJson, type ParsedReceipt } from './ai-receipt';

export interface AiAccessRepo {
  /** Assemble the access snapshot for this tenant+package (subscription, usage, tenant status, permission). */
  loadSnapshot(tenantId: string, packageCode: string, userId: string | null): Promise<AiAccessSnapshot>;
}

export interface AiAssistantRequest { tenantId: string; userId: string | null; packageCode: string; action?: string; prompt: string }
export interface AiAssistantResponse {
  ok: boolean;
  text?: string;
  decision: AiAccessDecision & { label: string };
  /** null = the usage counter could not be read. NOT the same as "unlimited" (-1) and not the same as 0. */
  remainingUsage?: number | null;
  usage?: { provider: string; model: string; inputTokens: number; outputTokens: number };
}

const blockedStatus = (reason: string): AiUsageStatus =>
  reason === 'limit_exceeded' ? 'blocked_limit' : reason === 'permission_denied' ? 'blocked_permission' : 'blocked_unpaid';

export class AiAssistantService {
  constructor(
    private readonly repo: AiAccessRepo,
    private readonly gateway: AiGatewayService,
    private readonly logger: AiUsageLogger,
    // Optional control-mode lookup (spec §3). When it returns 'disabled', the assistant cannot run — enforced here on
    // the BACKEND before any provider call. Optional + fail-open on lookup error so existing callers/tests are unaffected.
    private readonly controlModeLookup?: (tenantId: string, packageCode: string) => Promise<string | null>,
  ) {}

  async run(req: AiAssistantRequest): Promise<AiAssistantResponse> {
    const pkg = getAiPackage(req.packageCode);
    if (!pkg || !isAiPackageCode(req.packageCode)) {
      throw Object.assign(new Error('unknown_ai_package'), { status: 404 });
    }
    const action = req.action || 'invoke';
    const snapshot = await this.repo.loadSnapshot(req.tenantId, req.packageCode, req.userId);
    // §3 Mode 1 (Disabled): a disabled assistant cannot run — block before the provider call, no charge.
    const ctlMode = this.controlModeLookup ? await this.controlModeLookup(req.tenantId, req.packageCode).catch(() => null) : null;
    if (ctlMode === 'disabled') {
      await this.log(req, pkg.usageUnit, 0, 'blocked_permission', null, null, 0, 0, 'control_mode_disabled');
      const blocked = { ...evaluateAiAccess(snapshot), allowed: false, reason: 'package_disabled' as const };
      return { ok: false, decision: { ...blocked, label: accessReasonLabel('package_disabled') } };
    }
    const decision = evaluateAiAccess(snapshot);
    const withLabel = { ...decision, label: accessReasonLabel(decision.reason) };

    if (!decision.allowed) {
      await this.log(req, pkg.usageUnit, 0, blockedStatus(decision.reason), null, null, 0, 0, decision.reason);
      return { ok: false, decision: withLabel };
    }

    // Per-assistant system prompt from the registry (tenant-scoped, advisory-only); runtime prompt carries the case.
    const { system, maxTokens } = getAiPrompt(req.packageCode, { tenantId: req.tenantId });
    try {
      const out = await this.gateway.complete({ system, prompt: req.prompt, maxTokens });
      await this.log(req, pkg.usageUnit, 1, 'success', out.provider, out.model, out.inputTokens, out.outputTokens, null);
      return {
        ok: true, text: out.text, decision: withLabel, remainingUsage: decision.remainingUsage,
        usage: { provider: out.provider, model: out.model, inputTokens: out.inputTokens, outputTokens: out.outputTokens },
      };
    } catch (e: any) {
      await this.log(req, pkg.usageUnit, 0, 'provider_error', this.gateway.providerName, this.gateway.modelName, 0, 0, e?.message ?? 'provider_error');
      throw Object.assign(new Error('ai_provider_error'), { status: 502 });
    }
  }

  /** OCR receipt scan: same access gate + usage log as run(), but routed through the vision gateway and parsed into a
   *  normalized receipt. Never auto-saves — returns the parsed data for the POS to review and confirm. */
  async scanReceipt(req: { tenantId: string; userId: string | null; imageBase64: string; mimeType: string }): Promise<{
    ok: boolean; receipt?: ParsedReceipt; decision: AiAccessDecision & { label: string };
    usage?: { provider: string; model: string; inputTokens: number; outputTokens: number };
  }> {
    const code = 'ai_ocr_receipt_scanner';
    const pkg = getAiPackage(code)!;
    const base: AiAssistantRequest = { tenantId: req.tenantId, userId: req.userId, packageCode: code, action: 'scan_receipt', prompt: '' };
    const snapshot = await this.repo.loadSnapshot(req.tenantId, code, req.userId);
    const decision = evaluateAiAccess(snapshot);
    const withLabel = { ...decision, label: accessReasonLabel(decision.reason) };

    if (!decision.allowed) {
      await this.log(base, pkg.usageUnit, 0, blockedStatus(decision.reason), null, null, 0, 0, decision.reason);
      return { ok: false, decision: withLabel };
    }
    try {
      const out = await this.gateway.completeVision({ system: RECEIPT_SYSTEM, prompt: RECEIPT_PROMPT, imageBase64: req.imageBase64, mimeType: req.mimeType });
      const receipt = parseReceiptJson(out.text);
      await this.log(base, pkg.usageUnit, 1, 'success', out.provider, out.model, out.inputTokens, out.outputTokens, receipt ? null : 'parse_failed');
      if (!receipt) throw Object.assign(new Error('receipt_unreadable'), { status: 502 });
      return { ok: true, receipt, decision: withLabel, usage: { provider: out.provider, model: out.model, inputTokens: out.inputTokens, outputTokens: out.outputTokens } };
    } catch (e: any) {
      if (e?.status) throw e;
      await this.log(base, pkg.usageUnit, 0, 'provider_error', this.gateway.providerName, this.gateway.modelName, 0, 0, e?.message ?? 'provider_error');
      throw Object.assign(new Error('ai_provider_error'), { status: 502 });
    }
  }

  private log(req: AiAssistantRequest, usageUnit: string, usageAmount: number, status: AiUsageStatus, provider: string | null, model: string | null, inTok: number, outTok: number, err: string | null): Promise<void> {
    // Only successful calls cost money (blocked/error calls never hit a provider).
    const costMicroUsd = status === 'success' ? computeAiCostMicroUsd(model, inTok, outTok) : 0;
    const entry: AiUsageEntry = {
      tenantId: req.tenantId, userId: req.userId, packageCode: req.packageCode, action: req.action || 'invoke',
      modelProvider: provider, modelName: model, inputTokens: inTok, outputTokens: outTok,
      usageUnit, usageAmount, status, errorMessage: err, createdAt: new Date().toISOString(), costMicroUsd,
    };
    return this.logger.log(entry);
  }
}

/** Default-deny in-memory access repo: closed unless a snapshot is explicitly seeded. Safe offline default — no tenant
 *  gets AI access until a real (Phase-2 Kysely) repo proves an active paid subscription. Used for tests/offline boot. */
export class InMemoryAiAccessRepo implements AiAccessRepo {
  private seeds = new Map<string, AiAccessSnapshot>();
  seed(tenantId: string, packageCode: string, snapshot: AiAccessSnapshot) { this.seeds.set(`${tenantId}:${packageCode}`, snapshot); }
  async loadSnapshot(tenantId: string, packageCode: string): Promise<AiAccessSnapshot> {
    return this.seeds.get(`${tenantId}:${packageCode}`) ?? {
      tenantStatus: 'active', packageEnabled: true, subscription: null,
      usage: { used: 0, limit: 0, overageEnabled: false }, hasPermission: false,
    };
  }
}
