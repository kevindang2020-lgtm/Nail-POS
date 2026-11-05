// POSCampaignCenterScreen.tsx — T15 Marketing & Growth › Campaign Center. Reads the REAL tenant-scoped Campaign Center
// state from /pos/campaigns/state (KPIs + campaign rows with derived open/click/reply rates + ROI) and drives the
// campaign lifecycle (schedule → activate → complete, cancel) through the guarded endpoints. No mock data: a tenant
// with no campaigns shows an honest empty state. Built on the shared @aipowersalon/ui kit (one design system).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader, KpiCard, StatusBadge, DataTable, FilterBar, EmptyState, Modal, Pagination, type Column, type Tone, useEventCallback } from '@aipowersalon/ui';
import { posCampaignsApi, type CampaignCostPreview } from '../api/posCampaignsApi';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { ImeSafeInput } from '../components/ImeSafeInput';
import { codeLabel } from '../components/codeLabel';

type Channel = 'sms' | 'email' | 'push';
type Status = 'draft' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
type Campaign = {
  id: string; name: string; offer: string | null; channel: Channel; audienceLabel: string | null; audienceSize: number;
  status: Status; sentCount: number; openRate?: number; clickRate?: number; replyRate?: number; bookingCount: number;
  revenueCents: number; roi?: number;
};
type State = {
  kpis: { totalCampaigns: number; activeCampaigns: number; totalSent: number; campaignRevenueCents: number; avgRoi: number; avgOpenRate: number };
  campaigns: Campaign[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
};

const money = (c: number) => '$' + (c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n: number) => n.toLocaleString();
const pct = (n?: number) => (n == null ? '—' : `${n}%`);
const PALETTE = ['#A96F22', '#C89B5A', '#6BAF92', '#7B9FD4', '#D08C8C', '#B0A0C8'];
const channelText = (c: Channel) => codeLabel('admin.comms.channel', c);

const cardBox: React.CSSProperties = { background: 'var(--aps-card)', border: '1px solid var(--aps-line)', borderRadius: 14, padding: 14 };
const headStyle: React.CSSProperties = { fontWeight: 800, fontSize: 13.5, marginBottom: 10, fontFamily: 'var(--aps-font-head)' };
const Donut = ({ items }: { items: { label: string; count: number }[] }) => {
  const total = items.reduce((a, x) => a + x.count, 0);
  if (total === 0) return <div style={{ color: 'var(--aps-muted)', fontSize: 12.5 }}>{tx('pos.no_campaign_data_yet')}</div>;
  let acc = 0; const R = 52, C = 2 * Math.PI * R;
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <svg viewBox="0 0 140 140" style={{ width: 104, height: 104, flex: 'none' }}>
        {items.map((it, i) => { const dash = (it.count / total) * C; const seg = <circle key={i} cx="70" cy="70" r={R} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth="16" strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc} transform="rotate(-90 70 70)" />; acc += dash; return seg; })}
      </svg>
      <div style={{ flex: 1 }}>{items.map((it, i) => (<div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '1px 0' }}><span style={{ width: 9, height: 9, borderRadius: 2, background: PALETTE[i % PALETTE.length] }} /><span>{it.label}</span><span style={{ marginLeft: 'auto', color: 'var(--aps-muted)' }}>{Math.round((it.count / total) * 100)}%</span></div>))}</div>
    </div>
  );
};

const STATUS_TONE: Record<Status, Tone> = { completed: 'success', in_progress: 'info', scheduled: 'warning', draft: 'neutral', cancelled: 'danger' };
const statusText = (s: Status) => codeLabel('admin.campaign.status', s, 'campaignType');
const CHANNEL_TONE: Record<Channel, Tone> = { sms: 'teal', email: 'purple', push: 'info' };
// Allowed next actions per status (mirrors the server-side state machine).
const NEXT: Record<Status, { to: Status; label: string }[]> = {
  draft: [{ to: 'scheduled', get label() { return tx('pos.schedule'); } }, { to: 'in_progress', get label() { return tx('pos.activate'); } }, { to: 'cancelled', get label() { return tx('pos.cancel'); } }],
  scheduled: [{ to: 'in_progress', get label() { return tx('pos.activate'); } }, { to: 'cancelled', get label() { return tx('pos.cancel'); } }],
  in_progress: [{ to: 'completed', get label() { return tx('pos.complete_2'); } }, { to: 'cancelled', get label() { return tx('pos.cancel'); } }],
  completed: [],
  cancelled: [],
};

