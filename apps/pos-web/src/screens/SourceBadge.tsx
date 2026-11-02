// SourceBadge.tsx — compact, labeled booking-source badge for appointment cards/details (§47). Maps both the domain
// source values stored on appointments (phone/manual/online/walk_in/customer_app/ai/google/pos_manual) AND the
// ai_booking channel sources (AI_PHONE_RECEPTIONIST, FRONT_DESK_POS, …) to a friendly label + a subtle tint, so staff
// can see at a glance where a booking came from. Presentational only; unknown values fall back to the raw string.
import React from 'react';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { statusLabel } from '../i18n/status-label';

type Meta = { label: string; bg: string; fg: string };

const MAP: Record<string, Meta> = {
  // AI phone
  phone: { get label() { return t('pos.ai_phone_2'); }, bg: '#EFE7FA', fg: '#5B3E9B' },
  ai_phone_receptionist: { get label() { return t('pos.ai_phone_2'); }, bg: '#EFE7FA', fg: '#5B3E9B' },
  ai: { label: 'AI', bg: '#EFE7FA', fg: '#5B3E9B' },
  // front desk
  manual: { get label() { return t('pos.front_desk_2'); }, bg: '#F3ECDD', fg: '#8A6A22' },
  pos_manual: { get label() { return t('pos.front_desk_2'); }, bg: '#F3ECDD', fg: '#8A6A22' },
  front_desk_pos: { get label() { return t('pos.front_desk_2'); }, bg: '#F3ECDD', fg: '#8A6A22' },
  // customer app
  customer_app: { get label() { return t('pos.customer_app'); }, bg: '#E5F1F0', fg: '#2E6E67' },
  customer_mobile_app: { get label() { return t('pos.customer_app'); }, bg: '#E5F1F0', fg: '#2E6E67' },
  // online
  online: { get label() { return t('pos.online'); }, bg: '#E4EEF8', fg: '#2C5C8F' },
  online_booking: { get label() { return t('pos.online'); }, bg: '#E4EEF8', fg: '#2C5C8F' },
  google: { get label() { return t('pos.google'); }, bg: '#E4EEF8', fg: '#2C5C8F' },
  // partner
  partner_booking_link: { get label() { return t('pos.partner'); }, bg: '#F6E9E1', fg: '#9B5B33' },
  // walk-in
  walk_in: { get label() { return t('pos.walk_in'); }, bg: '#ECEFE3', fg: '#5F7031' },
  walk_in_conversion: { get label() { return t('pos.walk_in'); }, bg: '#ECEFE3', fg: '#5F7031' },
  // support
  super_admin_support_mode: { get label() { return t('pos.support'); }, bg: '#F7E4E4', fg: '#9B3B3B' },
};

export function sourceLabel(source: string | null | undefined): string {
  if (!source) return '—';
  return MAP[source.toLowerCase()]?.label ?? statusLabel('source', source);   // unknown: the canonical source label (never a raw code)
}

export default function SourceBadge({ source, title }: { source: string | null | undefined; title?: string }) {
  if (!source) return <span style={{ color: 'var(--muted,#9B8B78)' }}>—</span>;
  const meta = MAP[source.toLowerCase()] ?? { label: statusLabel('source', source), bg: '#EEE9DF', fg: '#6B5D46' };
  return (
    <span
      title={title ?? t('pos.booking_source_label', { label: String(meta.label) })}
      style={{ display: 'inline-block', padding: '1px 7px', borderRadius: 999, background: meta.bg, color: meta.fg, fontSize: 11, fontWeight: 700, lineHeight: '16px', whiteSpace: 'nowrap' }}
    >
      {meta.label}
    </span>
  );
}
