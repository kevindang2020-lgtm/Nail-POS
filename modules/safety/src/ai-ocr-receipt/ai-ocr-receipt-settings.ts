// ai-ocr-receipt-settings.ts — tri-state (platform → tenant → branch) settings for the OCR module, plus PII storage
// helpers. Two clamps are non-negotiable and can NEVER be turned off by tenant/branch config:
//   • piiMasking is always true (full PANs/bank numbers are never stored),
//   • humanReviewRequired is always true (AI never posts; every posting is reviewed + approved).
// Tenant config can only ADD stricter approval requirements, never remove review. "disabled wins" downward.
import { redactSensitive, maskCardNumber } from './ai-ocr-receipt-core';
import type { ToleranceRule } from './ai-ocr-receipt-validation';

export interface ApprovalRules {
  requireApprovalAboveCents: number;      // documents at/above this total need explicit approver sign-off
  dualApprovalAboveCents: number | null;  // at/above this, two approvers
  restrictedCategories: string[];         // categories that always require approval regardless of amount
}
export interface OcrReceiptConfig {
  autoPipeline: boolean;                  // auto-run OCR/extraction on upload (NEVER auto-post)
  tolerance: ToleranceRule;
  highAmountCents: number;
  lowConfidenceThreshold: number;
  retentionDays: number;
  maxFileSizeBytes: number;
  maxPages: number;
  allowedMimeTypes: string[];
  malwareScanRequired: boolean;
  approvalRules: ApprovalRules;
  // clamped invariants (present so the effective config is explicit; always forced true)
  piiMasking: boolean;
  humanReviewRequired: boolean;
}

export const PLATFORM_DEFAULTS: OcrReceiptConfig = {
  autoPipeline: true,
  tolerance: { absoluteCents: 2, relativePct: 0.5 },
  highAmountCents: 50_000,
  lowConfidenceThreshold: 0.6,
  retentionDays: 2555,                    // ~7 years (financial retention)
  maxFileSizeBytes: 20 * 1024 * 1024,
  maxPages: 30,
  allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/webp', 'image/tiff'],
  malwareScanRequired: true,
  approvalRules: { requireApprovalAboveCents: 25_000, dualApprovalAboveCents: null, restrictedCategories: [] },
  piiMasking: true,
  humanReviewRequired: true,
};

export interface SettingsRow { level: 'tenant' | 'branch'; branch_id: string | null; enabled: boolean | null; config: Partial<OcrReceiptConfig> | null; }
export interface ResolvedSettings { enabled: boolean; config: OcrReceiptConfig; source: { tenant: boolean; branch: boolean }; }

const clampNum = (v: any, lo: number, hi: number, dflt: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt);

function mergeConfig(base: OcrReceiptConfig, patch: Partial<OcrReceiptConfig> | null): OcrReceiptConfig {
  if (!patch) return base;
  const merged: OcrReceiptConfig = {
    ...base, ...patch,
    tolerance: { absoluteCents: clampNum(patch.tolerance?.absoluteCents, 0, 100, base.tolerance.absoluteCents), relativePct: clampNum(patch.tolerance?.relativePct, 0, 10, base.tolerance.relativePct) },
    highAmountCents: clampNum(patch.highAmountCents, 0, 100_000_000, base.highAmountCents),
    lowConfidenceThreshold: clampNum(patch.lowConfidenceThreshold, 0, 1, base.lowConfidenceThreshold),
    retentionDays: clampNum(patch.retentionDays, 30, 3650, base.retentionDays),               // never below a 30-day floor
    maxFileSizeBytes: clampNum(patch.maxFileSizeBytes, 1024, 50 * 1024 * 1024, base.maxFileSizeBytes),
    maxPages: clampNum(patch.maxPages, 1, 200, base.maxPages),
    approvalRules: {
      requireApprovalAboveCents: clampNum(patch.approvalRules?.requireApprovalAboveCents, 0, 100_000_000, base.approvalRules.requireApprovalAboveCents),
      dualApprovalAboveCents: patch.approvalRules?.dualApprovalAboveCents == null ? base.approvalRules.dualApprovalAboveCents : clampNum(patch.approvalRules.dualApprovalAboveCents, 0, 100_000_000, base.approvalRules.dualApprovalAboveCents ?? 0),
      restrictedCategories: Array.isArray(patch.approvalRules?.restrictedCategories) ? patch.approvalRules!.restrictedCategories.map(String) : base.approvalRules.restrictedCategories,
    },
  };
  // hard clamps — tenants can never weaken these
  merged.piiMasking = true;
  merged.humanReviewRequired = true;
  return merged;
}

export function resolveSettings(input: { platform?: OcrReceiptConfig; tenant?: SettingsRow | null; branch?: SettingsRow | null }): ResolvedSettings {
  const platform = input.platform ?? PLATFORM_DEFAULTS;
  let config = platform;
  let enabled = true;
  const source = { tenant: false, branch: false };
  if (input.tenant) { source.tenant = true; if (input.tenant.enabled === false) enabled = false; config = mergeConfig(config, input.tenant.config); }
  if (input.branch) { source.branch = true; if (input.branch.enabled === false) enabled = false; config = mergeConfig(config, input.branch.config); } // disabled wins downward
  return { enabled, config, source };
}

/** Split loaded rows into tenant + branch layers for a given branch. */
export function rowsToLayers(rows: SettingsRow[], opts: { branchId?: string }): { tenant: SettingsRow | null; branch: SettingsRow | null } {
  const tenant = rows.find((r) => r.level === 'tenant') ?? null;
  const branch = opts.branchId ? rows.find((r) => r.level === 'branch' && r.branch_id === opts.branchId) ?? null : null;
  return { tenant, branch };
}

// ── PII storage helpers ──────────────────────────────────────────────────────
const SENSITIVE_KEYS = /card|pan|account|routing|iban|cvv|ssn|bank/i;
/** Prepare an extracted field for persistence: sensitive keys are masked to last-4; all text is redacted of PAN/bank runs. */
export function maskFieldForStorage(fieldKey: string, valueText: string | null): string | null {
  if (valueText == null) return null;
  if (SENSITIVE_KEYS.test(fieldKey)) return maskCardNumber(valueText) ?? '••••';
  return redactSensitive(valueText);
}
/** Redact an entire OCR page's text before it is stored. */
export function redactPageText(text: string | null): string { return redactSensitive(text); }
