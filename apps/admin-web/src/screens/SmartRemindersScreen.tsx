import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { superAdminApi } from '../api/superAdminApi';
import { Donut, MiniBars, Gauge, NotConnected } from './_chartkit';

// SmartRemindersScreen.tsx — S15 Super Admin › Smart Reminders. Platform-wide reminder operations from
// GET /super-admin/platform/reminders (notification_delivery_logs ⋈ tenants + reminder_settings + appointment_reminders_sent):
// REAL & wired — appointment reminders sent, delivery rate, delivered/failed counts, channel mix & delivery-status
// breakdowns, a daily delivery trend, reminder-configuration adoption by channel, and the full delivery-log feed with a
// failed-send review filter. All three tables are empty in the seed → honest "no data yet" (proven to populate). NB the
// platform's notification channels are sms / email / push only — the mockup's WhatsApp & Phone-AI aren't modelled
// channels, so the channel mix shows the real supported set. Predictive send-time, no-show prediction, response/
// confirmation attribution, a forward "today's queue", segment-response analytics & AI insight cards aren't
// implemented — each is an honest "not connected" gap, not an invented number.

type Row = { id: string; channel: string; template: string | null; targetMasked: string | null; status: string; errorMessage: string | null; createdAt: string; tenantId: string; tenantName: string | null };
type State = {
  rows: Row[]; total: number;
  kpis: { appointmentRemindersSent: number; remindersSentThisMonth: number; tenantsConfigured: number; remindersEnabled: number; avgLeadMinutes: number; deliveryLogs: number; delivered: number; failed: number; deliveryRate: number };
  byChannel: { channel: string; count: number }[];
  byStatus: { status: string; count: number }[];
  settingsByChannel: { channel: string; count: number }[];
  byDay: { date: string; count: number; delivered: number }[];
};

const cap = (s: string) => (s ? s.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : '—');
const CH = (s: string) => ({ sms: 'SMS', email: 'Email', push: 'Push' } as Record<string, string>)[s] || s.toUpperCase();
const statusTone = (s: string) => { const v = (s || '').toLowerCase(); return ['delivered', 'sent', 'ok'].includes(v) ? 'ok' : ['failed', 'error', 'bounced'].includes(v) ? 'warn' : ''; };
const leadLabel = (m: number) => (m >= 1440 ? `${Math.round(m / 1440)}d` : m >= 60 ? `${Math.round(m / 60)}h` : `${m}m`);
const dt = (iso: string | null) => { if (!iso) return '—'; try { return new Date(iso).toLocaleString(); } catch { return String(iso); } };
const ago = (iso: string | null) => { if (!iso) return '—'; const d = (Date.now() - new Date(iso).getTime()) / 60000; if (d < 1) return 'now'; if (d < 60) return `${Math.floor(d)}m ago`; if (d < 1440) return `${Math.floor(d / 60)}h ago`; return new Date(iso).toLocaleDateString(); };

