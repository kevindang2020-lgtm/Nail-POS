import { useEffect, useState } from 'react';
import { posMembershipEnrollApi } from '../api/posMembershipEnrollApi';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { codeLabel } from '../components/codeLabel';

// MembershipBadge — a small, drop-in indicator for any POS surface that has a customerId (check-in, queue, Service Done,
// checkout). It reads the customer's memberships and shows the active plan + status, or nothing for non-members. Purely
// presentational beyond the one read; it never blocks the surface it's placed in.

const ACTIVE = new Set(['active', 'trial', 'grace', 'comped']);
// a membership status code → people.membership.status.<code> (WP-C2's labels), read at render
const statusText = (code: string) => codeLabel('people.membership.status', code);
const TONE: Record<string, { bg: string; fg: string }> = {
  active: { bg: '#E7F3EC', fg: '#2E7D55' }, trial: { bg: '#FBF1DC', fg: '#9A6B12' }, comped: { bg: '#EDE7F6', fg: '#5B4699' },
  grace: { bg: '#FBF1DC', fg: '#9A6B12' }, past_due: { bg: '#F7E3E3', fg: '#A33B3B' }, paused: { bg: '#EEE8DD', fg: '#6A5A46' },
};

interface MemberInfo { membershipId: string; planName: string | null; status: string }

export function MembershipBadge({ customerId, compact }: { customerId: string | null | undefined; compact?: boolean }) {
  const [info, setInfo] = useState<MemberInfo | null>(null);
  useEffect(() => {
    if (!customerId) { setInfo(null); return; }
    let alive = true;
    (posMembershipEnrollApi.customerMemberships(customerId) as Promise<any>)
      .then((r) => {
        if (!alive) return;
        const list: any[] = r?.memberships || [];
        const active = list.find((m) => ACTIVE.has(m.status)) || list[0] || null;
        setInfo(active ? { membershipId: active.membershipId, planName: active.planName, status: active.status } : null);
      })
      .catch(() => { if (alive) setInfo(null); });
    return () => { alive = false; };
  }, [customerId]);

  if (!info) return null;
  const tone = TONE[info.status] || { bg: '#EEE8DD', fg: '#6A5A46' };
  return (
    <span title={t('pos.member_v0', { v0: String(statusText(info.status)) })} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: compact ? '1px 6px' : '2px 8px', borderRadius: 999, background: tone.bg, color: tone.fg, fontSize: compact ? 11 : 12, fontWeight: 700, lineHeight: 1.4 }}>
      <span aria-hidden>★</span>{compact ? (info.planName || t('pos.member')) : `${info.planName || t('pos.member')} · ${statusText(info.status)}`}
    </span>
  );
}
