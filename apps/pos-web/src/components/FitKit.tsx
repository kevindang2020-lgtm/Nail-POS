// FitKit.tsx — the shared pieces of the Oct 29 2026 one-screen Customers pages (Loyalty & Rewards, Membership Overview,
// Customer Retention). One implementation each, so the three screens behave the same:
//   useFitRows   how many list rows fit a bounded panel body right now (ResizeObserver) → the server page size, so a
//                list never grows the page and never shows a half row (specs: "choose page sizes from viewport and row
//                height; use fewer rows before making typography tiny")
//   Pager        "Showing 1–10 of 85 · Page 1 of 9 · ‹ 1 2 3 … 9 ›" — Previous disabled on page 1, Next on the last
//   FitDialog    a viewport-bounded overlay: title + close, focus trapped, Escape closes (unless busy), focus returns
//                to the control that opened it, the page behind stays in place
//   KpiCard      an equal-height KPI that IS a button (click-through) with an honest sub-line / loading / error state
//   csvCell / downloadCsv   spreadsheet-safe CSV (a cell starting with = + - @ is prefixed with ' — formula injection)
//   requestId    a fresh idempotency key for one user action (a retry reuses it; a new action gets a new one)
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { fmtNumber } from '../i18n/format';

export function useFitRows<T extends HTMLElement>(rowHeight: number, opts: { min?: number; max?: number; reserve?: number } = {}) {
  const ref = useRef<T | null>(null);
  const [rows, setRows] = useState(opts.min ?? 3);
  const min = opts.min ?? 2, max = opts.max ?? 12, reserve = opts.reserve ?? 0;
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    // the body's BOX height (not clientHeight): a scrollbar appearing inside the body must not change the page size, or
    // rows → content → scrollbar → rows would loop and re-fetch forever
    const measure = () => { const cs = getComputedStyle(el); const h = el.getBoundingClientRect().height - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0) - reserve; const n = Math.max(min, Math.min(max, Math.floor(h / rowHeight))); setRows((prev) => (prev === n ? prev : n)); };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure()); ro.observe(el);
    return () => ro.disconnect();
  }, [rowHeight, min, max, reserve]);
  return { ref, rows };
}

export interface PageInfo { page: number; pageSize: number; totalItems: number; totalPages: number }
export function Pager({ info, onPage, compact = false, label }: { info: PageInfo | null | undefined; onPage: (p: number) => void; compact?: boolean; label?: string }) {
  if (!info) return null;
  const { page, pageSize, totalItems, totalPages } = info;
  const from = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalItems);
  const btns: (number | '…')[] = [];
  if (totalPages <= 5) for (let i = 1; i <= totalPages; i++) btns.push(i);
  else if (page <= 3) btns.push(1, 2, 3, 4, '…', totalPages);
  else if (page >= totalPages - 2) btns.push(1, '…', totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
  else btns.push(1, '…', page - 1, page, page + 1, '…', totalPages);
  // a narrow panel: at most 5 slots — the current page, its neighbours, and the last
  const cbtns: (number | '…')[] = [];
  if (totalPages <= 4) for (let i = 1; i <= totalPages; i++) cbtns.push(i);
  else if (page <= 2) cbtns.push(1, 2, 3, '…', totalPages);
  else if (page >= totalPages - 1) cbtns.push(1, '…', totalPages - 2, totalPages - 1, totalPages);
  else cbtns.push(page - 1, page, page + 1, '…', totalPages);
  return (
    <nav className={'fk-pager' + (compact ? ' compact' : '')} aria-label={label ?? tx('people.fit.pagination')}>
      <span className="fk-pager-range">{tx(compact ? 'people.fit.rangeShort' : 'people.fit.showingRange', { from: fmtNumber(from), to: fmtNumber(to), total: fmtNumber(totalItems) })}{compact ? '' : ` · ${tx('people.fit.pageOf', { page: String(page), pages: String(totalPages) })}`}</span>
      <span className="fk-pager-btns">
        <button type="button" className="fk-pbtn" aria-label={tx('people.fit.previous')} disabled={page <= 1} onClick={() => onPage(page - 1)}>‹ <span className="fk-pbtn-l">{tx('people.fit.previous')}</span></button>
        {(compact ? cbtns : btns).map((b, i) => b === '…' ? <span key={'e' + i} className="fk-pell">…</span> : (
          <button type="button" key={b} className={'fk-pbtn num' + (b === page ? ' on' : '')} aria-current={b === page ? 'page' : undefined} aria-label={tx('people.fit.pageN', { n: String(b) })} onClick={() => onPage(b)}>{b}</button>
        ))}
        <button type="button" className="fk-pbtn" aria-label={tx('people.fit.next')} disabled={page >= totalPages} onClick={() => onPage(page + 1)}><span className="fk-pbtn-l">{tx('people.fit.next')}</span> ›</button>
      </span>
    </nav>
  );
}

