import { useEffect, useMemo, useState } from 'react';
import { useScope } from '../shell/ScopeContext';
import {
  reportBuilderApi, useReportCatalog,
  type DimensionKey, type MeasureKey, type VisualizationKey, type ReportRange, type RunResult, type ReportDefinition,
} from '../api/superAdminReportBuilderApi';
import { Donut, MiniBars, AreaLine, NotConnected, money } from './_chartkit';

// ReportBuilderScreen.tsx — Super Admin › Report Builder. Compose a report from the platform's existing
// analytics aggregates: pick a dimension, a measure (only the ones actually backed for that dimension are
// offered), a visualization, range, and scope; run it; then save it for reuse. Honest-only: the backend
// returns available:false with a reason when a selection has no real source — the UI surfaces that, never
// inventing data. Rendered in the existing cream/gold system, Mac-fit.

const RANGES: { v: ReportRange; label: string }[] = [
  { v: '7d', label: 'Last 7 Days' }, { v: '30d', label: 'Last 30 Days' }, { v: '90d', label: 'Last Quarter' },
  { v: '6m', label: 'Last 6 Months' }, { v: '12m', label: 'Last 12 Months' },
];

export function ReportBuilderScreen() {
  const { tenantId, tenantName } = useScope();
  const { catalog, definitions, loading, error, reloadDefinitions } = useReportCatalog();

  const [dimension, setDimension] = useState<DimensionKey>('payment_method');
  const [measure, setMeasure] = useState<MeasureKey>('revenue_cents');
  const [visualization, setVisualization] = useState<VisualizationKey>('donut');
  const [range, setRange] = useState<ReportRange>('30d');
  const [limit, setLimit] = useState(50);
  const [name, setName] = useState('');
  const [result, setResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  // Measures actually backed for the chosen dimension (drives an honest measure dropdown).
  const supportedMeasures = useMemo<MeasureKey[]>(() => catalog?.supported[dimension]?.measures ?? [], [catalog, dimension]);
  useEffect(() => { if (supportedMeasures.length && !supportedMeasures.includes(measure)) setMeasure(supportedMeasures[0]); }, [supportedMeasures, measure]);

  const run = async () => {
    setRunning(true); setRunError(null);
    try { setResult(await reportBuilderApi.run({ dimension, measure, visualization, range, tenantId, limit })); }
    catch (e: any) { setRunError(e?.message || 'Run failed.'); setResult(null); }
    finally { setRunning(false); }
  };

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try { await reportBuilderApi.create({ name: name.trim(), dimension, measure, visualization, range, tenantId, limit }); setName(''); await reloadDefinitions(); }
    catch (e: any) { setRunError(e?.message || 'Save failed.'); }
    finally { setSaving(false); }
  };

  const load = async (d: ReportDefinition) => {
    setDimension(d.dimension); setMeasure(d.measure); setVisualization(d.visualization); setRange(d.rangeKey); setLimit(d.rowLimit);
    setRunning(true); setRunError(null);
    try { setResult(await reportBuilderApi.run({ dimension: d.dimension, measure: d.measure, visualization: d.visualization, range: d.rangeKey, tenantId: d.scopeTenantId, limit: d.rowLimit })); }
    catch (e: any) { setRunError(e?.message || 'Run failed.'); }
    finally { setRunning(false); }
  };

  const del = async (id: string) => { try { await reportBuilderApi.remove(id); await reloadDefinitions(); } catch { /* no-op */ } };

  const exportCsv = () => {
    if (!result || !result.available) return;
    const safe = (v: string) => (/^[=+\-@]/.test(v) ? `'${v}` : v).replace(/"/g, '""');
    const fmt = (v: number) => result.format === 'money' ? money(v) : String(v);
    const rows = [result.columns, ...result.rows.map((r) => [r.label, fmt(r.value)] as [string, string])];
    const csv = rows.map((r) => r.map((c) => `"${safe(String(c))}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `report-${dimension}-${measure}.csv`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  if (error) return <div className="work"><div className="state">{error}</div></div>;
  if (loading || !catalog) return <div className="work"><div className="state">Loading report builder…</div></div>;

  const fmtVal = (v: number) => (result && result.available && result.format === 'money') ? money(v) : v.toLocaleString();
  const total = result && result.available ? result.rows.reduce((a, r) => a + r.value, 0) : 0;

  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="vh">
        <h1>Report Builder</h1>
        <div className="sub">Build a report from real platform aggregates, preview it, and save it for reuse.{tenantId ? ` · Scoped to ${tenantName ?? 'salon'}` : ''}</div>
      </div>

      <div className="grid2 gap-2">
        {/* Builder */}
        <section className="panel">
          <h2 style={{ fontSize: 13.5, marginBottom: 10 }}>Configure</h2>
          <div className="flex gap-2 whitespace-nowrap flex-wrap">
            <label className='mr-2 font-bold border border-[var(--line)] p-1 rounded-md px-2'>Dimension
              <select className="font-normal" value={dimension} onChange={(e) => setDimension(e.target.value as DimensionKey)}>
                {catalog.dimensions.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
              </select>
            </label>
            <label className='mr-2 font-bold border border-[var(--line)] p-1 rounded-md px-2'>Measure
              <select className="font-normal" value={measure} onChange={(e) => setMeasure(e.target.value as MeasureKey)}>
                {catalog.measures.filter((m) => supportedMeasures.includes(m.key)).map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
            </label>
            <label className='mr-2 font-bold border border-[var(--line)] p-1 rounded-md px-2'>Visualization
              <select className="font-normal" value={visualization} onChange={(e) => setVisualization(e.target.value as VisualizationKey)}>
                {catalog.visualizations.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
              </select>
            </label>
            <label className='mr-2 font-bold border border-[var(--line)] p-1 rounded-md px-2'>Range
              <select className="font-normal" value={range} onChange={(e) => setRange(e.target.value as ReportRange)}>
                {RANGES.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
              </select>
            </label>
            <label className='mr-2 font-bold border border-[var(--line)] p-1 rounded-md px-2'>Row limit: 
              <input className="font-normal" type="number" min={1} max={500} value={limit} onChange={(e) => setLimit(Math.min(500, Math.max(1, Number(e.target.value) || 50)))} />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button className="btn" onClick={run} disabled={running}>{running ? 'Running…' : 'Run report'}</button>
            <input className="rbname" placeholder="Name to save…" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn ghost" onClick={save} disabled={saving || !name.trim()}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
          {runError && <div className="muted" style={{ color: 'var(--danger)', fontSize: 12, marginTop: 8 }}>{runError}</div>}
          <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>Source: composes from existing platform analytics — no ad-hoc cross-tenant queries.</div>
        </section>

        {/* Result */}
        <section className="panel">
          <div className="phead" style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <h2 style={{ fontSize: 13.5 }}>Preview</h2>
            <button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={exportCsv} disabled={!result || !result.available}>⤓ Export CSV</button>
          </div>
          {!result ? <div className="state" style={{ fontSize: 12 }}>Configure a report and press Run.</div>
            : !result.available ? <div className="state" style={{ fontSize: 12 }}><NotConnected /> <div className="muted" style={{ marginTop: 4, fontSize: 11 }}>{result.reason}</div></div>
              : result.rows.length === 0 ? <div className="state" style={{ fontSize: 12 }}>No rows for this selection.</div>
                : (
                  <>
                    {visualization === 'donut' && <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      <Donut hideLegend data={result.rows.map((r) => ({ label: r.label, value: r.value }))} centerLabel={result.format === 'money' ? money(total) : total.toLocaleString()} />
                      <div className="legend" style={{ flex: 1 }}>{result.rows.slice(0, 8).map((r) => (
                        <div className="li" key={r.label}><span style={{ textTransform: 'capitalize' }}>{r.label}</span><span className="va">{fmtVal(r.value)}</span></div>
                      ))}</div>
                    </div>}
                    {(visualization === 'bar' || visualization === 'kpi') && <MiniBars data={result.rows.map((r) => ({ label: r.label, value: r.value, tip: fmtVal(r.value) }))} />}
                    {visualization === 'line' && <AreaLine series={result.rows.map((r) => ({ label: r.label, valueCents: r.value }))} height={170} />}
                    {visualization === 'table' && <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                      <thead><tr><th style={{ textAlign: 'left', textTransform: 'capitalize' }}>{result.columns[0]}</th><th style={{ textAlign: 'right' }}>{result.columns[1]}</th></tr></thead>
                      <tbody>{result.rows.map((r) => (
                        <tr key={r.label} style={{ borderTop: '1px solid var(--line)' }}><td style={{ textTransform: 'capitalize' }}>{r.label}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtVal(r.value)}</td></tr>
                      ))}</tbody>
                    </table>}
                    <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>{result.rows.length} row(s) · source: {result.source}</div>
                  </>
                )}
        </section>
      </div>

      {/* Saved reports */}
      <section className="panel">
        <h2 style={{ fontSize: 13.5, marginBottom: 8 }}>Saved Reports</h2>
        {definitions.length === 0 ? <div className="state" style={{ fontSize: 12 }}>No saved reports yet. Configure one above and press Save.</div>
          : <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead><tr><th style={{ textAlign: 'left' }}>Name</th><th style={{ textAlign: 'left' }}>Definition</th><th style={{ textAlign: 'left' }}>Range</th><th></th></tr></thead>
            <tbody>{definitions.map((d) => (
              <tr key={d.id} style={{ borderTop: '1px solid var(--line)' }}>
                <td style={{ fontWeight: 600 }}>{d.name}</td>
                <td className="muted" style={{ textTransform: 'capitalize' }}>{d.dimension.replace(/_/g, ' ')} × {d.measure.replace(/_/g, ' ')} · {d.visualization}</td>
                <td className="muted">{d.rangeKey}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="btn ghost sm" onClick={() => load(d)}>Load</button>{' '}
                  <button className="btn ghost sm" onClick={() => del(d.id)}>Delete</button>
                </td>
              </tr>
            ))}</tbody>
          </table>}
      </section>
    </div>
  );
}
