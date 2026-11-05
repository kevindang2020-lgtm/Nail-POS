// POSDealsScreen.tsx — Marketing & Growth → Deals & Offers (BUILD_PLAN Phase 5: the one deals domain). Wired to /pos/deals
// (pos.marketing.view read, pos.marketing.manage write).
//   Dashboard — live counts, discounts given (net of refunds), redemptions, the top deals (deal_daily_stats)
//   Deals     — deals, coupons, automatic promotions and announcements; the approval queue; the lifecycle (submit →
//               approve → publish/schedule → pause/resume → cancel/archive); edit (a new version); a coupon's codes
//   New deal  — the five-step wizard with the rule builder and the simulator
//   Settings  — the stacking policy, price floor, combining with member discounts / rewards, technician deals
// Money is integer cents; the server computes every price (the old client-side price math — bug list item "client math
// in POSDealsScreen" — is gone: the wizard's simulator asks the server).
import { useCallback, useEffect, useState } from 'react';
import { posDealsApi, type DealView, type DealSettings, type DealStatus } from '../api/posDealsApi';
import { money, reportError } from './reportsCommon';
import { DealWizard } from './deals/DealWizard';
import { DealCouponsPanel } from './deals/DealCouponsPanel';
import { DealsDashboard } from './deals/DealsDashboard';
import { DealsSettingsPanel } from './deals/DealsSettingsPanel';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { codeLabel } from '../components/codeLabel';

import { statusLabel } from '../i18n/status-label';
const statusTone = (s: DealStatus): string =>
  s === 'active' ? 'var(--ok)' : s === 'pending_approval' || s === 'scheduled' ? '#B7791F'
    : s === 'rejected' || s === 'expired' || s === 'canceled' || s === 'archived' || s === 'sold_out' ? '#B4453C' : 'var(--muted)';
const kindText = (k: string) => codeLabel('admin.deals.kind', k);
const discountLabel = (d: DealView) => ((d.kind ?? 'deal') === 'announcement' ? kindText('announcement').toLowerCase()
  : d.discountType === 'percent' ? tx('pos.v0_off_2', { v0: String(d.discountPercent ?? 0) }) : d.discountType === 'fixed_price' ? tx('pos.for_v0', { v0: String(money(d.discountCents || 0)) }) : tx('pos.v0_off', { v0: String(money(d.discountCents || 0)) }));

// The lifecycle actions available from each status (the server's status machine decides; this only offers them).
function actionsFor(status: DealStatus): { key: string; label: string; needsReason?: boolean }[] {
  switch (status) {
    case 'draft': return [{ key: 'submit', label: tx('pos.submit_for_approval') }, { key: 'cancel', label: tx('pos.cancel') }];
    case 'pending_approval': return [{ key: 'approve', label: tx('pos.approve') }, { key: 'reject', label: tx('pos.reject'), needsReason: true }];
    case 'approved': return [{ key: 'publish', label: tx('pos.publish') }, { key: 'cancel', label: tx('pos.cancel') }];
    case 'scheduled': return [{ key: 'cancel', label: tx('pos.cancel') }];
    case 'active': return [{ key: 'pause', label: tx('pos.pause') }, { key: 'cancel', label: tx('pos.end_now') }];
    case 'paused': return [{ key: 'resume', label: tx('pos.resume') }, { key: 'cancel', label: tx('pos.cancel') }];
    case 'expired': case 'rejected': case 'canceled': case 'sold_out': return [{ key: 'archive', label: tx('pos.archive') }];
    default: return [];
  }
}

type Tab = 'dashboard' | 'deals' | 'new' | 'settings';

