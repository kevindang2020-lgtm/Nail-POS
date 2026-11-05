// OwnerPortfolioPanels.tsx — the three panels from the reference image's Super Admin row:
//   • Salons in Portfolio   (Salon Name · Store Code · Location · Branches · Status · Monthly Revenue)
//   • Add New Salon
//   • Create / Invite Salon User
//
// ── Why these are thin ───────────────────────────────────────────────────────────────────────────────────
// Every one of them is a UI over a backend that ALREADY EXISTS and is already proven:
//
//   • the table          → GET  /super-admin/owners/:id/portfolio  (the SAME repository the Owner App runs on,
//                          so Super Admin and the owner can never disagree about what the owner owns)
//   • Add New Salon      → POST /super-admin/tenants  — which already creates the tenant, generates a UNIQUE
//                          Store Code, creates the first branch, grants user_branch_access, opens the
//                          subscription, and — critically — REUSES the existing owner account rather than
//                          minting a second one for the same person
//   • Invite Salon User  → POST /super-admin/platform/users/invite  (existing invitation flow)
//
// Nothing here re-implements any of that. A second "create a salon" path would be the exact duplicate-tenant /
// duplicate-owner bug the spec forbids.
//
// ── A salon is a TENANT ──────────────────────────────────────────────────────────────────────────────────
// That is why this table can show a Store Code per salon at all, and why "Add New Salon" posts to /tenants and
// not to /owners/:id/salons — the latter adds a BRANCH to the owner's existing tenant, which is a different
// operation (a second location of the same legal business), not a new salon.
import { useCallback, useEffect, useState } from 'react';
import { superAdminApi, type SaOwnerPortfolio, type SaPortfolioSalon } from '../api/superAdminApi';

