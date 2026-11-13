import { useCallback } from 'react';
import type { AvailabilityGap, ID } from '../domain/scheduleTypes';
import { formatRange, minuteOfDay } from '../domain/time';
import { useDismiss } from './primitives';
import { useBoardText } from '../i18n/boardText';

export interface ViewAllPopoverProps {
  technicianId: ID;
  technicianName: string;
  gaps: AvailabilityGap[];
  date: string;
  timezone: string;
  /** Position relative to the board root. */
  left: number;
  top: number;
  canBook: boolean;
  onBook: (technicianId: ID, gap: AvailabilityGap) => void;
  onClose: () => void;
}

/** View All (spec §12): every meaningful gap, from the same authoritative availability. */
export function ViewAllPopover(p: ViewAllPopoverProps) {
  const { t } = useBoardText();
  const close = useCallback(() => p.onClose(), [p]);
  const ref = useDismiss(true, close);
  return (
    <div ref={ref} className="bsb-popover" style={{ left: p.left, top: p.top }} role="dialog" aria-label={t('viewAll.label', { name: p.technicianName })} data-testid="bsb-view-all">
      <h4>{t('viewAll.title', { name: p.technicianName, n: p.gaps.length })}</h4>
      {p.gaps.length === 0 && <p className="bsb-muted">{t('viewAll.none')}</p>}
      <div className="bsb-list">
        {p.gaps.map((g) => {
          const s = minuteOfDay(g.startAt, p.date, p.timezone);
          const e = minuteOfDay(g.endAt, p.date, p.timezone);
          return (
            <button key={g.startAt} type="button" className="bsb-row is-clickable" disabled={!p.canBook} onClick={() => { p.onBook(p.technicianId, g); p.onClose(); }}>
              <span className="bsb-row-main"><span className="bsb-row-title">{formatRange(s, e)}</span></span>
              <span className="bsb-chip">{t('card.min', { n: g.durationMinutes })}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
