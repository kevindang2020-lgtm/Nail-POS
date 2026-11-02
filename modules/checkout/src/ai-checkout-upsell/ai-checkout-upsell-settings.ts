// ai-checkout-upsell-settings.ts — PURE settings resolution for the assistant (§70). Layers resolve
// platform → tenant → branch → device → user. `enabled` is tri-state (null = inherit); FALSE at any layer disables the
// assistant for that scope (kill switch, §88) without ever affecting checkout/payments. Tunables (fatigue caps, category
// toggles, safety limits) clamp to safe ranges. No I/O here — the DB-backed port feeds rows in.

export interface UpsellTunables {
  maxTotal: number; maxAddOn: number; maxProduct: number; maxMembership: number;
  addOnsEnabled: boolean; productsEnabled: boolean; membershipEnabled: boolean;
  loyaltyEnrollEnabled: boolean; loyaltyRedeemEnabled: boolean; giftCardEnabled: boolean; rebookingEnabled: boolean;
  maxAddedValueCents: number;        // hard ceiling on the TOTAL added value of add-on + product suggestions (Functional Decision 27: default $30)
  maxAddedPercent: number;           // …and at most this % of the booked service subtotal (Decision 27: default 30%). The lower of the two wins.
  allowAfterServiceDone: boolean;    // whether add-ons may be recommended after Service Done (§10/§70)
}

export const PLATFORM_DEFAULTS: UpsellTunables = {
  maxTotal: 2, maxAddOn: 2, maxProduct: 2, maxMembership: 1,
  addOnsEnabled: true, productsEnabled: true, membershipEnabled: true,
  loyaltyEnrollEnabled: true, loyaltyRedeemEnabled: true, giftCardEnabled: true, rebookingEnabled: true,
  // Functional Decision 27 (Oct 1 2026): was $500 with no percentage rule.
  maxAddedValueCents: 3000, maxAddedPercent: 30, allowAfterServiceDone: true,
};

export interface UpsellSettingsLayer { enabled?: boolean; tunables?: Partial<UpsellTunables>; }
export interface EffectiveUpsellSettings { enabled: boolean; disabledAtLevel: string | null; tunables: UpsellTunables; }

const clampInt = (v: unknown, lo: number, hi: number, dflt: number): number => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

/** Resolve the effective settings from ordered layers. Disabled-wins: the FIRST layer that sets enabled:false disables
 *  the assistant and records the level. Tunables merge in order; caps clamp to safe ranges. */
export function resolveSettings(layers: { platform: UpsellTunables; tenant?: UpsellSettingsLayer; branch?: UpsellSettingsLayer; device?: UpsellSettingsLayer; user?: UpsellSettingsLayer }): EffectiveUpsellSettings {
  const order: [string, UpsellSettingsLayer | undefined][] = [['tenant', layers.tenant], ['branch', layers.branch], ['device', layers.device], ['user', layers.user]];
  let disabledAtLevel: string | null = null;
  for (const [level, l] of order) { if (l?.enabled === false) { disabledAtLevel = level; break; } }

  const merged: UpsellTunables = { ...layers.platform };
  for (const [, l] of order) if (l?.tunables) Object.assign(merged, l.tunables);
  const t: UpsellTunables = {
    maxTotal: clampInt(merged.maxTotal, 0, 8, PLATFORM_DEFAULTS.maxTotal),
    maxAddOn: clampInt(merged.maxAddOn, 0, 5, PLATFORM_DEFAULTS.maxAddOn),
    maxProduct: clampInt(merged.maxProduct, 0, 5, PLATFORM_DEFAULTS.maxProduct),
    maxMembership: clampInt(merged.maxMembership, 0, 2, PLATFORM_DEFAULTS.maxMembership),
    addOnsEnabled: merged.addOnsEnabled !== false,
    productsEnabled: merged.productsEnabled !== false,
    membershipEnabled: merged.membershipEnabled !== false,
    loyaltyEnrollEnabled: merged.loyaltyEnrollEnabled !== false,
    loyaltyRedeemEnabled: merged.loyaltyRedeemEnabled !== false,
    giftCardEnabled: merged.giftCardEnabled !== false,
    rebookingEnabled: merged.rebookingEnabled !== false,
    maxAddedValueCents: clampInt(merged.maxAddedValueCents, 0, 1000000, PLATFORM_DEFAULTS.maxAddedValueCents),
    maxAddedPercent: clampInt(merged.maxAddedPercent, 0, 100, PLATFORM_DEFAULTS.maxAddedPercent),
    allowAfterServiceDone: merged.allowAfterServiceDone !== false,
  };
  return { enabled: disabledAtLevel === null, disabledAtLevel, tunables: t };
}

// ---- persistence mapping (pure; the Kysely adapter feeds rows) ----
export interface SettingsRow { level: 'tenant' | 'branch' | 'device' | 'user'; branch_id: string | null; device_id: string | null; user_id: string | null; enabled: boolean | null; tunables: Partial<UpsellTunables> | null; }

export function rowsToLayers(rows: SettingsRow[], ctx: { branchId?: string; deviceId?: string | null; userId?: string }): { tenant?: UpsellSettingsLayer; branch?: UpsellSettingsLayer; device?: UpsellSettingsLayer; user?: UpsellSettingsLayer } {
  const out: { tenant?: UpsellSettingsLayer; branch?: UpsellSettingsLayer; device?: UpsellSettingsLayer; user?: UpsellSettingsLayer } = {};
  const toLayer = (r: SettingsRow): UpsellSettingsLayer => ({ ...(r.enabled == null ? {} : { enabled: r.enabled }), ...(r.tunables ? { tunables: r.tunables } : {}) });
  for (const r of rows) {
    if (r.level === 'tenant') out.tenant = toLayer(r);
    else if (r.level === 'branch' && ctx.branchId && r.branch_id === ctx.branchId) out.branch = toLayer(r);
    else if (r.level === 'device' && ctx.deviceId && r.device_id === ctx.deviceId) out.device = toLayer(r);
    else if (r.level === 'user' && ctx.userId && r.user_id === ctx.userId) out.user = toLayer(r);
  }
  return out;
}

/** Functional Decision 27 — the most a set of add-on + product suggestions may add to this visit: the lower of the hard
 *  cap and the percentage of the booked service subtotal. With no booked subtotal (nothing to anchor a percentage), the
 *  hard cap alone applies. */
export function effectiveAddedValueCapCents(t: Pick<UpsellTunables, 'maxAddedValueCents' | 'maxAddedPercent'>, subtotalCents: number): number {
  const hard = Math.max(0, Math.floor(t.maxAddedValueCents));
  if (!(subtotalCents > 0)) return hard;
  return Math.min(hard, Math.floor((subtotalCents * Math.max(0, t.maxAddedPercent)) / 100));
}

