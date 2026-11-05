import { useEffect, useState } from 'react';
import { ownerCompensationApi, type RetailMethod } from '../api/ownerApi';

/**
 * Retail Commission — the salon's rate on retail product sales (spec §16), kept separate from service commission.
 * Percent of gross retail price, or a fixed amount per item; "None" (the default) means no retail commission. Rendered
 * inside the (reachable) Commission & Payroll screen.
 */
export function RetailCommissionCard() {
  const [method, setMethod] = useState<RetailMethod>('none');
  const [value, setValue] = useState('0');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null); setLoading(true);
    ownerCompensationApi.retailPolicy()
      .then((p) => { setMethod(p.method); setValue(p.method === 'fixed' ? (p.value / 100).toFixed(2) : String(p.value)); })
      .catch((e) => setError(e?.message || 'Failed to load'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true); setSaved(false); setError(null);
    const num = Number(value || 0);
    const payloadValue = method === 'none' ? 0 : method === 'fixed' ? Math.round(num * 100) : Math.round(num);
    try { const p = await ownerCompensationApi.setRetailPolicy({ method, value: payloadValue }); setMethod(p.method); setValue(p.method === 'fixed' ? (p.value / 100).toFixed(2) : String(p.value)); setSaved(true); }
    catch (e: any) { setError(e?.message || 'Could not save'); }
    finally { setSaving(false); }
  };

  return (
    <div className="owner-chartcard">
      <div className="head"><div className="t">Retail Commission</div>{saving ? <div className="u">Saving…</div> : saved ? <div className="u" style={{ color: 'var(--owner-success)' }}>Saved</div> : null}</div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>What a technician earns on retail product sales. Kept separate from service commission and tips.</div>
      {loading ? <div className="muted" style={{ fontSize: 13 }}>Loading…</div> : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: '1 1 180px', fontSize: 12, fontWeight: 600, color: 'var(--owner-text-secondary)' }}>
            <span>Method</span>
            <select aria-label="Retail method" value={method} onChange={(e) => { setMethod(e.target.value as RetailMethod); setSaved(false); }} className="owner-input">
              <option value="none">None</option>
              <option value="percent">Percent of price</option>
              <option value="fixed">Fixed $ per item</option>
            </select>
          </label>
          {method !== 'none' ? (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: '0 0 110px', fontSize: 12, fontWeight: 600, color: 'var(--owner-text-secondary)' }}>
              <span>{method === 'fixed' ? 'Amount ($)' : 'Rate %'}</span>
              <input aria-label="Retail value" value={value} onChange={(e) => { setValue(e.target.value); setSaved(false); }} className="owner-input" inputMode="decimal" />
            </label>
          ) : null}
          <button
            className="owner-btn"
            disabled={saving}
            onClick={save}
            style={{
              minHeight: 46,
              height: 46,
              padding: '0 24px',
              fontSize: 15,
              fontWeight: 700,
              borderRadius: 10,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            Save
          </button>
        </div>
      )}
      {error ? <div role="alert" style={{ fontSize: 12.5, color: 'var(--owner-danger)', marginTop: 6 }}>{error}</div> : null}
    </div>
  );
}
