import { useCallback, useState } from 'react';
import { PER_PAGE_OPTIONS, type PageInfo } from '../domain/paging';
import type { ID, Service, Technician } from '../domain/scheduleTypes';
import { useBoardText } from '../i18n/boardText';
import { ChevronDown, SearchIcon, SparkIcon } from './icons';
import { useDismiss } from './primitives';
import { TechnicianPager } from './TechnicianPager';

/** Server-paged boards (200+ technicians) filter on the server: "working today" vs every technician, with the server's counts. */
export interface ServerTechnicianFilter {
  workingOnly: boolean;
  workingCount: number;
  totalAll: number;
  onWorkingOnly: (on: boolean) => void;
}

export interface OpeningToolbarProps {
  services: Service[];
  /** The service used for Find an Opening / Best Matches (not the display filter). */
  bookingServiceId: ID | null;
  onBookingService: (id: ID | null) => void;
  onFindOpening: () => void;
  onBestMatches: () => void;
  /** All technicians for the branch/date, with their working flag. */
  technicians: Technician[];
  workingCount: number;
  technicianFilter: ID[];
  onTechnicianFilter: (ids: ID[]) => void;
  /** Present when the adapter pages technicians on the server — replaces the client-side checklist. */
  serverFilter?: ServerTechnicianFilter;
  perPage: number;
  onPerPage: (n: number) => void;
  page: PageInfo;
  onPrev: () => void;
  onNext: () => void;
}

export function OpeningToolbar(p: OpeningToolbarProps) {
  const { t } = useBoardText();
  const [techOpen, setTechOpen] = useState(false);
  const close = useCallback(() => setTechOpen(false), []);
  const ref = useDismiss(techOpen, close);
  const svc = p.services.find((s) => s.id === p.bookingServiceId) ?? null;
  const working = p.technicians.filter((x) => x.workingState !== 'time_off' && x.workingState !== 'off' && x.active);
  const sf = p.serverFilter;
  const filterLabel = sf
    ? (sf.workingOnly ? t('opening.workingTechs', { n: sf.workingCount }) : t('opening.allTechs', { n: sf.totalAll }))
    : p.technicianFilter.length === 0 ? t('opening.workingTechs', { n: p.workingCount }) : t('opening.filteredTechs', { n: p.technicianFilter.length, total: p.workingCount });

  return (
    <div className="bsb-toolbar" data-testid="bsb-opening-toolbar">
      <button type="button" className="bsb-find" onClick={p.onFindOpening}><SearchIcon /> {t('opening.find')}</button>
      <select className="bsb-select" aria-label={t('opening.serviceToBook')} value={p.bookingServiceId ?? ''} onChange={(e) => p.onBookingService(e.target.value || null)}>
        <option value="">{t('opening.chooseService')}</option>
        {p.services.map((s) => <option key={s.id} value={s.id}>{t('opening.serviceOption', { name: s.name, min: s.durationMinutes })}</option>)}
      </select>
      <button type="button" className="bsb-btn is-accent" onClick={p.onBestMatches} disabled={!svc} title={svc ? t('opening.rankFor', { name: svc.name }) : t('opening.chooseServiceFirst')}><SparkIcon /> {t('opening.bestMatches')}</button>
      <div className="bsb-spacer" />
      <div ref={ref} style={{ position: 'relative' }}>
        <button type="button" className="bsb-btn" aria-haspopup="true" aria-expanded={techOpen} onClick={() => setTechOpen((o) => !o)} data-testid="bsb-tech-filter">{filterLabel} <ChevronDown /></button>
        {techOpen && sf && (
          <div className="bsb-menu" role="group" aria-label={t('opening.techFilter')} style={{ top: '100%', right: 0, marginTop: 4 }}>
            <button type="button" className="bsb-menu-item" aria-pressed={sf.workingOnly} onClick={() => { close(); sf.onWorkingOnly(true); }}>{t('opening.workingOnly', { n: sf.workingCount })}</button>
            <button type="button" className="bsb-menu-item" aria-pressed={!sf.workingOnly} onClick={() => { close(); sf.onWorkingOnly(false); }}>{t('opening.allTechs', { n: sf.totalAll })}</button>
          </div>
        )}
        {techOpen && !sf && (
          <div className="bsb-menu" role="group" aria-label={t('opening.techFilter')} style={{ top: '100%', right: 0, marginTop: 4 }}>
            <button type="button" className="bsb-menu-item" onClick={() => p.onTechnicianFilter([])}>{t('opening.allWorking', { n: p.workingCount })}</button>
            <div className="bsb-menu-sep" />
            {working.map((x) => (
              <label key={x.id}>
                <input type="checkbox" checked={p.technicianFilter.includes(x.id)} onChange={(e) => p.onTechnicianFilter(e.target.checked ? [...p.technicianFilter, x.id] : p.technicianFilter.filter((id) => id !== x.id))} />
                {x.displayName}
              </label>
            ))}
            {p.technicians.length > working.length && (
              <>
                <div className="bsb-menu-sep" />
                <div className="bsb-muted" style={{ padding: '4px 8px' }}>{t('opening.offToday', { names: p.technicians.filter((x) => !working.includes(x)).map((x) => x.displayName).join(', ') })}</div>
              </>
            )}
          </div>
        )}
      </div>
      <select className="bsb-select" aria-label={t('opening.perPage')} value={p.perPage} onChange={(e) => p.onPerPage(Number(e.target.value))}>
        {PER_PAGE_OPTIONS.map((n) => <option key={n} value={n}>{t('opening.perPageOption', { n })}</option>)}
      </select>
      <TechnicianPager page={p.page} onPrev={p.onPrev} onNext={p.onNext} />
    </div>
  );
}