const money = (cents: number | null | undefined) =>
  cents == null ? '—' : `$${(Math.round(cents) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

const ROLES = [
  'Primary Owner', 'Co-Owner', 'Salon Administrator', 'Manager',
  'Receptionist', 'Technician', 'Bookkeeper', 'Reporting Only',
];

/** Maps the human role label to the backend role the invite endpoint expects. */
const ROLE_CODE: Record<string, string> = {
  'Primary Owner': 'OWNER', 'Co-Owner': 'OWNER', 'Salon Administrator': 'MANAGER', Manager: 'MANAGER',
  Receptionist: 'FRONT_DESK', Technician: 'TECHNICIAN', Bookkeeper: 'ACCOUNTANT', 'Reporting Only': 'ACCOUNTANT',
};

// ── Salons in Portfolio ─────────────────────────────────────────────────────────────────────────────────
export function SalonsInPortfolio({ ownerId, reloadKey, onChanged }: { ownerId: string; reloadKey?: number; onChanged?: () => void }) {
  const [data, setData] = useState<SaOwnerPortfolio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    // Promise.resolve + try/catch, not a bare `.then()`. If the call throws synchronously — or returns
    // undefined — there is no promise to attach `.catch()` to, and the exception escapes into the render tree
    // and unmounts the ENTIRE Super Admin owners console. A supporting panel is never allowed to do that.
    try {
      Promise.resolve(superAdminApi.ownerPortfolio(ownerId))
        .then((r) => setData(r ?? null))
        // An error shows an error. It does NOT render an empty table, which would read as "this owner has no
        // salons" — a very different and much worse statement than "we could not load them".
        .catch((e: any) => { setError(e?.message || 'Could not load this portfolio.'); setData(null); })
        .finally(() => setLoading(false));
    } catch (e: any) {
      setError(e?.message || 'Could not load this portfolio.');
      setData(null);
      setLoading(false);
    }
  }, [ownerId]);

  useEffect(load, [load, reloadKey]);

  if (loading) return <div className="s" role="status">Loading portfolio…</div>;
  if (error) return <div className="s" role="alert" style={{ color: '#8F3226' }}>{error}</div>;

  const salons: SaPortfolioSalon[] = data?.portfolio?.salons ?? [];
  if (!salons.length) return <div className="s">This owner has no salons yet.</div>;

  const mtd = new Map((data?.totals ?? []).map((t) => [t.tenantId, t.revenueMonthCents]));

  return (
    <table className="min-w-[600px] " style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ textAlign: 'left', color: 'var(--muted, #7A6C57)', fontSize: 11.5 }}>
          <th style={{ padding: '6px 4px' }}>Salon Name</th>
          <th>Store Code</th>
          <th>Location</th>
          <th>Branches</th>
          <th>Status</th>
          <th style={{ textAlign: 'right' }}>Monthly Revenue</th>
        </tr>
      </thead>
      <tbody>
        {salons.map((s) => {
          const first = s.branches[0];
          const loc = first ? [first.city, first.state].filter(Boolean).join(', ') : '';
          return (
            <tr key={s.tenantId} style={{ borderTop: '1px solid var(--line, #E7DBC6)' }}>
              <td style={{ padding: '8px 4px', fontWeight: 600 }}>
                {s.salonName}
                {s.isPrimaryOwner ? <span className="pill" style={{ marginLeft: 6 }}>Primary</span> : null}
              </td>
              <td style={{ fontFamily: 'ui-monospace, monospace' }}>{s.storeCode || '—'}</td>
              <td>{loc || '—'}</td>
              <td>{s.branches.length}</td>
              <td><span className={'pill ' + (s.tenantStatus === 'active' ? 'ok' : '')}>{s.tenantStatus}</span></td>
              {/* Month-to-date, refund-netted, integer cents. `—` when the figure was not loaded — never a
                  confident $0, which would tell a Super Admin this salon took nothing this month. */}
              <td style={{ textAlign: 'right', fontWeight: 600 }}>{money(mtd.get(s.tenantId))}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Add New Salon ───────────────────────────────────────────────────────────────────────────────────────
export function AddNewSalon({ ownerEmail, ownerName, onCreated }: { ownerEmail: string | null; ownerName: string; onCreated: () => void }) {
  const [f, setF] = useState({ legalName: '', displayName: '', storeCode: '', city: '', state: '', phone: '', email: '', plan: 'starter', active: true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const set = (k: string, v: any) => setF((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    setErr(null); setOk(null);
    if (!f.displayName.trim()) return setErr('A public business name is required.');
    if (!f.storeCode.trim()) return setErr('A Store Code is required — it is how staff sign in to this salon’s POS.');
    if (!ownerEmail) return setErr('This owner has no email on file, so the salon cannot be linked to them.');

    setBusy(true);
    try {
      // The owner's EXISTING email is sent deliberately. createTenant() looks the person up first and reuses
      // their account — one owner, many salons, one password. Passing a new email here would mint a second
      // owner user for the same human, which is the exact bug the spec forbids.
      await superAdminApi.createTenant({
        legalName: f.legalName.trim() || f.displayName.trim(),
        displayName: f.displayName.trim(),
        tenantCode: f.storeCode.trim().toUpperCase(),
        ownerName, ownerEmail,
        branch: { name: f.displayName.trim(), city: f.city.trim() || undefined, state: f.state.trim() || undefined, phone: f.phone.trim() || undefined },
        plan: f.plan,
      });
      setOk(`Salon created. Store Code ${f.storeCode.trim().toUpperCase()}.`);
      setF({ legalName: '', displayName: '', storeCode: '', city: '', state: '', phone: '', email: '', plan: 'starter', active: true });
      onCreated();
    } catch (e: any) {
      // A duplicate Store Code is rejected by the BACKEND (tenant_code is checked for uniqueness there). We
      // surface whatever it says rather than pre-guessing, because the backend is the only thing that can know.
      setErr(e?.message || 'Could not create the salon.');
    } finally { setBusy(false); }
  };

  const input = (k: string, ph: string) => (
    <input value={(f as any)[k]} onChange={(e) => set(k, e.target.value)} placeholder={ph}
      style={{ width: '100%', padding: '7px 9px', border: '1px solid var(--line, #E7DBC6)', borderRadius: 8, fontSize: 13, marginBottom: 8 }} />
  );

  return (
    <div>
      {input('legalName', 'Salon legal name')}
      {input('displayName', 'Public business name')}
      {input('storeCode', 'Unique Store Code (e.g. LUXE001)')}
      <div style={{ display: 'flex', gap: 8 }}>
        {input('city', 'City')}
        {input('state', 'State')}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {input('phone', 'Phone')}
        {input('email', 'Salon email')}
      </div>
      {err ? <div role="alert" style={{ color: '#8F3226', fontSize: 12, marginBottom: 6 }}>{err}</div> : null}
      {ok ? <div role="status" style={{ color: '#3F6B46', fontSize: 12, marginBottom: 6 }}>{ok}</div> : null}
      <button onClick={submit} disabled={busy} className="btn primary" style={{ width: '100%' }}>
        {busy ? 'Creating…' : 'Create Salon'}
      </button>
      <div className="s" style={{ marginTop: 6, fontSize: 11 }}>
        Creates a new salon (its own tenant, Store Code, subscription and merchant account) and links it to{' '}
        <strong>{ownerName}</strong>’s existing account — no second owner login is created.
      </div>
    </div>
  );
}

// ── Create / Invite Salon User ──────────────────────────────────────────────────────────────────────────
export function InviteSalonUser({ salons }: { salons: SaPortfolioSalon[] }) {
  const [f, setF] = useState({ fullName: '', email: '', phone: '', role: '', tenantId: '', branchId: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const set = (k: string, v: any) => setF((p) => ({ ...p, [k]: v }));

  const branches = salons.find((s) => s.tenantId === f.tenantId)?.branches ?? [];

  const submit = async () => {
    setErr(null); setSent(null);
    if (!f.fullName.trim()) return setErr('A full name is required.');
    if (!f.email.trim() && !f.phone.trim()) return setErr('Enter an email address or a phone number — the person signs in with whichever you provide.');
    if (!f.role) return setErr('Select a role.');
    if (!f.tenantId) return setErr('Select a salon.');

    setBusy(true);
    try {
      // The backend looks the person up by email first, so inviting an existing user to a SECOND salon grants
      // them access there — it does not create a duplicate account.
      await superAdminApi.inviteUser({
        fullName: f.fullName.trim(),
        email: f.email.trim() || undefined,
        phone: f.phone.trim() || undefined,
        role: ROLE_CODE[f.role] || 'FRONT_DESK',
        tenantId: f.tenantId,
        branchId: f.branchId || null,
      });
      // Deliberately NOT showing the credential the endpoint returns. It is temporary and must be changed on
      // first sign-in, but a plain-text password rendered in a browser is still a plain-text password — it can
      // be shoulder-surfed, screenshotted, and pasted into a chat. The user gets it through the invitation.
      setSent(`Invitation sent to ${f.email.trim() || f.phone.trim()}.`);
      setF({ fullName: '', email: '', phone: '', role: '', tenantId: '', branchId: '' });
    } catch (e: any) {
      setErr(e?.message || 'Could not send the invitation.');
    } finally { setBusy(false); }
  };

  const sel: React.CSSProperties = { width: '100%', padding: '7px 9px', border: '1px solid var(--line, #E7DBC6)', borderRadius: 8, fontSize: 13, marginBottom: 8 };

  return (
    <div>
      <input value={f.fullName} onChange={(e) => set('fullName', e.target.value)} placeholder="Full name" style={sel} />
      <input value={f.email} onChange={(e) => set('email', e.target.value)} type="email" placeholder="Email (or leave blank and use a phone)" style={sel} />
      {/* Phone is a real sign-in identifier, not a contact detail: whatever is entered here is what the person
          types at the login screen. Stored E.164-normalized, so any format the admin types works. */}
      <input value={f.phone} onChange={(e) => set('phone', e.target.value)} type="tel" inputMode="tel" placeholder="Phone number (works as their login)" style={sel} />
      <select value={f.role} onChange={(e) => set('role', e.target.value)} style={sel}>
        <option value="">Select role</option>
        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
      <select value={f.tenantId} onChange={(e) => { set('tenantId', e.target.value); set('branchId', ''); }} style={sel}>
        <option value="">Select salon</option>
        {salons.map((s) => <option key={s.tenantId} value={s.tenantId}>{s.salonName} · {s.storeCode}</option>)}
      </select>
      <select value={f.branchId} onChange={(e) => set('branchId', e.target.value)} style={sel} disabled={!f.tenantId}>
        <option value="">Branch (optional — all branches)</option>
        {branches.map((b) => <option key={b.branchId} value={b.branchId}>{b.name}</option>)}
      </select>
      {err ? <div role="alert" style={{ color: '#8F3226', fontSize: 12, marginBottom: 6 }}>{err}</div> : null}
      {sent ? <div role="status" style={{ color: '#3F6B46', fontSize: 12, marginBottom: 6 }}>{sent}</div> : null}
      <button onClick={submit} disabled={busy} className="btn primary" style={{ width: '100%' }}>
        {busy ? 'Sending…' : 'Send Invitation'}
      </button>
      <div className="s" style={{ marginTop: 6, fontSize: 11 }}>
        Set up with an email, a phone number, or both — they sign in with whichever you enter. Inviting someone who
        already has an account grants them access to this salon; it does not create a second login.
      </div>
    </div>
  );
}
