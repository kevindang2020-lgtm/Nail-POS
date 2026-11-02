// CommunityEmergencyBanner.tsx — the shell-level Safety Community emergency banner (contract §5): high / critical
// advisories published in the last 72 h (GET /community/alerts/active — followed categories first), shown above every
// POS screen. Dismissed per USER in localStorage (try/catch — a private window or blocked storage just shows it again).
// Hidden without community.feed.view, on any error (403 for a technician without the salon's grant), and when empty.
// Realtime `community_alert` / `community_post_updated` (refetch key "community") reload it.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SyncTickReason } from '@aipowersalon/realtime-client';
import { Link } from 'react-router-dom';
import type { CommunityActiveAlert } from '@aipowersalon/api-contracts/tenant';
import { useAuth } from '../../auth/AuthContext';
import { useCan } from '../../components/usePermissions';
import { useRealtime } from '../../realtime/useRealtime';
import { posCommunityApi as api } from '../../api/posCommunityApi';
import { CATEGORY_LABEL, P, SEVERITY_LABEL } from './communityUi';
import { t } from '@aipowersalon/mobile-sdk/i18n';

export const dismissKey = (userId: string | null | undefined) => `aps.community.dismissedAlerts.${userId || 'anon'}`;
export function readDismissed(userId: string | null | undefined): string[] {
  try { const v = JSON.parse(localStorage.getItem(dismissKey(userId)) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; }
  catch { return []; }
}
function writeDismissed(userId: string | null | undefined, ids: string[]) {
  try { localStorage.setItem(dismissKey(userId), JSON.stringify(ids.slice(-200))); } catch { /* storage unavailable — dismissal lasts this session only */ }
}
const RANK: Record<string, number> = { critical: 0, high: 1, moderate: 2, low: 3, informational: 4 };

export function CommunityEmergencyBanner() {
  const { principal } = useAuth();
  const can = useCan();
  const userId = principal?.userId ?? null;
  const allowed = can(P.view);
  const [alerts, setAlerts] = useState<CommunityActiveAlert[]>([]);
  const [dismissed, setDismissed] = useState<string[]>(() => readDismissed(userId));
  useEffect(() => { setDismissed(readDismissed(userId)); }, [userId]);

  // A salon not in the Safety Community must not be asked for alerts at all (it used to get one 403 community_disabled per
  // POS screen per minute). The salon's community settings (200 with `enabled`, the same permission) are read on mount and
  // on a pushed 'community' event / reconcile — not on every tick; while the community is off nothing is polled. A 403
  // community_disabled from the alerts call (turned off between reads) also stops polling; any other error keeps polling
  // (a network blip is not "off"), and unreadable settings fall back to asking for alerts. (BUILD_PLAN Phase 12)
  const enabled = useRef<boolean | null>(null);
  const load = useCallback((reason?: SyncTickReason) => {
    if (!allowed) return Promise.resolve();
    const tick = reason === 'interval' || reason === 'visible' || reason === 'focus';
    const gate = (!tick || enabled.current === null)
      ? api.settings().then((s) => { enabled.current = !!(s as { enabled?: boolean } | null)?.enabled; }).catch(() => { enabled.current = null; })
      : Promise.resolve();
    return gate.then(() => {
      if (enabled.current === false) { setAlerts([]); return undefined; }
      return api.activeAlerts().then((a) => { setAlerts(Array.isArray(a) ? a : []); })
        .catch((e) => { if ((e as { code?: string })?.code === 'community_disabled') enabled.current = false; setAlerts([]); });
    });
  }, [allowed]);
  useEffect(() => { load('manual'); }, [load]);
  useRealtime(['community'], load, { intervalMs: 60_000 });

  const visible = alerts.filter((a) => (a.severity === 'critical' || a.severity === 'high') && !dismissed.includes(a.postId))
    .sort((a, b) => (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9));
  if (!allowed || visible.length === 0) return null;
  const top = visible[0];
  const dismiss = () => { const next = [...dismissed, top.postId]; setDismissed(next); writeDismissed(userId, next); };
  const critical = top.severity === 'critical';
  return (
    <div role="alert" aria-label={t('pos.safety_community_alert')} data-testid="community-emergency-banner"
      style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '8px 16px', background: critical ? '#F4CFC4' : '#FBEEDD', color: critical ? '#6E2410' : '#6B4A14', borderBottom: '1px solid #E7C6BB', fontSize: 13 }}>
      <strong>{SEVERITY_LABEL[top.severity]} {t('pos.safety_alert')}</strong>
      <span style={{ minWidth: 0 }}>{top.title} · {CATEGORY_LABEL[top.category] ?? top.category} · {top.author?.label || t('pos.a_salon')}</span>
      {visible.length > 1 ? <span>+{visible.length - 1} {t('pos.more')}</span> : null}
      <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
        <Link to={`/community/posts/${encodeURIComponent(top.postId)}`} style={{ fontWeight: 700, color: 'inherit' }}>{t('pos.view_advisory')}</Link>
        <button type="button" onClick={dismiss} aria-label={t('pos.dismiss_alert_title', { title: String(top.title) })} style={{ border: '1px solid currentColor', background: 'transparent', color: 'inherit', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontFamily: 'inherit' }}>{t('pos.dismiss')}</button>
      </span>
    </div>
  );
}
