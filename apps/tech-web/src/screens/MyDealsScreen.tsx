// MyDealsScreen.tsx — Technician App "My Deals". Wired to /tech/deals. The salon's technician-deal policy decides
// whether creation is allowed; when it's OFF (by the salon, the plan or the platform) this shows an honest disabled
// state (no create form). Phase 5 (bug 8): the technician picks from the services THEY perform and the server prices
// the deal from the catalog — there is no "original price" box to type into any more. A technician only ever sees
// their own deals.
import { useCallback, useEffect, useState } from 'react';
import { techDealsApi, type TechDeal, type TechDealSettings, type TechDealStatus, type TechService } from '../api/techDealsApi';
import { useTechNav } from '../shell/nav';
import { formatCentsOrDash } from '@aipowersalon/money';   // BUILD_PLAN Phase 13 E (C6 §99–100): shared money / branch-zone date display

const money = (c: number | null) => formatCentsOrDash(c);
const statusTone = (s: TechDealStatus) => s === 'active' ? '#2F6B43' : s === 'pending_approval' ? '#B7791F' : /reject|expire|cancel|archive/.test(s) ? '#9B2C2C' : '#6b6b6b';
const discountLabel = (d: TechDeal) => d.discountType === 'percent' ? `${d.discountPercent ?? 0}% off` : d.discountType === 'fixed_price' ? `for ${money(d.discountCents)}` : `${money(d.discountCents)} off`;

