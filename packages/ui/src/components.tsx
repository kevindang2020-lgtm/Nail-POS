// Canonical AI PowerSalon UI kit. One implementation of each shared component, variant-driven, consumed by BOTH the
// tenant POS and the Super Admin app (the master spec's "one KpiCard / one DataTable" rule). Styling is via the
// --aps-* design tokens (tokens.css) so the same components render correctly under .theme-tenant and .theme-superadmin.
import type { CSSProperties, ReactNode } from 'react';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'purple' | 'teal';

const TONE_COLOR: Record<Tone, string> = {
  success: 'var(--aps-ok)', warning: 'var(--aps-warn)', danger: 'var(--aps-danger)',
  info: 'var(--aps-info)', neutral: 'var(--aps-muted)', purple: 'var(--aps-purple)', teal: 'var(--aps-teal)',
};
const toneTint = (t: Tone) => `color-mix(in srgb, ${TONE_COLOR[t]} 14%, transparent)`;

const card: CSSProperties = {
  background: 'var(--aps-card)', border: '1px solid var(--aps-line)', borderRadius: 'var(--aps-radius)',
  boxShadow: 'var(--aps-shadow)', fontFamily: 'var(--aps-font-body)', color: 'var(--aps-text)',
};

// ---- StatusBadge ----
export function StatusBadge({ tone = 'neutral', children, dot }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: 999,
      fontSize: 11.5, fontWeight: 700, color: TONE_COLOR[tone], background: toneTint(tone), whiteSpace: 'nowrap' }}>
      {dot ? <span style={{ width: 6, height: 6, borderRadius: 999, background: TONE_COLOR[tone] }} /> : null}
      {children}
    </span>
  );
}

// ---- KpiCard ----
export function KpiCard({ label, value, delta, deltaDirection, icon, tone = 'neutral', sub }:
  { label: string; value: ReactNode; delta?: string; deltaDirection?: 'up' | 'down'; icon?: ReactNode; tone?: Tone; sub?: ReactNode }) {
  const deltaColor = deltaDirection === 'down' ? 'var(--aps-danger)' : 'var(--aps-ok)';
  return (
    <div style={{ ...card, padding: 14, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      {icon ? <div aria-hidden style={{ width: 38, height: 38, borderRadius: 11, display: 'grid', placeItems: 'center',
        background: toneTint(tone), color: TONE_COLOR[tone], flex: '0 0 auto' }}>{icon}</div> : null}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11.5, color: 'var(--aps-muted)', fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 21, fontWeight: 800, fontFamily: 'var(--aps-font-head)', lineHeight: 1.2, marginTop: 2 }}>{value}</div>
        {delta ? <div style={{ fontSize: 11.5, fontWeight: 700, color: deltaColor, marginTop: 2 }}>
          {deltaDirection === 'down' ? '▼' : '▲'} {delta}</div> : null}
        {sub ? <div style={{ fontSize: 11, color: 'var(--aps-muted)', marginTop: 2 }}>{sub}</div> : null}
      </div>
    </div>
  );
}

// ---- MetricStrip ----
export function MetricStrip({ items }: { items: { label: string; value: ReactNode; tone?: Tone }[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 0, ...card, padding: 0, overflow: 'hidden' }}>
      {items.map((m, i) => (
        <div key={i} style={{ flex: '1 1 120px', padding: '12px 14px', borderLeft: i ? '1px solid var(--aps-line)' : 'none' }}>
          <div style={{ fontSize: 11, color: 'var(--aps-muted)', fontWeight: 600 }}>{m.label}</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: m.tone ? TONE_COLOR[m.tone] : 'var(--aps-text)', marginTop: 2 }}>{m.value}</div>
        </div>
      ))}
    </div>
  );
}

// ---- ProgressBar ----
export function ProgressBar({ value, tone = 'info', label }: { value: number; tone?: Tone; label?: ReactNode }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div>
      {label ? <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--aps-muted)', marginBottom: 4 }}>
        <span>{label}</span><span style={{ fontWeight: 700, color: 'var(--aps-text)' }}>{pct}%</span></div> : null}
      <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
        style={{ height: 8, borderRadius: 999, background: 'color-mix(in srgb, var(--aps-line) 70%, transparent)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: TONE_COLOR[tone], borderRadius: 999 }} />
      </div>
    </div>
  );
}

