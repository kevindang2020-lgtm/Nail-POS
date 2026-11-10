// reportsCommon.tsx — shared report scaffolding. §5 of the realtime standard (Jul 27, 2026) lives HERE so every
// report screen gets the same cadence with one line: reports refresh every 2 minutes while actively viewed
// (visible-only), refetch when a reports_updated event arrives, and offer an explicit Refresh button. Heavy
// report queries never run continuously in a hidden tab.
import { useCallback, useState } from 'react';
import { useRealtime } from '../realtime/useRealtime';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { fmtMoney } from '../i18n/format';
import { serverText } from '../i18n/server-text';
import { useSearchParams } from 'react-router-dom';
import { periodQuery, type PeriodState } from '../components/FinanceKit';

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

/** batch 9 guide 2 (Nov 10 2026): Revenue by Service category label — the two buckets the server keys specially. */
export const svcCategoryLabel = (key: string, name: string): string =>
  key === '__no_lines__' ? t('rpt.svc.noLines') : key === '__unmapped__' ? t('rpt.svc.unmapped') : name;
/** the Services Report URL for a Daily Summary period (+ an optional category), so the drill-down keeps the dates */
export const servicesReportHref = (period: Record<string, unknown>, category?: string): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(period)) if (v != null && v !== '') p.set(k, String(v));
  if (category) p.set('category', category);
  return '/tenant/reports/services' + (p.toString() ? '?' + p.toString() : '');
};

/** batch 9 (Nov 10 2026): the report period lives in the URL (?preset=… [&from&to]) so Back / refresh / a drill-down keep it.
 *  Changing the period drops the other query keys listed in `resetKeys` (page, a selection …). */
export function useUrlPeriod(defaultPreset: PeriodState['preset'] = 'month', resetKeys: string[] = ['page']) {
  const [sp, setSp] = useSearchParams();
  const raw = sp.get('preset') || '';
  const preset = (URL_PRESETS as readonly string[]).includes(raw) ? (raw as PeriodState['preset']) : defaultPreset;
  const period: PeriodState = preset === 'custom' ? { preset, from: sp.get('from') || undefined, to: sp.get('to') || undefined } : { preset };
  const setPeriod = (v: PeriodState) => {
    const p = new URLSearchParams(sp);
    for (const k of ['preset', 'from', 'to', ...resetKeys]) p.delete(k);
    p.set('preset', v.preset);
    if (v.preset === 'custom') { if (v.from) p.set('from', v.from); if (v.to) p.set('to', v.to); }
    setSp(p);
  };
  const setParam = (k: string, v: string | null | undefined) => { const p = new URLSearchParams(sp); if (v == null || v === '') p.delete(k); else p.set(k, v); setSp(p); };
  return { period, setPeriod, query: periodQuery(period), sp, setParam };
}
const URL_PRESETS = ['today', 'week', 'month', 'year', 'custom'] as const;
