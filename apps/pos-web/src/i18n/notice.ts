// notice.ts — a message kept in React state as a KEY, translated when it is rendered (English + Vietnamese POS mandate
// §6/§7/§105/§108; build plan WP-B rule "store { key, vars } and translate at render", mandatory for the payment-safety
// banner). A screen that did `setNote(t('pos.x', vars))` froze the text in the language of the moment; with
// `setNote(msg('pos.x', vars))` the same note re-reads in Vietnamese the instant the cashier switches.
//
//   msg('payment.verify.pending', { seconds: 60 })                   a catalogue text with {placeholders}
//   msg('payment.result.cardStatus', { status: st('payment', code) }) a placeholder that is itself translated
//   parts([a, b], ' · ')                                              several messages joined
//   'plain text'                                                      a string as-is (a server's / an error's own words)
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { statusLabel } from './status-label';

export type MsgVar = string | number | Msg;
export type Msg =
  | string
  | { readonly key: string; readonly vars?: Readonly<Record<string, MsgVar>> }
  | { readonly parts: readonly Msg[]; readonly sep?: string }
  | { readonly statusDomain: string | readonly string[]; readonly code: string };

export const msg = (key: string, vars?: Record<string, MsgVar>): Msg => (vars ? { key, vars } : { key });
export const parts = (list: readonly Msg[], sep = ' '): Msg => ({ parts: list, sep });
/** a canonical status code shown as its label (statusLabel) at render time */
export const st = (statusDomain: string | readonly string[], code: string): Msg => ({ statusDomain, code });

/** the message in the current language (call it in render) */
export function renderMsg(m: Msg | null | undefined): string {
  if (m == null) return '';
  if (typeof m === 'string') return m;
  if ('parts' in m) return m.parts.map(renderMsg).filter(Boolean).join(m.sep ?? ' ');
  if ('statusDomain' in m) return statusLabel(m.statusDomain, m.code);
  if (!m.vars) return t(m.key);
  const vars: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(m.vars)) vars[k] = typeof v === 'number' ? v : renderMsg(v);
  return t(m.key, vars);
}
