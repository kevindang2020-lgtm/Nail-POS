// DealDetailScreen.tsx — BUILD_PLAN Phase 5: a deal's page in the customer app (guests too). The terms in full — when it
// is valid (dates, days, hours, how far ahead), who it is for (new customers, members, once per customer, minimum spend)
// — save it, and "what would I pay": the deal on the services, at catalog prices, through the same engine checkout uses,
// with every reason it would not apply. Opening this page counts as a view (bug 15: the app never opened one).
import { exitGuestMode } from '../auth/guest';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { customerApi, type DealDetail, type DealEstimate } from '../api/customerApi';
import { useAuth } from '../auth/AuthContext';
import { formatCentsOrDash } from '@aipowersalon/money';   // BUILD_PLAN Phase 13 E (C6 §99–100): shared money / branch-zone date display
import { fmtDate } from '@aipowersalon/mobile-sdk';   // BUILD_PLAN Phase 13 E (C6 §99–100): shared money / branch-zone date display

const money = (c: number | null) => formatCentsOrDash(c);
const fmt = (iso: string | null) => (iso ? fmtDate(iso) : '');
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hhmm = (m: number) => `${(Math.floor(m / 60) % 12) || 12}:${String(m % 60).padStart(2, '0')} ${m >= 720 ? 'PM' : 'AM'}`;

export function termsLines(d: DealDetail): string[] {
  const out: string[] = [];
  if (d.startsAt || d.endsAt) out.push(`Valid ${d.startsAt ? 'from ' + fmt(d.startsAt) + ' ' : ''}${d.endsAt ? 'until ' + fmt(d.endsAt) : ''}`.trim() + '.');
  if (d.daysOfWeek?.length) out.push(`On ${d.daysOfWeek.map((n) => DAYS[n]).join(', ')}.`);
  if (d.validFromMinute != null && d.validToMinute != null) out.push(`Between ${hhmm(d.validFromMinute)} and ${hhmm(d.validToMinute)}.`);
  if (d.bookingLeadMinutes) out.push(`Book at least ${d.bookingLeadMinutes >= 60 ? Math.round(d.bookingLeadMinutes / 60) + ' hour(s)' : d.bookingLeadMinutes + ' minutes'} ahead.`);
  if (d.newCustomersOnly) out.push('For new customers only.');
  if (d.memberOnly) out.push('For members only.');
  if (d.maxPerCustomer) out.push(d.maxPerCustomer === 1 ? 'One per customer.' : `Up to ${d.maxPerCustomer} per customer.`);
  if (d.minSpendCents) out.push(`Minimum spend ${money(d.minSpendCents)}.`);
  if (d.ownerType === 'technician') out.push(`Valid only with ${d.technicianName || 'this technician'}.`);
  return out;
}

export function DealDetailScreen() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { principal } = useAuth() as any;
  const signedIn = !!principal;
  const [d, setD] = useState<DealDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [est, setEst] = useState<DealEstimate | null>(null);
  const [estError, setEstError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    customerApi.dealDetail(id, signedIn).then((x) => { if (!live) return; setD(x); setSaved(!!x.saved); }).catch((e: any) => live && setError(e?.status === 404 ? 'This deal is no longer available.' : e?.message || 'Could not load the deal.'));
    return () => { live = false; };
  }, [id, signedIn]);
  useEffect(() => {
    if (!d || d.kind === 'announcement' || !d.serviceIds.length) return;
    customerApi.dealEstimate(d.id, d.serviceIds, signedIn).then(setEst).catch((e: any) => setEstError(e?.message || 'No estimate right now.'));
  }, [d, signedIn]);

  const toggleSave = async () => {
    if (!signedIn) { exitGuestMode(); return; }   // no /login route: leaving guest mode shows the sign-in screen (Oct 28 2026 dead-route scan)
    const was = saved; setSaved(!was);
    try { await (was ? customerApi.unsaveDeal(id) : customerApi.saveDeal(id)); } catch { setSaved(was); }
  };

  if (error) return <div style={{ padding: 18 }}><div className="cust-card" style={{ padding: 16 }}>{error}</div></div>;
  if (!d) return <div style={{ padding: 18 }}><div className="cust-skel" style={{ height: 160, borderRadius: 16 }} /></div>;
  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="deal-detail">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => nav(-1)} aria-label="Back" style={{ border: 0, background: 'none', fontSize: 22, cursor: 'pointer' }}>‹</button>
        <h1 className="cust-h1" style={{ fontSize: 20, flex: 1 }}>{d.title}</h1>
        <button onClick={() => void toggleSave()} aria-label={saved ? 'Unsave' : 'Save'} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 22, color: saved ? '#C9971B' : '#bbb' }}>{saved ? '♥' : '♡'}</button>
      </div>
      {d.imageUrl ? <img src={d.imageUrl} alt="" style={{ width: '100%', height: 160, objectFit: 'cover', borderRadius: 14 }} /> : null}
      <div className="cust-sub">{d.salonName}{d.branchName ? ` · ${d.branchName}` : ''}{d.address ? ` · ${d.address}` : ''}</div>
      {d.shortDescription ? <div>{d.shortDescription}</div> : null}
      {d.kind !== 'announcement' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {d.originalPriceCents != null && <span style={{ textDecoration: 'line-through', color: '#999' }}>{money(d.originalPriceCents)}</span>}
          {d.finalPriceCents != null ? <strong style={{ fontSize: 18, color: 'var(--customer-gold, #A96F22)' }}>{money(d.finalPriceCents)}</strong>
            : <strong>{d.discountType === 'percent' ? `${d.discountPercent}% off` : `${money(d.discountCents)} off`}</strong>}
        </div>
      )}
      <div className="cust-card" style={{ padding: 14 }} data-testid="deal-terms">
        <div style={{ fontWeight: 800, marginBottom: 6 }}>Terms</div>
        <ul style={{ margin: 0, paddingLeft: 18 }}>{termsLines(d).map((t) => <li key={t}>{t}</li>)}{d.terms ? <li>{d.terms}</li> : null}</ul>
        {!termsLines(d).length && !d.terms ? <div className="cust-sub">No special conditions.</div> : null}
      </div>
      {est && (
        <div className="cust-card" style={{ padding: 14 }} data-testid="deal-estimate">
          <div style={{ fontWeight: 800 }}>What you would pay</div>
          {est.eligible
            ? <div>{money(est.subtotalCents)} − {money(est.discountCents)} = <strong>{money(est.totalCents)}</strong> <span className="cust-sub">(before tax and tip; the final price is set at checkout)</span></div>
            : <div style={{ color: 'var(--customer-red)' }}>Not available to you yet: {est.reasons.map((r) => r.message).join(' ')}</div>}
        </div>
      )}
      {estError && <div className="cust-sub">{estError}</div>}
      {d.kind === 'deal' && <button className="cust-btn" onClick={() => nav('/book', { state: { deal: { id: d.id, title: d.title } } })}>Book this deal</button>}
      {d.kind === 'coupon' && <div className="cust-sub">Show your coupon at checkout (My coupons).</div>}
    </div>
  );
}
