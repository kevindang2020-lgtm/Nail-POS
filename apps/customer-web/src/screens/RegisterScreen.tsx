import { useEffect, useState } from 'react';
import { authApi } from '../api/authApi';
import { customerApi, SalonResult } from '../api/customerApi';

// Create your account — public customer self-signup. POST /customer/auth/register creates a CUSTOMER account for the
// salon (by salonId or salon code); on success the customer signs in normally.
const field: React.CSSProperties = {
  height: 40,
  border: '1px solid var(--line)',
  borderRadius: 10,
  padding: '0 12px',
  background: '#FFFDF8',
  fontFamily: 'inherit',
  fontSize: 14,
  color: 'var(--text)',
  width: '100%',
  boxSizing: 'border-box',
};

export function RegisterScreen({ onBack, onRegistered }: { onBack: () => void; onRegistered: (email: string) => void }) {
  const [salons, setSalons] = useState<SalonResult[]>([]);
  const [selectedSalonId, setSelectedSalonId] = useState('');
  const [useManualCode, setUseManualCode] = useState(false);
  const [salonCode, setSalonCode] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [referralCode, setReferralCode] = useState(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      return sp.get('ref') || '';
    } catch {
      return '';
    }
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    customerApi
      .salonsNearby({ radiusMiles: 5000 })
      .then((res) => {
        const list = res.results || [];
        setSalons(list);
        if (list.length > 0) {
          // Default to the first available salon (e.g. Nova Nail Lab or Pilot)
          setSelectedSalonId(list[0].salon_id);
        }
      })
      .catch(() => {});
  }, []);

  const submit = async () => {
    setErr(null);
    setBusy(true);
    try {
      const payload: Record<string, any> = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim() || undefined,
        password,
        referralCode: referralCode.trim() ? referralCode.trim().toUpperCase() : undefined,
      };

      if (useManualCode) {
        if (!salonCode.trim()) {
          setErr('Please enter your salon code.');
          setBusy(false);
          return;
        }
        payload.salonCode = salonCode.trim();
      } else {
        if (!selectedSalonId) {
          setErr('Please select your preferred salon.');
          setBusy(false);
          return;
        }
        payload.salonId = selectedSalonId;
      }

      const r = await authApi.register(payload);
      if (r.ok) onRegistered(email);
      else setErr(r.message || 'Could not create your account.');
    } catch (e: any) {
      setErr(e?.message || 'Could not create your account.');
    } finally {
      setBusy(false);
    }
  };

  const hasSalonChosen = useManualCode ? !!salonCode.trim() : !!selectedSalonId;

  return (
    <div style={{ height: '100vh', display: 'grid', placeItems: 'center', background: 'var(--page)' }}>
      <div className="panel" style={{ width: 380, maxWidth: '92vw' }}>
        <div style={{ textAlign: 'center', marginBottom: 14 }}>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 22 }}>AIPowerSalon</div>
          <div className="muted" style={{ fontSize: 13 }}>Create your account</div>
        </div>
        {err ? <div className="err" style={{ marginBottom: 10 }}>{err}</div> : null}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {salons.length > 0 && !useManualCode ? (
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 4, display: 'block' }}>
                Select Your Salon:
              </label>
              <select
                style={{ ...field, cursor: 'pointer' }}
                value={selectedSalonId}
                onChange={(e) => {
                  if (e.target.value === '__manual__') {
                    setUseManualCode(true);
                    setSelectedSalonId('');
                  } else {
                    setSelectedSalonId(e.target.value);
                  }
                }}
              >
                {salons.map((s) => (
                  <option key={s.salon_id} value={s.salon_id}>
                    {s.name} {s.city ? `(${s.city})` : ''}
                  </option>
                ))}
                <option value="__manual__">➕ Enter Salon Code Manually</option>
              </select>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>Salon Code:</label>
                {salons.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setUseManualCode(false)}
                    style={{ background: 'none', border: 'none', color: 'var(--customer-primary, #A96F22)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    Select from salon list
                  </button>
                ) : null}
              </div>
              <input
                style={field}
                placeholder="e.g. NOVA01 or PILOT01"
                value={salonCode}
                onChange={(e) => setSalonCode(e.target.value)}
                autoComplete="off"
              />
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <input style={field} placeholder="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            <input style={field} placeholder="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
          <input style={field} placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" autoComplete="email" />
          <input style={field} placeholder="Phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
          <input style={field} placeholder="Referral code (optional - e.g. REF123)" value={referralCode} onChange={(e) => setReferralCode(e.target.value.toUpperCase())} autoComplete="off" />
          <input style={field} type="password" placeholder="Password (8+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          <button className="btn" disabled={busy || !hasSalonChosen || !firstName || !lastName || !email || !password} onClick={submit}>
            {busy ? 'Creating…' : 'Create account'}
          </button>
          <button className="btn ghost" onClick={onBack} disabled={busy}>Back to sign in</button>
        </div>
      </div>
    </div>
  );
}
