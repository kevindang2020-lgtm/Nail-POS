// opsStatus.ts — WP-C1 (Vietnamese POS mandate): the label of a front-desk status code the boards mix together
// (appointment / queue / technician / message statuses arrive on the same Overview / Live Ops rows). The code stays the
// authority (tone, filters); only the label is translated. Lookup: the canonical status labels (ns/status, WP-D1) first,
// then the few message / board words only these screens show (ns/ops `ops.status.<code>`), then the humanised code.
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { statusLabelOrNull, humanizeCode } from '../i18n/status-label';

const DOMAINS = ['appointment', 'queueItem', 'techTicket', 'turnBoard'] as const;

export function opsStatusLabel(code: string | null | undefined): string {
  if (code == null || code === '') return '';
  const canonical = statusLabelOrNull(DOMAINS, code);
  if (canonical) return canonical;
  const key = `ops.status.${String(code).toLowerCase()}`;
  const own = t(key);
  return own !== key ? own : humanizeCode(String(code));
}

/** a board word the server sends as English text ("Finishing Soon", "Quality Check", "Now") — labelled by its slug; an
 *  unknown word (a salon's own stage name) is shown as sent */
export function floorLabel(word: string | null | undefined): string {
  if (word == null || word === '') return '';
  const slug = String(word).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const canonical = statusLabelOrNull(DOMAINS, slug);
  if (canonical) return canonical;
  const key = `ops.status.${slug}`;
  const own = t(key);
  return own !== key ? own : String(word);
}

const ACTION_KEYS: Record<string, string> = { 'Review Now': 'ops.insight.reviewNow', 'Open Profile': 'ops.insight.openProfile', Balance: 'ops.insight.balance', Open: 'ops.insight.open' };
/** a Serving / Service Done AI insight in the cashier's language: written from its id + the numbers / names the server
 *  sent (`vars`); an insight the POS has no text for (or an older server without vars) shows the server's words */
export function floorInsight(scope: 'serving' | 'serviceDone', ins: { id: string; text: string; sub?: string; action?: string; vars?: Record<string, string | number> }): { text: string; sub?: string; actionText?: string } {
  const key = `ops.${scope}.insight.${ins.id}`;
  const own = ins.vars ? t(key, ins.vars) : key;
  const known = own !== key;
  const subKey = `ops.${scope}.insightSub.${ins.id}`;
  const sub = known ? (t(subKey) !== subKey ? t(subKey) : undefined) : ins.sub;
  const actionText = ins.action ? (ACTION_KEYS[ins.action] ? t(ACTION_KEYS[ins.action]) : ins.action) : undefined;
  return { text: known ? own : ins.text, sub, actionText };
}
