import { useEffect, useState } from 'react';
import { posMembershipEnrollApi } from '../api/posMembershipEnrollApi';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { codeLabel } from '../components/codeLabel';

// MembershipChip + useMemberStatusMap — the batch-friendly way to show member status in a LIST (check-in, queue,
// customer roster). Unlike MembershipBadge (which self-fetches for a single customer), the chip is purely
// presentational and is fed by useMemberStatusMap, which issues ONE request for every customerId on the page and
// returns a map. Non-members are simply absent from the map, so the chip never renders for them.

// a membership status code → people.membership.status.<code> (WP-C2's labels), read at render
const statusText = (code: string) => codeLabel('people.membership.status', code);
const TONE: Record<string, { bg: string; fg: string }> = {
  active: { bg: '#E7F3EC', fg: '#2E7D55' }, trial: { bg: '#FBF1DC', fg: '#9A6B12' }, comped: { bg: '#EDE7F6', fg: '#5B4699' },
  grace: { bg: '#FBF1DC', fg: '#9A6B12' }, past_due: { bg: '#F7E3E3', fg: '#A33B3B' }, paused: { bg: '#EEE8DD', fg: '#6A5A46' },
};

// A CLIENT view model built from the members-by-customers response (plan name + status per customer) — not an API
// contract, so it keeps a specific local name (it only shared the word with the server's gift-card program MembershipChipStatus).
export interface MembershipChipStatus { planName: string | null; status: string }

export function MembershipChip({ planName, status, compact }: { planName: string | null; status: string; compact?: boolean }) {
  const tone = TONE[status] || { bg: '#EEE8DD', fg: '#6A5A46' };
  return (
    <span title={t('pos.member_v0', { v0: String(statusText(status)) })} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: compact ? '1px 6px' : '2px 8px', borderRadius: 999, background: tone.bg, color: tone.fg, fontSize: compact ? 11 : 12, fontWeight: 700, lineHeight: 1.4 }}>
      <span aria-hidden>★</span>{compact ? (planName || t('pos.member')) : `${planName || t('pos.member')} · ${statusText(status)}`}
    </span>
  );
}

// Pass the customerIds visible on the page; one batch request fires and re-fires only when the SET of ids changes
// (the ids are normalized + sorted into a stable key). Returns customerId -> { planName, status } for active members.
export function useMemberStatusMap(customerIds: Array<string | null | undefined>): Record<string, MembershipChipStatus> {
  const key = [...new Set(customerIds.filter((x): x is string => !!x))].sort().join(',');
  const [map, setMap] = useState<Record<string, MembershipChipStatus>>({});
  useEffect(() => {
    const ids = key ? key.split(',') : [];
    if (!ids.length) { setMap({}); return; }
    let alive = true;
    (posMembershipEnrollApi.membersByCustomers(ids) as Promise<any>)
      .then((r) => {
        if (!alive) return;
        const next: Record<string, MembershipChipStatus> = {};
        for (const m of (r?.members || [])) next[m.customerId] = { planName: m.planName, status: m.status };
        setMap(next);
      })
      .catch(() => { if (alive) setMap({}); });
    return () => { alive = false; };
  }, [key]);
  return map;
}