// ---- HealthGauge (semicircular SVG arc) ----
export function HealthGauge({ value, label, tone }: { value: number; label?: ReactNode; tone?: Tone }) {
  const pct = Math.max(0, Math.min(100, value));
  const color = tone ? TONE_COLOR[tone] : pct >= 80 ? 'var(--aps-ok)' : pct >= 50 ? 'var(--aps-warn)' : 'var(--aps-danger)';
  const r = 52, c = Math.PI * r, off = c * (1 - pct / 100);
  return (
    <div style={{ textAlign: 'center' }}>
      <svg viewBox="0 0 130 74" width="130" height="74" role="img" aria-label={`${pct}%`}>
        <path d="M9 65 A56 56 0 0 1 121 65" fill="none" stroke="var(--aps-line)" strokeWidth="11" strokeLinecap="round" />
        <path d="M9 65 A56 56 0 0 1 121 65" fill="none" stroke={color} strokeWidth="11" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={off} />
      </svg>
      <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'var(--aps-font-head)', marginTop: -14 }}>{pct}%</div>
      {label ? <div style={{ fontSize: 11.5, color: 'var(--aps-muted)' }}>{label}</div> : null}
    </div>
  );
}

// ---- ChartCard ----
export function ChartCard({ title, action, children }: { title: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section style={{ ...card, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <h3 style={{ fontSize: 14, fontWeight: 800, margin: 0, fontFamily: 'var(--aps-font-head)' }}>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

// ---- DataTable ----
export type Column<R> = { key: string; header: ReactNode; render?: (row: R) => ReactNode; align?: 'left' | 'right' | 'center'; width?: number | string };
export function DataTable<R>({ columns, rows, getRowKey, empty, maxHeight = 420, onRowClick }:
  { columns: Column<R>[]; rows: R[]; getRowKey: (row: R, i: number) => string; empty?: ReactNode; maxHeight?: number | string; onRowClick?: (row: R) => void }) {
  if (!rows.length) return <div style={{ ...card, padding: 0 }}>{empty || <EmptyState title="No records" />}</div>;
  return (
    <div style={{ ...card, padding: 0, overflow: 'auto', maxHeight:0 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth:900 }}>
        <thead>
          <tr>{columns.map((col) => (
            <th key={col.key} style={{ position: 'sticky', top: 0, background: 'var(--aps-card)', textAlign: col.align || 'left',
              padding: '10px 12px', borderBottom: '1px solid var(--aps-line)', color: 'var(--aps-muted)', fontSize: 11.5,
              fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', width: col.width }}>{col.header}</th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={getRowKey(row, i)} onClick={onRowClick ? () => onRowClick(row) : undefined}
              style={{ cursor: onRowClick ? 'pointer' : 'default' }}>
              {columns.map((col) => (
                <td key={col.key} style={{ textAlign: col.align || 'left', padding: '10px 12px', borderBottom: '1px solid var(--aps-line)' }}>
                  {col.render ? col.render(row) : (row as Record<string, ReactNode>)[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- FilterBar ----
export function FilterBar({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>{children}</div>;
}

// ---- EmptyState ----
export function EmptyState({ title, message, icon, action }: { title: ReactNode; message?: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div style={{ padding: 28, textAlign: 'center', color: 'var(--aps-muted)' }}>
      {icon ? <div style={{ fontSize: 26, marginBottom: 8 }}>{icon}</div> : null}
      <div style={{ fontWeight: 800, color: 'var(--aps-text)', fontSize: 14 }}>{title}</div>
      {message ? <div style={{ fontSize: 12.5, marginTop: 4 }}>{message}</div> : null}
      {action ? <div style={{ marginTop: 12 }}>{action}</div> : null}
    </div>
  );
}

// ---- LoadingSkeleton ----
export function LoadingSkeleton({ lines = 3, height = 14 }: { lines?: number; height?: number }) {
  return (
    <div aria-busy="true" aria-live="polite">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} style={{ height, borderRadius: 6, marginBottom: 8, width: i === lines - 1 ? '70%' : '100%',
          background: 'linear-gradient(90deg, var(--aps-line) 25%, color-mix(in srgb, var(--aps-line) 40%, #fff) 50%, var(--aps-line) 75%)',
          backgroundSize: '800px 100%', animation: 'aps-shimmer 1.4s infinite linear' }} />
      ))}
    </div>
  );
}

// ---- ErrorState ----
export function ErrorState({ message, onRetry }: { message?: ReactNode; onRetry?: () => void }) {
  return (
    <div style={{ padding: 24, textAlign: 'center' }}>
      <div style={{ color: 'var(--aps-danger)', fontWeight: 800, fontSize: 14 }}>Something went wrong</div>
      <div style={{ fontSize: 12.5, color: 'var(--aps-muted)', marginTop: 4 }}>{message || 'Please try again.'}</div>
      {onRetry ? <button onClick={onRetry} style={btn('ghost')}>Retry</button> : null}
    </div>
  );
}

// ---- PermissionGate ----
export function PermissionGate({ allow, children, fallback = null }: { allow: boolean; children: ReactNode; fallback?: ReactNode }) {
  return <>{allow ? children : fallback}</>;
}

// ---- Pagination ----
export function Pagination({ page, pageCount, onPage }: { page: number; pageCount: number; onPage: (p: number) => void }) {
  const total = Math.max(1, pageCount);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end', padding: '8px 0' }}>
      <button disabled={page <= 1} onClick={() => onPage(page - 1)} style={btn('ghost')}>Prev</button>
      <span style={{ fontSize: 12, color: 'var(--aps-muted)' }}>Page {Math.min(page, total)} of {total}</span>
      <button disabled={page >= total} onClick={() => onPage(page + 1)} style={btn('ghost')}>Next</button>
    </div>
  );
}

// ---- PageHeader ----
export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, fontFamily: 'var(--aps-font-head)' }}>{title}</h1>
        {subtitle ? <div style={{ fontSize: 12.5, color: 'var(--aps-muted)', marginTop: 2 }}>{subtitle}</div> : null}
      </div>
      {actions ? <div style={{ display: 'flex', gap: 8, flex: '0 0 auto' }}>{actions}</div> : null}
    </div>
  );
}

// ---- Drawer ----
export function Drawer({ open, onClose, title, children, width = 420 }:
  { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; width?: number }) {
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" style={overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', top: 0, right: 0, height: '100%', width,
        maxWidth: '94vw', background: 'var(--aps-card)', borderLeft: '1px solid var(--aps-line)', boxShadow: '-8px 0 24px rgba(44,33,24,.12)',
        display: 'flex', flexDirection: 'column', fontFamily: 'var(--aps-font-body)', color: 'var(--aps-text)' }}>
        <DialogHead title={title} onClose={onClose} />
        <div style={{ padding: 16, overflow: 'auto' }}>{children}</div>
      </div>
    </div>
  );
}

// ---- Modal ----
export function Modal({ open, onClose, title, children, width = 520 }:
  { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; width?: number }) {
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" style={{ ...overlay, display: 'grid', placeItems: 'center' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width, maxWidth: '94vw', maxHeight: '88vh', background: 'var(--aps-card)',
        border: '1px solid var(--aps-line)', borderRadius: 'var(--aps-radius)', boxShadow: '0 12px 40px rgba(44,33,24,.18)',
        display: 'flex', flexDirection: 'column', fontFamily: 'var(--aps-font-body)', color: 'var(--aps-text)' }}>
        <DialogHead title={title} onClose={onClose} />
        <div style={{ padding: 16, overflow: 'auto' }}>{children}</div>
      </div>
    </div>
  );
}

function DialogHead({ title, onClose }: { title?: ReactNode; onClose: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--aps-line)' }}>
      <div style={{ fontWeight: 800, fontSize: 15, fontFamily: 'var(--aps-font-head)' }}>{title}</div>
      <button aria-label="Close" onClick={onClose} style={{ ...btn('ghost'), padding: '4px 10px', fontSize: 16, lineHeight: 1 }}>×</button>
    </div>
  );
}

const overlay: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(44,33,24,.32)', zIndex: 60 };
function btn(variant: 'primary' | 'ghost' = 'primary'): CSSProperties {
  const base: CSSProperties = { fontFamily: 'var(--aps-font-body)', fontSize: 12.5, fontWeight: 700, borderRadius: 'var(--aps-radius-sm)',
    padding: '7px 12px', cursor: 'pointer', minHeight: 32 };
  return variant === 'primary'
    ? { ...base, background: 'var(--aps-orange)', color: '#fff', border: '1px solid var(--aps-orange-strong)' }
    : { ...base, background: 'transparent', color: 'var(--aps-text)', border: '1px solid var(--aps-line)' };
}
export { btn as kitButtonStyle };
