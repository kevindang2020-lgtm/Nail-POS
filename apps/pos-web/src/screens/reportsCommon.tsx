// reportsCommon.tsx — shared report scaffolding. §5 of the realtime standard (Jul 27, 2026) lives HERE so every
// report screen gets the same cadence with one line: reports refresh every 2 minutes while actively viewed
// (visible-only), refetch when a reports_updated event arrives, and offer an explicit Refresh button. Heavy
// report queries never run continuously in a hidden tab.
import { useCallback, useState } from 'react';
import { useRealtime } from '../realtime/useRealtime';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { fmtMoney } from '../i18n/format';
import { serverText } from '../i18n/server-text';

/** Adopt the §5 cadence: call with the screen's loader; render the returned <RefreshButton/> where it fits.
 *  `reloadKey` bumps whenever a refresh is requested — screens add it to their load-effect deps. */
export function useReportCadence(): { reloadKey: number; refresh: () => void } {
  const [reloadKey, setReloadKey] = useState(0);
  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);
  useRealtime('reports', refresh, { fallbackMs: 120_000 });   // event-driven + 2-min visible-only safety refresh
  return { reloadKey, refresh };
}

export function RefreshButton({ onClick, busy }: { onClick: () => void; busy?: boolean }) {
  return (
    <button type="button" className="btn ghost" onClick={onClick} disabled={busy}
      title={t('pos.reports_auto_refresh_every_2_minutes_1bx8')} style={{ fontSize: 12 }}>
      {t('pos.refresh')}
    </button>
  );
}

// reportsCommon.tsx — shared bits for the Reports screens (money formatter, period control).
export const money = (c: number) => fmtMoney(c || 0);

/** the report periods — labels read at render (an instant language switch re-labels the tabs in place) */
export const reportPeriods = (): [string, string][] => [['today', t('pos.today_2')], ['week', t('pos.this_week_2')], ['month', t('pos.this_month_3')], ['year', t('admin.reports.period.year')]];
/** a period code ('week') → its label; anything else (a server's date-range text) is shown through serverText */
export const periodText = (p: string | null | undefined): string => { const hit = reportPeriods().find(([v]) => v === p); return hit ? hit[1] : serverText(p); };

export function PeriodTabs({ period, onChange }: { period: string; onChange: (p: string) => void }) {
  return (
    <div className="seg" role="tablist" aria-label={t('pos.report_period')}>
      {reportPeriods().map(([val, label]) => (
        <button key={val} role="tab" aria-selected={period === val} className={`seg-btn whitespace-nowrap ${period === val ? 'on' : ''}`} onClick={() => onChange(val)}>{label}</button>
      ))}
    </div>
  );
}

export function reportError(e: any, noun: string = t('admin.reports.noun.thisReport')): string {
  return e?.status === 403
    ? t('pos.you_do_not_have_permission_to_euol', { noun: String(noun) })
    : (e?.message || t('pos.could_not_load_noun', { noun: String(noun) }));
}