export function POSDealsScreen() {
  const [tab, setTab] = useState<Tab>('deals');
  const [deals, setDeals] = useState<DealView[] | null>(null);
  const [settings, setSettings] = useState<DealSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<DealView | null>(null);
  const [codesFor, setCodesFor] = useState<DealView | null>(null);
  // the terms each version carried — a customer who booked v2 keeps v2's terms; this is how staff see what changed
  const [history, setHistory] = useState<{ id: string; rows: { version: number; terms: any; createdAt: string | null }[] } | null>(null);
  const showHistory = async (d: DealView) => {
    if (history?.id === d.id) { setHistory(null); return; }
    try { setHistory({ id: d.id, rows: ((await posDealsApi.versions(d.id)) as any[]) ?? [] }); }
    catch (e: any) { setNote(e?.message || tx('pos.could_not_load_the_history')); }
  };
  const [kind, setKind] = useState<string>('');
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [d, s] = await Promise.all([(kind ? posDealsApi.listKind(kind) : posDealsApi.list()) as Promise<DealView[]>, posDealsApi.getSettings() as Promise<DealSettings>]);
      setDeals(d); setSettings(s);
    } catch (e: any) { setError(reportError(e, 'deals')); }
    finally { setLoading(false); }
  }, [kind]);
  useEffect(() => { void load(); }, [load]);

  const act = async (d: DealView, action: string, needsReason?: boolean) => {
    let reason: string | undefined;
    if (needsReason) {
      if (rejecting !== d.id) { setRejecting(d.id); setRejectReason(''); return; }
      reason = rejectReason.trim();
      if (!reason) { setNote(tx('pos.a_rejection_reason_is_required')); return; }
      setRejecting(null); setRejectReason('');
    }
    setBusy(d.id + action); setNote(null);
    try {
      const api: Record<string, () => Promise<unknown>> = {
        submit: () => posDealsApi.submit(d.id), approve: () => posDealsApi.approve(d.id), reject: () => posDealsApi.reject(d.id, reason!),
        pause: () => posDealsApi.pause(d.id), resume: () => posDealsApi.resume(d.id), publish: () => posDealsApi.publish(d.id),
        cancel: () => posDealsApi.cancel(d.id), archive: () => posDealsApi.archive(d.id),
      };
      const r: any = await api[action]();
      if (action === 'publish' && r?.status === 'scheduled') setNote(tx('pos.title_is_scheduled_it_goes_live_1kwm', { title: String(d.title), v1: String(r.startsAt ? new Date(r.startsAt).toLocaleString() : tx('pos.at_its_start')) }));
      await load();
    } catch (e: any) { setNote(e?.message || tx('pos.that_action_could_not_be_completed')); }
    finally { setBusy(null); }
  };

  if (loading && !deals) return <div style={{ padding: 24, color: 'var(--muted)' }}>{tx('pos.loading_deals')}</div>;
  if (error) return <div style={{ padding: 24, color: '#B4453C' }}>{error}</div>;
  const pending = (deals || []).filter((d) => d.status === 'pending_approval');

  return (
    <div className="work">
      <div className="vh" style={{ marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div><h1>{tx('pos.deals_offers')}</h1><div className="sub">{tx('pos.deals_coupons_and_promotions_one_place_1qav')}</div></div>
        <button className="btn primary" onClick={() => { setEditing(null); setTab('new'); }}>{tx('pos.new_deal')}</button>
      </div>
      <div role="tablist" className="flex gap-2" style={{ marginBottom: 12 }}>
        {(['dashboard', 'deals', 'new', 'settings'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'btn primary' : 'btn ghost'} onClick={() => { setTab(t); if (t !== 'new') setEditing(null); }}>
            {t === 'dashboard' ? tx('pos.dashboard') : t === 'deals' ? tx('admin.deals.tab') : t === 'new' ? (editing ? tx('pos.edit_deal') : tx('pos.new_deal_2')) : tx('pos.settings')}
          </button>
        ))}
      </div>
      {note && <div role="status" style={{ padding: '8px 12px', background: 'var(--surface-2, #f4efe3)', borderRadius: 8, marginBottom: 12, fontSize: 13, color: 'var(--ink)' }}>{note}</div>}

      {tab === 'dashboard' && <DealsDashboard />}

      {tab === 'new' && (
        <DealWizard editing={editing} onCancel={() => { setEditing(null); setTab('deals'); }}
          onDone={(v) => { setNote(editing ? tx('pos.title_saved_version_version', { title: String(v.title), version: String(v.version) }) : tx('pos.title_created_as_a_draft_submit_oxk0', { title: String(v.title) })); setEditing(null); setTab('deals'); void load(); }} />
      )}

      {tab === 'settings' && settings && <DealsSettingsPanel settings={settings} onSaved={setSettings} />}

      {tab === 'deals' && (
        <>
          {codesFor && <DealCouponsPanel dealId={codesFor.id} title={codesFor.title} onClose={() => setCodesFor(null)} />}
          {pending.length > 0 && (
            <section className="panel" style={{ borderColor: '#B7791F', marginBottom: 16 }}>
              <div className="p-h" style={{ color: '#B7791F' }}>{tx('pos.approval_queue')}{pending.length})</div>
              {pending.map((d) => (
                <div key={d.id} className="flex flex-col md:flex-row md:items-center justify-between gap-3 py-3" style={{ borderTop: '1px solid var(--line)' }}>
                  <div><strong>{d.title}</strong> <span className="sub" style={{ fontSize: 12 }}>· {d.ownerType === 'technician' ? tx('pos.technician_deal') : tx('pos.salon_deal')} · {discountLabel(d)}</span></div>
                  <div className="flex gap-2">
                    {actionsFor(d.status).map((a) => (
                      a.needsReason && rejecting === d.id ? (
                        <span key={a.key} className="flex gap-2 items-center">
                          <input aria-label={tx('pos.reason_for_rejection_required')} placeholder={tx('pos.reason_for_rejection')} value={rejectReason} autoFocus onChange={(ev) => setRejectReason(ev.target.value)}
                            style={{ height: 34, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px', fontSize: 13, width: 200 }} />
                          <button onClick={() => act(d, a.key, true)} disabled={!!busy} className="btn" style={{ background: '#B4453C', color: '#fff', borderColor: '#B4453C' }}>{tx('pos.reject')}</button>
                          <button onClick={() => { setRejecting(null); setRejectReason(''); }} className="btn ghost">{tx('pos.cancel')}</button>
                        </span>
                      ) : <button key={a.key} onClick={() => act(d, a.key, a.needsReason)} disabled={!!busy} className={a.key === 'reject' ? 'btn ghost' : 'btn primary'}>{a.label}</button>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          )}

          <section className="panel" style={{ marginBottom: 16 }}>
            <div className="flex justify-between items-center" style={{ marginBottom: 4 }}>
              <div className="p-h">{tx('pos.all_2')}{(deals || []).length})</div>
              <select aria-label={tx('pos.show')} value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="">{tx('pos.everything')}</option><option value="deal">{tx('pos.deals')}</option><option value="coupon">{tx('pos.coupons')}</option><option value="automatic">{tx('pos.automatic_promotions')}</option><option value="announcement">{tx('pos.announcements')}</option>
              </select>
            </div>
            {(deals || []).length === 0 && <div className="sub" style={{ fontSize: 14, padding: '8px 0' }}>{tx('pos.nothing_here_yet_create_your_first_1c2a')}</div>}
            {(deals || []).map((d) => (
              <div key={d.id} data-testid="deal-row" className="flex flex-col md:flex-row md:items-center justify-between gap-3 py-3" style={{ borderTop: '1px solid var(--line)' }}>
                <div style={{ minWidth: 0 }}>
                  <strong>{d.title}</strong>
                  <span style={{ marginLeft: 8, fontSize: 11, padding: '2px 8px', borderRadius: 999, background: 'var(--surface-2,#f4efe3)', color: statusTone(d.status) }}>{statusLabel('deal', d.status)}</span>
                  <span style={{ marginLeft: 6, fontSize: 11 }} className="sub">{kindText(d.kind ?? 'deal')}</span>
                  {d.suspendedReason && <div style={{ fontSize: 12, color: '#B4453C' }}>{tx('pos.suspended_by_the_platform')}{' '}{d.suspendedReason}</div>}
                  <div className="sub" style={{ fontSize: 12, marginTop: 4 }}>
                    {d.ownerType === 'technician' ? tx('pos.technician') : tx('pos.salon_2')} · {discountLabel(d)}
                    {d.originalPriceCents != null && d.finalPriceCents != null && <> · {money(d.originalPriceCents)} → <strong>{money(d.finalPriceCents)}</strong></>}
                    {' · '}{d.redemptionCount}{d.maxRedemptions ? ` / ${d.maxRedemptions}` : ''} {tx('pos.redeemed_2')}
                    {d.budgetCents ? <> {tx('pos.budget_3')}{' '}{money(d.budgetReservedCents ?? 0)} / {money(d.budgetCents)}</> : null}
                    {d.endsAt ? <> {tx('pos.ends')}{' '}{new Date(d.endsAt).toLocaleDateString()}</> : null}
                    {' · '}v{d.version}
                  </div>
                  {history?.id === d.id && (
                    <ul data-testid="deal-history" className="sub" style={{ fontSize: 12, margin: '6px 0 0', paddingLeft: 18 }}>
                      {history.rows.length === 0 ? <li>{tx('pos.no_earlier_versions')}</li> : history.rows.map((h) => (
                        <li key={h.version}>v{h.version}{h.createdAt ? ` · ${new Date(h.createdAt).toLocaleString()}` : ''} · {h.terms?.title ?? d.title} · {h.terms?.discountType === 'percent' ? tx('pos.discountpercent_off', { discountPercent: String(h.terms?.discountPercent) }) : h.terms?.discountCents != null ? `${money(h.terms.discountCents)}${h.terms?.discountType === 'fixed_price' ? ' price' : ' off'}` : ''}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex gap-2 shrink-0 flex-wrap">
                  {!['canceled', 'archived', 'expired', 'rejected'].includes(d.status) && <button className="btn ghost" onClick={() => { setEditing(d); setTab('new'); }}>{tx('pos.edit')}</button>}
                  {(d.kind ?? 'deal') === 'coupon' && <button className="btn ghost" onClick={() => setCodesFor(d)}>{tx('pos.codes')}</button>}
                  {d.version > 1 && <button className="btn ghost" onClick={() => void showHistory(d)}>{tx('pos.history')}</button>}
                  {actionsFor(d.status).filter((a) => !a.needsReason).map((a) => (
                    <button key={a.key} onClick={() => act(d, a.key)} disabled={!!busy} className="btn">{a.label}</button>
                  ))}
                </div>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
