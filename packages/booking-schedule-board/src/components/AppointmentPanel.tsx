import { useState } from 'react';
import type { BoardPermissions } from '../adapters/BookingDataAdapter';
import type { Appointment, ID, Technician } from '../domain/scheduleTypes';
import { technicianAccent } from '../domain/technicianColor';
import { formatClock, formatRange, minuteOfDay } from '../domain/time';
import { useBoardText } from '../i18n/boardText';
import { STATUS_GLYPH } from './AppointmentCard';
import { SidePanel } from './primitives';

export interface AppointmentPanelProps {
  appointment: Appointment;
  date: string;
  timezone: string;
  technicians: Technician[];
  dayStart: number;
  dayEnd: number;
  permissions: BoardPermissions;
  busy: boolean;
  error: string | null;
  /** Host hook: opens the existing appointment detail / edit workflow. */
  onOpenInHost?: (a: Appointment) => void;
  onMove: (a: Appointment, technicianId: ID, startMinute: number) => void;
  onCancel: (a: Appointment, reason: string) => void;
  onClose: () => void;
}

/**
 * Lightweight appointment sheet: summary + keyboard-accessible move + cancel.
 * Full editing stays in the host's existing appointment workflow (spec §27).
 */
export function AppointmentPanel(p: AppointmentPanelProps) {
  const { t, money } = useBoardText();
  const a = p.appointment;
  const s = minuteOfDay(a.startAt, p.date, p.timezone);
  const e = minuteOfDay(a.endAt, p.date, p.timezone);
  const [techId, setTechId] = useState(a.technicianId);
  const [start, setStart] = useState(s);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [reason, setReason] = useState('');
  const movable = p.permissions.canMove && !['completed', 'cancelled', 'in_service', 'no_show'].includes(a.status);
  const times: number[] = [];
  for (let m = p.dayStart; m + (e - s) <= p.dayEnd; m += 15) times.push(m);
  const eligibleTechs = p.technicians.filter((x) => x.serviceIds == null || a.items.every((it) => x.serviceIds!.includes(it.serviceId)));
  const accent = technicianAccent(a.tenantId, a.technicianId);   // the same identity accent as the column header + card rail
  const techName = p.technicians.find((x) => x.id === a.technicianId)?.displayName;
  const sub = [`${STATUS_GLYPH[a.status]} ${t(`status.${a.status}`)}`, ...(a.source === 'walk_in' ? [t('card.walkIn')] : []), ...(a.requestedTechnician ? [t('card.requested')] : []), ...(a.protected ? [t('card.protected')] : [])].join(' · ');
  return (
    <SidePanel title={<><span className="bsb-accent-dot" style={{ background: accent }} data-accent={accent} data-testid="bsb-panel-accent" aria-hidden="true" />{a.customerName}</>} onClose={p.onClose} testId="bsb-appointment"
      footer={<>
        {p.onOpenInHost && <button type="button" className="bsb-btn" onClick={() => p.onOpenInHost!(a)}>{t('appt.open')}</button>}
        {p.permissions.canCancel && a.status !== 'cancelled' && a.status !== 'completed' && !confirmCancel && <button type="button" className="bsb-btn" onClick={() => setConfirmCancel(true)}>{t('appt.cancel')}</button>}
        <div className="bsb-spacer" />
        {movable && <button type="button" className="bsb-btn is-primary" disabled={p.busy || (techId === a.technicianId && start === s)} onClick={() => p.onMove(a, techId, start)}>{p.busy ? t('appt.moving') : t('appt.move')}</button>}
      </>}
    >
      {p.error && <div className="bsb-error" role="alert">{p.error}</div>}
      <div className="bsb-row"><span className="bsb-row-main"><span className="bsb-row-title">{formatRange(s, e)} · {t('card.min', { n: e - s })}</span><span className="bsb-row-sub">{techName ? `${techName} · ` : ''}{sub}</span></span></div>
      <div className="bsb-list">
        {a.items.map((it) => (
          <div key={it.serviceId} className="bsb-row"><span className="bsb-row-main"><span className="bsb-row-title">{it.name}</span><span className="bsb-row-sub">{t('card.min', { n: it.durationMinutes })} · {money(it.priceCents)}{it.addOns?.length ? ` · + ${it.addOns.map((x) => x.name).join(', ')}` : ''}</span></span></div>
        ))}
      </div>
      {a.notes && <p className="bsb-muted">{a.notes}</p>}
      {movable && (
        <>
          <h4 className="bsb-muted" style={{ margin: '6px 0 0' }}>{t('appt.moveHeading')}</h4>
          <div className="bsb-field-row">
            <label className="bsb-field">{t('appt.technician')}
              <select value={techId} onChange={(ev) => setTechId(ev.target.value)}>
                {eligibleTechs.map((x) => <option key={x.id} value={x.id}>{x.displayName}</option>)}
              </select>
            </label>
            <label className="bsb-field">{t('appt.start')}
              <select value={start} onChange={(ev) => setStart(Number(ev.target.value))}>{times.map((m) => <option key={m} value={m}>{formatClock(m)}</option>)}</select>
            </label>
          </div>
          {a.requestedTechnician && techId !== a.technicianId && <div className="bsb-notice">{t('appt.requestedNotice', { name: techName ?? '' })}</div>}
        </>
      )}
      {confirmCancel && (
        <div className="bsb-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <b>{t('appt.cancelQ')}</b>
          <label className="bsb-field">{t('appt.reason')}<input value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder={t('appt.reasonPh')} /></label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="bsb-btn" onClick={() => setConfirmCancel(false)}>{t('appt.keep')}</button>
            <button type="button" className="bsb-btn is-primary" disabled={p.busy} onClick={() => p.onCancel(a, reason)}>{t('appt.confirmCancel')}</button>
          </div>
        </div>
      )}
    </SidePanel>
  );
}