export function SmartRemindersScreen() {
  const nav = useNavigate();
  const [st, setSt] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [channel, setChannel] = useState('');
  const [status, setStatus] = useState('');

  const load = () => { (superAdminApi.platformReminders({ pageSize: 100, ...(channel ? { channel } : {}), ...(status ? { status } : {}), ...(q ? { search: q } : {}) }) as Promise<State>).then((d) => { setSt(d); setError(null); }).catch((e: any) => setError(e?.message || 'Failed to load reminders.')); };
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [channel, status, q]);

  if (error) return <div className="screen"><div className="state">{error}</div></div>;
  if (!st) return <div className="screen"><div className="state">Loading reminders…</div></div>;

  const k = st.kpis; const NC = '— ';
  const kpis = [
    { l: 'Total Reminders Sent', v: k.appointmentRemindersSent.toLocaleString() },
    { l: 'Delivery Rate', v: k.deliveryLogs ? `${k.deliveryRate}%` : NC, t: k.deliveryLogs ? undefined : 'No delivery logs yet' },
    { l: 'Response Rate', v: NC, t: 'No response/confirmation tracking on delivery logs' },
    { l: 'Confirmed Appointments', v: NC, t: 'No reminder→confirmation link' },
    { l: 'No-Show Prevention', v: NC, t: 'No no-show model' },
    { l: 'Rebooking Conversions', v: NC, t: 'No rebooking attribution' },
    { l: 'Active Automations', v: k.remindersEnabled.toLocaleString() },
    { l: 'Revenue Influenced', v: NC, t: 'No revenue attribution' },
  ];
  const allChannels = st.byChannel.map((c) => c.channel).filter(Boolean);
  const allStatuses = st.byStatus.map((s) => s.status).filter(Boolean);

  return (
    <div className="screen" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className='flex flex-col xl:flex-row justify-between gap-3'>
        <div className="vh"><h1>Smart Reminders</h1><div className="sub">AI-powered appointment reminders, rebooking prompts, follow-ups, birthday messages & no-show prevention across all branches.</div></div>
        <div className="items-baseline" style={{ display: 'flex', gap: 8 }}><button className="btn ghost" onClick={() => nav('/smart-reminders')}>Export Report</button><button className="btn" onClick={() => nav('/smart-reminders')}>Create Reminder</button></div>
      </div>

      <div className="kpis grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2">{kpis.map((c) => (<div className="kpi" key={c.l}><div className="l">{c.l}</div><div className="v" title={(c as any).t}>{c.v}</div></div>))}</div>

      {/* performance · channel mix · health */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <section className="panel">
          <h2>Reminder Performance Overview</h2>
          <MiniBars data={st.byDay.map((d) => ({ label: d.date.slice(5), value: d.count, tip: `${d.count} sent · ${d.delivered} delivered (${d.date})` }))} emptyHint="No reminder deliveries yet — populates from notification_delivery_logs." />
          <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>Total sent <b>{k.appointmentRemindersSent.toLocaleString()}</b> · delivered <b>{k.delivered.toLocaleString()}</b> · delivery rate <b>{k.deliveryLogs ? `${k.deliveryRate}%` : '—'}</b> · failed <b>{k.failed.toLocaleString()}</b></div>
        </section>
        <section className="panel">
          <h2>Reminder Channel Mix</h2>
          <Donut data={st.byChannel.map((c) => ({ label: CH(c.channel), value: c.count }))} centerLabel={k.deliveryLogs ? k.deliveryLogs.toLocaleString() : ''} />
          <div className="muted" style={{ fontSize: 10.5, marginTop: 6 }}>Supported channels: SMS, Email, Push. WhatsApp & Phone-AI aren’t modelled channels — <NotConnected />.</div>
        </section>
        <section className="panel">
          <h2>AI Reminder Health</h2>
          <Gauge pct={k.deliveryRate} label="Deliverability (live telemetry)" />
          <div className="kpis" style={{ gridTemplateColumns: 'repeat(2,1fr)', gap: 6, marginTop: 8 }}>
            <div className="kpi"><div className="l">Deliverability</div><div className="v">{k.deliveryLogs ? `${k.deliveryRate}%` : '—'}</div></div>
            <div className="kpi"><div className="l">Engagement</div><div className="v" title="No engagement model">—</div></div>
            <div className="kpi"><div className="l">AI Accuracy</div><div className="v" title="No ML">—</div></div>
            <div className="kpi"><div className="l">Opt-out Rate</div><div className="v" title="No opt-out tracking here">—</div></div>
          </div>
        </section>
      </div>

      {/* scheduled flows · today's queue · recent activity */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <section className="panel">
          <h2>Scheduled Reminder Flows</h2>
          {st.settingsByChannel.length === 0 ? <div className="state" style={{ fontSize: 12 }}>No reminder flows configured yet.</div> : (
            <table className="tgrid" style={{ width: '100%', fontSize: 12 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5 }}><th>Channel</th><th>Enabled Tenants</th><th>Avg Lead</th></tr></thead>
              <tbody>{st.settingsByChannel.map((c, i) => (<tr key={i}><td style={{ fontWeight: 600 }}>{CH(c.channel)}</td><td><span className="pill ok">{c.count}</span></td><td className="muted">{k.avgLeadMinutes ? leadLabel(k.avgLeadMinutes) : '—'}</td></tr>))}</tbody>
            </table>
          )}
          <div className="muted" style={{ fontSize: 10.5, marginTop: 8 }}>Flow config is real. Per-flow delivery % & AI scores need an ML layer — <NotConnected />.</div>
        </section>
        <section className="panel">
          <h2>Today’s Reminder Queue</h2>
          <div className="state" style={{ fontSize: 12, lineHeight: 1.5 }}>A forward-looking send queue (scheduled-today counts by type) needs a reminder-queue/scheduler table. Delivery history is shown in the log below; the upcoming queue is <NotConnected />.</div>
        </section>
        <section className="panel">
          <h2>Recent Reminder Activity</h2>
          {st.rows.length === 0 ? <div className="state" style={{ fontSize: 12 }}>No recent reminder activity.</div> : st.rows.slice(0, 6).map((r) => (
            <div key={r.id} style={{ padding: '6px 0', fontSize: 12, borderBottom: '1px solid var(--line,#f0f0f0)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><b>{cap(r.template || '—')}</b><span className={'pill ' + statusTone(r.status)} style={{ marginLeft: 'auto', fontSize: 10 }}>{cap(r.status)}</span></div>
              <div className="muted" style={{ fontSize: 10.5 }}>{CH(r.channel)} · {r.tenantName || '—'} · {ago(r.createdAt)}</div>
            </div>
          ))}
        </section>
      </div>

      {/* REAL: full delivery log + failed-send review */}
      <section className="panel">
        <div className="phead"><h2>Reminder Delivery Log <span className="muted">({st.total})</span></h2>
          <div style={{ display: 'flex', gap: 6 }}>
            <select className="inp" style={{ height: 30, padding: '0 8px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }} value={channel} onChange={(e) => setChannel(e.target.value)}><option value="">All Channels</option>{allChannels.map((c) => <option key={c} value={c}>{CH(c)}</option>)}</select>
            <select className="inp" style={{ height: 30, padding: '0 8px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All Statuses</option>{allStatuses.map((s) => <option key={s} value={s}>{cap(s)}</option>)}<option value="failed">Failed (review)</option></select>
            <input className="inp" style={{ width: 160, height: 30, padding: '0 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }} placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        {st.rows.length === 0 ? <div className="state">No reminder deliveries on the platform yet. Sent reminders & notifications will appear here.</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tgrid" style={{ width: '100%', fontSize: 12.5, minWidth: 680 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11 }}><th>Template</th><th>Tenant</th><th>Channel</th><th>Target</th><th>Status</th><th>Sent</th></tr></thead>
              <tbody>
                {st.rows.slice(0, 60).map((r) => (
                  <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/tenants/${r.tenantId}`)}>
                    <td style={{ fontWeight: 600 }}>{cap(r.template || '—')}</td>
                    <td className="muted">{r.tenantName || '—'}</td>
                    <td><span className="pill">{CH(r.channel)}</span></td>
                    <td className="muted" style={{ fontFamily: 'monospace', fontSize: 11.5 }}>{r.targetMasked || '—'}</td>
                    <td><span className={'pill ' + statusTone(r.status)}>{cap(r.status)}</span>{r.errorMessage ? <span className="muted" style={{ fontSize: 10, marginLeft: 4 }}>{r.errorMessage.slice(0, 24)}</span> : null}</td>
                    <td className="muted">{dt(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {st.total > 60 ? <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>Showing first 60 of {st.total}. Refine to narrow.</div> : null}
          </div>
        )}
      </section>

      {/* segment response · AI insights · quick actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <section className="panel"><h2>Customer Segment Response</h2><div className="state" style={{ fontSize: 12, lineHeight: 1.5 }}>Per-segment reminder response rates need response tracking & a segment model, which aren’t built. <NotConnected />.</div></section>
        <section className="panel"><h2>AI Reminder Insights</h2><div className="state" style={{ fontSize: 12, lineHeight: 1.5 }}>Best send-time, no-show-risk & rebooking-likelihood insights need the ML layer, which isn’t built. <NotConnected />.</div></section>
        <section className="panel">
          <h2>Quick Actions</h2>
          <div className="qgrid">
            {[{ l: 'Communications', to: '/communications' }, { l: 'Automation Rules', to: '/automation-rules' }, { l: 'Campaigns', to: '/marketing-campaigns' }, { l: 'Appointments', to: '/appointments' }, { l: 'Analytics', to: '/analytics' }, { l: 'AI Insights', to: '/ai-insights' }].map((a) => <button key={a.l} className="qbtn" onClick={() => nav(a.to)}>{a.l}</button>)}
          </div>
        </section>
      </div>

      {/* bottom stat strip */}
      <div className="kpis grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
        <div className="kpi"><div className="l">Active Flows</div><div className="v">{k.remindersEnabled}</div></div>
        <div className="kpi"><div className="l">Reminders Sent</div><div className="v">{k.appointmentRemindersSent.toLocaleString()}</div></div>
        <div className="kpi"><div className="l">Delivered</div><div className="v">{k.delivered.toLocaleString()}</div></div>
        <div className="kpi"><div className="l">Failed Sends</div><div className="v" style={k.failed > 0 ? { color: '#B85B4D' } : undefined}>{k.failed.toLocaleString()}</div></div>
        <div className="kpi"><div className="l">Delivery Health</div><div className="v">{k.deliveryLogs ? `${k.deliveryRate}%` : '—'}</div></div>
        <div className="kpi"><div className="l">Rebooking Rate</div><div className="v" title="No rebooking attribution">—</div></div>
      </div>
    </div>
  );
}
