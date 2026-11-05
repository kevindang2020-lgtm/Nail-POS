// ttp-kill-switch.ts — mandate §197–§199: the platform can switch Tap to Pay on iPhone off (all providers, or one provider)
// WITHOUT touching Clover Compact / CardPointe terminal / cash / gift-card payments. The switches are the two
// platform_settings rows the Super Admin kill-switch centre toggles (modules/super-admin kill-switches.ts, step-up +
// reason + audit): 'payments.tap_to_pay_disabled' and 'payments.fiserv_tap_to_pay_disabled'. Read here with a 15 s
// cache (the same discipline as PaymentGatewayResolver.integrationPaused); a failed read keeps the last value.
import { sql } from 'kysely';

export type TapToPayKillReason = 'platform' | 'provider';
export interface TapToPayKillSwitchPort {
  /** Why Tap to Pay is off for this provider right now, or null when it is on. */
  disabledReason(provider: string): Promise<TapToPayKillReason | null>;
}

export const TTP_PLATFORM_SWITCH = 'payments.tap_to_pay_disabled';
/** provider name (TapToPaySessionPort / PaymentIntent.provider) → its provider-specific switch */
export const TTP_PROVIDER_SWITCHES: Readonly<Record<string, string>> = { fiserv_commercehub: 'payments.fiserv_tap_to_pay_disabled' };

export class InMemoryTapToPayKillSwitch implements TapToPayKillSwitchPort {
  constructor(public platformOff = false, public providersOff: Set<string> = new Set()) {}
  async disabledReason(provider: string): Promise<TapToPayKillReason | null> {
    if (this.platformOff) return 'platform';
    return this.providersOff.has(provider) ? 'provider' : null;
  }
}

export class KyselyTapToPayKillSwitch implements TapToPayKillSwitchPort {
  private cache = new Map<string, { at: number; off: boolean }>();
  constructor(private readonly db: any, private readonly ttlMs = 15_000, private readonly now: () => number = Date.now) {}
  private async read(key: string): Promise<boolean> {
    const hit = this.cache.get(key);
    const t = this.now();
    if (hit && t - hit.at < this.ttlMs) return hit.off;
    try {
      const r: any = await sql`select value from platform_settings where setting_key = ${key} limit 1`.execute(this.db);
      const v = r?.rows?.[0]?.value;
      this.cache.set(key, { at: t, off: v === true || v === 'true' });
    } catch { if (!hit) this.cache.set(key, { at: t, off: false }); }
    return this.cache.get(key)!.off;
  }
  async disabledReason(provider: string): Promise<TapToPayKillReason | null> {
    if (await this.read(TTP_PLATFORM_SWITCH)) return 'platform';
    const pk = TTP_PROVIDER_SWITCHES[provider];
    if (pk && await this.read(pk)) return 'provider';
    return null;
  }
}
