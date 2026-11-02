import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { customerApi, type CustomerAddress, type CreateAddressBody } from '../api/customerApi';

// My Addresses (Profile → My Addresses) — real CRUD over /customer/addresses. List, add, delete, set default. No
// fabricated rows; a new account starts empty.
const EMPTY: CreateAddressBody = { label: '', line1: '', line2: '', city: '', state: '', zip: '' };

export function AddressesScreen() {
  const nav = useNavigate();
  const [items, setItems] = useState<CustomerAddress[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<CreateAddressBody>(EMPTY);

  const load = () => customerApi.addresses().then(setItems).catch((e: any) => setError(e?.message || 'Could not load addresses.'));
  useEffect(() => { let live = true; customerApi.addresses().then((d) => { if (live) setItems(d); }).catch((e: any) => live && setError(e?.message || 'Could not load addresses.')); return () => { live = false; }; }, []);

  const save = async () => {
    if (!(form.line1 || '').trim()) { setError('Street address is required.'); return; }
    setBusy(true); setError(null);
    try { await customerApi.addAddress(form); setForm(EMPTY); setAdding(false); await load(); }
    catch (e: any) { setError(e?.message || 'Could not save the address.'); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => { setBusy(true); try { await customerApi.deleteAddress(id); await load(); } catch (e: any) { setError(e?.message || 'Could not delete.'); } finally { setBusy(false); } };
  const makeDefault = async (id: string) => { setBusy(true); try { await customerApi.setDefaultAddress(id); await load(); } catch (e: any) { setError(e?.message || 'Could not update.'); } finally { setBusy(false); } };

  const field = (k: keyof CreateAddressBody, ph: string) => (
    <input value={(form[k] as string) || ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} placeholder={ph}
      style={{ width: '100%', height: 42, borderRadius: 10, border: '1px solid var(--customer-border)', padding: '0 12px', font: 'inherit', background: '#fff' }} />
  );

  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          onClick={() => nav(-1)}
          aria-label="Back"
          className='customer-back'
        
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <h1 className="cust-h1" style={{ fontSize: 20 }}>My Addresses</h1>
      </div>

      {error ? <div className="cust-card" style={{ padding: 14, color: 'var(--customer-red)', background: 'var(--customer-red-light)', border: 0 }}>{error}</div> : null}

      {!items ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {[1, 2].map((i) => (
            <div key={i} className="cust-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div className="cust-skel" style={{ width: 100, height: 16 }} />
                {i === 1 ? <div className="cust-skel" style={{ width: 50, height: 18, borderRadius: 999 }} /> : null}
              </div>
              <div className="cust-skel" style={{ width: 180, height: 14 }} />
              <div className="cust-skel" style={{ width: 140, height: 14 }} />
              <div style={{ display: 'flex', gap: 14, marginTop: 2 }}>
                <div className="cust-skel" style={{ width: 60, height: 16 }} />
                <div className="cust-skel" style={{ width: 40, height: 16 }} />
              </div>
            </div>
          ))}
        </div>
      )
        : items.length === 0 && !adding ? <div className="cust-card" style={{ padding: 24, textAlign: 'center' }}><div aria-hidden style={{ fontSize: 32 }}>📍</div><div className="cust-sub" style={{ marginTop: 8 }}>No saved addresses yet.</div></div>
        : items.map((a) => (
            <div key={a.id} className="cust-card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ fontWeight: 700, flex: 1 }}>{a.label || 'Address'}</div>
                {a.isDefault ? <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--customer-primary)', background: 'var(--customer-purple-100)', padding: '2px 8px', borderRadius: 999 }}>Default</span> : null}
              </div>
              <div style={{ marginTop: 4 }}>{a.line1}{a.line2 ? `, ${a.line2}` : ''}</div>
              {(a.city || a.state || a.zip) ? <div className="cust-sub" style={{ fontSize: 13 }}>{[a.city, a.state].filter(Boolean).join(', ')} {a.zip || ''}</div> : null}
              <div style={{ display: 'flex', gap: 14, marginTop: 10 }}>
                {!a.isDefault ? <button onClick={() => makeDefault(a.id)} disabled={busy} style={{ border: 0, background: 'none', color: 'var(--customer-primary)', fontWeight: 700, cursor: 'pointer', padding: 0 }}>Set default</button> : null}
                <button onClick={() => remove(a.id)} disabled={busy} style={{ border: 0, background: 'none', color: 'var(--customer-red)', fontWeight: 700, cursor: 'pointer', padding: 0 }}>Delete</button>
              </div>
            </div>
          ))}

      {adding ? (
        <div className="cust-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontWeight: 700 }}>Add address</div>
          {field('label', 'Label (e.g. Home)')}
          {field('line1', 'Street address')}
          {field('line2', 'Apt, suite (optional)')}
          <div style={{ display: 'flex', gap: 10 }}>{field('city', 'City')}{field('state', 'State')}{field('zip', 'ZIP')}</div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <input type="checkbox" checked={!!form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} /> Set as default
          </label>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => { setAdding(false); setForm(EMPTY); setError(null); }} className="cust-btn cust-btn-ghost" style={{ height: 44 }}>Cancel</button>
            <button onClick={save} disabled={busy} className="cust-btn" style={{ height: 44 }}>{busy ? 'Saving…' : 'Save address'}</button>
          </div>
        </div>
      ) : <button onClick={() => setAdding(true)} className="cust-btn cust-btn-ghost">+ Add address</button>}
    </div>
  );
}
