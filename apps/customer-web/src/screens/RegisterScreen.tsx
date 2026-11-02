import { useState } from 'react';
import { authApi } from '../api/authApi';
import { SalonPicker, type PickedSalon } from '../components/SalonPicker';

// Create your account — public customer self-signup. The customer PICKS their salon (search or "Use my location"), or
// enters a salon code; it becomes their default salon, changeable later on Profile → My salon (Oct 3 2026). POST
// /customer/auth/register creates the CUSTOMER account; on success the customer signs in normally.
const field: React.CSSProperties = { height: 40, border: '1px solid var(--line)', borderRadius: 10, padding: '0 12px', background: '#FFFDF8', fontFamily: 'inherit', fontSize: 14, color: 'var(--text)', width: '100%' };

export function RegisterScreen({ onBack, onRegistered }: { onBack: () => void; onRegistered: (email: string) => void }) {
  const [salonCode, setSalonCode] = useState('');
  const [salon, setSalon] = useState<PickedSalon | null>(null);
  const [useCode, setUseCode] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr(null); setBusy(true);
    try {
      if (!salon && !(useCode && salonCode.trim())) { setErr('Choose your salon.'); return; }
      const r = await authApi.register({ ...(useCode ? { salonCode: salonCode.trim() } : { salonId: salon!.salonId }), firstName, lastName, email, phone, password });
      if (r.ok) onRegistered(email);
      else setErr(r.message || 'Could not create your account.');
    } catch (e: any) { setErr(e?.message || 'Could not create your account.'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ height: '100vh', display: 'grid', placeItems: 'center', background: 'var(--page)' }}>
      <div className="panel" style={{ width: 380, maxWidth: '92vw' }}>
        <div style={{ textAlign: 'center', marginBottom: 14 }}>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 22 }}>AIPowerSalon</div>
          <div className="muted" style={{ fontSize: 13 }}>Create your account</div>
        </div>
        {err ? <div className="err" style={{ marginBottom: 10 }}>{err}</div> : null}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Your salon</div>
          {useCode ? (
            <>
              <input style={field} placeholder="Salon code" aria-label="Salon code" value={salonCode} onChange={(e) => setSalonCode(e.target.value)} autoComplete="off" />
              <button type="button" className="btn ghost" onClick={() => setUseCode(false)}>Find my salon instead</button>
            </>
          ) : salon ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid var(--line)', borderRadius: 10, padding: '8px 12px' }}>
              <span><b>{salon.name}</b>{salon.city ? ` · ${salon.city}` : ''}<div className="muted" style={{ fontSize: 12 }}>Your default salon — you can change it later.</div></span>
              <button type="button" className="btn ghost" onClick={() => setSalon(null)}>Change</button>
            </div>
          ) : (
            <>
              <SalonPicker onPick={setSalon} />
              <button type="button" className="btn ghost" onClick={() => setUseCode(true)}>I have a salon code</button>
            </>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <input style={field} placeholder="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            <input style={field} placeholder="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
          <input style={field} placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" autoComplete="email" />
          <input style={field} placeholder="Phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
          <input style={field} type="password" placeholder="Password (8+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          <button className="btn" disabled={busy || !firstName || !lastName || !email || !password} onClick={submit}>{busy ? 'Creating…' : 'Create account'}</button>
          <button className="btn ghost" onClick={onBack} disabled={busy}>Back to sign in</button>
        </div>
      </div>
    </div>
  );
}
