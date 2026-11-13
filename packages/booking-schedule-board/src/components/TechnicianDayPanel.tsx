import { useEffect, useState } from 'react';
import type { BookingDataAdapter } from '../adapters/BookingDataAdapter';
import { toBookingError } from '../domain/bookingErrors';
import type { Appointment, AvailabilityGap, ID, ISODate, TechnicianDay } from '../domain/scheduleTypes';
import { technicianAccent } from '../domain/technicianColor';
import { formatClock, formatRange, minuteOfDay } from '../domain/time';
import { useBoardText } from '../i18n/boardText';
import { serviceSummary, STATUS_GLYPH } from './AppointmentCard';
import { SidePanel } from './primitives';

export interface TechnicianDayPanelProps {
  adapter: BookingDataAdapter;
  tenantId: ID;
  branchId: ID;
  date: ISODate;
  timezone: string;
  technicianId: ID;
  onBook: (technicianId: ID, gap: AvailabilityGap) => void;
  onOpenAppointment: (a: Appointment) => void;
  onClose: () => void;
}

/** View Day (spec §10): the technician's complete day, loaded through the adapter, without touching board state. */
export function TechnicianDayPanel(p: TechnicianDayPanelProps) {
  const { t } = useBoardText();
  const [day, setDay] = useState<TechnicianDay | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    p.adapter.getTechnicianDay({ tenantId: p.tenantId, branchId: p.branchId, technicianId: p.technicianId, date: p.date })
      .then((d) => { if (!cancelled) setDay(d); })
      .catch((e) => { if (!cancelled) setError(t(`err.${toBookingError(e).code}`)); });
    return () => { cancelled = true; };
  }, [p.adapter, p.tenantId, p.branchId, p.technicianId, p.date, t]);
  const m = (iso: string) => minuteOfDay(iso, p.date, p.timezone);
  const accent = technicianAccent(p.tenantId, p.technicianId);
  return (
    <SidePanel title={<><span className="bsb-accent-dot" style={{ background: accent }} data-accent={accent} data-testid="bsb-panel-accent" aria-hidden="true" />{day ? t('day.title', { name: day.technician.displayName }) : t('day.titleFallback')}</>} onClose={p.onClose} wide testId="bsb-technician-day">
      {error && <div className="bsb-error" role="alert">{error}</div>}
      {!day && !error && <p className="bsb-muted">{t('day.loading')}</p>}
      {day && (
        <>
          <div className="bsb-row" style={{ gap: 18 }}>
            <span><b>{day.summary.appointmentCount}</b> <span className="bsb-muted">{t('day.appointments')}</span></span>
            <span><b>{day.summary.bookedMinutes}</b> <span className="bsb-muted">{t('day.minBooked')}</span></span>
            <span><b>{day.summary.openMinutes}</b> <span className="bsb-muted">{t('day.minOpen')}</span></span>
            <span><b>{day.summary.workingMinutes}</b> <span className="bsb-muted">{t('day.minShift')}</span></span>
          </div>
          <h4 className="bsb-muted" style={{ margin: '6px 0 0' }}>{t('day.timeline')}</h4>
          <div className="bsb-list">
            {[...day.segments.filter((s) => s.type !== 'working').map((s) => ({ kind: 'segment' as const, start: m(s.startAt), end: m(s.endAt), seg: s })),
              ...day.appointments.map((a) => ({ kind: 'appointment' as const, start: m(a.startAt), end: m(a.endAt), appt: a })),
              ...day.availability.map((g) => ({ kind: 'gap' as const, start: m(g.startAt), end: m(g.endAt), gap: g }))]
              .sort((a, b) => a.start - b.start)
              .map((row) => {
                if (row.kind === 'gap') {
                  return (
                    <button key={`g-${row.start}`} type="button" className="bsb-row is-clickable" onClick={() => p.onBook(p.technicianId, row.gap)}>
                      <span className="bsb-row-main"><span className="bsb-row-title">{formatRange(row.start, row.end)}</span><span className="bsb-row-sub">{t('day.open')}</span></span>
                      <span className="bsb-chip">{t('day.bookChip', { n: row.gap.durationMinutes })}</span>
                    </button>
                  );
                }
                if (row.kind === 'segment') {
                  return (
                    <div key={row.seg.id} className="bsb-row" style={{ background: 'var(--bsb-break-bg)' }}>
                      <span className="bsb-row-main"><span className="bsb-row-title">{formatRange(row.start, row.end)}</span><span className="bsb-row-sub">{t(`seg.${row.seg.type}`)}{row.seg.reason ? ` · ${row.seg.reason}` : ''}</span></span>
                    </div>
                  );
                }
                const a = row.appt;
                return (
                  <button key={a.id} type="button" className="bsb-row is-clickable" onClick={() => p.onOpenAppointment(a)}>
                    <span className="bsb-row-main">
                      <span className="bsb-row-title">{formatClock(row.start)} · {a.customerName}{a.source === 'walk_in' ? ` ${t('day.walkIn')}` : ''}</span>
                      <span className="bsb-row-sub">{serviceSummary(a)} · {t('card.min', { n: row.end - row.start })} · {STATUS_GLYPH[a.status]} {t(`status.${a.status}`)}{a.protected ? ` · ${t('day.protected')}` : ''}</span>
                    </span>
                  </button>
                );
              })}
          </div>
        </>
      )}
    </SidePanel>
  );
}
