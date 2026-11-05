// POSCommunicationsScreen.tsx — T14 Communications › Unified Inbox hub. A two-pane inbox (thread list + conversation
// detail with a reply composer and customer-context panel) reading REAL tenant-scoped data from /pos/communications,
// plus derived inbox analytics (channel mix, missed-call summary) and quick actions. Campaign / automation / AI-
// receptionist surfaces live in their own modules and are linked honestly rather than faked. No mock data — an empty
// inbox shows an honest empty state. Built on the shared @aipowersalon/ui kit.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { StatusBadge, EmptyState, type Tone } from '@aipowersalon/ui';
import { posCommunicationsApi, type ActivityMetric } from '../api/posCommunicationsApi';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { ImeSafeInput } from '../components/ImeSafeInput';
import { codeLabel } from '../components/codeLabel';
import { fmtInZone } from '../i18n/format';

type Channel = 'sms' | 'email' | 'call';
type Status = 'open' | 'pending' | 'replied' | 'closed' | 'missed';
type Direction = 'inbound' | 'outbound';
type Thread = {
  id: string; customerName: string | null; customerContact: string | null; channel: Channel; status: Status;
  assignedToName: string | null; unreadCount: number; lastMessageAt: string | null; lastMessagePreview: string | null;
};
type Message = { id: string; direction: Direction; body: string; authorName: string | null; createdAt: string; status: string };
type State = { kpis: { totalThreads: number; openConversations: number; unreadThreads: number; repliedThreads: number; missedThreads: number }; threads: Thread[]; pagination: any };

