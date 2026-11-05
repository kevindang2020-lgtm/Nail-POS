// kiosk-pin-limiter.ts — per-process failure window for kiosk PIN identification (Technician Profile merge, Oct 12
// 2026). Counts FAILED identifications per (tenant, kiosk) so an attacker enumerating the 4-digit space against every
// technician is stopped after KIOSK_PIN_FAIL_LIMIT misses; the per-technician lockout in clock-pin-core (DB row) still
// protects a PIN that already matched someone. Per API instance; a Redis-shared window (@aipowersalon/security
// KeyedRateLimiter) can replace it when RATE_LIMIT_STORE=redis is wired — the limiter is never silently absent.
import type { KioskPinLimiter } from './technician-clock-pin.service';

export class InMemoryKioskPinLimiter implements KioskPinLimiter {
  private readonly events = new Map<string, number[]>();
  constructor(private readonly now: () => number = Date.now) {}
  async count(scope: string, key: string, windowMs: number) {
    const t = this.now();
    const arr = (this.events.get(scope + '|' + key) || []).filter((x) => x > t - windowMs);
    this.events.set(scope + '|' + key, arr);
    return { count: arr.length, oldestMs: arr.length ? arr[0] : null };
  }
  async record(scope: string, key: string) {
    const k = scope + '|' + key;
    this.events.set(k, [...(this.events.get(k) || []), this.now()]);
  }
}
