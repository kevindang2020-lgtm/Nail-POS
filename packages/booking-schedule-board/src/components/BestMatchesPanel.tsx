import { useEffect, useState } from 'react';
import type { BookingDataAdapter } from '../adapters/BookingDataAdapter';
import { toBookingError } from '../domain/bookingErrors';
import type { ID, ISODate, Service, Technician, TechnicianMatch } from '../domain/scheduleTypes';
import { formatClock, minuteOfDay, minutesToHHmm } from '../domain/time';
import { SidePanel } from './primitives';
import { useBoardText } from '../i18n/boardText';

export interface BestMatchesPanelProps {
  adapter: BookingDataAdapter;
  tenantId: ID;
  branchId: ID;
  date: ISODate;
  timezone: string;
  services: Service[];
  technicians: Technician[];
  serviceId: ID;
  dayStart: number;
  dayEnd: number;
  nowMinute: number | null;
  onPick: (match: TechnicianMatch, serviceId: ID) => void;
  onClose: () => void;
}

/** Best Matches (spec §17): eligibility first, ranking second — both on the backend side of the adapter. */
export function BestMatchesPanel(p: BestMatchesPanelProps) {
  const { t } = useBoardText();
  const [requested, setRequested] = useState<ID | ''>('');
  const [preferredStart, setPreferredStart] = useState<number>(p.nowMinute != null && p.nowMinute >= p.dayStart ? Math.ceil(p.nowMinute / 15) * 15 : p.dayStart);
  const [matches, setMatches] = useState<TechnicianMatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const service = p.services.find((s) => s.id === p.serviceId);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    p.adapter.getBestMatches({ tenantId: p.tenantId, branchId: p.branchId, date: p.date, serviceIds: [p.serviceId], requestedTechnicianId: requested || null, preferredStart: minutesToHHmm(preferredStart) })
      .then((m) => { if (!cancelled) setMatches(m); })
      .catch((e) => { if (!cancelled) setError(t(`err.${toBookingError(e).code}`)); });
    return () => { cancelled = true; };
  }, [p.adapter, p.tenantId, p.branchId, p.date, p.serviceId, requested, preferredStart, t]);

  const times: number[] = [];
  for (let m = p.dayStart; m < p.dayEnd; m += 15) times.push(m);
  const eligibleIds = new Set((matches ?? []).map((m) => m.technicianId));
  const excluded = p.technicians.filter((t) => !eligibleIds.has(t.id));

  return (
    <SidePanel title={t('best.title', { service: service?.name ?? t('best.serviceFallback') })} onClose={p.onClose} testId="bsb-best-matches">
      <div className="bsb-field-row">
        <label className="bsb-field">{t('best.requested')}
          <select value={requested} onChange={(e) => setRequested(e.target.value)}>
            <option value="">{t('best.none')}</option>
            {p.technicians.map((t) => <option key={t.id} value={t.id}>{t.displayName}</option>)}
          </select>
        </label>
        <label className="bsb-field">{t('best.preferred')}
          <select value={preferredStart} onChange={(e) => setPreferredStart(Number(e.target.value))}>{times.map((m) => <option key={m} value={m}>{formatClock(m)}</option>)}</select>
        </label>
      </div>
      {error && <div className="bsb-error" role="alert">{error}</div>}
      {!matches && !error && <p className="bsb-muted">{t('best.ranking')}</p>}
      {matches && (
        <div className="bsb-list" data-testid="bsb-matches" aria-live="polite">
          {matches.length === 0 && <p className="bsb-muted">{t('best.noMatch', { n: service?.durationMinutes ?? 0, time: formatClock(preferredStart) })}</p>}
          {matches.map((m, i) => (
            <button key={m.technicianId} type="button" className="bsb-row is-clickable" onClick={() => p.onPick(m, p.serviceId)} data-testid="bsb-match">
              <span className="bsb-chip is-rank">#{i + 1}</span>
              <span className="bsb-row-main">
                <span className="bsb-row-title">{m.technicianName}</span>
                <span className="bsb-row-sub">{m.earliestStartAt ? t('best.earliest', { time: formatClock(minuteOfDay(m.earliestStartAt, p.date, p.timezone)) }) : t('best.noOpening')} · {t('best.score', { n: m.score })}</span>
                <span className="bsb-reasons">{m.reasons.map((r) => <span key={r}>{r}</span>)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {matches && excluded.length > 0 && (
        <details>
          <summary className="bsb-muted">{t('best.excluded', { n: excluded.length })}</summary>
          <p className="bsb-muted">{excluded.map((t) => t.displayName).join(', ')}</p>
        </details>
      )}
    </SidePanel>
  );
}
