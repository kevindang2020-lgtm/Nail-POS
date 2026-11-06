// BusinessKit.tsx — shared parts of AI Business Reports and AI Business Alerts (Nov 3 2026 guides): the period bar (presets + From/To
// month calendar, salon time), the read-only system check dialog, error text and value formatting. Numbers come from
// /pos/ai-business/center, which reads the canonical Sales Report; nothing here changes a sale, an appointment or a schedule.
import { useState } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { FitDialog } from './FitKit';
import { RangeCalendar, isForbidden } from './FinanceKit';
import { errorTextOf } from '../i18n/error-text';
import { fmtNumber, fmtMoney, fmtInZone, fmtYmd } from '../i18n/format';
import { deviceToday } from '../lib/deviceToday';

export const bt = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);
export const bzWhen = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
export const bzNum = (n: number | null | undefined) => (n == null ? '—' : fmtNumber(n));
export function bzErr(e: unknown): string { return isForbidden(e) ? bt('bzx.err.forbidden') : errorTextOf(e, bt('bzx.loadFailed')); }
/** a metric value in its unit: money in cents, a percent, or a count */
export function bzValue(v: number | null | undefined, unit: string): string {
  if (v == null) return '—';
  return unit === 'cents' || unit === 'currency_cents' ? fmtMoney(v) : unit === 'percent' ? `${fmtNumber(v, 1)}%` : fmtNumber(v);
}
export const bzDays = (p?: { from?: string | null; to?: string | null } | null) => (!p?.from ? '—' : p.from === p.to ? fmtYmd(p.from) : `${fmtYmd(p.from)} – ${fmtYmd(p.to ?? p.from)}`);
const TONE: Record<string, string> = { PASSED: 'ok', WARNING: 'warn', FAILED: 'bad', INSUFFICIENT_DATA: '', UNAVAILABLE: 'bad' };
export const BZ_PRESETS = ['today', 'yesterday', 'week', 'last_7', 'month', 'last_30', 'last_month', 'year'] as const;
export type BzPeriod = { preset?: string; from?: string; to?: string };

export function BzPeriodBar({ value, onChange, today }: { value: BzPeriod; onChange: (p: BzPeriod) => void; today?: string }) {
  const [cal, setCal] = useState(false);
  return (
    <div className="rvw-dates" data-testid="bzx-period" style={{ position: 'relative' }}>
      <button type="button" className={'btn ghost' + (!value.preset ? ' on' : '')} data-testid="bzx-preset-all" onClick={() => onChange({})}>{bt('bzx.preset.all')}</button>
      {BZ_PRESETS.map((x) => <button key={x} type="button" className={'btn ghost' + (value.preset === x ? ' on' : '')} data-testid={`bzx-preset-${x}`} onClick={() => onChange({ preset: x })}>{bt('bzx.preset.' + x)}</button>)}
      <button type="button" className={'btn ghost' + (value.preset === 'custom' ? ' on' : '')} data-testid="bzx-custom" onClick={() => setCal(true)}>
        {value.preset === 'custom' ? `${value.from} → ${value.to}` : bt('bzx.preset.custom')}</button>
      {cal ? <div className="rvw-cal"><RangeCalendar initial={{ from: value.from, to: value.to }} today={today ?? deviceToday()}
        onApply={(r) => { onChange({ preset: 'custom', from: r.from, to: r.to }); setCal(false); }} onCancel={() => setCal(false)} onClear={() => { onChange({}); setCal(false); }} /></div> : null}
    </div>
  );
}

/** Check AI Business Reports / Alerts System — read-only; every check says what it looked at and when it last passed */
export function BzHealthButton({ area, run }: { area: 'reports' | 'alerts' | 'branches' | 'assistant'; run: () => Promise<any> }) {
  const [h, setH] = useState<any | 'loading' | null>(null);
  const go = () => { setH('loading'); run().then(setH).catch((e) => setH({ error: bzErr(e) })); };
  const title = bt(`bzx.check.${area}`);
  return (<>
    <button type="button" className="btn ghost" data-testid="bzx-check" onClick={go}>{title}</button>
    {h ? <FitDialog wide testId="bzx-health" title={title} onClose={() => setH(null)}
      subtitle={h !== 'loading' && !h.error ? bt('bzx.health.overall', { s: bt('bzx.health.' + h.overall), at: bzWhen(h.checkedAt) }) : undefined}
      footer={<><button className="btn ghost" onClick={go}>{bt('bzx.health.retry')}</button><button className="btn ghost" onClick={() => setH(null)}>{bt('bzx.close')}</button></>}>
      {h === 'loading' ? <div className="state">{bt('bzx.health.running')}</div> : h.error ? <div className="err">{h.error}</div> : <>
        <p className="sub">{bt('bzx.health.readOnly')}{h.reused ? ` ${bt('bzx.health.recent')}` : ''}</p>
        {(h.checks ?? []).map((x: any) => (
          <div key={x.key} className="rvw-check" data-testid={`bzx-chk-${x.key}`}>
            <div><span className={'chip ' + (TONE[x.state] ?? '')}>{bt('bzx.health.' + x.state)}</span> <b>{bt('bzx.health.k.' + x.key)}</b>{x.count ? <span className="sub"> · {fmtNumber(x.count)}</span> : null}</div>
            <div className="sub">{bt(`bzx.health.d.${x.key}.${x.state}`)}</div>
            <div className="sub">{[bt('bzx.health.part', { c: bt('bzx.comp.' + x.component) }), x.lastPassedAt ? bt('bzx.health.lastPassed', { at: bzWhen(x.lastPassedAt) }) : bt('bzx.health.neverPassed')].join(' · ')}</div>
          </div>))}
      </>}
    </FitDialog> : null}
  </>);
}
