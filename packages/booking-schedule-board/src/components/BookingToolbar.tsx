import { useCallback, useRef, useState } from 'react';
import type { AppointmentStatus, ISODate, Service } from '../domain/scheduleTypes';
import { formatLongDate } from '../domain/time';
import type { BoardView } from '../state/boardState';
import { ChevronDown, ChevronLeft, ChevronRight, ExpandIcon, FitIcon } from './icons';
import { useDismiss } from './primitives';
import { useBoardText } from '../i18n/boardText';

export const STATUS_OPTIONS: AppointmentStatus[] = ['scheduled', 'confirmed', 'arrived', 'in_service', 'completed', 'cancelled', 'no_show', 'rescheduled'];

export interface BookingToolbarProps {
  date: ISODate;
  timezone: string;
  today: ISODate;
  view: BoardView;
  services: Service[];
  serviceId: string | null;
  statuses: AppointmentStatus[];
  fitDay: boolean;
  fullScreen: boolean;
  onDate: (d: ISODate) => void;
  onShiftDate: (days: number) => void;
  onView: (v: BoardView) => void;
  onService: (id: string | null) => void;
  onStatuses: (s: AppointmentStatus[]) => void;
  onToggleFitDay: () => void;
  onToggleFullScreen: () => void;
}

export function BookingToolbar(p: BookingToolbarProps) {
  const [statusOpen, setStatusOpen] = useState(false);
  const closeStatus = useCallback(() => setStatusOpen(false), []);
  const statusRef = useDismiss(statusOpen, closeStatus);
  const dateInput = useRef<HTMLInputElement>(null);
  const { t } = useBoardText();
  const statusLabel = p.statuses.length === 0 ? t('toolbar.status') : p.statuses.length === 1 ? t(`status.${p.statuses[0]}`) : t('toolbar.statusesN', { n: p.statuses.length });

  return (
    <div className="bsb-toolbar" data-testid="bsb-toolbar">
      <div className="bsb-seg" role="group" aria-label={t('toolbar.view')}>
        <button type="button" aria-pressed={p.view === 'day'} onClick={() => p.onView('day')}>{t('toolbar.day')}</button>
        <button type="button" aria-pressed={p.view === 'week'} onClick={() => p.onView('week')}>{t('toolbar.week')}</button>
      </div>
      <button type="button" className="bsb-btn" onClick={() => p.onDate(p.today)} disabled={p.date === p.today}>{t('toolbar.today')}</button>
      <div className="bsb-datenav">
        <button type="button" aria-label={t('toolbar.prevDay')} onClick={() => p.onShiftDate(p.view === 'week' ? -7 : -1)}><ChevronLeft /></button>
        <button type="button" className="bsb-date" onClick={() => dateInput.current?.showPicker?.() ?? dateInput.current?.click()} aria-label={t('toolbar.selectedDate', { date: formatLongDate(p.date, p.timezone) })}>
          {formatLongDate(p.date, p.timezone)}
          <input ref={dateInput} type="date" value={p.date} onChange={(e) => e.target.value && p.onDate(e.target.value)} tabIndex={-1} aria-hidden="true" />
        </button>
        <button type="button" aria-label={t('toolbar.nextDay')} onClick={() => p.onShiftDate(p.view === 'week' ? 7 : 1)}><ChevronRight /></button>
      </div>
      <select className="bsb-select" aria-label={t('toolbar.serviceFilter')} value={p.serviceId ?? ''} onChange={(e) => p.onService(e.target.value || null)}>
        <option value="">{t('toolbar.allServices')}</option>
        {p.services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <div ref={statusRef} style={{ position: 'relative' }}>
        <button type="button" className="bsb-btn" aria-haspopup="true" aria-expanded={statusOpen} onClick={() => setStatusOpen((o) => !o)}>
          {statusLabel} <ChevronDown />
        </button>
        {statusOpen && (
          <div className="bsb-menu" role="group" aria-label={t('toolbar.statusFilter')} style={{ top: '100%', left: 0, marginTop: 4 }}>
            {STATUS_OPTIONS.map((o) => (
              <label key={o}>
                <input type="checkbox" checked={p.statuses.includes(o)} onChange={(e) => p.onStatuses(e.target.checked ? [...p.statuses, o] : p.statuses.filter((x) => x !== o))} />
                {t(`status.${o}`)}
              </label>
            ))}
            <div className="bsb-menu-sep" />
            <button type="button" className="bsb-menu-item" onClick={() => p.onStatuses([])}>{t('toolbar.clear')}</button>
          </div>
        )}
      </div>
      <div className="bsb-spacer" />
      <span className="bsb-btn is-ghost" aria-label={t('toolbar.gridResolution')}>{t('toolbar.grid15')}</span>
      <button type="button" className={`bsb-btn${p.fitDay ? ' is-active' : ''}`} aria-pressed={p.fitDay} onClick={p.onToggleFitDay}><FitIcon /> {t('toolbar.fitDay')}</button>
      <button type="button" className={`bsb-btn${p.fullScreen ? ' is-active' : ''}`} aria-pressed={p.fullScreen} onClick={p.onToggleFullScreen}><ExpandIcon /> {p.fullScreen ? t('toolbar.exitFullScreen') : t('toolbar.fullScreen')}</button>
    </div>
  );
}
