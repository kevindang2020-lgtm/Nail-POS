// deal-reason-text.ts — Vietnamese POS §58 V-5 (Oct 27 2026): a deals-engine reason (DEAL_REFUSED `reasons[]`, an offer's
// not-eligible list, the wizard's eligibility preview) worded in the cashier's language from its CODE and PARAMS
// (errors.dealReason.<code> in ns/errors). English keeps the server's own sentence (it can be more specific, like the rest of
// the POS's error text); a code the POS does not know, or params the text needs and the server did not send, fall back to it.
import { t, getLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { fmtMoney, displayLocale } from './format';

export interface DealReasonLike { code?: string | null; message?: string | null; params?: Record<string, unknown> | null }

const weekday = (d: number) => new Date(Date.UTC(2023, 0, 1 + d)).toLocaleDateString(displayLocale(), { weekday: 'long', timeZone: 'UTC' });   // 2023-01-01 is a Sunday (0)
const clock = (m: number) => new Date(Date.UTC(2023, 0, 1, Math.floor(m / 60) % 24, m % 60)).toLocaleTimeString(displayLocale(), { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });

export function dealReasonText(r: DealReasonLike): string {
  const fallback = String(r?.message ?? '');
  if (getLanguage() !== 'vi' || !r?.code) return fallback;
  const p = (r.params ?? {}) as Record<string, unknown>;
  const vars: Record<string, string | number> = {};
  if (Array.isArray(p.days)) vars.days = p.days.map(Number).filter((d) => d >= 0 && d <= 6).map(weekday).join(', ');
  if (typeof p.fromMinute === 'number') vars.from = clock(p.fromMinute);
  if (typeof p.toMinute === 'number') vars.to = clock(p.toMinute);
  if (typeof p.cents === 'number') vars.amount = fmtMoney(p.cents);
  for (const k of ['count', 'max', 'minutes', 'sinceDays'] as const) if (typeof p[k] === 'number' || typeof p[k] === 'string') vars[k] = p[k] as number | string;
  const key = `errors.dealReason.${r.code}`;
  const text = t(key, vars);
  if (text === key || /\{[A-Za-z]+\}/.test(text)) return fallback || text;   // unknown code, or a placeholder the server gave no value for
  return text;
}

/** a refusal's reasons in one line (DEAL_REFUSED), else the given fallback */
export function dealReasonsLine(reasons: DealReasonLike[] | null | undefined, fallback: string): string {
  const parts = (reasons ?? []).map(dealReasonText).filter(Boolean);
  return parts.length ? parts.join(' ') : fallback;
}