export function FitDialog({ title, subtitle, onClose, busy = false, wide = false, side = false, children, footer, testId }: { title: string; subtitle?: ReactNode; onClose: () => void; busy?: boolean; wide?: boolean; side?: boolean; children: ReactNode; footer?: ReactNode; testId?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const opener = useRef<Element | null>(typeof document !== 'undefined' ? document.activeElement : null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const busyRef = useRef(busy); busyRef.current = busy;
  useEffect(() => {
    const node = ref.current;
    const first = node?.querySelector<HTMLElement>('[data-autofocus]') ?? node?.querySelector<HTMLElement>('input, select, textarea, button');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busyRef.current) { e.preventDefault(); closeRef.current(); return; }
      if (e.key !== 'Tab' || !node) return;
      const f = Array.from(node.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((el) => el.offsetParent !== null);
      if (!f.length) return;
      const a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener('keydown', onKey);
    const back = opener.current as HTMLElement | null;   // the element that opened the dialog (set once, at mount)
    return () => { document.removeEventListener('keydown', onKey); back?.focus?.(); };
  }, []);
  return (
    <div className={'fk-backdrop' + (side ? ' side' : '')} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }} data-testid={testId}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={'fk-dialog' + (wide ? ' wide' : '') + (side ? ' side' : '')}>
        <header className="fk-dialog-head">
          <div style={{ minWidth: 0 }}><h2>{title}</h2>{subtitle ? <div className="fk-dialog-sub">{subtitle}</div> : null}</div>
          <button type="button" className="fk-x" aria-label={tx('pos.close')} onClick={onClose} disabled={busy}>✕</button>
        </header>
        <div className="fk-dialog-body">{children}</div>
        {footer ? <footer className="fk-dialog-foot">{footer}</footer> : null}
      </div>
    </div>
  );
}

export function KpiCard({ label, value, sub, onClick, tone, loading, testId }: { label: string; value: ReactNode; sub?: ReactNode; onClick?: () => void; tone?: 'ok' | 'warn' | 'bad' | 'gold'; loading?: boolean; testId?: string }) {
  return (
    <button type="button" className={'fk-kpi' + (tone ? ' ' + tone : '')} onClick={onClick} disabled={!onClick} data-testid={testId} aria-label={typeof value === 'string' || typeof value === 'number' ? `${label}: ${value}` : label}>
      <span className="fk-kpi-l">{label}</span>
      <span className="fk-kpi-v">{loading ? <span className="fk-skel" aria-hidden /> : value}</span>
      <span className="fk-kpi-s">{sub}</span>
    </button>
  );
}

/** A panel with a fixed header, a bounded body (lists page inside it), and an optional footer (the pager). */
export function FitPanel({ title, actions, children, footer, bodyRef, testId, className }: { title: ReactNode; actions?: ReactNode; children: ReactNode; footer?: ReactNode; bodyRef?: React.Ref<HTMLDivElement>; testId?: string; className?: string }) {
  return (
    <section className={'fk-panel' + (className ? ' ' + className : '')} data-testid={testId}>
      <div className="fk-panel-head"><h2>{title}</h2>{actions ? <div className="fk-panel-actions">{actions}</div> : null}</div>
      <div className="fk-panel-body" ref={bodyRef}>{children}</div>
      {footer ? <div className="fk-panel-foot">{footer}</div> : null}
    </section>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="fk-empty" role="status"><div className="fk-empty-t">{title}</div>{children ? <div className="fk-empty-a">{children}</div> : null}</div>;
}

export function ErrorRetry({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="fk-error" role="alert"><span>{message}</span><button type="button" className="fk-btn ghost" onClick={onRetry}>{tx('pos.retry')}</button></div>;
}

export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;   // formula injection: a spreadsheet never executes an exported cell
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function downloadCsv(filename: string, header: string[], rows: unknown[][]) {
  const lines = [header.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))];
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
/** save server-produced text (an audited CSV export) under the screen's file name — no client-side rebuild */
export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
export function requestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = new Uint8Array(16); globalThis.crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
/** A list's query state: page resets to 1 whenever a filter changes (spec: "filter / search change → Page 1"). */
export function useListState<F extends Record<string, unknown>>(initial: F) {
  const [filters, setFiltersRaw] = useState<F>(initial);
  const [page, setPage] = useState(1);
  const setFilters = useCallback((patch: Partial<F>) => { setFiltersRaw((f) => ({ ...f, ...patch })); setPage(1); }, []);
  return { filters, setFilters, page, setPage };
}
/** Debounced value (search boxes): stale responses are ignored by the caller's request counter. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => { const id = setTimeout(() => setV(value), ms); return () => clearTimeout(id); }, [value, ms]);
  return v;
}
/** Escape closes an overlay that is not built on FitDialog (the existing membership enrol / plan builder overlays). */
export function useEscapeToClose(onClose: () => void) {
  const ref = useRef(onClose); ref.current = onClose;
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') ref.current(); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, []);
}
