// login-risk.ts — Constitution 3 §58–60 (Step 10b, Oct 3 2026): risk signals at sign-in, from data already recorded.
//   • credential stuffing: one network address failing for MANY DIFFERENT accounts in a short window is blocked for a
//     while (login_attempts, migration 001, records every attempt). The per-account throttle never saw this pattern —
//     it keys on (portal, salon, identifier, ip), so one IP spraying 500 accounts tripped nothing.
//   • elevated sign-in: a device this account has never used AND a network it has never signed in from — only for an
//     account WITH history (no history is not "new": the first sign-ins after deploy must not look risky). Elevated →
//     the authenticator is required for anyone who has one (even with two-factor switched off), and it is logged.
// Not built: impossible travel (no IP geolocation data here) and an email-code challenge for accounts with no
// authenticator (it changes every app's sign-in screen — a product decision, recorded in AUTHENTICATION_AUDIT.md).
import { createHash } from 'node:crypto';
import { sql } from 'kysely';

export const STUFFING_WINDOW_MIN = 10;
export const STUFFING_DISTINCT_ACCOUNTS = 10;
export const NETWORK_HISTORY_DAYS = 90;
/** The network an address belongs to: IPv4 /24, IPv6 /48. Anything else → null (no signal). */
export function ipNetwork(ip: string | null | undefined): string | null {
  const s = String(ip ?? '').trim().replace(/^::ffff:/i, '');
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  if (s.includes(':')) { const parts = s.split('::')[0].split(':').filter(Boolean); if (parts.length >= 3) return `${parts.slice(0, 3).join(':').toLowerCase()}::/48`; }
  return null;
}
export type RiskLevel = 'normal' | 'elevated';
export interface RiskSignals { newDevice: boolean; newNetwork: boolean; hasHistory: boolean }
export function assessRisk(s: RiskSignals): RiskLevel { return s.hasHistory && s.newDevice && s.newNetwork ? 'elevated' : 'normal'; }

export interface LoginRiskPort {
  stuffingBlocked(ip: string | null | undefined): Promise<boolean>;
  assess(userId: string, deviceKey: string | null | undefined, ip: string | null | undefined): Promise<{ level: RiskLevel; signals: RiskSignals }>;
}
export class KyselyLoginRisk implements LoginRiskPort {
  constructor(private readonly db: any) {}
  async stuffingBlocked(ip: string | null | undefined): Promise<boolean> {
    if (!ip) return false;
    try {
      const r: any = (await sql`select count(distinct identifier)::int as n from login_attempts
        where ip_address = ${ip}::inet and success = false and created_at > now() - make_interval(mins => ${STUFFING_WINDOW_MIN})`.execute(this.db)).rows[0];
      return Number(r?.n ?? 0) >= STUFFING_DISTINCT_ACCOUNTS;
    } catch { return false; }   // never block sign-in on a failed risk read
  }
  async assess(userId: string, deviceKey: string | null | undefined, ip: string | null | undefined): Promise<{ level: RiskLevel; signals: RiskSignals }> {
    const normal = { level: 'normal' as const, signals: { newDevice: false, newNetwork: false, hasHistory: false } };
    try {
      const dev: any = (await sql`select count(*)::int as total, count(*) filter (where device_key_hash = ${deviceKey ? createHash('sha256').update(deviceKey).digest('hex') : '-'} and trust_state <> 'revoked')::int as known from auth_devices where user_id = ${userId}::uuid`.execute(this.db)).rows[0];
      const net = ipNetwork(ip);
      const hist: any = (await sql`select ip from auth_events where user_id = ${userId}::uuid and event_type = 'LOGIN_SUCCEEDED' and ip is not null and occurred_at > now() - make_interval(days => ${NETWORK_HISTORY_DAYS}) limit 500`.execute(this.db)).rows;
      const nets = new Set(hist.map((h: any) => ipNetwork(h.ip)).filter(Boolean));
      const signals: RiskSignals = { newDevice: Number(dev?.known ?? 0) === 0, newNetwork: !!net && !nets.has(net), hasHistory: Number(dev?.total ?? 0) > 0 && nets.size > 0 };
      return { level: assessRisk(signals), signals };
    } catch { return normal; }
  }
}
