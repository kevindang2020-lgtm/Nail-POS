import { useEffect, useState } from 'react';
import type { BookingDataAdapter } from '../adapters/BookingDataAdapter';
import { buildDayContext, daySummary } from '../domain/availability';
import type { ID, ISODate, ScheduleRange, Technician } from '../domain/scheduleTypes';
import { formatLongDate, weekDates } from '../domain/time';
import { useBoardText } from '../i18n/boardText';

export interface WeekViewProps {
  adapter: BookingDataAdapter;
  tenantId: ID;
  branchId: ID;
  date: ISODate;
  today: ISODate;
  timezone: string;
  technicians: Technician[];
  onPickDay: (date: ISODate) => void;
}

/**
 * Week view (spec §19): one range request per day (never per technician), rendered as a
 * technician × day summary; clicking a day cell returns to Day view on that date.
 */
export function WeekView(p: WeekViewProps) {
  const { t } = useBoardText();
  const days = weekDates(p.date);
  const [ranges, setRanges] = useState<Record<ISODate, ScheduleRange | null>>({});
  useEffect(() => {
    let cancelled = false;
    setRanges({});
    Promise.all(days.map((d) => p.adapter.getScheduleRange({ tenantId: p.tenantId, branchId: p.branchId, fromDate: d, toDate: d }).then((r) => [d, r] as const).catch(() => [d, null] as const)))
      .then((pairs) => { if (!cancelled) setRanges(Object.fromEntries(pairs)); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.adapter, p.tenantId, p.branchId, days[0]]);
  const loaded = Object.keys(ranges).length === days.length;
  return (
    <div className="bsb-week" data-testid="bsb-week">
      <table>
        <thead>
          <tr>
            <th style={{ width: 180 }}>{t('week.technician')}</th>
            {days.map((d) => <th key={d} className={d === p.today ? 'is-today' : ''}><button type="button" className="bsb-btn is-ghost" onClick={() => p.onPickDay(d)}>{formatLongDate(d, p.timezone)}</button></th>)}
          </tr>
        </thead>
        <tbody>
          {p.technicians.map((tech0) => (
            <tr key={tech0.id}>
              <td><b>{tech0.displayName}</b></td>
              {days.map((d) => {
                const r = ranges[d];
                if (!loaded) return <td key={d} className="bsb-muted">…</td>;
                if (!r) return <td key={d} className="bsb-muted">—</td>;
                const tech = r.technicians.find((x) => x.id === tech0.id);
                if (!tech) return <td key={d} className="bsb-muted">—</td>;
                const ctx = buildDayContext({ technician: tech, date: d, timezone: r.timezone, branchHours: r.branchHours, appointments: r.appointments, segments: r.segments });
                const sum = daySummary(ctx);
                const count = r.appointments.filter((a) => a.technicianId === tech0.id && a.status !== 'cancelled').length;
                if (sum.workingMinutes === 0) return <td key={d} className={`bsb-muted${d === p.today ? ' is-today' : ''}`}>{t('week.off')}</td>;
                return (
                  <td key={d} className={d === p.today ? 'is-today' : ''}>
                    <button type="button" onClick={() => p.onPickDay(d)} aria-label={t('week.label', { name: tech.displayName, date: d, n: count, m: sum.openMinutes })}>
                      <span>{t('week.summary', { n: count, m: sum.openMinutes })}</span>
                      <span className="bsb-bar"><i style={{ width: `${Math.min(100, (sum.bookedMinutes / sum.workingMinutes) * 100)}%` }} /></span>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
