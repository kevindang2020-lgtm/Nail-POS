// MySalonCard.tsx — Profile → My salon (Kevin, Oct 3 2026): the customer's default salon, chosen at sign-up, changeable
// here with the same picker (search or "Use my location"). Another location of the same salon switches at once; a
// different salon needs a fresh sign-in (the account there becomes the default — same email and password).
import { useEffect, useState } from 'react';
import { customerApi } from '../api/customerApi';
import { SalonPicker, type PickedSalon } from './SalonPicker';

export function MySalonCard({ onSignInAgain }: { onSignInAgain: (salonName: string) => void }) {
  const [home, setHome] = useState<{ salonId: string; salonName: string; city: string | null } | null>(null);
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { customerApi.homeSalon().then(setHome).catch(() => setHome(null)); }, []);

  const choose = async (s: PickedSalon) => {
    if (home && s.salonId === home.salonId) { setChanging(false); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await customerApi.setHomeSalon(s.salonId);
      if (r.requiresSignIn) { onSignInAgain(r.salonName || s.name); return; }
      setHome({ salonId: s.salonId, salonName: r.salonName || s.name, city: s.city });
      setChanging(false); setMsg(`${r.salonName || s.name} is now your salon.`);
    } catch (e: any) { setMsg(e?.message || 'Could not change your salon.'); }
    finally { setBusy(false); }
  };

  return (
    <section className="owner-menu-section" aria-label="My salon">
      <div className="owner-menu-card" style={{ padding: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 700 }}>My salon</div>
            <div className="cust-sub" style={{ fontSize: 13 }}>{home ? `${home.salonName}${home.city ? ' · ' + home.city : ''}` : 'Not set'}</div>
          </div>
          {!changing && <button type="button" className="btn ghost" onClick={() => { setChanging(true); setMsg(null); }}>Change</button>}
        </div>
        {changing && (
          <div style={{ marginTop: 10 }}>
            {busy ? <div className="muted">Switching…</div> : <SalonPicker onPick={choose} />}
            <button type="button" className="btn ghost" style={{ marginTop: 6 }} onClick={() => setChanging(false)}>Cancel</button>
          </div>
        )}
        {msg && <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>{msg}</div>}
      </div>
    </section>
  );
}