const BLANK = { title: '', discountValue: '', serviceIds: [] as string[] };
const Back = () => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>);
export function MyDealsScreen({ onBack: _onBack }: { onBack?: () => void }) {
  const [settings, setSettings] = useState<TechDealSettings | null>(null);
  const [deals, setDeals] = useState<TechDeal[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [services, setServices] = useState<TechService[]>([]);
const { back } = useTechNav();
  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const s = await techDealsApi.settings();
      setSettings(s);
      if (s.allowTechnicianDeals === 'off') { setDeals([]); setServices([]); }
      else { const [mine, svcs] = await Promise.all([techDealsApi.myDeals(), techDealsApi.services().catch(() => [] as TechService[])]); setDeals(mine); setServices(svcs); }
    } catch (e: any) { setErr(e?.message || 'Could not load your deals.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const pct = Number(form.discountValue);
  const pctOk = form.discountValue.trim() !== '' && Number.isInteger(pct) && pct >= 1 && pct <= 100;
  const catalogCents = services.filter((x) => form.serviceIds.includes(x.id)).reduce((n, x) => n + x.priceCents, 0);
  const toggleService = (id: string) => setForm({ ...form, serviceIds: form.serviceIds.includes(id) ? form.serviceIds.filter((x) => x !== id) : [...form.serviceIds, id] });
  const create = async () => {
    setBusy('create'); setNote(null);
    try {
      await techDealsApi.create({ title: form.title.trim(), discountType: 'percent', discountPercent: pct, serviceIds: form.serviceIds });
      setShowAdd(false); setForm(BLANK); setNote('Deal submitted.'); await load();
    } catch (e: any) { setNote(e?.message || 'Could not create the deal.'); }
    finally { setBusy(null); }
  };

  const act = async (d: TechDeal, action: 'submit' | 'pause') => {
    setBusy(d.id + action); setNote(null);
    try { await (action === 'submit' ? techDealsApi.submit(d.id) : techDealsApi.pause(d.id)); await load(); }
    catch (e: any) { setNote(e?.message || 'That action could not be completed.'); }
    finally { setBusy(null); }
  };

  return (
    <div className="tech-screen" style={{ paddingInline: 0, paddingBottom: 90 }}>
      <div className="tech-topbar" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="tech-iconbtn" onClick={back} aria-label="Back" ><Back /></button>
        <h1 className="t-title" style={{ fontSize: 20, margin: 0 }}>My Deals</h1>
      </div>
      <div className="tech-main-2">

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={dealRow}>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="tech-skel" style={{ width: 120, height: 16 }} />
                  <div className="tech-skel" style={{ width: 60, height: 14 }} />
                </div>
                <div className="tech-skel" style={{ width: 200, height: 14 }} />
              </div>
              <div className="tech-skel" style={{ width: 60, height: 28, borderRadius: 8 }} />
            </div>
          ))}
        </div>
      )}
      {err && <div style={{ color: '#9B2C2C' }}>{err}</div>}
      {note && <div style={{ padding: '8px 12px', background: '#f4efe3', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{note}</div>}

      {!loading && settings && settings.allowTechnicianDeals === 'off' && (
        <div style={{ padding: 20, border: '1px dashed #d8ccae', borderRadius: 12, textAlign: 'center', color: '#7a6f57' }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Technician deals are turned off</div>
          <div style={{ fontSize: 13 }}>Your salon hasn’t enabled technician-created deals. Ask your manager to turn them on in Marketing → Deals &amp; Offers.</div>
        </div>
      )}

      {!loading && settings && settings.allowTechnicianDeals !== 'off' && (
        <>
          <button onClick={() => setShowAdd((v) => !v)} style={btnPrimary}>{showAdd ? 'Cancel' : '+ Create Deal'}</button>
          {settings.maxDiscountPercent != null && <div style={{ fontSize: 12, color: '#888', marginTop: 6 }}>Your salon caps discounts at {settings.maxDiscountPercent}%.</div>}

          {showAdd && (
            <div style={cardStyle}>
              <label style={lbl}>Title<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} style={inp} placeholder="My gel special" /></label>
              <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
                <legend style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>Services (yours, at the salon’s price)</legend>
                {services.length === 0 && <div style={{ fontSize: 12, color: '#9B2C2C' }}>No services are assigned to you yet — ask your manager to add them to your profile.</div>}
                {services.map((x) => (
                  <label key={x.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, padding: '3px 0' }}>
                    <input type="checkbox" aria-label={x.name} checked={form.serviceIds.includes(x.id)} onChange={() => toggleService(x.id)} /> {x.name} <span style={{ color: '#888' }}>{money(x.priceCents)}</span>
                  </label>
                ))}
              </fieldset>
              <label style={lbl}>Discount (%)<input aria-label="Discount (%)" value={form.discountValue} onChange={(e) => setForm({ ...form, discountValue: e.target.value })} style={inp} inputMode="numeric" /></label>
              {form.discountValue.trim() !== '' && !pctOk && <div role="alert" style={{ fontSize: 12, color: '#9B2C2C' }}>Use a whole percentage from 1 to 100.</div>}
              {pctOk && catalogCents > 0 && <div data-testid="tech-deal-estimate" style={{ fontSize: 12, color: '#2F6B43' }}>{money(catalogCents)} → about {money(catalogCents - Math.floor((catalogCents * pct) / 100))} (the salon confirms the price)</div>}
              <button onClick={create} disabled={busy === 'create' || !form.title.trim() || !pctOk || !form.serviceIds.length} style={{ ...btnPrimary, marginTop: 10 }}>{busy === 'create' ? 'Submitting…' : 'Submit deal'}</button>
              <div style={{ fontSize: 11, color: '#888', marginTop: 6 }}>{settings.allowTechnicianDeals === 'on_with_approval' ? 'Goes to your manager for approval.' : 'Publishes within your salon’s limits.'}</div>
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            {(deals || []).length === 0 && <div style={{ color: '#888', fontSize: 14 }}>You haven’t created any deals yet.</div>}
            {(deals || []).map((d) => (
              <div key={d.id} style={dealRow}>
                <div style={{ minWidth: 0 }}>
                  <strong>{d.title}</strong>
                  <span style={{ marginLeft: 8, fontSize: 11, color: statusTone(d.status) }}>{d.status.replace(/_/g, ' ')}</span>
                  <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{discountLabel(d)} · {money(d.originalPriceCents)} → <strong>{money(d.finalPriceCents)}</strong> · {d.redemptionCount} redeemed</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {d.status === 'draft' && <button onClick={() => act(d, 'submit')} disabled={!!busy} style={btnSmall}>Submit</button>}
                  {d.status === 'active' && <button onClick={() => act(d, 'pause')} disabled={!!busy} style={btnSmall}>Pause</button>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      </div>
    </div>
  );
}

const btnPrimary: React.CSSProperties = { padding: '10px 16px', background: 'var(--tech-gold, #A96F22)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14 };
const btnSmall: React.CSSProperties = { padding: '6px 12px', background: 'var(--tech-gold, #A96F22)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12 };
const cardStyle: React.CSSProperties = { border: '1px solid #eadfca', borderRadius: 12, padding: 14, marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 };
const dealRow: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 0', borderTop: '1px solid #efe7d6' };
const lbl: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#888' };
const inp: React.CSSProperties = { padding: '9px 11px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 };
