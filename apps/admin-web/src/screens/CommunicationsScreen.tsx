import { useEffect, useState } from 'react';
import { useEventCallback } from '@aipowersalon/ui';
import { useNavigate } from 'react-router-dom';
import { superAdminCommunicationsApi } from '../api/superAdminCommunicationsApi';
import { Donut, MiniBars, NotConnected } from './_chartkit';

// CommunicationsScreen.tsx — S12 Super Admin › Communications Hub. Every module wired to the REAL cross-tenant comms
// surface (GET /super-admin/communications/state): message KPIs (total + per-channel sent, delivery/response rate,
// customer replies) from communication_messages, a channel-performance donut, channel analytics (sent/delivered),
// the message queue (scheduled/pending/failed/draft by status), a unified inbox from communication_threads, an
// engagement-volume trend, and recent activity — all derived from real rows. Messages are empty in the seed → honest
// "no data yet" (proven to populate). Template performance, audience segmentation, automation flows, opt-out/bounce
// tracking & campaign rollups have no platform-wide schema → honest "not connected". Zero fabricated numbers.

type Thread = { id: string; tenantId?: string; customerName: string | null; customerContact?: string | null; channel: string; subject?: string | null; status: string; unreadCount: number; lastMessageAt: string | null; lastMessagePreview: string | null };
type State = {
  kpis: { totalThreads: number; openConversations: number; unreadThreads: number; unreadMessages: number; repliedThreads: number; missedThreads: number };
  messageKpis: { totalMessages: number; emailSent: number; smsSent: number; whatsappSent: number; callCount: number; deliveryRate: number; responseRate: number; customerReplies: number; outboundCount: number };
  threads: Thread[];
  byChannel?: { channel: string; count: number; unread: number }[];
  messageByChannel: { channel: string; count: number; delivered: number }[];
  channelAnalytics: { channel: string; sent: number; delivered: number; deliveryRate: number }[];
  queue: { scheduled: number; pending: number; failed: number; draft: number };
  engagementTrend: { date: string; count: number }[];
  recentActivity: { customerName: string; channel: string; preview: string; at: string | null; direction: string | null }[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
};

const CH_LABEL = (c: string) => ({ email: 'Email', sms: 'SMS', whatsapp: 'WhatsApp', call: 'Call', web_chat: 'Web Chat', social: 'Social' } as Record<string, string>)[c] || c;
const ago = (iso: string | null) => { if (!iso) return '—'; const d = (Date.now() - new Date(iso).getTime()) / 60000; if (d < 1) return 'now'; if (d < 60) return `${Math.floor(d)}m ago`; if (d < 1440) return `${Math.floor(d / 60)}h ago`; return new Date(iso).toLocaleDateString(); };

export function CommunicationsScreen() {
  const nav = useNavigate();
  const [st, setSt] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [channel, setChannel] = useState('');

  const load = useEventCallback(() => { (superAdminCommunicationsApi.getState({ pageSize: 100, ...(channel ? { channel } : {}), ...(q ? { search: q } : {}) }) as Promise<State>).then((d) => { setSt(d); setError(null); }).catch((e: any) => setError(e?.message || 'Failed to load communications.')); });
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [channel, load, q]);

  if (error) return <div className="screen"><div className="state">{error}</div></div>;
  if (!st) return <div className="screen"><div className="state">Loading communications…</div></div>;

  const m = st.messageKpis;
  const kpis = [
    { l: 'Total Messages', v: m.totalMessages.toLocaleString() },
    { l: 'Email Sent', v: m.emailSent.toLocaleString() },
    { l: 'SMS Sent', v: m.smsSent.toLocaleString() },
    { l: 'WhatsApp Sent', v: m.whatsappSent.toLocaleString() },
    { l: 'Delivery Rate', v: `${m.deliveryRate}%` },
    { l: 'Response Rate', v: `${m.responseRate}%` },
  ];
  const allChannels = (st.byChannel || []).map((c) => c.channel).filter(Boolean);

  return (
    <div className="screen p-5" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="flex flex-col md:flex-row gap-3 justify-between" >
        <div className="vh"><h1>Communications Hub</h1><div className="sub">Manage all customer communications, campaigns & conversations across all tenants.</div></div>
        <div style={{ display: 'flex', gap: 8 }}><button className="btn ghost" onClick={() => nav('/communications')}>Export Report</button><button className="btn" onClick={() => nav('/marketing-campaigns')}>New Campaign</button></div>
      </div>

      <div className="kpis">{kpis.map((kp) => (<div className="kpi" key={kp.l}><div className="l">{kp.l}</div><div className="v">{kp.v}</div></div>))}</div>

      {/* channel performance · overview · engagement trend */}
      <div className="grid3">
        <section className="panel">
          <h2>Message Channel Performance</h2>
          <Donut data={st.messageByChannel.map((c) => ({ label: CH_LABEL(c.channel), value: c.count }))} centerLabel={m.totalMessages ? m.totalMessages.toLocaleString() : ''} />
        </section>
        <section className="panel">
          <h2>Communication Overview</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12.5 }}>
            <div className="arow" style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Customer replies</span><b>{m.customerReplies.toLocaleString()}</b></div>
            <div className="arow" style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Outbound sent</span><b>{m.outboundCount.toLocaleString()}</b></div>
            <div className="arow" style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Open conversations</span><b>{st.kpis.openConversations}</b></div>
            <div className="arow" style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Campaigns sent</span><b title="Lives in Marketing & Campaigns">—</b></div>
            <div className="arow" style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Opt-outs / bounce</span><b title="No opt-out/bounce tracking table">—</b></div>
          </div>
          <div className="muted" style={{ fontSize: 10.5, marginTop: 8 }}>Templates, opt-out & bounce tracking — <NotConnected />.</div>
        </section>
        <section className="panel">
          <h2>Engagement Trend</h2>
          <MiniBars data={st.engagementTrend.map((d) => ({ label: d.date.slice(5), value: d.count, tip: `${d.count} messages on ${d.date}` }))} emptyHint="No message volume yet — populates as messages send." />
          <div className="muted" style={{ fontSize: 10.5, marginTop: 8 }}>Daily message volume. Open/click-rate tracking isn’t modelled — <NotConnected />.</div>
        </section>
      </div>

      {/* unified inbox + message queue */}
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section className="panel">
          <div className="phead"><h2>Unified Inbox <span className="muted">({st.pagination.totalItems})</span></h2>
            <div style={{ display: 'flex', gap: 6 }}>
              <select className="inp" style={{ height: 30, padding: '0 8px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }} value={channel} onChange={(e) => setChannel(e.target.value)}><option value="">All</option>{allChannels.map((c) => <option key={c} value={c}>{CH_LABEL(c)}</option>)}</select>
              <input className="inp" style={{ width: 160, height: 30, padding: '0 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }} placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
          {st.threads.length === 0 ? <div className="state">No conversations on the platform yet. Customer messages across tenants will appear here.</div> : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {st.threads.slice(0, 40).map((t) => (
                <div key={t.id} className="arow" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 4px', borderBottom: '1px solid var(--line,#f0f0f0)', cursor: 'pointer' }} onClick={() => t.tenantId && nav(`/tenants/${t.tenantId}`)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ fontWeight: 600 }}>{t.customerName || t.customerContact || 'Unknown'}</span>{t.unreadCount > 0 ? <span className="pill" style={{ background: '#C77A2A', color: '#fff' }}>{t.unreadCount}</span> : null}</div>
                    <div className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.lastMessagePreview || t.subject || '—'}</div>
                  </div>
                  <span className="pill">{CH_LABEL(t.channel)}</span>
                  <span className="muted" style={{ fontSize: 11, width: 60, textAlign: 'right' }}>{ago(t.lastMessageAt)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="panel">
          <h2>Message Queue</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
            {[{ l: 'Scheduled Messages', v: st.queue.scheduled, tone: '' }, { l: 'Pending Approvals', v: st.queue.pending, tone: 'warn' }, { l: 'Failed Messages', v: st.queue.failed, tone: 'warn' }, { l: 'Draft Messages', v: st.queue.draft, tone: '' }].map((row) => (
              <div key={row.l} className="arow" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 10px', border: '1px solid var(--line)', borderRadius: 10 }}>
                <span style={{ fontWeight: 600, fontSize: 12.5 }}>{row.l}</span>
                <span className={'pill ' + row.tone} style={{ fontSize: 13 }}>{row.v}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* channel analytics · recent campaigns · top templates */}
      <div className="grid3">
        <section className="panel">
          <h2>Channel Analytics</h2>
          {st.channelAnalytics.length === 0 ? <div className="state" style={{ fontSize: 12 }}>No channel data yet.</div> : (
            <table className="tgrid" style={{ width: '100%', fontSize: 12 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5 }}><th>Channel</th><th>Sent</th><th>Delivered</th><th>Rate</th></tr></thead>
              <tbody>{st.channelAnalytics.map((c, i) => (<tr key={i}><td style={{ fontWeight: 600 }}>{CH_LABEL(c.channel)}</td><td className="muted">{c.sent.toLocaleString()}</td><td className="muted">{c.delivered.toLocaleString()}</td><td><span className="pill ok">{c.deliveryRate}%</span></td></tr>))}</tbody>
            </table>
          )}
        </section>
        <section className="panel">
          <h2>Recent Campaigns</h2>
          <div className="state" style={{ fontSize: 12, lineHeight: 1.5 }}>Campaign sends live in the Marketing & Campaigns module. <NotConnected />.</div>
          <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => nav('/marketing-campaigns')}>Open Marketing & Campaigns</button>
        </section>
        <section className="panel">
          <h2>Top Performing Templates</h2>
          <div className="state" style={{ fontSize: 12, lineHeight: 1.5 }}>Template usage & open/click performance need a message-template schema, which isn’t modelled. <NotConnected />.</div>
        </section>
      </div>

      {/* audience segmentation · automation · recent activity */}
      <div className="grid3">
        <section className="panel">
          <h2>Audience Segmentation</h2>
          <div className="state" style={{ fontSize: 12, lineHeight: 1.5 }}>Per-segment open/click analytics need a customer-segment schema, which isn’t modelled. <NotConnected />.</div>
        </section>
        <section className="panel">
          <h2>Communication Automation</h2>
          <div className="state" style={{ fontSize: 12, lineHeight: 1.5 }}>Automation flows (welcome series, reminders, re-engagement) need an automation schema, which isn’t modelled. <NotConnected />.</div>
        </section>
        <section className="panel">
          <h2>Recent Activity</h2>
          {st.recentActivity.length === 0 ? <div className="state" style={{ fontSize: 12 }}>No recent activity.</div> : st.recentActivity.map((a, i) => (
            <div key={i} style={{ padding: '6px 0', fontSize: 12, borderBottom: '1px solid var(--line,#f0f0f0)' }}>
              <div><b>{a.customerName}</b> <span className="muted">· {CH_LABEL(a.channel)} · {a.direction === 'inbound' ? 'received' : 'sent'}</span></div>
              <div className="muted" style={{ fontSize: 10.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.preview || '—'} · {ago(a.at)}</div>
            </div>
          ))}
        </section>
      </div>

      <section className="panel">
        <h2>Quick Actions</h2>
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
          {[{ l: 'Marketing & Campaigns', to: '/marketing-campaigns' }, { l: 'Promotions & Offers', to: '/promotions-offers' }, { l: 'Smart Reminders', to: '/smart-reminders' }, { l: 'Automation Rules', to: '/automation-rules' }, { l: 'Analytics', to: '/analytics' }, { l: 'AI Reports', to: '/ai-reports' }].map((a) => <button key={a.l} className="qbtn" onClick={() => nav(a.to)}>{a.l}</button>)}
        </div>
      </section>

      {/* bottom stat strip */}
      <div className="grid gap-2 grid-cols-1 pb-7 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        <div className="kpi"><div className="l">Total Messages</div><div className="v">{m.totalMessages.toLocaleString()}</div></div>
        <div className="kpi"><div className="l">Delivery Rate</div><div className="v">{m.deliveryRate}%</div></div>
        <div className="kpi"><div className="l">Response Rate</div><div className="v">{m.responseRate}%</div></div>
        <div className="kpi"><div className="l">Active Automations</div><div className="v" title="No automation table">—</div></div>
        <div className="kpi"><div className="l">Total Campaigns</div><div className="v" title="Lives in Marketing">—</div></div>
      </div>
    </div>
  );
}
