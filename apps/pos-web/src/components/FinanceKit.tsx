// FinanceKit.tsx — the shared pieces of the Oct 29 2026 Payments & Money one-screen pages (Deposits & Settlements, AI Deposit
// Reconciliation, Invoices). One implementation each, so the three pages behave the same:
//   PeriodBar      Today · This Week · This Month · This Year · Custom Range, the visible active period, the date-basis
//                  selector. The presets are resolved by the SERVER in the salon's time zone (the answer carries the
//                  dates); Custom Range opens RangeCalendar.
//   RangeCalendar  a real month-view picker for From and To: previous / next month, month and year jump, weekday headings,
//                  a Today marker, the selected bounds and the highlighted interval, Apply / Cancel / Clear; To before From
//                  is refused (nothing is applied until Apply).
//   DateField      one date (Record a Deposit, invoice issue / due, payment date) with the same month view.
//   useLoad        one request at a time per list: a newer request makes an older answer stale (it is dropped), errors are
//                  kept apart from empty answers (a failed load is never a false $0.00).
//   fmtYmdSafe     'YYYY-MM-DD' → "Oct 9, 2026"; anything else → "Not set" (the Invoices "Invalid Date" fix).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { fmtYmd, displayLocale } from '../i18n/format';
import { deviceToday } from '../lib/deviceToday';

type PeriodPreset = 'today' | 'week' | 'month' | 'year' | 'custom' | 'all';
export interface PeriodState { preset: PeriodPreset; from?: string; to?: string }
export interface ServerPeriod { preset: PeriodPreset; from: string | null; to: string | null; tz: string; today: string }

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
export const isYmd = (s: unknown): s is string => typeof s === 'string' && YMD.test(s) && !Number.isNaN(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)));
/** A stored calendar day → "Oct 9, 2026"; a missing or malformed value → "Not set" (never "Invalid Date"). */
export const fmtYmdSafe = (v: string | null | undefined, fallback?: string) => (isYmd(v) ? fmtYmd(v, { month: 'short', day: 'numeric', year: 'numeric' }, fallback ?? tx('finance.notSet')) : (fallback ?? tx('finance.notSet')));
export const periodText = (p: ServerPeriod | null | undefined) => {
  if (!p) return '…';
  if (!p.from || !p.to) return tx('finance.period.allTime');
  return p.from === p.to ? fmtYmdSafe(p.from) : `${fmtYmdSafe(p.from)} – ${fmtYmdSafe(p.to)}`;
};
const pad = (n: number) => String(n).padStart(2, '0');
const ymdOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
/** Monday-first month grid (null = filler). */
function monthGrid(y: number, m: number): (number | null)[] {
  const first = new Date(Date.UTC(y, m, 1)).getUTCDay();   // 0 = Sunday
  const lead = (first + 6) % 7;
  const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const cells: (number | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);
  return cells;
}
const monthName = (m: number) => new Intl.DateTimeFormat(displayLocale(), { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, m, 1)));
const weekdayNames = () => Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(displayLocale(), { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 9, 5 + i))));   // Oct 5 2026 = Monday

