// AppointmentDetailInner.tsx — the appointment full-view content for the shared iPad Pro modal.
// Loads the REAL appointment from GET /pos/booking/appointments/:id (posBookingApi.appointment),
// never mock data. Shows customer, technician, date/time, duration, status, source, service lines +
// total, and notes. Safe idempotent lifecycle actions (Check In / Start Service / Move to Queue) call
// the SAME existing endpoints the Booking quick-actions use; the server enforces permission + tenant.
import { useCallback, useEffect, useRef, useState } from 'react';
import { posBookingApi } from '../api/posBookingApi';
import { posCheckInApi } from '../api/posCheckInApi';
import { useRealtime } from '../realtime/useRealtime';
import { useCan } from './usePermissions';
import { useIPadView } from './IPadViewProvider';
import { customerRequest } from './ipad-modules';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { fmtMoney } from '../i18n/format';
import { clockOfHHMM } from '../screens/opsClock';

import { statusLabel } from '../i18n/status-label';
const V = (n: string) => `var(--${n})`;

type ServiceLine = { serviceId?: string; serviceName: string; durationMinutes?: number; priceCents?: number };
export interface AppointmentRow {
  appointmentId: string; customerId?: string; customerName: string; customerPhone?: string; isVip?: boolean;
  technicianId?: string; technicianName?: string; services: ServiceLine[]; source?: string;
  startTime: string; endTime: string; durationMinutes: number; status: string;
  depositStatus?: string; notes?: string; createdAt?: string; updatedAt?: string;
}

const to12 = (t: string) => clockOfHHMM(t);   // the user's clock ("2:30 PM" / "14:30")
const money = (c?: number) => fmtMoney(c || 0);

const ACTIONS: { key: string; label: string; perm: string; run: (id: string) => Promise<unknown> }[] = [
  { key: 'check-in', get label() { return tx('pos.check_in'); }, perm: 'pos.booking.check_in', run: (id) => posCheckInApi.appointmentCheckIn(id) },
  { key: 'start-service', get label() { return tx('pos.start_service'); }, perm: 'pos.serving.start', run: (id) => posBookingApi.startService(id) },
  { key: 'move-to-queue', get label() { return tx('pos.move_to_queue'); }, perm: 'pos.queue.create', run: (id) => posBookingApi.moveToQueue(id) },
];

