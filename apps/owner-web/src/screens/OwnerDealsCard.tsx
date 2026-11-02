// OwnerDealsCard.tsx — BUILD_PLAN Phase 5: deals in the Owner App, inside Marketing & Growth. What deals gave away in
// the last 30 days NET of refunds (a refunded ticket gives its discount back), what is still sitting unpaid on tickets,
// the top deals, and the approval queue — approve, reject with a reason the technician sees, or pause. If deals are
// switched off (salon setting, plan or platform) it says so and why, instead of showing an empty marketplace.
import { useCallback, useEffect, useState } from 'react';
import { ownerDealsApi, type OwnerDealsSummary, type OwnerDealRow } from '../api/ownerDealsApi';
import { formatCentsOrDash } from '@aipowersalon/money';   // BUILD_PLAN Phase 13 E (C6 §99–100): shared money / branch-zone date display

const money = (c: number | null | undefined) => formatCentsOrDash(c);
const terms = (d: OwnerDealRow) => (d.discountType === 'percent' ? `${d.discountPercent}% off` : d.discountType === 'fixed_price' ? `for ${money(d.discountCents)}` : `${money(d.discountCents)} off`);

export function OwnerDealsCard() {
  const [data, setData] = useState<OwnerDealsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(() => {
    ownerDealsApi.summary(30).then((d) => { setData(d); setError(null); }).catch((e: any) => setError(e?.status === 403 ? null : (e?.message || 'Could not load deals.')));
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key); setNote(null);
    try { await fn(); setNote(done); setRejecting(null); setReason(''); load(); }
    catch (e: any) { setNote(e?.message || 'That did not go through.'); }
    finally { setBusy(null); }
  };

  if (error) return <div className="owner-state" role="alert">{error}</div>;
  if (!data) return null;
  const { dashboard: dash, pending, switches } = data;
  return (
    <section data-testid="owner-deals" style={{ marginTop: 16 }}>
      <div className="owner-sechead"><div className="h">Deals &amp; Coupons</div><div className="d">last {dash.days} days</div></div>
      {!switches.running && <div className="owner-state" data-testid="deals-off">Deals are not running: {switches.reason}</div>}
      {note && <div role="status" className="owner-text-muted" style={{ fontSize: 12, margin: '4px 0' }}>{note}</div>}
      <div className="owner-kpigrid three" style={{ marginBottom: 8 }}>
        <div className="owner-kpi"><div className="label">Given (net)</div><div className="val">{money(dash.totals.netDiscountCents)}</div><div className="sub owner-text-muted">{dash.totals.reversals} refunded back</div></div>
        <div className="owner-kpi"><div className="label">Redemptions</div><div className="val">{dash.totals.redemptions}</div><div className="sub owner-text-muted">{dash.totals.views} views</div></div>
        <div className="owner-kpi"><div className="label">Live</div><div className="val">{dash.live.active}</div><div className="sub owner-text-muted">{dash.live.scheduled} scheduled{switches.maxActiveDeals != null ? ` · limit ${switches.maxActiveDeals}` : ''}</div></div>
      </div>
      {dash.totals.openApplications > 0 && <div className="owner-text-muted" style={{ fontSize: 12, marginBottom: 8 }}>{dash.totals.openApplications} unpaid ticket(s) carry {money(dash.totals.openDiscountCents)} in deals — counted only once paid.</div>}

      {dash.top.length > 0 && (
        <div className="owner-drill" style={{ marginBottom: 12 }}>
          {dash.top.slice(0, 5).map((t) => (
            <div className="owner-drillrow" key={t.dealId} data-testid="owner-top-deal">
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700 }}>{t.title}</div><div className="owner-text-muted" style={{ fontSize: 12 }}>{t.redemptions} redeemed · {t.conversion}% of views</div></div>
              <div style={{ fontWeight: 700, marginLeft: 10 }}>{money(t.discountedCents)}</div>
              {t.status === 'active' && <button style={{ marginLeft: 8 }} disabled={!!busy} onClick={() => void act('pause' + t.dealId, () => ownerDealsApi.pause(t.dealId), `${t.title} paused.`)}>Pause</button>}
            </div>
          ))}
        </div>
      )}

      <div className="owner-sechead"><div className="h">Waiting for approval</div><div className="d">{pending.length}</div></div>
      {pending.length === 0 ? <div className="owner-state">Nothing waiting.</div> : pending.map((d) => (
        <div className="owner-chartcard" key={d.id} data-testid="owner-pending-deal" style={{ padding: 12, marginBottom: 8 }}>
          <div style={{ fontWeight: 700 }}>{d.title}</div>
          <div className="owner-text-muted" style={{ fontSize: 12 }}>{d.ownerType === 'technician' ? 'Technician deal' : 'Salon deal'} · {terms(d)}{d.originalPriceCents != null ? ` · ${money(d.originalPriceCents)} → ${money(d.finalPriceCents)}` : ''}</div>
          {rejecting === d.id ? (
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <input aria-label="Reason" placeholder="What should change? (they see this)" value={reason} onChange={(e) => setReason(e.target.value)} style={{ flex: 1 }} />
              <button disabled={!!busy || reason.trim().length < 5} onClick={() => void act('rej' + d.id, () => ownerDealsApi.reject(d.id, reason.trim()), 'Sent back with your reason.')}>Send back</button>
              <button onClick={() => { setRejecting(null); setReason(''); }}>Cancel</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button disabled={!!busy} onClick={() => void act('ok' + d.id, () => ownerDealsApi.approve(d.id), `${d.title} approved.`)}>Approve</button>
              <button disabled={!!busy} onClick={() => setRejecting(d.id)}>Reject…</button>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