/** One month view. `range` highlights [from, to]; `onPick` gets the chosen day. */
export function MonthView({ value, range, today, onPick, label, testId }: { value: { y: number; m: number }; range?: { from?: string; to?: string }; today?: string; onPick: (ymd: string) => void; label: string; testId?: string }) {
  const [view, setView] = useState(value);
  useEffect(() => { setView(value); }, [value.y, value.m]);   // eslint-disable-line react-hooks/exhaustive-deps
  const cells = monthGrid(view.y, view.m);
  const years = useMemo(() => { const base = today ? +today.slice(0, 4) : new Date().getFullYear(); return Array.from({ length: 12 }, (_, i) => base - 9 + i); }, [today]);
  const step = (d: number) => setView((v) => { const n = new Date(Date.UTC(v.y, v.m + d, 1)); return { y: n.getUTCFullYear(), m: n.getUTCMonth() }; });
  const wd = weekdayNames();
  return (
    <div className="fn-month" role="group" aria-label={label} data-testid={testId}>
      <div className="fn-month-head">
        <button type="button" className="fk-ibtn" aria-label={tx('finance.cal.prevMonth')} onClick={() => step(-1)}>‹</button>
        <select className="fn-mselect" aria-label={tx('finance.cal.month')} value={view.m} onChange={(e) => setView({ ...view, m: Number(e.target.value) })}>
          {Array.from({ length: 12 }, (_, i) => <option key={i} value={i}>{monthName(i)}</option>)}
        </select>
        <select className="fn-mselect" aria-label={tx('finance.cal.year')} value={view.y} onChange={(e) => setView({ ...view, y: Number(e.target.value) })}>
          {(years.includes(view.y) ? years : [...years, view.y].sort()).map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <button type="button" className="fk-ibtn" aria-label={tx('finance.cal.nextMonth')} onClick={() => step(1)}>›</button>
      </div>
      <div className="fn-grid" role="grid">
        {wd.map((w) => <span key={w} className="fn-wd" role="columnheader">{w}</span>)}
        {cells.map((d, i) => {
          if (d == null) return <span key={'x' + i} className="fn-day empty" aria-hidden />;
          const ymd = ymdOf(view.y, view.m, d);
          const from = range?.from, to = range?.to;
          const isStart = ymd === from, isEnd = ymd === to;
          const inside = !!from && !!to && ymd > from && ymd < to;
          return (
            <button type="button" key={ymd} role="gridcell" data-ymd={ymd}
              className={'fn-day' + (isStart || isEnd ? ' sel' : '') + (inside ? ' in' : '') + (ymd === today ? ' today' : '')}
              aria-selected={isStart || isEnd || inside} aria-current={ymd === today ? 'date' : undefined}
              aria-label={fmtYmdSafe(ymd)} onClick={() => onPick(ymd)}>{d}</button>
          );
        })}
      </div>
    </div>
  );
}

/** Custom Range: From / To month calendars, Apply / Cancel / Clear. Nothing is applied before Apply. */
export function RangeCalendar({ initial, today, onApply, onCancel, onClear }: { initial: { from?: string; to?: string }; today: string; onApply: (r: { from: string; to: string }) => void; onCancel: () => void; onClear: () => void }) {
  const [from, setFrom] = useState<string | undefined>(initial.from);
  const [to, setTo] = useState<string | undefined>(initial.to);
  const [active, setActive] = useState<'from' | 'to'>('from');
  const ref = useRef<HTMLDivElement | null>(null);
  const anchor = (s: string | undefined) => (isYmd(s) ? { y: +s.slice(0, 4), m: +s.slice(5, 7) - 1 } : { y: +today.slice(0, 4), m: +today.slice(5, 7) - 1 });
  const left = anchor(from ?? to);
  const right = (() => { const a = anchor(to ?? from); if (a.y === left.y && a.m === left.m) { const n = new Date(Date.UTC(a.y, a.m + 1, 1)); return { y: n.getUTCFullYear(), m: n.getUTCMonth() }; } return a; })();
  const invalid = !!from && !!to && to < from;
  const pick = (ymd: string) => {
    if (active === 'from') { setFrom(ymd); if (to && ymd > to) setTo(undefined); setActive('to'); }
    else { if (from && ymd < from) { setFrom(ymd); setTo(undefined); setActive('to'); } else { setTo(ymd); } }
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } };
    document.addEventListener('keydown', k, true);
    ref.current?.querySelector<HTMLElement>('.fn-rfield.on')?.focus();
    return () => document.removeEventListener('keydown', k, true);
  }, [onCancel]);
  return (
    <div className="fn-pop" ref={ref} role="dialog" aria-label={tx('finance.cal.customRange')} data-testid="range-calendar">
      <div className="fn-rfields">
        <button type="button" className={'fn-rfield' + (active === 'from' ? ' on' : '')} onClick={() => setActive('from')} data-testid="range-from">
          <span>{tx('finance.cal.from')}</span><b>{from ? fmtYmdSafe(from) : tx('finance.cal.pick')}</b>
        </button>
        <span className="fn-rarrow" aria-hidden>→</span>
        <button type="button" className={'fn-rfield' + (active === 'to' ? ' on' : '')} onClick={() => setActive('to')} data-testid="range-to">
          <span>{tx('finance.cal.to')}</span><b>{to ? fmtYmdSafe(to) : tx('finance.cal.pick')}</b>
        </button>
      </div>
      <div className="fn-months">
        <MonthView value={left} range={{ from, to }} today={today} onPick={pick} label={tx('finance.cal.monthA')} testId="cal-left" />
        <MonthView value={right} range={{ from, to }} today={today} onPick={pick} label={tx('finance.cal.monthB')} testId="cal-right" />
      </div>
      {invalid ? <div className="fk-err" role="alert">{tx('finance.cal.toBeforeFrom')}</div> : <div className="fk-hint">{tx(active === 'from' ? 'finance.cal.hintFrom' : 'finance.cal.hintTo')}</div>}
      <div className="fn-pop-foot">
        <button type="button" className="fk-btn ghost" onClick={() => { setFrom(undefined); setTo(undefined); setActive('from'); onClear(); }} data-testid="range-clear">{tx('finance.cal.clear')}</button>
        <span style={{ flex: 1 }} />
        <button type="button" className="fk-btn" onClick={onCancel} data-testid="range-cancel">{tx('pos.cancel')}</button>
        <button type="button" className="fk-btn primary" disabled={!from || !to || invalid} onClick={() => from && to && onApply({ from, to })} data-testid="range-apply">{tx('finance.cal.apply')}</button>
      </div>
    </div>
  );
}

