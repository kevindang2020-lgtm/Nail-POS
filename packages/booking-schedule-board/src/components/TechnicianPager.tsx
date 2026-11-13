import type { PageInfo } from '../domain/paging';
import { useBoardText } from '../i18n/boardText';
import { ChevronLeft, ChevronRight } from './icons';

export interface TechnicianPagerProps {
  page: PageInfo;
  onPrev: () => void;
  onNext: () => void;
  /** Compact = bottom bar flavour (`Next 12 technicians ›`). */
  variant?: 'toolbar' | 'bottom';
}

/** Previous / "Technicians 1–12 of 24" / Next 12 — always derived from the same PageInfo (spec §9). */
export function TechnicianPager({ page, onPrev, onNext, variant = 'toolbar' }: TechnicianPagerProps) {
  const { t } = useBoardText();
  const nextCount = Math.min(page.perPage, Math.max(0, page.total - page.endIndex)) || page.perPage;
  if (variant === 'bottom') {
    return (
      <div className="bsb-pager" data-testid="bsb-pager-bottom">
        <span className="bsb-page">{t('pager.page', { page: page.pageIndex + 1, pages: page.pageCount })}</span>
        <button type="button" className="bsb-btn is-ghost is-strong" onClick={onNext} disabled={!page.hasNext}>
          {t('pager.nextTechs', { n: nextCount })} <ChevronRight />
        </button>
      </div>
    );
  }
  const label = page.total === 0 ? t('pager.none') : t('pager.range', { first: page.startIndex + 1, last: page.endIndex, total: page.total });
  return (
    <div className="bsb-pager" data-testid="bsb-pager">
      <button type="button" className="bsb-btn" onClick={onPrev} disabled={!page.hasPrevious}><ChevronLeft /> {t('pager.previous')}</button>
      <span className="bsb-pager-label" aria-live="polite">{label}</span>
      <button type="button" className="bsb-btn bsb-next" onClick={onNext} disabled={!page.hasNext}>{t('pager.next', { n: nextCount })} <ChevronRight /></button>
    </div>
  );
}
