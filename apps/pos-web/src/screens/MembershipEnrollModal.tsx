import { useEscapeToClose } from '../components/FitKit';
import { useEffect, useRef, useState } from 'react';
import { createIntentKeys } from '@aipowersalon/api-client';
import { posCustomersApi } from '../api/posCustomersApi';
import { posMembershipsApi } from '../api/posMembershipsApi';
import { posMembershipEnrollApi } from '../api/posMembershipEnrollApi';
import { centsToUsd } from '@aipowersalon/money';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { ImeSafeInput } from '../components/ImeSafeInput';
import { MembershipFirstPaymentPanel } from '../components/MembershipFirstPaymentPanel';

// MembershipEnrollModal — enroll a customer into a plan from the POS. Search a customer, pick an active plan, and capture
// the auto-renew consent the backend requires for auto-renewing plans (negative-option compliance) before enrolling.
// Enrollment issues the cycle's credits + sets the first billing date server-side; this UI only collects the inputs.

const GOLD = '#A96F22';
const lbl: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: '#6A5A46', margin: '10px 0 0' };
const inp: React.CSSProperties = { display: 'block', width: '100%', marginTop: 4, padding: '8px 10px', border: '1px solid var(--line,#E2D6C2)', borderRadius: 8, fontSize: 14, boxSizing: 'border-box', background: '#fff' };
const money = (c: number): string => centsToUsd(c);   // shared formatter: a negative reads −$6.75, never $-6.75 (wave 4 pilot)
const disclosure = (): string => tx('pos.member_consents_to_automatic_renewal_each_1ypb');

interface CustomerOpt { id: string; name: string; phone: string | null }
interface PlanOpt { planId: string; name: string; status: string; priceCents: number; isCustomPricing: boolean; billingInterval: string }

const INTERVAL_LABEL: Record<string, string> = { month: '/mo', quarter: '/qtr', six_month: '/6mo', year: '/yr', none: '', custom: '' };

