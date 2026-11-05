// Super-Admin → Booking Verification Oversight — BUILD_PLAN Phase 4 (customer_booking_phone_verification).
//
// The platform's view of booking phone verification: is the module on, is the emergency stop pulled, how verification is
// going everywhere (codes sent, verified, approved without a code, locked, expired), and every salon's state — with the
// one row that matters most flagged: verification ON, provider not usable, so that salon is refusing remote bookings.
//
// The switches: the module itself and the emergency stop (step-up + reason), and per salon "require", "block" and "no
// manager override" (reason). Counts and states only — the API never returns a phone number, a code or a credential.
import { useCallback, useEffect, useState } from 'react';
import { useInlineAsk } from '@aipowersalon/ui';
import type { BookingVerificationHealthView, BookingVerificationPlatformPolicyView, BookingVerificationTenantRow } from '@aipowersalon/api-contracts';
import { superAdminBookingVerificationApi as bvApi } from '../api/superAdminBookingVerificationApi';

const WINDOWS = [{ h: 24, label: 'Last 24 hours' }, { h: 168, label: 'Last 7 days' }, { h: 720, label: 'Last 30 days' }];
const CARDS: { key: keyof BookingVerificationHealthView; label: string; warn?: boolean }[] = [
  { key: 'requested', label: 'Asked for a code' },
  { key: 'codesSent', label: 'Codes sent' },
  { key: 'verified', label: 'Verified by SMS' },
  { key: 'overridden', label: 'Approved without a code', warn: true },
  { key: 'locked', label: 'Locked (wrong codes)', warn: true },
  { key: 'expired', label: 'Not finished in time' },
  { key: 'failed', label: 'Delivery failed', warn: true },
  { key: 'tenantsMisconfigured', label: 'Salons refusing bookings (provider not ready)', warn: true },
];
const EFFECTIVE: Record<BookingVerificationTenantRow['effective'], { label: string; color: string }> = {
  active: { label: 'Active', color: '#3E8F57' },
  disabled_by_tenant: { label: 'Off (salon)', color: '#6b7280' },
  blocked_by_platform: { label: 'Blocked by platform', color: '#B85B4D' },
  provider_not_ready: { label: 'Refusing bookings — provider not ready', color: '#b45309' },
  platform_emergency: { label: 'Platform stop', color: '#B85B4D' },
};