/** One calendar day field (a button showing the date that opens a month view). */
export function DateField({ label, value, onChange, today, max, testId, required }: { label: string; value: string; onChange: (ymd: string) => void; today: string; max?: string; testId?: string; required?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', k, true);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', k, true); };
  }, [open]);
  const anchor = isYmd(value) ? { y: +value.slice(0, 4), m: +value.slice(5, 7) - 1 } : { y: +today.slice(0, 4), m: +today.slice(5, 7) - 1 };
  return (
    <div className="fk-field fn-datefield" ref={ref}>
      <span>{label}{required ? ' *' : ''}</span>
      <button type="button" className="fn-datebtn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid={testId}>
        {value ? fmtYmdSafe(value) : tx('finance.cal.pick')}<span aria-hidden>📅</span>
      </button>
      {open ? (
        <div className="fn-pop small" role="dialog" aria-label={label}>
          <MonthView value={anchor} range={{ from: value, to: value }} today={today} label={label}
            onPick={(d) => { if (max && d > max) return; onChange(d); setOpen(false); }} />
          {max ? <div className="fk-hint">{tx('finance.cal.notAfter', { d: fmtYmdSafe(max) })}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

/** The period toolbar: presets, Custom Range (calendar), the active period and the date basis. */
export function PeriodBar({ value, onChange, server, basis, basisOptions, onBasis, allowAll, compact }: {
  value: PeriodState; onChange: (p: PeriodState) => void; server: ServerPeriod | null | undefined;
  basis?: string; basisOptions?: Array<{ value: string; label: string }>; onBasis?: (b: string) => void; allowAll?: boolean; compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const today = server?.today ?? deviceToday();
  const presets: PeriodPreset[] = [...(allowAll ? ['all' as PeriodPreset] : []), 'today', 'week', 'month', 'year'];
  const wrap = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close); return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className={'fn-period' + (compact ? ' compact' : '')} ref={wrap} role="group" aria-label={tx('finance.period.label')}>
      <div className="fk-seg fn-presets" data-testid="period-presets">
        {presets.map((p) => (
          <button type="button" key={p} className={value.preset === p ? 'on' : ''} aria-pressed={value.preset === p} onClick={() => { setOpen(false); onChange({ preset: p }); }} data-testid={'preset-' + p}>
            {tx('finance.period.' + p)}
          </button>
        ))}
        <button type="button" className={value.preset === 'custom' ? 'on' : ''} aria-pressed={value.preset === 'custom'} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="preset-custom">
          {tx('finance.period.custom')} ▾
        </button>
      </div>
      {basisOptions?.length === 1 && !onBasis ? (   // one date basis: said, not offered as a choice (a select that changes nothing is an inert control)
        <span className="fn-basis" data-testid="date-basis-fixed"><span>{tx('finance.period.dateField')}</span> {basisOptions[0].label}</span>
      ) : basisOptions && onBasis ? (
        <label className="fn-basis"><span>{tx('finance.period.dateField')}</span>
          <select className="fk-select" value={basis} onChange={(e) => onBasis(e.target.value)} data-testid="date-basis">
            {basisOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      ) : null}
      <span className="fn-active" data-testid="active-period" title={server?.tz}>{periodText(server)}</span>
      {open ? (
        <RangeCalendar initial={{ from: value.preset === 'custom' ? value.from : server?.from ?? undefined, to: value.preset === 'custom' ? value.to : server?.to ?? undefined }} today={today}
          onApply={(r) => { setOpen(false); onChange({ preset: 'custom', from: r.from, to: r.to }); }}
          onCancel={() => setOpen(false)}
          onClear={() => { /* keeps the popover open; Apply needs both dates again */ }} />
      ) : null}
    </div>
  );
}
export const periodQuery = (p: PeriodState) => (p.preset === 'custom' ? { preset: 'custom', from: p.from, to: p.to } : { preset: p.preset });

/** One request at a time: a newer call makes older answers stale. `error` and `data` are kept apart. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: unknown; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    const my = ++seq.current; setLoading(true);
    fn().then((d) => { if (my === seq.current) { setData(d); setError(null); setLoading(false); } })
      .catch((e) => { if (my === seq.current) { setError(e); setLoading(false); } });
  }, [...deps, tick]);   // eslint-disable-line react-hooks/exhaustive-deps
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

/** 403 vs everything else: an unauthorized answer shows an access message, never the data's shape. */
export const isForbidden = (e: unknown) => { const x = e as { status?: number; code?: string } | null; return !!x && (x.status === 403 || x.code === 'PERMISSION_DENIED'); };
export const isUnavailable = (e: unknown) => { const x = e as { status?: number } | null; return !!x && (x.status === 503 || x.status === 0 || x.status == null); };

export function StateBlock({ error, onRetry, children }: { error: unknown; onRetry: () => void; children?: ReactNode }) {
  if (isForbidden(error)) return <div className="fk-empty" role="alert"><div className="fk-empty-t">{tx('finance.state.forbidden')}</div><div className="fk-hint">{tx('finance.state.forbiddenHint')}</div></div>;
  const msg = (error as Error | null)?.message || tx('finance.state.loadFailed');
  return <div className="fk-error" role="alert"><span>{isUnavailable(error) ? tx('finance.state.unavailable') : msg}</span><button type="button" className="fk-btn ghost" onClick={onRetry}>{tx('pos.retry')}</button>{children}</div>;
}

/** "$" text box ↔ integer cents (no float sums: the cents are parsed from the text, never multiplied from a float). */
export function centsFromText(s: string): number | null {
  const t = s.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null;
  const [w, f = ''] = t.split('.');
  const c = Number(w) * 100 + Number((f + '00').slice(0, 2));
  return Number.isSafeInteger(c) ? c : null;
}
export const textFromCents = (c: number | null | undefined) => (c == null ? '' : `${Math.floor(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, '0')}`);
