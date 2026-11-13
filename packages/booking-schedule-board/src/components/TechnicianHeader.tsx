import { memo, useCallback, useState } from 'react';
import type { Technician } from '../domain/scheduleTypes';
import { technicianAccent } from '../domain/technicianColor';
import { formatClock } from '../domain/time';
import type { TechnicianSlice } from '../state/scheduleStore';
import { CalendarIcon, DotsIcon } from './icons';
import { initials, useDismiss } from './primitives';
import { useBoardText } from '../i18n/boardText';


export interface TechnicianHeaderProps {
  slice: TechnicianSlice;
  /** 1-based global sequence number (spec §10). */
  sequence: number;
  selected: boolean;
  canViewDay: boolean;
  canBlockTime: boolean;
  onViewDay: (technicianId: string) => void;
  onSelect: (technicianId: string | null) => void;
  onBlockTime: (technicianId: string) => void;
}

export const TechnicianHeader = memo(function TechnicianHeader({ slice, sequence, selected, canViewDay, canBlockTime, onViewDay, onSelect, onBlockTime }: TechnicianHeaderProps) {
  const t = slice.technician;
  const { t: tr } = useBoardText();
  const [menu, setMenu] = useState(false);
  const close = useCallback(() => setMenu(false), []);
  const ref = useDismiss(menu, close);
  const shift = slice.ctx.working.length ? `${formatClock(slice.ctx.working[0].start, { suffix: false })}–${formatClock(slice.ctx.working[slice.ctx.working.length - 1].end)}` : tr('tech.offToday');
  const booked = slice.appointments.filter((a) => a.status !== 'cancelled' && a.status !== 'no_show').length;
  const liveState: Technician['workingState'] = slice.ctx.working.length === 0 && t.workingState === 'working' ? 'off' : t.workingState;
  const accent = technicianAccent(t.tenantId, t.id);   // identity (addendum §05) — never the column index

  return (
    <div className={`bsb-tech${selected ? ' is-selected' : ''}`} style={{ ['--bsb-tech' as string]: accent }} data-accent={accent} data-testid={`bsb-tech-${t.id}`} onClick={() => onSelect(selected ? null : t.id)} role="columnheader" aria-selected={selected}>
      <div className="bsb-tech-top">
        <span className="bsb-tech-num" data-testid={`bsb-tech-num-${t.id}`}>{String(sequence).padStart(2, '0')}</span>
        <span className="bsb-avatar" style={{ background: accent }} aria-hidden="true">
          {t.avatarUrl ? <img src={t.avatarUrl} alt="" /> : initials(t.displayName)}
          <span className="bsb-dot" data-state={liveState} />
        </span>
        <span className="bsb-tech-name" title={t.displayName}>{t.displayName}</span>
        <div ref={ref} style={{ position: 'relative', marginLeft: 'auto' }}>
          <button type="button" className="bsb-tech-more" aria-label={tr('tech.moreActions', { name: t.displayName })} aria-haspopup="true" aria-expanded={menu} onClick={(e) => { e.stopPropagation(); setMenu((m) => !m); }}><DotsIcon /></button>
          {menu && (
            <div className="bsb-menu" style={{ top: '100%', right: 0 }} onClick={(e) => e.stopPropagation()}>
              {canViewDay && <button type="button" className="bsb-menu-item" onClick={() => { close(); onViewDay(t.id); }}>{tr('tech.viewFullDay')}</button>}
              {canBlockTime && <button type="button" className="bsb-menu-item" onClick={() => { close(); onBlockTime(t.id); }}>{tr('tech.blockTime')}</button>}
              <button type="button" className="bsb-menu-item" onClick={() => { close(); onSelect(selected ? null : t.id); }}>{selected ? tr('tech.clearSelection') : tr('tech.selectColumn')}</button>
            </div>
          )}
        </div>
      </div>
      <div className="bsb-tech-meta">
        {canViewDay ? (
          <button type="button" className="bsb-link" onClick={(e) => { e.stopPropagation(); onViewDay(t.id); }}><CalendarIcon width={12} height={12} /> {tr('tech.viewDay')}</button>
        ) : <span className="bsb-link"><CalendarIcon width={12} height={12} /> {shift}</span>}
        <span className="bsb-state" title={tr('tech.stateTitle', { state: tr(`tech.state.${liveState}`), shift, n: booked })}>{tr(`tech.state.${liveState}`)} · {booked}</span>
      </div>
    </div>
  );
});
