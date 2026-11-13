import { memo } from 'react';
import type { ID } from '../domain/scheduleTypes';
import { formatClock } from '../domain/time';
import type { SelectedSlot } from '../state/boardState';
import { PlusIcon } from './icons';
import { useBoardText } from '../i18n/boardText';

export interface OpenSlotCardProps {
  technicianId: ID;
  startMinute: number;
  endMinute: number;
  cellHeight: number;
  top: number;
  nowMinute: number | null;
  canBook: boolean;
  selected: SelectedSlot | null;
  /** Largest bookable run from a given start (respects protection). */
  availableAt: (startMinute: number) => number;
  onBook: (technicianId: ID, startMinute: number, availableDurationMinutes: number) => void;
  onSelect: (slot: SelectedSlot | null) => void;
}

/**
 * One open gap. Every 15-minute cell inside is its own `+ Book` target so the
 * receptionist can start a booking anywhere in the gap; the first cell carries
 * the gap-length label (`+ Book · 60m`).
 */
export const OpenSlotCard = memo(function OpenSlotCard(p: OpenSlotCardProps) {
  const { t } = useBoardText();
  const cells: number[] = [];
  for (let m = p.startMinute; m < p.endMinute; m += 15) cells.push(m);
  const gapMinutes = p.endMinute - p.startMinute;
  const height = (gapMinutes / 15) * p.cellHeight;
  const showLabelEvery = p.cellHeight >= 22 ? 4 : Math.max(4, Math.ceil(60 / 15)); // once per hour-ish
  return (
    <div className={`bsb-open${p.selected ? ' is-selected' : ''}`} style={{ top: p.top, height: Math.max(height - 2, 10) }} data-testid={`bsb-open-${p.technicianId}-${p.startMinute}`} data-duration={gapMinutes}>
      {cells.map((m, i) => {
        const avail = p.availableAt(m);
        const past = p.nowMinute != null && m + 15 <= p.nowMinute;
        const labelled = i === 0 || i % showLabelEvery === 0;
        const label = t('open.bookAt', { time: formatClock(m), n: avail });
        return (
          <button
            key={m}
            type="button"
            className="bsb-open-cell"
            style={{ top: i * p.cellHeight, height: p.cellHeight }}
            disabled={!p.canBook || avail < 15 || past}
            aria-label={label}
            title={past ? t('open.passed') : label}
            data-testid={`bsb-cell-${p.technicianId}-${m}`}
            onClick={() => { p.onSelect({ technicianId: p.technicianId, startMinute: m, durationMinutes: avail }); p.onBook(p.technicianId, m, avail); }}
          >
            {labelled && avail >= 15 && !past && <span className="bsb-open-label"><PlusIcon /> {t('open.bookMin', { n: i === 0 ? gapMinutes : avail })}</span>}
            {!labelled && <span className="bsb-open-hover"><PlusIcon /> {formatClock(m, { suffix: false })}</span>}
          </button>
        );
      })}
    </div>
  );
});
