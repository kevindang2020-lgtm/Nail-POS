// Super-Admin → Customer Phone Oversight — BUILD_PLAN Phase 3 (customer_phone_number_management, audit E13).
//
// How phone-number changes are going across every salon: requested, verified, failed, waiting for a manager, numbers
// set without an SMS, and — the ones that matter most — synchronisations that failed or ran out of retries (those
// customers believe their number changed everywhere; some records still have the old one).
//
// Counts and states only: the API never returns a phone number, a code or a credential here. "Run sweep now" closes
// changes past their deadline and queues every failed synchronisation; it changes no customer's number. It needs a
// reason, which is audited.
import { useCallback, useEffect, useState } from 'react';
import { useInlineAsk } from '@aipowersalon/ui';
import type { CustomerPhoneOversight, CustomerPhoneOversightTenantRow } from '@aipowersalon/api-contracts';
import { superAdminCustomerPhoneApi } from '../api/superAdminCustomerPhoneApi';

const WINDOWS = [{ h: 24, label: 'Last 24 hours' }, { h: 168, label: 'Last 7 days' }, { h: 720, label: 'Last 30 days' }];

const CARDS: { key: keyof CustomerPhoneOversight; label: string; warn?: boolean }[] = [
  { key: 'updatesRequested', label: 'Changes requested' },
  { key: 'verified', label: 'Verified by SMS' },
  { key: 'failed', label: 'Failed verification', warn: true },
  { key: 'awaitingApproval', label: 'Waiting for a manager', warn: true },
  { key: 'duplicateConflicts', label: 'Number already in use' },
  { key: 'manualConfirmations', label: 'Manually confirmed (OTP not completed)', warn: true },
  { key: 'changesWithoutSms', label: 'Changed without SMS (salon policy)' },
  { key: 'synchronizationFailures', label: 'Sync failed — retrying', warn: true },
  { key: 'synchronizationDead', label: 'Sync retries exhausted', warn: true },
  { key: 'openSessions', label: 'Changes open now' },
  { key: 'expiredSessions', label: 'Expired before verification' },
  { key: 'tenantsWithUpdatesEnabled', label: 'Salons with phone changes on' },
];

export function CustomerPhoneOversightScreen() {
  const [hours, setHours] = useState(168);
  const [summary, setSummary] = useState<CustomerPhoneOversight | 'failed' | null>(null);
  const [tenants, setTenants] = useState<CustomerPhoneOversightTenantRow[] | 'failed' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { ask, askUi } = useInlineAsk();

  const load = useCallback(() => {
    superAdminCustomerPhoneApi.oversight(hours).then(setSummary).catch(() => setSummary('failed'));
    superAdminCustomerPhoneApi.byTenant(hours).then((r) => setTenants(Array.isArray(r) ? r : [])).catch(() => setTenants('failed'));
  }, [hours]);
  useEffect(() => { load(); }, [load]);

  const runSweep = async (reason: string) => {
    setBusy(true);
    try { const r = await superAdminCustomerPhoneApi.sweep(reason); setNotice(`Sweep done: ${r.expired} expired change(s) closed, ${r.syncQueued} synchronisation(s) queued.`); load(); }
    catch (e: any) { setNotice(e?.message || 'The sweep did not run.'); }
    finally { setBusy(false); }
  };
  const sweep = () => ask('Run the customer-phone sweep now — why?', (reason) => { void runSweep(reason); }, { minLength: 5, inputLabel: 'Reason', confirmLabel: 'Run sweep' });

  return (
    <div style={{ padding: 24, display: 'grid', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Customer Phone Oversight</h1>
        <select aria-label="Time window" value={hours} onChange={(e) => setHours(Number(e.target.value))} style={{ padding: '6px 8px' }}>
          {WINDOWS.map((w) => <option key={w.h} value={w.h}>{w.label}</option>)}
        </select>
        <button onClick={sweep} disabled={busy} style={{ marginLeft: 'auto', padding: '8px 14px', fontWeight: 600 }}>{busy ? 'Running…' : 'Run sweep now'}</button>
      </div>
      <p style={{ margin: 0, color: '#6b7280', fontSize: 13 }}>Counts only — no phone number, code or credential is shown or returned here.</p>
      {askUi}
      {notice ? <div role="status" data-testid="notice" style={{ padding: 10, background: '#eef6ff', borderRadius: 8, fontSize: 13 }}>{notice}</div> : null}

      {summary === 'failed' ? <div role="alert" style={{ color: '#b91c1c' }}>Could not load the phone-change summary.</div>
        : !summary ? <div>Loading…</div>
        : (
          <div data-testid="phone-oversight-cards" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }}>
            {CARDS.map((c) => {
              const v = Number(summary[c.key] ?? 0);
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
        <h2 style={{ fontSize: 16, margin: '8px 0' }}>By salon</h2>
        {tenants === 'failed' ? <div role="alert" style={{ color: '#b91c1c' }}>Could not load the per-salon view.</div>
          : !tenants ? <div>Loading…</div>
          : tenants.length === 0 ? <div style={{ color: '#6b7280' }}>No phone changes in this window.</div>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>
                <th>Salon</th><th>Requested</th><th>Verified</th><th>Failed</th><th>Sync failed</th><th>Waiting for approval</th>
              </tr></thead>
              <tbody>
                {tenants.map((t) => (
                  <tr key={t.tenantId} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td>{t.tenantName}</td><td>{t.requested}</td><td>{t.verified}</td><td>{t.failed}</td>
                    <td style={{ color: t.syncFailed ? '#b45309' : undefined, fontWeight: t.syncFailed ? 700 : undefined }}>{t.syncFailed}</td><td>{t.awaitingApproval}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </section>
    </div>
  );
}