export function AppointmentDetailInner({ appointmentId, initial, onChanged }: {
  appointmentId: string; initial?: AppointmentRow; onChanged?: () => void;
}) {
  const [row, setRow] = useState<AppointmentRow | null>(initial || null);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const alive = useRef(true);
  const can = useCan();
  const { open: openIPad } = useIPadView();

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const d = await posBookingApi.appointment(appointmentId);
      if (alive.current) setRow(d as AppointmentRow);
    } catch (e: any) {
      if (alive.current) setError(e?.message || tx('pos.could_not_load_this_appointment'));
    } finally { if (alive.current) setLoading(false); }
  }, [appointmentId]);

  // Fetch fresh detail on open / when the record id changes; cancel stale writes on unmount.
  useEffect(() => { alive.current = true; load(); return () => { alive.current = false; }; }, [load]);
  // Live refresh: re-fetch when a realtime booking event changes the underlying record.
  useRealtime('booking', load);

  const doAction = async (key: string) => {
    setBusy(key); setError(null);
    try {
      await ACTIONS.find((a) => a.key === key)!.run(appointmentId);
      onChanged?.();
      await load();
    } catch (e: any) {
      if (alive.current) setError(e?.message || tx('pos.could_not_v0', { v0: String(key.replace(/-/g, ' ')) }));
    } finally { if (alive.current) setBusy(null); }
  };

  if (loading && !row) {
    return <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: V('muted'), fontSize: 13 }} aria-busy="true">{tx('pos.loading_appointment')}</div>;
  }
  if (error && !row) {
    return <div role="alert" style={{ flex: 1, display: 'grid', placeItems: 'center', textAlign: 'center', padding: 40 }}>
      <div><div style={{ fontSize: 24 }}>⚠️</div><div style={{ color: V('danger'), fontWeight: 700, marginTop: 6 }}>{error}</div>
        <button onClick={load} style={btn(true)}>{tx('pos.retry')}</button></div>
    </div>;
  }
  if (!row) return null;

  const total = (row.services || []).reduce((s, l) => s + (l.priceCents || 0), 0);
  const field = (l: string, v: React.ReactNode) => (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10.5, color: V('muted'), fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em' }}>{l}</div>
      <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v}</div>
    </div>
  );

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 18px', display: 'grid', gap: 14, alignContent: 'start' }}>
      {error && <div role="alert" style={{ background: '#FFF0ED', border: `1px solid #F6D9D2`, color: V('danger'), borderRadius: 10, padding: '8px 12px', fontSize: 12.5, fontWeight: 600 }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, background: V('card'), border: `1px solid ${V('line')}`, borderRadius: 12, padding: 14 }}>
        {field(tx('pos.customer'), (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span>{row.customerName}</span>
            {row.isVip ? <span style={{ fontSize: 10, color: V('gold'), fontWeight: 800 }}>{tx('pos.vip')}</span> : null}
            <button
              type="button"
              title={tx('pos.open_customer_profile')}
              onClick={() => openIPad(customerRequest({ customerId: row.customerId || `cust_${row.customerName.replace(/\s+/g, '_').toLowerCase()}`, displayName: row.customerName, phone: row.customerPhone, isVip: row.isVip } as any))}
              style={{
                background: V('card'), border: `1px solid ${V('line')}`, borderRadius: 6,
                padding: '2px 7px', fontSize: 11, fontWeight: 700, color: V('orange'), cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 3
              }}
            >
              {tx('pos.profile')}
            </button>
          </div>
        ))}
        {field(tx('pos.phone'), row.customerPhone || '—')}
        {field(tx('pos.technician'), row.technicianName || tx('pos.unassigned'))}
        {field(tx('pos.date_time'), `${to12(row.startTime)} – ${to12(row.endTime)}`)}
        {field(tx('pos.duration'), tx('pos.v0_min', { v0: String(row.durationMinutes) }))}
        {field(tx('pos.booking_source'), statusLabel('source', row.source) || '—')}
      </div>

      <div style={{ background: V('card'), border: `1px solid ${V('line')}`, borderRadius: 12, padding: 14 }}>
        <div style={{ fontSize: 11, color: V('muted'), fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>{tx('pos.services')}</div>
        {(row.services || []).map((l, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: i < row.services.length - 1 ? `1px solid #F4EEE1` : 'none', fontSize: 13 }}>
            <span style={{ fontWeight: 600 }}>{l.serviceName}{l.durationMinutes ? <span style={{ color: V('muted'), fontWeight: 500 }}> · {l.durationMinutes} {tx('pos.min')}</span> : null}</span>
            {l.priceCents != null && <b>{money(l.priceCents)}</b>}
          </div>
        ))}
        {total > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, marginTop: 4, borderTop: `1.5px solid ${V('gold')}`, fontSize: 14 }}><b>{tx('pos.total')}</b><b>{money(total)}</b></div>}
      </div>

      {row.notes && (
        <div style={{ background: V('page'), border: `1px solid ${V('line')}`, borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 11, color: V('muted'), fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>{tx('pos.notes')}</div>
          <div style={{ fontSize: 13, lineHeight: 1.4 }}>{row.notes}</div>
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 9 }}>
        {ACTIONS.filter((a) => can(a.perm)).map((a) => (
          <button key={a.key} onClick={() => doAction(a.key)} disabled={!!busy} style={btn(a.key === 'check-in')}>
            {busy === a.key ? '…' : a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function btn(primary: boolean): React.CSSProperties {
  return { fontFamily: 'inherit', fontSize: 12.5, fontWeight: 800, borderRadius: 9, padding: '9px 16px', cursor: 'pointer',
    border: primary ? 'none' : `1px solid ${V('line')}`, background: primary ? V('orange') : V('card'), color: primary ? '#fff' : V('ink') };
}