export function MembershipEnrollModal({ onClose, onEnrolled }: { onClose: () => void; onEnrolled: (msg: string) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CustomerOpt[]>([]);
  const [customer, setCustomer] = useState<CustomerOpt | null>(null);
  const [plans, setPlans] = useState<PlanOpt[]>([]);
  const [planId, setPlanId] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState<{ membershipId: string; name: string } | null>(null);

  useEffect(() => {
    let alive = true;
    (posMembershipsApi.listPlans() as Promise<any>)
      .then((rows) => {
        if (!alive) return;
        const list: PlanOpt[] = (Array.isArray(rows) ? rows : rows?.plans || rows?.items || [])
          .map((p: any) => ({ planId: p.planId, name: p.name, status: p.status, priceCents: Number(p.priceCents ?? 0) || 0, isCustomPricing: !!p.isCustomPricing, billingInterval: p.billingInterval || 'month' }))
          .filter((p: PlanOpt) => p.planId && p.status === 'active');
        setPlans(list);
        if (list.length === 1) setPlanId(list[0].planId);
      })
      .catch(() => setPlans([]));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (customer || query.trim().length < 2) { setResults([]); return; }
    let alive = true;
    const t = setTimeout(() => {
      (posCustomersApi.quickSearch(query.trim()) as Promise<any>)
        .then((r) => {
          if (!alive) return;
          const rows: any[] = r?.items || r?.customers || (Array.isArray(r) ? r : []);
          setResults(rows.slice(0, 8).map((c) => ({ id: c.id, name: c.fullName || c.full_name || [c.firstName, c.lastName].filter(Boolean).join(' ') || tx('glossary.people.customer'), phone: c.phoneDisplay || c.phone_display || null })));
        })
        .catch(() => setResults([]));
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [query, customer]);

  const keys = useRef(createIntentKeys());
  const canEnroll = !!customer && !!planId && consent && !busy;

  const enroll = async () => {
    if (!customer || !planId) return;
    if (!consent) { setErr(tx('pos.please_capture_the_member_s_auto_5i8w')); return; }
    setBusy(true); setErr(null);
    try {
      const body = { customerId: customer.id, planId, autoRenewConsent: true, agreementVersion: 'pos-1', channel: 'pos' };
      const res = await (posMembershipEnrollApi.enroll(body, keys.current.keyFor('enroll', body)) as Promise<any>);
      keys.current.done('enroll');
      // D6 §16: a priced plan without a trial starts pending — collect the first payment here (or later)
      if (res?.status === 'pending' && res?.membershipId) { setPending({ membershipId: String(res.membershipId), name: customer.name }); setBusy(false); return; }
      onEnrolled(tx('admin.membership.enrolled', { name: customer.name, number: res?.memberNumber ? ` (${res.memberNumber})` : '' }));
    } catch (e: any) { setErr(e?.message || tx('pos.could_not_enroll_this_member')); setBusy(false); }
  };

  useEscapeToClose(onClose);
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(40,30,20,0.38)', display: 'grid', placeItems: 'center', zIndex: 50, padding: 16 }} onClick={onClose}>
      <div className="panel" role="dialog" aria-modal="true" aria-label={tx('pos.add_new_member')} data-testid="dlg-membership-enroll" style={{ width: 'min(480px, 96vw)', maxHeight: '90vh', overflow: 'auto', background: 'var(--aps-card,#fff)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <h2 style={{ margin: 0 }}>{tx('pos.add_new_member')}</h2>
          <button className="btn" style={{ marginLeft: 'auto', padding: '2px 8px' }} onClick={onClose}>{tx('pos.close')}</button>
        </div>

        {pending ? <MembershipFirstPaymentPanel membershipId={pending.membershipId} customerName={pending.name} onPaid={onEnrolled} onLater={onEnrolled} /> : <>
        {!customer ? (
          <>
            <label style={lbl}>{tx('pos.find_customer')}<ImeSafeInput value={query} onValue={setQuery} style={inp} placeholder={tx('pos.search_by_name_or_phone')} autoFocus /></label>
            {query.trim().length >= 2 && (
              <div style={{ border: '1px solid var(--line,#E2D6C2)', borderRadius: 8, marginTop: 6, maxHeight: 220, overflow: 'auto' }}>
                {results.length === 0 ? <div className="muted" style={{ padding: 10, fontSize: 13 }}>{tx('pos.no_matching_customers')}</div> : results.map((c) => (
                  <div key={c.id} onClick={() => { setCustomer(c); setResults([]); }} style={{ padding: '8px 10px', cursor: 'pointer', borderBottom: '1px solid #F0E8DA', display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</span>{c.phone && <span className="muted" style={{ fontSize: 12 }}>{c.phone}</span>}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, padding: '8px 10px', border: `1px solid ${GOLD}`, borderRadius: 8, background: '#FBF6EC' }}>
            <span style={{ fontWeight: 700 }}>{customer.name}</span>{customer.phone && <span className="muted" style={{ fontSize: 12 }}>{customer.phone}</span>}
            <button className="btn" style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: 12 }} onClick={() => { setCustomer(null); setQuery(''); }}>{tx('pos.change')}</button>
          </div>
        )}

        <label style={lbl}>{tx('pos.plan')}
          <select value={planId} onChange={(e) => setPlanId(e.target.value)} style={inp}>
            <option value="">{plans.length ? tx('pos.select_a_plan') : tx('pos.no_active_plans_create_one_first')}</option>
            {plans.map((p) => <option key={p.planId} value={p.planId}>{p.name} · {p.isCustomPricing ? tx('pos.custom_2') : `${money(p.priceCents)}${INTERVAL_LABEL[p.billingInterval] ?? ''}`}</option>)}
          </select>
        </label>

        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 12, fontSize: 13 }}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 2 }} />
          <span>{disclosure()}</span>
        </label>

        {err && <div style={{ color: 'var(--danger,#A33B3B)', fontSize: 12, marginTop: 10 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button>
          <button className="btn" style={{ background: GOLD, color: '#fff', border: 'none', fontWeight: 700, opacity: canEnroll ? 1 : 0.6 }} onClick={enroll} disabled={!canEnroll}>{busy ? tx('pos.enrolling') : tx('pos.enroll_member')}</button>
        </div>
        </>}
      </div>
    </div>
  );
}
