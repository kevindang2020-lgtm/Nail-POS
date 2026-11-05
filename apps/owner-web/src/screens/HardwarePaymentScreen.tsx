import { useEffect, useState } from 'react';
import { ownerHardwarePaymentApi as HP, type OwnerHwPlan, type OwnerHwInvoice } from '../api/ownerApi';
import { useOwnerNav } from '../shell/nav';

// HardwarePaymentScreen — Owner App, Hardware Payment Recovery (build doc §15). Read-only view of the salon's hardware
// payment plan + monthly invoices (their hardware credit, what's due, any shortfall auto-charged), plus self-service
// autopay setup: save a tokenized card and authorize the shortfall auto-charge. Fiserv/platform figures are never shown.
const money = (c: any) => `$${(Number(c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const arr = (x: any): any[] => (Array.isArray(x) ? x : x?.invoices ?? x?.rows ?? x?.items ?? []);
const CONSENT_TEXT = 'I authorize AIPowerSalon to charge my saved payment method for any monthly hardware payment shortage not covered by my hardware credit from processing revenue.';
const tone: Record<string, string> = { paid: '#2e7d32', payment_failed: '#c0392b', past_due: '#c0392b', payment_method_required: '#b8860b', shortfall_pending: '#b8860b' };
const Back = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--owner-text)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>;

export function HardwarePaymentScreen() {
  const { back } = useOwnerNav();
  const [plan, setPlan] = useState<OwnerHwPlan | null>(null);
  const [invoices, setInvoices] = useState<OwnerHwInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [last4, setLast4] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [cardLast4, setCardLast4] = useState('');

  const load = () => {
    setLoading(true); setErr(null);
    Promise.allSettled([HP.plan(), HP.invoices()]).then(([p, inv]) => {
      const pval = p.status === 'fulfilled' ? p.value : null;
      const pv = pval?.plan ?? null;
      setPlan(pv && pv.id ? pv : null);
      setCardLast4(pval?.savedPaymentMethod?.last4 ?? '');
      setInvoices(inv.status === 'fulfilled' ? arr(inv.value) : []);
      if (p.status === 'rejected' && (p.reason as any)?.status === 403) setErr('You do not have access to hardware payments.');
    }).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const authorize = () => {
    if (!plan) return;
    if (!token.trim()) { setErr('Enter the card token from your secure payment field.'); return; }
    if (!agree) { setErr('Please check the authorization box to enable autopay.'); return; }
    setBusy(true); setErr(null); setNote(null);
    HP.addMethod({ gatewayPaymentMethodToken: token.trim(), brand: 'card', last4: last4 || undefined })
      .then(() => HP.consent(plan.id))
      .then(() => { setNote('Autopay authorized. Your card is on file for hardware payment shortfalls.'); setToken(''); setLast4(''); setAgree(false); load(); })
      .catch((e: any) => setErr(e?.status === 403 ? 'Only owners can set up autopay.' : e?.message || 'Could not save your card.'))
      .finally(() => setBusy(false));
  };

  const hasCard = !!plan?.savedPaymentMethodId;

  return (
    <>
      <header className="owner-header">
        <button className="owner-back" aria-label="Back" onClick={back}><Back /></button>
        <div className="owner-greet" style={{ textAlign: 'center' }}><div className="n owner-serif" style={{ cursor: 'default', justifyContent: 'center' }}>Hardware Payments</div></div>
        <div style={{ width: 40 }} />
      </header>

      {loading ? <div className="owner-state"><div className="big owner-serif">Loading…</div></div> : (
        <div style={{ padding: '0 16px 24px' }}>
          {err ? <div className="owner-chartcard" style={{ margin: '8px 0', padding: 12, color: '#c0392b' }}>{err}</div> : null}
          {note ? <div className="owner-chartcard" style={{ margin: '8px 0', padding: 12, color: '#2e7d32' }}>{note}</div> : null}

          {/* Plan summary */}
          <div className="owner-chartcard" style={{ margin: '8px 0', padding: 16 }}>
            <div className="owner-serif" style={{ fontSize: 16, marginBottom: 8 }}>Your plan</div>
            {plan ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><div className="muted" style={{ fontSize: 11.5 }}>Status</div><div style={{ fontWeight: 600, textTransform: 'capitalize' }}>{String(plan.status).replace('_', ' ')}</div></div>
                <div><div className="muted" style={{ fontSize: 11.5 }}>Monthly payment</div><div style={{ fontWeight: 600 }}>{money(plan.monthlyPaymentCents)}</div></div>
                <div><div className="muted" style={{ fontSize: 11.5 }}>Remaining balance</div><div style={{ fontWeight: 600 }}>{money(plan.remainingBalanceCents)}</div></div>
                <div><div className="muted" style={{ fontSize: 11.5 }}>Auto-charge shortfalls</div><div style={{ fontWeight: 600 }}>{plan.autoChargeShortfallEnabled ? 'On' : 'Off'}</div></div>
              </div>
            ) : <div className="muted">No hardware payment plan is on file for your salon yet.</div>}
          </div>

          {/* Autopay setup */}
          {plan ? (
            <div className="owner-chartcard" style={{ margin: '8px 0', padding: 16 }}>
              <div className="owner-serif" style={{ fontSize: 16, marginBottom: 8 }}>Autopay</div>
              {hasCard ? (
                <div className="muted">A card is on file{cardLast4 ? ` ending ${cardLast4}` : ''}. Shortfalls are charged automatically each month.</div>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  <div className="muted" style={{ fontSize: 12.5 }}>Each month your hardware payment is first covered by your hardware credit from card-processing revenue. If there's a shortfall, we charge your saved card.</div>
                  <input className="owner-input" placeholder="Card token (from your secure payment field)" value={token} onChange={(e) => setToken(e.target.value)} />
                  <input className="owner-input" placeholder="Last 4 (optional)" value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} />
                  <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, lineHeight: 1.4 }}>
                    <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ marginTop: 2 }} />
                    <span>{CONSENT_TEXT}</span>
                  </label>
                  <button className="owner-chip active" style={{ justifySelf: 'start', padding: '8px 16px' }} disabled={busy} onClick={authorize}>{busy ? 'Saving…' : 'Save card & authorize autopay'}</button>
                </div>
              )}
            </div>
          ) : null}

          {/* Invoices */}
          <div className="owner-chartcard" style={{ margin: '8px 0', padding: 16 }}>
            <div className="owner-serif" style={{ fontSize: 16, marginBottom: 8 }}>Monthly statements</div>
            {invoices.length === 0 ? <div className="muted">No statements yet.</div> : (
              <div style={{ display: 'grid', gap: 10 }}>
                {invoices.map((i) => (
                  <div key={i.billingMonth} style={{ borderTop: '1px solid var(--owner-line, #ece3d3)', paddingTop: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <div style={{ fontWeight: 600 }}>{i.billingMonth}</div>
                      <span style={{ fontSize: 12, fontWeight: 600, color: tone[i.status] || 'var(--owner-text)', textTransform: 'capitalize' }}>{String(i.status).replace(/_/g, ' ')}</span>
                    </div>
                    <div className="muted" style={{ fontSize: 12.5, marginTop: 4, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                      <span>Hardware credit: {money(i.salonHardwareCreditCents)}</span>
                      <span>Amount due: {money(i.hardwareMonthlyDueCents)}</span>
                      <span>Shortfall: {money(i.shortfallCents)}</span>
                      <span>Auto-charged: {money(i.autoChargeAmountCents)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
