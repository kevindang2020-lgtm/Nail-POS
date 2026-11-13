import { memo } from 'react';
import type { AvailabilityGap } from '../domain/scheduleTypes';
import { formatRange, minuteOfDay } from '../domain/time';
import type { TechnicianSlice } from '../state/scheduleStore';
import { ExternalIcon, InfoIcon } from './icons';
import { useBoardText } from '../i18n/boardText';

export interface AvailabilityCellProps {
  slice: TechnicianSlice;
  date: string;
  timezone: string;
  nowMinute: number | null;
  onViewAll: (technicianId: string, anchor: HTMLElement) => void;
  onBook: (technicianId: string, gap: AvailabilityGap) => void;
}

/** Pick the gap to headline: the first gap that has not fully passed. */
export function headlineGap(gaps: AvailabilityGap[], date: string, timezone: string, nowMinute: number | null): AvailabilityGap | null {
  if (gaps.length === 0) return null;
  if (nowMinute == null) return gaps[0];
  return gaps.find((g) => minuteOfDay(g.endAt, date, timezone) > nowMinute) ?? null;
}

export const AvailabilityCell = memo(function AvailabilityCell({ slice, date, timezone, nowMinute, onViewAll, onBook }: AvailabilityCellProps) {
  const gaps = slice.availability.filter((g) => g.bookable);
  const head = headlineGap(gaps, date, timezone, nowMinute);
  const t = slice.technician;
  const { t: tr } = useBoardText();
  if (!head) {
    const reason = slice.ctx.working.length === 0 ? (t.workingState === 'time_off' ? tr('avail.timeOff') : tr('avail.notWorking')) : tr('avail.fullyBooked');
    return (
      <div className="bsb-avail is-none" data-testid={`bsb-avail-${t.id}`}>
        <span className="bsb-avail-range">{reason}</span>
        <span className="bsb-avail-open">0 <small>{tr('avail.minOpen')}</small></span>
        <span className="bsb-muted" style={{ fontSize: 11 }}>{gaps.length === 0 && slice.ctx.working.length > 0 ? tr('avail.noOpeningsLeft') : '—'}</span>
      </div>
    );
  }
  const s = minuteOfDay(head.startAt, date, timezone);
  const e = minuteOfDay(head.endAt, date, timezone);
  const totalOpen = gaps.reduce((n, g) => n + g.durationMinutes, 0);
  return (
    <div className="bsb-avail" data-testid={`bsb-avail-${t.id}`}>
      <button type="button" className="bsb-avail-range" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }} onClick={() => onBook(t.id, head)} title={tr('avail.bookAt', { name: t.displayName, range: formatRange(s, e) })}>{formatRange(s, e)}</button>
      <span className="bsb-avail-open">{head.durationMinutes} <small>{tr('avail.minOpen')}</small></span>
      <button type="button" className="bsb-link" onClick={(ev) => onViewAll(t.id, ev.currentTarget)} aria-label={tr('avail.viewAllLabel', { n: gaps.length, name: t.displayName, min: totalOpen })}>{tr('avail.viewAll')} <ExternalIcon /></button>
    </div>
  );
});

export function StripLabel({ openMinutes }: { openMinutes: number }) {
  const { t } = useBoardText();
  const h = Math.floor(openMinutes / 60);
  const m = openMinutes % 60;
  return (
    <div className="bsb-strip-label" title={t('avail.openTimesTitle')}>
      <span>{h > 0 ? (m ? t('avail.hm', { h, m }) : t('avail.h', { h })) : t('avail.m', { m })}</span>
      <small>{t('avail.openTimes')}</small>
      <InfoIcon />
    </div>
  );
}
