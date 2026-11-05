// ReportSummaryInner.tsx — a reusable report full-view for the shared iPad Pro modal. Report shapes
// differ per type (sales, technicians, payments, …), so instead of a fragile generic loader this
// renders the REAL, already-loaded data the report screen hands over: KPI cards + an optional table.
// The report screen owns the fetch (its existing permission/tenant-scoped posReportsApi call), so no
// data is fabricated and nothing is duplicated.
import type { ReactNode } from 'react';
import { t } from '@aipowersalon/mobile-sdk/i18n';

const V = (n: string) => `var(--${n})`;

export interface ReportKpi { label: string; value: ReactNode; delta?: string; deltaUp?: boolean }
export interface ReportSummaryData {
  kpis?: ReportKpi[];
  columns?: string[];
  rows?: (ReactNode)[][];
  periodLabel?: string;
  note?: ReactNode;
}

export function ReportSummaryInner({ data }: { data: ReportSummaryData }) {
  const kpis = data.kpis || [];
  const rows = data.rows || [];
  const cols = data.columns || [];
  const card: React.CSSProperties = { background: V('card'), border: `1px solid ${V('line')}`, borderRadius: 12, padding: 14 };

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 18px', display: 'grid', gap: 14, alignContent: 'start' }}>
      {data.periodLabel && <div style={{ fontSize: 12, color: V('muted'), fontWeight: 700 }}>{data.periodLabel}</div>}

      {kpis.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(kpis.length, 4)}, 1fr)`, gap: 12 }}>
          {kpis.map((k, i) => (
            <div key={i} style={card}>
              <div style={{ fontSize: 10.5, color: V('muted'), fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em' }}>{k.label}</div>
              <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "'Playfair Display', serif", margin: '2px 0' }}>{k.value}</div>
              {k.delta && <div style={{ fontSize: 10.5, fontWeight: 700, color: k.deltaUp ? V('ok') : V('danger') }}>{k.delta}</div>}
            </div>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            {cols.length > 0 && (
              <thead>
                <tr>{cols.map((c, i) => <th key={i} style={{ textAlign: i === 0 ? 'left' : 'right', color: V('muted'), fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '.03em', padding: '9px 14px', borderBottom: `1px solid ${V('line')}`, background: V('page'), position: 'sticky', top: 0 }}>{c}</th>)}</tr>
              </thead>
            )}
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>{r.map((cell, ci) => <td key={ci} style={{ textAlign: ci === 0 ? 'left' : 'right', padding: '8px 14px', borderBottom: ri < rows.length - 1 ? `1px solid #F4EEE1` : 'none', fontWeight: ci === 0 ? 700 : 500 }}>{cell}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {kpis.length === 0 && rows.length === 0 && (
        <div style={{ textAlign: 'center', color: V('muted'), fontSize: 13, padding: '40px 0' }}>{t('pos.no_report_data_for_this_period')}</div>
      )}

      {data.note && <div style={{ fontSize: 11.5, color: V('muted') }}>{data.note}</div>}
    </div>
  );
}
