import { useEffect, useState } from 'react';
import { ownerCompensationApi, type TierPlan, type TierBand, type TierPreview } from '../api/ownerApi';

type BandRow = { upto: string; rate: string };
const toBands = (rows: BandRow[]): TierBand[] => rows.map((r) => ({ uptoCents: r.upto.trim() === '' ? null : Math.round(Number(r.upto) * 100), ratePercent: Number(r.rate) }));
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const bandLabel = (b: TierBand, i: number, prev: number | null) => `${prev == null ? '$0' : money(prev)}–${b.uptoCents == null ? '∞' : money(b.uptoCents)}: ${b.ratePercent}%`;

/**
 * Tiered Plans — author a per-technician production-tier ladder (spec §2) and preview it (§20). The preview runs the real
 * backend engine and shows entire-period vs marginal side-by-side, since the two methods differ and must not be confused.
 * Tiered plans override per-line commission at payroll time. Rendered inside the (reachable) Commission & Payroll screen.
 */
export function TierPlansPanel() {
  const [plans, setPlans] = useState<TierPlan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [techId, setTechId] = useState('');
  const [mode, setMode] = useState<'entire' | 'marginal'>('entire');
  const [rows, setRows] = useState<BandRow[]>([{ upto: '4000', rate: '50' }, { upto: '6000', rate: '55' }, { upto: '', rate: '60' }]);
  const [previewProd, setPreviewProd] = useState('5000');
  const [preview, setPreview] = useState<TierPreview | null>(null);

  const load = () => { setError(null); ownerCompensationApi.tierPlans().then(setPlans).catch((e) => { setPlans([]); setError(e?.message || 'Failed to load tier plans'); }); };
  useEffect(() => { load(); }, []);

  const setRow = (i: number, patch: Partial<BandRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { upto: '', rate: '' }]);
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));

  const runPreview = async () => {
    setError(null);
    try { setPreview(await ownerCompensationApi.previewTierPlan({ productionCents: Math.round(Number(previewProd || 0) * 100), bands: toBands(rows) })); }
    catch (e: any) { setError(e?.message || 'Preview failed'); }
  };

  const create = async () => {
    if (!techId.trim()) { setError('Enter a technician ID'); return; }
    setBusy(true); setError(null);
    try { await ownerCompensationApi.createTierPlan({ technicianId: techId.trim(), mode, bands: toBands(rows) }); setTechId(''); load(); }
    catch (e: any) { setError(e?.message || 'Could not create the plan'); }
    finally { setBusy(false); }
  };

  const archive = async (id: string) => { setBusy(true); setError(null); try { await ownerCompensationApi.archiveTierPlan(id); load(); } catch (e: any) { setError(e?.message || 'Archive failed'); } finally { setBusy(false); } };

  return (
    <div className="owner-chartcard">
      <div className="head"><div className="t">Tiered Plans</div>{busy ? <div className="u">Working…</div> : null}</div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>A technician's rate rises with their production over the pay period. Entire-period applies one band's rate to all production; marginal applies each band's rate only to production within it. Tiered plans replace per-line commission at payroll time.</div>

      {error ? <div role="alert" style={{ fontSize: 13, color: 'var(--owner-danger)', marginBottom: 8 }}>{error}</div> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, alignItems: 'flex-end', marginBottom: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--owner-text-secondary)' }}>
          <span>Technician ID</span>
          <input aria-label="Technician ID" value={techId} onChange={(e) => setTechId(e.target.value)} className="owner-input" placeholder="technician id" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--owner-text-secondary)' }}>
          <span>Method</span>
          <select aria-label="Tier mode" value={mode} onChange={(e) => setMode(e.target.value as any)} className="owner-input">
            <option value="entire">Entire-period</option>
            <option value="marginal">Marginal</option>
          </select>
        </label>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div className="muted" style={{ fontSize: 12, marginBottom: 6, fontWeight: 600, color: 'var(--owner-text-secondary)' }}>Bands (leave the top "up to" blank for no upper limit):</div>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <input aria-label={`Band ${i + 1} up to`} value={r.upto} onChange={(e) => setRow(i, { upto: e.target.value })} className="owner-input" placeholder="up to $" inputMode="decimal" style={{ flex: 1 }} />
            <input aria-label={`Band ${i + 1} rate`} value={r.rate} onChange={(e) => setRow(i, { rate: e.target.value })} className="owner-input" placeholder="rate %" inputMode="decimal" style={{ flex: 1 }} />
            {rows.length > 1 ? <button className="owner-btn ghost" onClick={() => removeRow(i)} aria-label={`Remove band ${i + 1}`} style={{ minHeight: 38, height: 38, width: 38, padding: 0, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>✕</button> : null}
          </div>
        ))}
        <button className="owner-btn ghost" onClick={addRow} style={{ minHeight: 34, height: 34, padding: '0 14px', fontSize: 13, borderRadius: 8, marginTop: 4 }}>Add band</button>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 10 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--owner-text-secondary)' }}>
          <span>Preview production ($)</span>
          <input aria-label="Preview production" value={previewProd} onChange={(e) => setPreviewProd(e.target.value)} className="owner-input" inputMode="decimal" />
        </label>
        <button className="owner-btn ghost" onClick={runPreview} style={{ minHeight: 44, height: 44, padding: '0 18px', fontSize: 14, borderRadius: 10 }}>Preview</button>
      </div>

      <button
        className="owner-btn"
        disabled={busy}
        onClick={create}
        style={{
          width: '100%',
          minHeight: 46,
          height: 46,
          padding: '0 20px',
          fontSize: 15,
          fontWeight: 700,
          borderRadius: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 12,
        }}
      >
        Save plan
      </button>

      {preview ? (
        <div style={{ fontSize: 12.5, marginBottom: 12, padding: 10, border: '1px solid var(--owner-border, #eee)', borderRadius: 8, background: 'var(--owner-surface)' }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>On {money(preview.productionCents)} production:</div>
          <div>· Entire-period: <b>{money(preview.entire.commissionCents)}</b> ({preview.entire.effectiveRatePercent}%)</div>
          <div>· Marginal: <b>{money(preview.marginal.commissionCents)}</b> ({preview.marginal.effectiveRatePercent}%)</div>
        </div>
      ) : null}

      {plans === null ? <div className="muted" style={{ fontSize: 13 }}>Loading…</div>
        : plans.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>No tiered plans. Technicians without a plan use their per-line commission.</div>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {plans.map((p) => {
              let prev: number | null = null;
              return (
                <div key={p.id} style={{ border: '1px solid var(--owner-border, #eee)', borderRadius: 8, padding: 10, fontSize: 12.5, background: 'var(--owner-surface)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600 }}>Tech {p.technicianId} · {p.mode === 'entire' ? 'Entire-period' : 'Marginal'}</span>
                    <button className="owner-btn ghost" disabled={busy} onClick={() => archive(p.id)} style={{ minHeight: 32, height: 32, padding: '0 12px', fontSize: 12, borderRadius: 8 }}>Archive</button>
                  </div>
                  <div className="muted" style={{ marginTop: 4 }}>{p.bands.map((b, i) => { const label = bandLabel(b, i, prev); prev = b.uptoCents; return <span key={i}>{i > 0 ? ' · ' : ''}{label}</span>; })}</div>
                </div>
              );
            })}
          </div>}
    </div>
  );
}
