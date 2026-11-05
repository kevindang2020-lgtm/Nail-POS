// ai-review-reputation-settings.ts — PURE settings resolution. Layers resolve platform → tenant → branch. `enabled` is
// tri-state (null = inherit); FALSE at any layer disables the assistant for that scope (never affects the underlying
// reviews store). Auto-response is OFF by default and, even when a tenant enables it, is confined to a narrow low-risk
// policy. Config is versioned (the DB keeps history) so a historical AI decision can be traced to the active config.

export type ResponseTone = 'professional' | 'warm' | 'luxury' | 'friendly' | 'concise' | 'apologetic' | 'brand';
export type ResponseLength = 'short' | 'medium' | 'long';

export interface AutoResponsePolicy {
  enabled: boolean;                 // OFF by default
  minRating: number;                // must be 5 to be eligible
  confidenceThreshold: number;      // 0..1
  requireNoComplaintText: boolean;
}

export interface ReviewRequestPolicy {
  enabled: boolean;
  delayMinutes: number;             // after completed visit
  channel: 'sms' | 'email' | 'app' | 'in_app';
  quietHoursStart: number;          // 0..23
  quietHoursEnd: number;            // 0..23
  cooldownDays: number;             // per-customer
  maxPerCustomerPerPeriod: number;
  oneReminder: boolean;             // at most one controlled reminder
  minVisitValueCents: number;       // 0 = no minimum
}

export interface ReputationConfig {
  responseTone: ResponseTone;
  brandVoice: string;
  salonName: string;
  languages: string[];
  responseLength: ResponseLength;
  approvalRequired: boolean;        // public responses require approval (default true)
  confidenceThreshold: number;      // analysis confidence floor for actions
  autoResponse: AutoResponsePolicy;
  reviewRequest: ReviewRequestPolicy;
  monthlyUsageLimit: number;        // 0 = unlimited (plan-driven)
  notificationRecipients: string[];
}

export const PLATFORM_DEFAULTS: ReputationConfig = {
  responseTone: 'professional', brandVoice: '', salonName: '', languages: ['en'], responseLength: 'medium',
  approvalRequired: true, confidenceThreshold: 0.7,
  autoResponse: { enabled: false, minRating: 5, confidenceThreshold: 0.9, requireNoComplaintText: true },
  reviewRequest: { enabled: false, delayMinutes: 120, channel: 'sms', quietHoursStart: 21, quietHoursEnd: 9, cooldownDays: 30, maxPerCustomerPerPeriod: 1, oneReminder: false, minVisitValueCents: 0 },
  monthlyUsageLimit: 0, notificationRecipients: [],
};

export interface SettingsLayer { enabled?: boolean; config?: Partial<ReputationConfig>; }
export interface EffectiveSettings { enabled: boolean; disabledAtLevel: string | null; config: ReputationConfig; }

const clampNum = (v: unknown, lo: number, hi: number, d: number): number => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const clampInt = (v: unknown, lo: number, hi: number, d: number): number => Math.floor(clampNum(v, lo, hi, d));

/** Resolve effective settings from ordered layers. Disabled-wins; auto-response is force-clamped to its safe envelope. */
export function resolveSettings(layers: { platform: ReputationConfig; tenant?: SettingsLayer; branch?: SettingsLayer }): EffectiveSettings {
  const order: [string, SettingsLayer | undefined][] = [['tenant', layers.tenant], ['branch', layers.branch]];
  let disabledAtLevel: string | null = null;
  for (const [lvl, l] of order) { if (l?.enabled === false) { disabledAtLevel = lvl; break; } }

  const merged: ReputationConfig = JSON.parse(JSON.stringify(layers.platform));
  for (const [, l] of order) if (l?.config) {
    Object.assign(merged, { ...l.config, autoResponse: { ...merged.autoResponse, ...(l.config.autoResponse || {}) }, reviewRequest: { ...merged.reviewRequest, ...(l.config.reviewRequest || {}) } });
  }
  // hard safety clamps — auto-response can never be widened past the low-risk envelope, whatever a tenant sets
  merged.autoResponse.minRating = 5;                                            // 5-star only, non-negotiable
  merged.autoResponse.requireNoComplaintText = true;
  merged.autoResponse.confidenceThreshold = clampNum(merged.autoResponse.confidenceThreshold, 0.8, 1, 0.9); // >= 0.8
  merged.confidenceThreshold = clampNum(merged.confidenceThreshold, 0, 1, 0.7);
  merged.reviewRequest.delayMinutes = clampInt(merged.reviewRequest.delayMinutes, 0, 10080, 120);
  merged.reviewRequest.cooldownDays = clampInt(merged.reviewRequest.cooldownDays, 0, 365, 30);
  merged.reviewRequest.maxPerCustomerPerPeriod = clampInt(merged.reviewRequest.maxPerCustomerPerPeriod, 1, 5, 1);
  merged.reviewRequest.quietHoursStart = clampInt(merged.reviewRequest.quietHoursStart, 0, 23, 21);
  merged.reviewRequest.quietHoursEnd = clampInt(merged.reviewRequest.quietHoursEnd, 0, 23, 9);
  merged.monthlyUsageLimit = clampInt(merged.monthlyUsageLimit, 0, 10_000_000, 0);
  if (!Array.isArray(merged.languages) || !merged.languages.length) merged.languages = ['en'];

  return { enabled: disabledAtLevel === null, disabledAtLevel, config: merged };
}

export interface SettingsRow { level: 'tenant' | 'branch'; branch_id: string | null; enabled: boolean | null; config: Partial<ReputationConfig> | null; }
export function rowsToLayers(rows: SettingsRow[], ctx: { branchId?: string }): { tenant?: SettingsLayer; branch?: SettingsLayer } {
  const out: { tenant?: SettingsLayer; branch?: SettingsLayer } = {};
  const toLayer = (r: SettingsRow): SettingsLayer => ({ ...(r.enabled == null ? {} : { enabled: r.enabled }), ...(r.config ? { config: r.config } : {}) });
  for (const r of rows) {
    if (r.level === 'tenant') out.tenant = toLayer(r);
    else if (r.level === 'branch' && ctx.branchId && r.branch_id === ctx.branchId) out.branch = toLayer(r);
  }
  return out;
}
