// QueueItemInner.tsx — the queue-item full-view content for the shared iPad Pro modal.
// Loads the REAL queue item (GET /pos/queue/items/:queueItemId → posQueueApi.item) — never mock data.
// Shows guest (contact, VIP, loyalty, visits, allergies), requested services, priority, status,
// requested / best-match / assigned technician, quoted & actual wait, and notes. Safe idempotent
// actions (Call Next / Start Service / Move to Serving / Notify Customer) call the same named
// endpoints the Queue screen uses; the server enforces permission + tenant.
import { useCallback, useEffect, useRef, useState } from 'react';
import { posQueueApi } from '../api/posQueueApi';
import { useRealtime } from '../realtime/useRealtime';
import { useCan } from './usePermissions';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { fmtMoney } from '../i18n/format';

import { statusLabel } from '../i18n/status-label';
const V = (n: string) => `var(--${n})`;

export interface QueueItemRow {
  queueItemId: string; customerId?: string; customerName: string; customerPhone?: string; isVip?: boolean; email?: string;
  source?: string; requestedServices?: { serviceId: string; serviceName: string; isAddon?: boolean; parentServiceId?: string; priceOverrideCents?: number; durationMin?: number }[]; serviceCount?: number; priority?: string; status?: string;
  requestedTechnicianName?: string; bestMatchTechnicianName?: string; assignedTechnicianName?: string | null; station?: string;
  checkedInAt?: string; quotedWaitMinutes?: number; actualWaitMinutes?: number; notes?: string;
  loyaltyPoints?: number; visitCount?: number; totalSpendCents?: number; preferredTechName?: string; allergies?: string;
}

const money = (c?: number | null) => fmtMoney(c ?? 0);   // the salon's currency (i18n/format)
const PRIO: Record<string, { fg: string; bg: string }> = { high: { fg: V('danger'), bg: '#FFF0ED' }, medium: { fg: V('warn'), bg: V('warn-bg') }, normal: { fg: V('muted'), bg: '#F1ECE4' }, low: { fg: V('muted'), bg: '#F1ECE4' } };

const ACTIONS: { key: string; label: string; perm: string; run: (id: string) => Promise<unknown> }[] = [
  { key: 'call-next', get label() { return t('pos.call_next'); }, perm: 'pos.queue.call_next', run: (id) => posQueueApi.callNext(id) },
  { key: 'move-to-tech', get label() { return t('pos.send_to_technician'); }, perm: 'pos.queue.move_to_tech_queue', run: (id) => posQueueApi.moveToTechQueue(id) },
  { key: 'start-service', get label() { return t('pos.start_service'); }, perm: 'pos.queue.move_to_serving', run: (id) => posQueueApi.startService(id) },
  { key: 'move-to-serving', get label() { return t('pos.move_to_serving'); }, perm: 'pos.queue.move_to_serving', run: (id) => posQueueApi.moveToServing(id) },
  { key: 'notify-customer', get label() { return t('pos.notify_customer'); }, perm: 'pos.queue.edit', run: (id) => posQueueApi.notifyCustomer(id, {}) },
];

// The status each action moves the item to server-side — used for an OPTIMISTIC badge update so the tap feels instant.
// (matches the queue service: callNext→called, start/move→in_service; notify changes no status.) The real state is
// reconciled in the background right after, and any mismatch is corrected.
const OPTIMISTIC_STATUS: Record<string, string | undefined> = {
  'call-next': 'called',
  'move-to-tech': 'moved_to_tech_queue',
  'start-service': 'in_service',
  'move-to-serving': 'in_service',
  'notify-customer': undefined,
};

// Which actions are valid from a given queue status — mirrors the server (canMoveToServing blocks in_service /
// cancelled / removed; call-next / notify apply while the guest is still pre-service). Unknown statuses fail OPEN
// (show the action) so the server stays the source of truth and we never hide a legitimately-available action.
const KNOWN_STATUS = new Set(['waiting', 'called', 'assigned', 'ready_for_tech', 'in_service', 'moved_to_tech_queue', 'cancelled', 'removed']);
function actionValidForStatus(key: string, status?: string): boolean {
  const s = (status || '').toLowerCase();
  if (!KNOWN_STATUS.has(s)) return true;
  const preService = s === 'waiting' || s === 'called' || s === 'assigned' || s === 'ready_for_tech';
  switch (key) {
    case 'call-next': return s === 'waiting' || s === 'called';
    case 'move-to-tech': return (s === 'waiting' || s === 'called' || s === 'assigned' || s === 'ready_for_tech'); // Backend handles no-tech gracefully, but we show it if preService. Actually, backend needs tech assigned. Let's rely on backend error or just preService.
    case 'start-service':
    case 'move-to-serving': return preService;   // canMoveToServing rejects in_service / moved / cancelled / removed
    case 'notify-customer': return preService;
    default: return true;
  }
}