export function BookingVerificationOversightScreen() {
  const [hours, setHours] = useState(24);
  const [policy, setPolicy] = useState<BookingVerificationPlatformPolicyView | 'failed' | null>(null);
  const [health, setHealth] = useState<BookingVerificationHealthView | 'failed' | null>(null);
  const [tenants, setTenants] = useState<BookingVerificationTenantRow[] | 'failed' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { ask, askUi } = useInlineAsk();

  const load = useCallback(() => {
    bvApi.policy().then(setPolicy).catch(() => setPolicy('failed'));
    bvApi.health(hours).then(setHealth).catch(() => setHealth('failed'));
    bvApi.tenants().then((r) => setTenants(Array.isArray(r) ? r : [])).catch(() => setTenants('failed'));
  }, [hours]);
  useEffect(() => { load(); }, [load]);

  const act = (question: string, run: (reason: string) => Promise<unknown>, done: string) =>
    ask(question, (reason) => { void run(reason).then(() => { setNotice(done); load(); }).catch((e: any) => setNotice(e?.message || 'That change was not made.')); },
      { minLength: 8, inputLabel: 'Reason', confirmLabel: 'Confirm' });

  const setTenant = (t: BookingVerificationTenantRow, patch: Partial<Pick<BookingVerificationTenantRow, 'requiredByPlatform' | 'blockedByPlatform' | 'bypassBlocked'>>, what: string) => {
    const next = { required: t.requiredByPlatform, blocked: t.blockedByPlatform, bypassBlocked: t.bypassBlocked, ...('requiredByPlatform' in patch ? { required: !!patch.requiredByPlatform } : {}), ...('blockedByPlatform' in patch ? { blocked: !!patch.blockedByPlatform } : {}), ...('bypassBlocked' in patch ? { bypassBlocked: !!patch.bypassBlocked } : {}) };
    act(`${what} for ${t.tenantName ?? 'this salon'} — why?`, (reason) => bvApi.setTenant(t.tenantId, { ...next, reason }), `${t.tenantName ?? 'Salon'}: ${what.toLowerCase()} — saved.`);
  };

  return (
    <div style={{ padding: 24, display: 'grid', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Booking Verification Oversight</h1>
        <select aria-label="Time window" value={hours} onChange={(e) => setHours(Number(e.target.value))} style={{ padding: '6px 8px' }}>
          {WINDOWS.map((w) => <option key={w.h} value={w.h}>{w.label}</option>)}
        </select>
      </div>
      <p style={{ margin: 0, color: '#6b7280', fontSize: 13 }}>Counts and switches only — no phone number, code or credential is shown or returned here.</p>
      {askUi}
      {notice ? <div role="status" data-testid="notice" style={{ padding: 10, background: '#eef6ff', borderRadius: 8, fontSize: 13 }}>{notice}</div> : null}

      <section data-testid="platform-switches" style={{ display: 'grid', gap: 8, padding: 14, border: '1px solid #e5e7eb', borderRadius: 10 }}>
        {policy === 'failed' ? <div role="alert" style={{ color: '#b91c1c' }}>Could not load the platform switches.</div>
          : !policy ? <div>Loading…</div>
          : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <b>Module</b>
                <span data-testid="module-state" style={{ color: policy.moduleEnabled ? '#3E8F57' : '#B85B4D', fontWeight: 700 }}>{policy.moduleEnabled ? 'On' : 'Off — no salon can use it'}</span>
                <button style={{ marginLeft: 'auto' }} onClick={() => act(policy.moduleEnabled ? 'Switch booking phone verification OFF for every salon — why?' : 'Switch booking phone verification back ON — why?', (reason) => bvApi.setModule(!policy.moduleEnabled, reason), policy.moduleEnabled ? 'Module switched off.' : 'Module switched on.')}>
                  {policy.moduleEnabled ? 'Switch module off…' : 'Switch module on…'}
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <b>Emergency stop</b>
                <span data-testid="emergency-state" style={{ color: policy.emergencyDisabled ? '#B85B4D' : '#3E8F57', fontWeight: 700 }}>{policy.emergencyDisabled ? 'STOPPED — bookings continue without codes' : 'Running'}</span>
                <button style={{ marginLeft: 'auto' }} onClick={() => act(policy.emergencyDisabled ? 'Resume booking verification — why?' : 'Stop booking verification everywhere (bookings continue without codes) — why?', (reason) => bvApi.setEmergency(!policy.emergencyDisabled, reason), policy.emergencyDisabled ? 'Verification resumed.' : 'Verification stopped.')}>
                  {policy.emergencyDisabled ? 'Resume…' : 'Stop…'}
                </button>
              </div>
              {policy.reason ? <div style={{ fontSize: 12, color: '#6b7280' }}>Last reason: {policy.reason}</div> : null}
            </>
          )}
      </section>

      {health === 'failed' ? <div role="alert" style={{ color: '#b91c1c' }}>Could not load the verification summary.</div>
        : !health ? <div>Loading…</div>
        : (
          <div data-testid="bv-cards" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }}>
            {CARDS.map((c) => {
              const v = Number(health[c.key] ?? 0);
              const alarm = c.warn && v > 0;
              return (
                <div key={c.key} data-testid={`card-${c.key}`} style={{ padding: 14, borderRadius: 10, border: `1px solid ${alarm ? '#f59e0b' : '#e5e7eb'}`, background: alarm ? '#fffbeb' : '#fff' }}>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>{c.label}</div>
                  <div style={{ fontSize: 26, fontWeight: 700 }}>{v}</div>
                </div>
              );
            })}
          </div>
        )}

      <section>
        <h2 style={{ fontSize: 16, margin: '8px 0' }}>Salons</h2>
        {tenants === 'failed' ? <div role="alert" style={{ color: '#b91c1c' }}>Could not load the per-salon view.</div>
          : !tenants ? <div>Loading…</div>
          : tenants.length === 0 ? <div style={{ color: '#6b7280' }}>No salons.</div>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>
                <th>Salon</th><th>State</th><th>Salon switch</th><th>Provider</th><th>Platform</th><th />
              </tr></thead>
              <tbody>
                {tenants.map((t) => (
                  <tr key={t.tenantId} data-testid="bv-tenant" style={{ borderBottom: '1px solid #f3f4f6', verticalAlign: 'top' }}>
                    <td>{t.tenantName ?? '—'}</td>
                    <td style={{ color: EFFECTIVE[t.effective].color, fontWeight: 700 }}>{EFFECTIVE[t.effective].label}</td>
                    <td>{t.enabled ? 'On' : 'Off'}</td>
                    <td>{t.providerConnected ? (t.providerValidated ? 'Tested' : 'Not tested') : 'Not connected'}</td>
                    <td>{[t.requiredByPlatform ? 'Required' : null, t.blockedByPlatform ? 'Blocked' : null, t.bypassBlocked ? 'No manager override' : null].filter(Boolean).join(' · ') || '—'}</td>
                    <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button onClick={() => setTenant(t, { requiredByPlatform: !t.requiredByPlatform, ...(t.requiredByPlatform ? {} : { blockedByPlatform: false }) }, t.requiredByPlatform ? 'Stop requiring verification' : 'Require verification')}>{t.requiredByPlatform ? 'Unrequire…' : 'Require…'}</button>
                      <button onClick={() => setTenant(t, { blockedByPlatform: !t.blockedByPlatform, ...(t.blockedByPlatform ? {} : { requiredByPlatform: false }) }, t.blockedByPlatform ? 'Unblock verification' : 'Block verification')}>{t.blockedByPlatform ? 'Unblock…' : 'Block…'}</button>
                      <button onClick={() => setTenant(t, { bypassBlocked: !t.bypassBlocked }, t.bypassBlocked ? 'Allow the manager override' : 'Forbid the manager override')}>{t.bypassBlocked ? 'Allow override…' : 'Forbid override…'}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </section>
    </div>
  );
}
