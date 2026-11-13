import { useEffect, useState } from 'react';
import type { BookingDataAdapter } from '../adapters/BookingDataAdapter';
import { toBookingError } from '../domain/bookingErrors';
import type { ID, ISODate, OpeningResult, Service, Technician } from '../domain/scheduleTypes';
import { formatClock, minuteOfDay, minutesToHHmm } from '../domain/time';
import { SidePanel } from './primitives';
import { useBoardText } from '../i18n/boardText';

export interface FindOpeningPanelProps {
  adapter: BookingDataAdapter;
  tenantId: ID;
  branchId: ID;
  date: ISODate;
  timezone: string;
  services: Service[];
  technicians: Technician[];
  initialServiceId: ID | null;
  dayStart: number;
  dayEnd: number;
  onPick: (opening: OpeningResult, serviceIds: ID[]) => void;
  onClose: () => void;
}

/** Find an Opening (spec §16) — backend-driven through the adapter, never a grid scan. */
export function FindOpeningPanel(p: FindOpeningPanelProps) {
  const { t } = useBoardText();
  const [serviceIds, setServiceIds] = useState<ID[]>(p.initialServiceId ? [p.initialServiceId] : []);
  const [technicianId, setTechnicianId] = useState<ID | ''>('');
  const [windowStart, setWindowStart] = useState(p.dayStart);
  const [windowEnd, setWindowEnd] = useState(p.dayEnd);
  const [results, setResults] = useState<OpeningResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const duration = serviceIds.reduce((n, id) => n + (p.services.find((s) => s.id === id)?.durationMinutes ?? 0), 0);

  useEffect(() => {
    if (serviceIds.length === 0) { setResults(null); return; }
    let cancelled = false;
    setBusy(true);
    setError(null);
    p.adapter.findOpenings({
      tenantId: p.tenantId, branchId: p.branchId, date: p.date, serviceIds,
      technicianId: technicianId || null, windowStart: minutesToHHmm(windowStart), windowEnd: minutesToHHmm(windowEnd), limit: 60,
    }).then((r) => { if (!cancelled) setResults(r); })
      .catch((e) => { if (!cancelled) setError(t(`err.${toBookingError(e).code}`)); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [p.adapter, p.tenantId, p.branchId, p.date, serviceIds, technicianId, windowStart, windowEnd, t]);

  const times: number[] = [];
  for (let m = p.dayStart; m <= p.dayEnd; m += 15) times.push(m);

  return (
    <SidePanel title={t('find.title')} onClose={p.onClose} testId="bsb-find-opening">
      <div className="bsb-field">{t('find.services', { n: duration })}
        <div className="bsb-list" role="group" aria-label={t('find.servicesGroup')}>
          {p.services.map((s) => (
            <label key={s.id} className="bsb-row" style={{ padding: '6px 10px' }}>
              <input type="checkbox" checked={serviceIds.includes(s.id)} onChange={(e) => setServiceIds(e.target.checked ? [...serviceIds, s.id] : serviceIds.filter((x) => x !== s.id))} />
              <span className="bsb-row-main">{s.name}</span>
              <span className="bsb-muted">{t('card.min', { n: s.durationMinutes })}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="bsb-field-row">
        <label className="bsb-field">{t('find.technician')}
          <select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}>
            <option value="">{t('find.any')}</option>
            {p.technicians.map((t) => <option key={t.id} value={t.id}>{t.displayName}</option>)}
          </select>
        </label>
        <label className="bsb-field">{t('find.date')}<input type="date" value={p.date} readOnly /></label>
      </div>
      <div className="bsb-field-row">
        <label className="bsb-field">{t('find.from')}
          <select value={windowStart} onChange={(e) => setWindowStart(Number(e.target.value))}>{times.map((m) => <option key={m} value={m}>{formatClock(m)}</option>)}</select>
        </label>
        <label className="bsb-field">{t('find.to')}
          <select value={windowEnd} onChange={(e) => setWindowEnd(Number(e.target.value))}>{times.map((m) => <option key={m} value={m}>{formatClock(m)}</option>)}</select>
        </label>
      </div>
      {error && <div className="bsb-error" role="alert">{error}</div>}
      {serviceIds.length === 0 && <p className="bsb-muted">{t('find.chooseOne')}</p>}
      {busy && <p className="bsb-muted" aria-live="polite">{t('find.searching')}</p>}
      {results && !busy && (
        <div className="bsb-list" aria-live="polite" data-testid="bsb-openings">
          {results.length === 0 && <p className="bsb-muted">{t('find.none', { n: duration })}</p>}
          {results.map((o) => {
            const s = minuteOfDay(o.startAt, p.date, p.timezone);
            return (
              <button key={`${o.technicianId}-${o.startAt}`} type="button" className="bsb-row is-clickable" onClick={() => p.onPick(o, serviceIds)} data-testid="bsb-opening">
                <span className="bsb-row-main">
                  <span className="bsb-row-title">{formatClock(s)} · {o.technicianName}</span>
                  <span className="bsb-row-sub">{t('find.row', { n: o.durationMinutes, gap: o.gapDurationMinutes })}</span>
                </span>
                <span className="bsb-chip">{t('find.book')}</span>
              </button>
            );
          })}
        </div>
      )}
    </SidePanel>
  );
}