export function QueueItemInner({ queueItemId, initial, onChanged }: { queueItemId: string; initial?: QueueItemRow; onChanged?: () => void }) {
  const [row, setRow] = useState<QueueItemRow | null>(initial || null);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const alive = useRef(true);
  const can = useCan();

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const d = await posQueueApi.item(queueItemId); if (alive.current) setRow(d as QueueItemRow); }
    catch (e: any) { if (alive.current) setError(e?.message || t('pos.could_not_load_this_queue_item')); }
    finally { if (alive.current) setLoading(false); }
  }, [queueItemId]);
  useEffect(() => { alive.current = true; load(); return () => { alive.current = false; }; }, [load]);
  // Live refresh: re-fetch when a realtime queue event changes the underlying record.
  useRealtime('queue', load);

  // Background truth-sync after an optimistic action — no full-screen loader, so it never blanks the open card.
  const reconcile = useCallback(async () => {
    try { const d = await posQueueApi.item(queueItemId); if (alive.current) setRow(d as QueueItemRow); }
    catch { /* keep the optimistic state; the realtime 'queue' event will resync */ }
  }, [queueItemId]);

  const doAction = async (key: string) => {
    const action = ACTIONS.find((a) => a.key === key)!;
    const snapshot = row;
    setBusy(key); setError(null);
    // Optimistic: reflect the transition on the badge immediately, before the round-trip — the tap feels instant.
    const nextStatus = OPTIMISTIC_STATUS[key];
    if (nextStatus && row) setRow({ ...row, status: nextStatus });
    try {
      await action.run(queueItemId);
      onChanged?.();
      void reconcile();                                 // background — does not hold the button or blank the card
    } catch (e: any) {
      if (alive.current) { if (snapshot) setRow(snapshot); setError(e?.message || t('pos.could_not_v0', { v0: String(key.replace(/-/g, ' ')) })); }  // roll back
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  if (loading && !row) return <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: V('muted'), fontSize: 13 }} aria-busy="true">{t('pos.loading_queue_item')}</div>;
  if (error && !row) return <div role="alert" style={{ flex: 1, display: 'grid', placeItems: 'center', textAlign: 'center', padding: 40 }}><div><div style={{ fontSize: 24 }}>⚠️</div><div style={{ color: V('danger'), fontWeight: 700, marginTop: 6 }}>{error}</div></div></div>;
  if (!row) return null;

  const prio = PRIO[(row.priority || 'normal').toLowerCase()] || PRIO.normal;
  const renderServices = () => {
    if (!row.requestedServices?.length) return '—';
    const roots = row.requestedServices.filter(s => !s.isAddon);
    const addons = row.requestedServices.filter(s => s.isAddon);
    return roots.map(root => (
      <div key={root.serviceId || root.serviceName} style={{ marginBottom: 4 }}>
        <div style={{ fontWeight: 600 }}>{root.serviceName}</div>
        {addons.filter(a => a.parentServiceId === root.serviceId).map(a => (
          <div key={a.serviceId || a.serviceName} style={{ fontSize: 12, color: V('muted'), marginLeft: 12, borderLeft: `2px solid ${V('line')}`, paddingLeft: 6, marginTop: 2 }}>
            + {a.serviceName} {a.priceOverrideCents != null ? `(${money(a.priceOverrideCents)})` : ''}
          </div>
        ))}
      </div>
    ));
  };
  const card: React.CSSProperties = { background: V('card'), border: `1px solid ${V('line')}`, borderRadius: 12, padding: 14 };
  const head: React.CSSProperties = { fontSize: 11, color: V('muted'), fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 };
  const stat = (l: string, v: React.ReactNode) => <div style={{ minWidth: 0 }}><div style={{ fontSize: 10, color: V('muted'), fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em' }}>{l}</div><div style={{ fontSize: 15, fontWeight: 800, marginTop: 2 }}>{v}</div></div>;

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 18px', display: 'grid', gap: 14, alignContent: 'start' }}>
      {error && <div role="alert" style={{ background: '#FFF0ED', border: `1px solid #F6D9D2`, color: V('danger'), borderRadius: 10, padding: '8px 12px', fontSize: 12.5, fontWeight: 600 }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 14 }}>
        <div style={card}>
          <div style={head}>{t('pos.guest')}</div>
          <div style={{ fontSize: 15, fontWeight: 800 }}>{row.customerName}{row.isVip ? <span style={{ marginLeft: 6, fontSize: 11, color: V('gold'), fontWeight: 800 }}>{t('pos.vip')}</span> : null}</div>
          <div style={{ fontSize: 12.5, color: V('muted'), marginTop: 3 }}>{row.customerPhone || row.email || '—'}{row.visitCount != null ? t('pos.visitcount_visits', { visitCount: String(row.visitCount) }) : ''}{row.loyaltyPoints != null ? t('pos.v0_pts', { v0: String(row.loyaltyPoints.toLocaleString()) }) : ''}</div>
          {row.allergies && <div style={{ marginTop: 6, fontSize: 12, color: V('danger'), fontWeight: 700, background: '#FFF0ED', border: '1px solid #F6D9D2', borderRadius: 8, padding: '4px 8px' }}>{t('pos.allergies_2')}{' '}{row.allergies}</div>}
        </div>
        <div style={card}>
          <div style={head}>{t('pos.priority_status')}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 800, borderRadius: 999, padding: '3px 11px', background: prio.bg, color: prio.fg }}>{statusLabel('priority', row.priority) || t('pos.normal')}</span>
            <span style={{ fontSize: 11, fontWeight: 800, borderRadius: 999, padding: '3px 11px', background: V('ok-bg'), color: V('ok') }}>{statusLabel('queueItem', row.status)}</span>
          </div>
        </div>
      </div>

      <div style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {stat(t('ops.queue.quotedWait'), row.quotedWaitMinutes != null ? t('pos.quotedwaitminutes_min', { quotedWaitMinutes: String(row.quotedWaitMinutes) }) : '—')}
        {stat(t('ops.queue.actualWait'), row.actualWaitMinutes != null ? t('pos.actualwaitminutes_min', { actualWaitMinutes: String(row.actualWaitMinutes) }) : '—')}
        {stat(t('pos.station'), row.station || '—')}
      </div>

      <div style={card}>
        <div style={head}>{t('pos.requested_services')}{row.serviceCount ? ` · ${row.serviceCount}` : ''}</div>
        <div style={{ fontSize: 13.5 }}>{renderServices()}</div>
      </div>

      <div style={card}>
        <div style={head}>{t('pos.technician')}</div>
        <div style={{ display: 'grid', gap: 3, fontSize: 13 }}>
          <div><b>{t('pos.assigned')}</b> · {row.assignedTechnicianName || t('pos.unassigned')}</div>
          {row.requestedTechnicianName && <div style={{ color: V('muted') }}>{t('pos.requested_3')}{' '}{row.requestedTechnicianName}</div>}
          {row.bestMatchTechnicianName && <div style={{ color: V('muted') }}>{t('pos.best_match')}{' '}{row.bestMatchTechnicianName}</div>}
        </div>
      </div>

      {row.notes && (
        <div style={{ ...card, background: V('page') }}>
          <div style={head}>{t('pos.notes')}</div>
          <div style={{ fontSize: 13, lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>{row.notes}</div>
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 9 }}>
        {(() => {
          const actions = ACTIONS.filter((a) => can(a.perm) && actionValidForStatus(a.key, row.status));
          if (actions.length === 0) return <div style={{ fontSize: 12.5, color: V('muted'), fontWeight: 600 }}>{t('pos.no_queue_actions_for_a_guest_zybg')}{' '}{statusLabel('queueItem', row.status).toLowerCase() || t('pos.in_this_state')}.</div>;
          return actions.map((a, i) => (
            <button key={a.key} onClick={() => doAction(a.key)} disabled={!!busy} style={btn(i === 0)}>{busy === a.key ? '…' : a.label}</button>
          ));
        })()}
      </div>
    </div>
  );
}

function btn(primary: boolean): React.CSSProperties {
  return { fontFamily: 'inherit', fontSize: 12.5, fontWeight: 800, borderRadius: 9, padding: '9px 16px', cursor: 'pointer',
    border: primary ? 'none' : `1px solid ${V('line')}`, background: primary ? V('orange') : V('card'), color: primary ? '#fff' : V('ink') };
}