const sel: React.CSSProperties = { height: 34, border: '1px solid var(--line)', borderRadius: 9, padding: '0 10px', background: '#FFFDF8', fontFamily: 'inherit', fontSize: 13, color: 'var(--ink)' };

export function POSCampaignCenterScreen({ defaultChannel = '' }: { defaultChannel?: string } = {}) {
  const nav = useNavigate();
  const [s, setS] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [channel, setChannel] = useState(defaultChannel);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', offer: '', channel: defaultChannel || 'sms', audienceLabel: '', audienceSize: '', costCents: '' });
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback((q: Record<string, unknown>) => {
    return (posCampaignsApi.getState(q) as Promise<State>).then(setS).catch((e: any) => setError(e?.message || tx('pos.failed_to_load_campaigns')));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { load({ status: status || undefined, channel: channel || undefined, search: search || undefined, page }); }, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, status, channel, search, page]);

  // wave 3 PAYI §81: a large SMS campaign shows its cost preview (recipients, opted-out, segments, cost) and asks for an
  // explicit confirmation before it is activated; the server refuses the send without it.
  const [preview, setPreview] = useState<{ id: string; p: CampaignCostPreview } | null>(null);
  const doAction = useEventCallback(async (id: string, to: Status, confirmEstimate: boolean = false) => {
    setBusyId(id); setNote(null);
    try {
      if (to === 'in_progress' && !confirmEstimate) {
        const p = await posCampaignsApi.costPreview(id).catch(() => null);
        if (p?.requiresConfirmation) { setPreview({ id, p }); return; }
      }
      const fn = to === 'scheduled' ? posCampaignsApi.schedule : to === 'in_progress' ? (cid: string) => posCampaignsApi.activate(cid, { confirmEstimate }) : to === 'completed' ? posCampaignsApi.complete : posCampaignsApi.cancel;
      await fn(id);
      setPreview(null);
      await load({ status: status || undefined, channel: channel || undefined, search: search || undefined, page });
    } catch (e: any) { setNote(e?.message || tx('pos.action_failed')); }
    finally { setBusyId(null); }
  });

  const submitCreate = async () => {
    setNote(null);
    if (!form.name.trim()) { setNote(tx('pos.campaign_name_is_required')); return; }
    try {
      await posCampaignsApi.create({
        name: form.name.trim(), offer: form.offer || undefined, channel: form.channel,
        audienceLabel: form.audienceLabel || undefined, audienceSize: form.audienceSize ? Number(form.audienceSize) : undefined,
        costCents: form.costCents ? Math.round(Number(form.costCents) * 100) : undefined,
      });
      setCreateOpen(false);
      setForm({ name: '', offer: '', channel: 'sms', audienceLabel: '', audienceSize: '', costCents: '' });
      await load({ status: status || undefined, channel: channel || undefined, search: search || undefined, page: 1 });
      setPage(1);
    } catch (e: any) { setNote(e?.message || tx('pos.create_failed')); }
  };

  const columns = useMemo<Column<Campaign>[]>(() => [
    { key: 'name', get header() { return tx('pos.campaign'); }, render: (r) => (<div><div style={{ fontWeight: 700 }}>{r.name}</div>{r.offer ? <div style={{ fontSize: 11.5, color: 'var(--aps-muted)' }}>{r.offer}</div> : null}</div>) },
    { key: 'channel', get header() { return tx('pos.channel'); }, render: (r) => <StatusBadge tone={CHANNEL_TONE[r.channel]} dot>{r.channel.toUpperCase()}</StatusBadge> },
    { key: 'audience', get header() { return tx('pos.audience'); }, align: 'right', render: (r) => num(r.audienceSize) },
    { key: 'status', get header() { return tx('pos.status'); }, render: (r) => <StatusBadge tone={STATUS_TONE[r.status]}>{statusText(r.status)}</StatusBadge> },
    { key: 'sent', get header() { return tx('pos.sent'); }, align: 'right', render: (r) => num(r.sentCount) },
    { key: 'open', get header() { return tx('pos.open'); }, align: 'right', render: (r) => pct(r.openRate) },
    { key: 'click', get header() { return tx('pos.click'); }, align: 'right', render: (r) => pct(r.clickRate) },
    { key: 'reply', get header() { return tx('pos.reply'); }, align: 'right', render: (r) => pct(r.replyRate) },
    { key: 'bookings', get header() { return tx('pos.bookings_2'); }, align: 'right', render: (r) => num(r.bookingCount) },
    { key: 'revenue', get header() { return tx('pos.revenue'); }, align: 'right', render: (r) => money(r.revenueCents) },
    { key: 'roi', header: 'ROI', align: 'right', render: (r) => (r.roi ? `${r.roi}x` : '—') },
    { key: 'actions', header: '', render: (r) => (
      <div className="flex justify-end gap-2 shrink-0">
        {NEXT[r.status].map((a) => (
          <button key={a.to} className={a.to !== 'cancelled' ? "btn primary" : "btn ghost"} disabled={busyId === r.id} onClick={() => doAction(r.id, a.to)}>{a.label}</button>
        ))}
      </div>
    ) },
  ], [busyId, doAction]);

  if (error) return <div className="work"><div className="err">{error}</div></div>;
  if (!s) return <div className="work"><div className="state">{tx('pos.loading_campaign_center')}</div></div>;

  const k = s.kpis;
  // Derived analytics from the loaded campaign rows (real)
  const camps = s.campaigns;
  const audienceReached = camps.reduce((a, c) => a + (c.audienceSize || 0), 0);
  const engaged = camps.reduce((a, c) => a + Math.round((c.sentCount || 0) * ((c.openRate || 0) / 100)), 0);
  const booked = camps.reduce((a, c) => a + (c.bookingCount || 0), 0);
  const totalBookings = booked;
  const funnel = [
    { label: tx('pos.audience_reached'), value: audienceReached },
    { label: tx('pos.engaged_opened'), value: engaged },
    { label: tx('pos.booked'), value: booked },
  ];
  const funnelMax = Math.max(1, audienceReached);
  const chanRev: Record<string, number> = { sms: 0, email: 0, push: 0 };
  for (const c of camps) chanRev[c.channel] = (chanRev[c.channel] || 0) + (c.revenueCents || 0);
  const channelMix = (Object.keys(chanRev) as Channel[]).map((ch) => ({ label: channelText(ch), count: chanRev[ch] })).filter((x) => x.count > 0);
  const revenueByCampaign = [...camps].filter((c) => c.revenueCents > 0).sort((a, b) => b.revenueCents - a.revenueCents).slice(0, 6);
  const revMax = Math.max(1, ...revenueByCampaign.map((c) => c.revenueCents));
  return (
    <div className="work" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14, height: '100%', overflow: 'auto', boxSizing: 'border-box' }}>
      <PageHeader
        title={tx('pos.campaign_center')}
        subtitle={tx('pos.marketing_growth_totalcampaigns_campaign_plural_xqw6', { totalCampaigns: String(k.totalCampaigns), plural: String(k.totalCampaigns === 1 ? '' : 's') })}
        actions={<button className="btn primary" onClick={() => { setNote(null); setCreateOpen(true); }}>{tx('pos.new_campaign')}</button>}
      />

      <div className="grid  gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
        <KpiCard label={tx('pos.campaign_revenue')} value={money(k.campaignRevenueCents)} tone="success" />
        <KpiCard label={tx('pos.active_campaigns')} value={num(k.activeCampaigns)} tone="info" />
        <KpiCard label={tx('pos.total_sent')} value={num(k.totalSent)} tone="teal" />
        <KpiCard label={tx('pos.avg_campaign_roi')} value={`${k.avgRoi}x`} tone="purple" />
        <KpiCard label={tx('pos.avg_open_rate_2')} value={`${k.avgOpenRate}%`} tone="warning" />
        <KpiCard label={tx('pos.total_bookings')} value={num(totalBookings)} tone="success" />
      </div>

      <FilterBar>
        <select style={sel} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label={tx('pos.status_filter')}>
          <option value="">{tx('pos.all_statuses')}</option>
          <option value="draft">{tx('pos.draft_2')}</option>
          <option value="scheduled">{tx('pos.scheduled')}</option>
          <option value="in_progress">{tx('pos.in_progress')}</option>
          <option value="completed">{tx('pos.completed_2')}</option>
          <option value="cancelled">{tx('pos.cancelled')}</option>
        </select>
        <select style={sel} value={channel} onChange={(e) => { setChannel(e.target.value); setPage(1); }} aria-label={tx('pos.channel_filter')}>
          <option value="">{tx('pos.all_channels')}</option>
          <option value="sms">SMS</option>
          <option value="email">{tx('pos.email')}</option>
          <option value="push">{tx('pos.push')}</option>
        </select>
        <ImeSafeInput type="search" enterKeyHint="search" style={{ ...sel, minWidth: 220 }} placeholder={tx('pos.search_campaigns')} value={search} onValue={(v) => { setSearch(v); setPage(1); }} />
        {note ? <span style={{ color: 'var(--aps-danger)', fontSize: 12 }}>{note}</span> : null}
        {preview ? (
          <div role="alertdialog" aria-label={tx('pos.confirm_campaign_cost')} style={{ gridColumn: '1 / -1', border: '1px solid var(--aps-gold, #A96F22)', borderRadius: 10, padding: 12, background: '#FBF4E6', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontWeight: 700 }}>{tx('pos.review_before_sending')}</div>
            <div style={{ fontSize: 13 }}>
              <b>{preview.p.deliverable.toLocaleString()}</b> {tx('pos.customers_will_be_texted')}{preview.p.recipients.toLocaleString()} {tx('pos.in_the_audience')}{' '}{preview.p.optedOut.toLocaleString()} {tx('pos.opted_out_and_skipped_about')}{' '}<b>{preview.p.estimatedSegments.toLocaleString()} {tx('pos.segments')}</b> ({preview.p.segmentsPerMessage} {tx('pos.per_message')}{' '}{preview.p.encoding}{tx('pos.estimated_cost')}{' '}<b>{preview.p.estimatedCostCents == null ? tx('pos.not_priced_yet_ask_aipowersalon_support') : `$${(preview.p.estimatedCostCents / 100).toFixed(2)}`}</b>
              {preview.p.unitPriceCents != null ? tx('pos.v0_per_segment', { v0: String((preview.p.unitPriceCents / 100).toFixed(2)) }) : ''}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn primary" disabled={busyId === preview.id} onClick={() => doAction(preview.id, 'in_progress', true)}>{tx('pos.confirm_and_send')}</button>
              <button className="btn ghost" onClick={() => setPreview(null)}>{tx('pos.cancel')}</button>
            </div>
          </div>
        ) : null}
      </FilterBar>

      <style>{`
        .table-wrapper > div { height: 100% !important; max-height: 100% !important; }
      `}</style>
      <div className="flex-1 shrink-0 min-h-[300px] w-full flex flex-col overflow-hidden table-wrapper">
        <DataTable<Campaign>
          columns={columns}
          rows={s.campaigns}
          getRowKey={(r) => r.id}
          maxHeight="100%"
          empty={<EmptyState title={tx('pos.no_campaigns_yet')} message={tx('pos.create_your_first_sms_email_or_1b4f')} action={<button className="btn primary" onClick={() => setCreateOpen(true)}>{tx('pos.new_campaign')}</button>} />}
        />
      </div>

      {s.pagination.totalPages > 1 ? <Pagination page={s.pagination.page} pageCount={s.pagination.totalPages} onPage={setPage} /> : null}

       <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3  gap-3">
        <div style={cardBox}>
          <div style={headStyle}>{tx('pos.growth_funnel')}</div>
          {audienceReached === 0 ? <div style={{ color: 'var(--aps-muted)', fontSize: 12.5 }}>{tx('pos.no_campaign_reach_yet')}</div> : (
            <div>
              {funnel.map((f, i) => (
                <div key={f.label} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', fontSize: 12.5 }}><span>{f.label}</span><span style={{ marginLeft: 'auto', fontWeight: 700 }}>{num(f.value)}{i > 0 && funnel[i - 1].value > 0 ? <span style={{ color: 'var(--aps-muted)', fontWeight: 400 }}> · {Math.round((f.value / funnel[i - 1].value) * 100)}%</span> : null}</span></div>
                  <div style={{ height: 10, background: 'var(--aps-page)', borderRadius: 5, marginTop: 2 }}><div style={{ width: `${Math.round((f.value / funnelMax) * 100)}%`, height: 10, background: PALETTE[i % PALETTE.length], borderRadius: 5 }} /></div>
                </div>
              ))}
              <div style={{ fontSize: 11.5, color: 'var(--aps-muted)', marginTop: 6 }}>{tx('pos.visited_repeat_client_stages_need_post_apat')}</div>
            </div>
          )}
        </div>
        <div style={cardBox}><div style={headStyle}>{tx('pos.channel_mix')}{' '}<span style={{ color: 'var(--aps-muted)', fontWeight: 400, fontSize: 11 }}>{tx('pos.by_revenue')}</span></div><Donut items={channelMix} /></div>
        <div style={cardBox}>
          <div style={headStyle}>{tx('pos.revenue_by_campaign')}</div>
          {revenueByCampaign.length === 0 ? <div style={{ color: 'var(--aps-muted)', fontSize: 12.5 }}>{tx('pos.no_campaign_revenue_yet')}</div> : (
            <div>
              {revenueByCampaign.map((c) => (
                <div key={c.id} style={{ marginBottom: 6 }}>
                  <div style={{ display: 'flex', fontSize: 12 }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span><span style={{ marginLeft: 'auto', fontWeight: 700 }}>{money(c.revenueCents)}</span></div>
                  <div style={{ height: 8, background: 'var(--aps-page)', borderRadius: 4 }}><div style={{ width: `${Math.round((c.revenueCents / revMax) * 100)}%`, height: 8, background: 'var(--aps-gold)', borderRadius: 4 }} /></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mt-4">
        {[
          { t: tx('pos.loyalty_rewards'), d: tx('pos.tier_distribution_points_issued_redeemed_top_1di0'), r: '/tenant/marketing/loyalty', b: tx('admin.campaign.open.loyalty') },
          { t: tx('pos.rebooking_retention'), d: tx('pos.overdue_at_risk_win_back_actions_mm4m'), r: '/follow-ups', b: tx('admin.campaign.open.retention') },
          { t: tx('pos.promotions_memberships_gift_cards'), d: tx('pos.active_promos_membership_plans_gift_card_1p0k'), r: '/tenant/marketing/promotions', b: tx('admin.campaign.open.promotions') },
          { t: tx('pos.ai_growth_insights'), d: tx('pos.best_send_time_likely_to_return_1jm1'), r: '/ai', b: tx('admin.management.open.aiCenter') },
        ].map((m) => (
          <section key={m.t} className="panel">
            <div className="p-h">{m.t}</div>
            <div className="sub mb-3 text-[13px]">{m.d} {tx('pos.managed_in_its_own_module')}</div>
            <button className="btn w-fit" onClick={() => nav(m.r)}>{m.b}</button>
          </section>
        ))}
      </div>

      <section className="panel mt-4 mb-4">
        <div className="p-h">{tx('pos.quick_actions_2')}</div>
        <div className="flex flex-wrap gap-2">
          {[
            { l: tx('pos.create_campaign'), fn: () => { setNote(null); setCreateOpen(true); } },
            { l: tx('pos.send_sms'), fn: () => nav('/tenant/marketing/sms') },
            { l: tx('pos.send_email'), fn: () => nav('/tenant/marketing/email') },
            { l: tx('pos.launch_promo'), fn: () => nav('/tenant/marketing/promotions') },
            { l: tx('pos.issue_gift_card'), fn: () => nav('/tenant/marketing/promotions') },
            { l: tx('pos.request_review'), fn: () => nav('/follow-ups') },
            { l: tx('pos.view_reports'), fn: () => nav('/reports') },
          ].map((a) => <button key={a.l} className="btn ghost" onClick={a.fn}>{a.l}</button>)}
        </div>
      </section>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={tx('pos.new_campaign_2')}>
        <div className="flex flex-col gap-0 mt-2">
          <div className="lf"><label>{tx('pos.name_2')}</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={tx('pos.spring_into_glow')} style={{ width: '100%' }} /></div>
          <div className="lf"><label>{tx('pos.offer')}</label><input value={form.offer} onChange={(e) => setForm({ ...form, offer: e.target.value })} placeholder={tx('pos.20_off_gel_mani')} style={{ width: '100%' }} /></div>
          <div className="lf"><label>{tx('pos.channel')}</label>
            <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} style={{ width: '100%' }}>
              <option value="sms">SMS</option><option value="email">{tx('pos.email')}</option><option value="push">{tx('pos.push')}</option>
            </select>
          </div>
          <div className="lf"><label>{tx('pos.audience')}</label><input value={form.audienceLabel} onChange={(e) => setForm({ ...form, audienceLabel: e.target.value })} placeholder={tx('pos.lapsed_clients_45_days')} style={{ width: '100%' }} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="lf"><label>{tx('pos.audience_size')}</label><input type="number" value={form.audienceSize} onChange={(e) => setForm({ ...form, audienceSize: e.target.value })} placeholder="0" style={{ width: '100%' }} /></div>
            <div className="lf"><label>{tx('pos.budget_2')}</label><input type="number" value={form.costCents} onChange={(e) => setForm({ ...form, costCents: e.target.value })} placeholder="0.00" style={{ width: '100%' }} /></div>
          </div>
        </div>
        {note ? <div className="sub mt-2" style={{ color: 'var(--aps-danger)' }}>{note}</div> : null}
        <div className="mt-4 pt-4 flex justify-end gap-3" style={{ borderTop: '1px solid var(--line)' }}>
          <button className="btn ghost" onClick={() => setCreateOpen(false)}>{tx('pos.cancel')}</button>
          <button className="btn primary" onClick={submitCreate}>{tx('pos.create_campaign')}</button>
        </div>
      </Modal>
    </div>
  );
}