const STATUS_TONE: Record<Status, Tone> = { open: 'info', pending: 'warning', replied: 'success', closed: 'neutral', missed: 'danger' };
const statusText = (s: Status) => codeLabel('admin.comms.thread', s);
const CHANNEL_TONE: Record<Channel, Tone> = { sms: 'teal', email: 'purple', call: 'info' };
const channelText = (c: Channel) => codeLabel('admin.comms.channel', c);
const PALETTE = ['#A96F22', '#C89B5A', '#6BAF92', '#7B9FD4', '#D08C8C', '#B0A0C8'];
const time = (iso: string | null) => { if (!iso) return ''; try { return fmtInZone(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return iso; } };

const sel: React.CSSProperties = { height: 32, border: '1px solid var(--aps-line)', borderRadius: 8, padding: '0 8px', background: 'var(--aps-card)', fontFamily: 'inherit', fontSize: 12, color: 'var(--aps-text)' };
const card: React.CSSProperties = { background: 'var(--aps-card)', border: '1px solid var(--aps-line)', borderRadius: 14 };

const Donut = ({ items }: { items: { label: string; count: number }[] }) => {
  const total = items.reduce((a, x) => a + x.count, 0);
  if (total === 0) return <div style={{ color: 'var(--aps-muted)', fontSize: 12.5 }}>{tx('pos.no_conversations_yet')}</div>;
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

// ActivityMetric tiles show the SOURCE's honesty: '…' while loading, '—' plus the reason when the source isn't there.
// A missing source must never render as a zero measurement (invariant §10).
function MetricKpi({ label, m, tone, suffix }: { label: string; m: ActivityMetric | undefined; tone: string; suffix?: string }) {
  const loading = m === undefined;
  const shown = loading ? '…' : m.available && m.value != null ? `${m.value.toLocaleString()}${suffix ?? ''}` : '—';
  return (
    <div style={{ ...card, padding: '8px 12px', display: 'flex', flexDirection: 'column', minWidth: 96 }} title={!loading && !m.available ? m.reason : undefined}>
      <span style={{ fontSize: 11, color: 'var(--aps-muted)', fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 18, fontWeight: 800, color: loading || !m.available ? 'var(--aps-muted)' : tone, fontFamily: 'var(--aps-font-head)' }}>{shown}</span>
      {!loading && !m.available ? <span style={{ fontSize: 10, color: 'var(--aps-muted)' }}>{tx('pos.not_tracked_yet_2')}</span> : null}
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div style={{ ...card, padding: '8px 12px', display: 'flex', flexDirection: 'column', minWidth: 96 }}>
      <span style={{ fontSize: 11, color: 'var(--aps-muted)', fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 18, fontWeight: 800, color: tone, fontFamily: 'var(--aps-font-head)' }}>{value.toLocaleString()}</span>
    </div>
  );
}

export function POSCommunicationsScreen() {
  const nav = useNavigate();
  const [s, setS] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [channel, setChannel] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [selId, setSelId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ thread: Thread; messages: Message[] } | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [activity, setActivity] = useState<Awaited<ReturnType<typeof posCommunicationsApi.getActivity>> | null | undefined>(undefined);
  const endRef = useRef<HTMLDivElement | null>(null);

  const loadInbox = useCallback((q: Record<string, unknown>) => {
    return (posCommunicationsApi.getState(q) as Promise<State>).then((d) => { setS(d); setError(null); }).catch((e: any) => setError(e?.message || tx('pos.failed_to_load_inbox')));
  }, []);

  useEffect(() => { posCommunicationsApi.getActivity(30).then(setActivity).catch(() => setActivity(null)); }, []);
  useEffect(() => {
    const t = setTimeout(() => { loadInbox({ channel: channel || undefined, status: status || undefined, search: search || undefined }); }, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [loadInbox, channel, status, search]);

  const openThread = useCallback(async (id: string) => {
    setSelId(id); setNote(null);
    try {
      const d = await posCommunicationsApi.getThread(id);
      setDetail(d);
      await posCommunicationsApi.markRead(id);
      loadInbox({ channel: channel || undefined, status: status || undefined, search: search || undefined });
    } catch (e: any) { setNote(e?.message || tx('pos.failed_to_open_conversation')); }
  }, [loadInbox, channel, status, search]);

  useEffect(() => { endRef.current?.scrollIntoView?.({ block: 'end' }); }, [detail?.messages?.length]);

  const send = async () => {
    if (!selId || !draft.trim()) return;
    setSending(true); setNote(null);
    try {
      const d = await posCommunicationsApi.reply(selId, draft.trim());
      setDetail(d); setDraft('');
      loadInbox({ channel: channel || undefined, status: status || undefined, search: search || undefined });
    } catch (e: any) { setNote(e?.message || tx('pos.failed_to_send')); }
    finally { setSending(false); }
  };

  if (error) return <div className="work"><div className="err">{error}</div></div>;
  if (!s) return <div className="work"><div className="state">{tx('pos.loading_inbox')}</div></div>;

  const k = s.kpis;
  // Channel mix derived from the loaded threads (real)
  const chanCounts: Record<string, number> = { sms: 0, email: 0, call: 0 };
  for (const t of s.threads) chanCounts[t.channel] = (chanCounts[t.channel] || 0) + 1;
  const channelMix = (Object.keys(chanCounts) as Channel[]).map((c) => ({ label: channelText(c), count: chanCounts[c] })).filter((x) => x.count > 0);
  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div><h1 style={{ margin: 0, fontFamily: 'var(--aps-font-head)', fontSize: 22 }}>{tx('pos.communications')}</h1><div style={{ fontSize: 12.5, color: 'var(--aps-muted)' }}>{tx('pos.manage_guest_messaging_calls_reminders_and_b410')}</div></div>
      </div>

      {/* Activity/volume metrics (mockup 19). Each comes from a real source and shows '—' when that source is absent. */}
     <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
        <MetricKpi label={tx('pos.messages_sent_today')} m={activity === null ? { value: null, available: false, reason: tx('admin.comms.metricsUnavailable') } : activity?.messagesSentToday} tone="var(--aps-text)" />
        <MetricKpi label={tx('pos.campaign_delivery')} m={activity === null ? { value: null, available: false, reason: tx('admin.comms.metricsUnavailable') } : activity?.campaignDeliveryRatePct} tone="var(--aps-ok)" suffix="%" />
        <MetricKpi label={tx('pos.ai_calls_handled')} m={activity === null ? { value: null, available: false, reason: tx('admin.comms.metricsUnavailable') } : activity?.aiCallsHandled} tone="var(--aps-info)" />
        <MetricKpi label={tx('pos.review_requests_sent')} m={activity === null ? { value: null, available: false, reason: tx('admin.comms.metricsUnavailable') } : activity?.reviewRequestsSent} tone="var(--aps-text)" />
        <MetricKpi label={tx('pos.avg_response')} m={activity === null ? { value: null, available: false, reason: tx('admin.comms.metricsUnavailable') } : activity?.avgResponseMinutes} tone="var(--aps-gold)" suffix="m" />
        <MetricKpi label={tx('pos.rebooking_conv')} m={activity === null ? { value: null, available: false, reason: tx('admin.comms.metricsUnavailable') } : activity?.rebookingConversionPct} tone="var(--aps-text)" suffix="%" />
      </div>

     <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-7 gap-3">

        <Kpi label={tx('pos.open_conversations')} value={k.openConversations} tone="var(--aps-info)" />
        <Kpi label={tx('pos.unread_2')} value={k.unreadThreads} tone="var(--aps-warn)" />
        <Kpi label={tx('pos.replied')} value={k.repliedThreads} tone="var(--aps-ok)" />
        <Kpi label={tx('pos.missed')} value={k.missedThreads} tone="var(--aps-danger)" />
        <Kpi label="SMS" value={chanCounts.sms} tone="var(--aps-text)" />
        <Kpi label={tx('pos.email')} value={chanCounts.email} tone="var(--aps-text)" />
        <Kpi label={tx('pos.total_conversations')} value={k.totalThreads} tone="var(--aps-gold)" />
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select style={sel} value={channel} onChange={(e) => setChannel(e.target.value)} aria-label={tx('pos.channel_filter')}><option value="">{tx('pos.all_channels')}</option><option value="sms">SMS</option><option value="email">{tx('pos.email')}</option><option value="call">{tx('pos.call_2')}</option></select>
        <select style={sel} value={status} onChange={(e) => setStatus(e.target.value)} aria-label={tx('pos.status_filter')}><option value="">{tx('pos.all_statuses')}</option><option value="open">{tx('pos.open')}</option><option value="pending">{tx('pos.pending')}</option><option value="replied">{tx('pos.replied')}</option><option value="missed">{tx('pos.missed')}</option><option value="closed">{tx('pos.closed')}</option></select>
        <ImeSafeInput style={{ ...sel, minWidth: 200 }} placeholder={tx('pos.search_conversations')} value={search} onValue={setSearch} />
        {note ? <span style={{ color: 'var(--aps-danger)', fontSize: 12, alignSelf: 'center' }}>{note}</span> : null}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-3 md:h-[520px] h-auto min-h-[520px]">
        {/* Inbox list */}
        <div style={{ ...card, overflow: 'auto', minHeight: 0 }}>
          {s.threads.length === 0 ? <div style={{ padding: 24 }}><EmptyState title={tx('pos.no_conversations_yet_2')} message={tx('pos.inbound_guest_messages_will_appear_here')} /></div> :
            s.threads.map((t) => (
              <button key={t.id} onClick={() => openThread(t.id)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', border: 'none', borderBottom: '1px solid var(--aps-line)', background: selId === t.id ? 'var(--aps-page)' : 'transparent', cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{t.customerName || t.customerContact || tx('pos.unknown')}</span>
                  <span style={{ fontSize: 10.5, color: 'var(--aps-muted)' }}>{time(t.lastMessageAt)}</span>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '3px 0' }}>
                  <StatusBadge tone={CHANNEL_TONE[t.channel]} dot>{t.channel.toUpperCase()}</StatusBadge>
                  <StatusBadge tone={STATUS_TONE[t.status]}>{statusText(t.status)}</StatusBadge>
                  {t.unreadCount > 0 ? <span style={{ marginLeft: 'auto', background: 'var(--aps-gold)', color: '#fff', borderRadius: 999, fontSize: 10, fontWeight: 800, padding: '1px 7px' }}>{t.unreadCount}</span> : null}
                </div>
                <div style={{ fontSize: 12, color: 'var(--aps-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.lastMessagePreview || '—'}</div>
              </button>
            ))}
        </div>

        {/* Conversation detail */}
        <div style={{ ...card, display: 'grid', gridTemplateRows: detail ? 'auto minmax(0,1fr) auto' : '1fr', minHeight: 0 }}>
          {!detail ? <div style={{ display: 'grid', placeItems: 'center' }}><EmptyState title={tx('pos.select_a_conversation')} message={tx('pos.choose_a_thread_from_the_inbox_1o03')} /></div> : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--aps-line)' }}>
                <div><div style={{ fontWeight: 800 }}>{detail.thread.customerName || tx('pos.unknown')}</div><div style={{ fontSize: 11.5, color: 'var(--aps-muted)' }}>{detail.thread.customerContact || ''}{detail.thread.assignedToName ? tx('pos.assigned_to_assignedtoname', { assignedToName: String(detail.thread.assignedToName) }) : ''}</div></div>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}><StatusBadge tone={CHANNEL_TONE[detail.thread.channel]} dot>{detail.thread.channel.toUpperCase()}</StatusBadge><StatusBadge tone={STATUS_TONE[detail.thread.status]}>{statusText(detail.thread.status)}</StatusBadge></div>
              </div>
              <div style={{ overflow: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {detail.messages.map((m) => (
                  <div key={m.id} style={{ alignSelf: m.direction === 'outbound' ? 'flex-end' : 'flex-start', maxWidth: '76%' }}>
                    <div style={{ background: m.direction === 'outbound' ? 'color-mix(in srgb, var(--aps-gold) 16%, transparent)' : 'var(--aps-page)', border: '1px solid var(--aps-line)', borderRadius: 12, padding: '8px 11px', fontSize: 13 }}>{m.body}</div>
                    <div style={{ fontSize: 10, color: 'var(--aps-muted)', marginTop: 2, textAlign: m.direction === 'outbound' ? 'right' : 'left' }}>{m.direction === 'outbound' ? (m.authorName || tx('pos.staff')) : (detail.thread.customerName || tx('pos.guest'))} · {time(m.createdAt)}</div>
                  </div>
                ))}
                <div ref={endRef} />
              </div>
              <div style={{ display: 'flex', gap: 8, padding: '10px 12px', borderTop: '1px solid var(--aps-line)' }}>
                <input style={{ ...sel, flex: 1, height: 36 }} placeholder={tx('pos.type_a_message')} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); }} disabled={sending} />
                <button style={{ height: 36, padding: '0 16px', borderRadius: 8, border: '1px solid var(--aps-gold)', background: 'var(--aps-gold)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }} disabled={sending || !draft.trim()} onClick={send}>{sending ? tx('pos.sending') : tx('pos.send')}</button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <div style={{ ...card, padding: 14 }}>
          <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 8, fontFamily: 'var(--aps-font-head)' }}>{tx('pos.channel_mix')}</div>
          <Donut items={channelMix} />
        </div>
        <div style={{ ...card, padding: 14 }}>
          <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 8, fontFamily: 'var(--aps-font-head)' }}>{tx('pos.ai_receptionist_missed_calls')}</div>
          <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
            <div><div style={{ fontSize: 11, color: 'var(--aps-muted)' }}>{tx('pos.missed_threads')}</div><div style={{ fontSize: 20, fontWeight: 800, color: 'var(--aps-danger)' }}>{k.missedThreads}</div></div>
            <div><div style={{ fontSize: 11, color: 'var(--aps-muted)' }}>{tx('pos.open_threads')}</div><div style={{ fontSize: 20, fontWeight: 800 }}>{k.openConversations}</div></div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--aps-muted)' }}>{tx('pos.missed_call_tracking_isn_rsquo_t_3xcw')}</div>
          <button onClick={() => nav('/tenant/ai/receptionist')} style={{ marginTop: 8, height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid var(--aps-line)', background: 'var(--aps-card)', fontSize: 12, cursor: 'pointer' }}>{tx('pos.open_ai_receptionist')}</button>
        </div>
        <div style={{ ...card, padding: 14 }}>
          <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 8, fontFamily: 'var(--aps-font-head)' }}>{tx('pos.communication_performance')}</div>
          <div style={{ fontSize: 12, color: 'var(--aps-muted)' }}>{tx('pos.delivery_trend_response_rate_and_rebooking_1bcg')}</div>
        </div>
      </div>

     <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <div style={{ ...card, padding: 14 }}>
          <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 8, fontFamily: 'var(--aps-font-head)' }}>{tx('pos.campaign_center')}</div>
          <div style={{ fontSize: 12, color: 'var(--aps-muted)' }}>{tx('pos.sms_email_campaigns_live_in_marketing_1w22')}</div>
          <button onClick={() => nav('/tenant/marketing/campaigns')} style={{ marginTop: 8, height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid var(--aps-line)', background: 'var(--aps-card)', fontSize: 12, cursor: 'pointer' }}>{tx('pos.open_campaigns')}</button>
        </div>
        <div style={{ ...card, padding: 14 }}>
          <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 8, fontFamily: 'var(--aps-font-head)' }}>{tx('pos.automations_templates')}</div>
          <div style={{ fontSize: 12, color: 'var(--aps-muted)' }}>{tx('pos.reminder_recovery_automations_message_templates_are_11tx')}</div>
          <button onClick={() => nav('/tenant/communications/templates')} style={{ marginTop: 8, height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid var(--aps-line)', background: 'var(--aps-card)', fontSize: 12, cursor: 'pointer' }}>{tx('pos.open_templates')}</button>
        </div>
        <div style={{ ...card, padding: 14 }}>
          <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 8, fontFamily: 'var(--aps-font-head)' }}>{tx('pos.ai_communication_insights')}</div>
          <div style={{ fontSize: 12, color: 'var(--aps-muted)' }}>{tx('pos.best_time_to_send_lapsed_guest_8ekc')}</div>
        </div>
      </div>

      <div style={{ ...card, padding: 14 }}>
        <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 8, fontFamily: 'var(--aps-font-head)' }}>{tx('pos.quick_actions_2')}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {[
            { l: tx('pos.new_message'), fn: () => setSearch('') },
            { l: tx('pos.send_campaign'), fn: () => nav('/tenant/marketing/campaigns') },
            { l: tx('pos.schedule_reminder'), fn: () => setNote(tx('pos.reminder_scheduling_isn_t_connected_yet')) },
            { l: tx('pos.ai_receptionist'), fn: () => setNote(tx('pos.ai_receptionist_isn_t_connected_yet')) },
            { l: tx('pos.request_review'), fn: () => nav('/follow-ups') },
            { l: tx('pos.create_template'), fn: () => setNote(tx('pos.message_templates_aren_t_connected_yet')) },
            { l: tx('pos.view_reports'), fn: () => nav('/reports') },
          ].map((a) => <button key={a.l} onClick={a.fn} style={{ height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid var(--aps-line)', background: 'var(--aps-card)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>{a.l}</button>)}
        </div>
      </div>
    </div>
  );
}
