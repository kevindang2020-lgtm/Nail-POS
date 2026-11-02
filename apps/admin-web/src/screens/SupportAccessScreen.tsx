import { useCallback, useEffect, useRef, useState } from 'react';
import { superAdminSupportApi, type SupportOverview } from '../api/superAdminSupportApi';
import { Donut, AreaLine, NotConnected } from './_chartkit';
import { superAdminApi } from '../api/superAdminApi';
import { ActiveSupportSessions } from '../components/ActiveSupportSessions';

// SupportAccessScreen — Super Admin › Support › Support Center. Full tenant-support + technical-incident oversight over
// the real support_tickets / support_access_sessions / help_articles via GET /super-admin/support/overview. Controlled
// support mode is audited + time-limited (never unrestricted impersonation). Read/oversight dashboard; write actions
// (create ticket, start support mode) wire to audited endpoints in the next unit.

const GOLD = 'var(--g7,#A96F22)';
const TITLE = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const num = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString());
const ago = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const TONE: Record<string, { bg: string; fg: string }> = {
  critical: { bg: '#F7E4E4', fg: '#B84A3D' }, urgent: { bg: '#F7E4E4', fg: '#B84A3D' }, high: { bg: '#FBECDD', fg: '#C0722A' }, normal: { bg: '#EEEDF0', fg: '#6B6B72' }, medium: { bg: '#FBF1DC', fg: '#B7841F' }, low: { bg: '#EEEDF0', fg: '#6B6B72' },
  on_track: { bg: '#E4F0E8', fg: '#3E8F57' }, near_breach: { bg: '#FBF1DC', fg: '#B7841F' }, breached: { bg: '#F7E4E4', fg: '#B84A3D' }, paused: { bg: '#E2EEF7', fg: '#3C7FB6' }, not_applicable: { bg: '#EEEDF0', fg: '#6B6B72' },
  open: { bg: '#E2EEF7', fg: '#3C7FB6' }, assigned: { bg: '#EFE7F7', fg: '#7A5AA6' }, in_progress: { bg: '#E2EEF7', fg: '#3C7FB6' }, waiting_customer: { bg: '#FBF1DC', fg: '#B7841F' }, escalated: { bg: '#F7E4E4', fg: '#B84A3D' }, resolved: { bg: '#E4F0E8', fg: '#3E8F57' },
  Active: { bg: '#E2EEF7', fg: '#3C7FB6' }, Completed: { bg: '#E4F0E8', fg: '#3E8F57' }, Expired: { bg: '#EEEDF0', fg: '#6B6B72' }, Revoked: { bg: '#F7E4E4', fg: '#B84A3D' },
  draft: { bg: '#FBF1DC', fg: '#B7841F' }, published: { bg: '#E4F0E8', fg: '#3E8F57' }, in_review: { bg: '#E2EEF7', fg: '#3C7FB6' }, archived: { bg: '#EEEDF0', fg: '#6B6B72' },
};
function Pill({ label }: { label: string }) { const t = TONE[label] ?? TONE[label.toLowerCase()] ?? { bg: '#EEEDF0', fg: '#6B6B72' }; return <span style={{ background: t.bg, color: t.fg, fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 20, whiteSpace: 'nowrap' }}>{TITLE(label)}</span>; }

const CONTROLS: [string, string][] = [
  ['Create Tickets', 'Create a new support ticket.'], ['Assign Tickets', 'Assign selected tickets to support agents.'],
  ['Change Priority', 'Update ticket priority with a reason.'], ['Communicate', 'Send tenant-visible support messages.'],
  ['Attach Logs', 'Upload approved logs and files.'], ['Link Transactions', 'Link authorized devices, transactions, or records.'],
  ['Escalate Issues', 'Escalate technical or operational incidents.'], ['Start Support Mode', 'Enter controlled, time-limited tenant access.'],
  ['Record Resolution', 'Document the final resolution and corrective action.'], ['KB Articles', 'Create and manage knowledge-base articles.'],
  ['Performance', 'Review support performance and SLA metrics.'],
];
const SUPPORT_MODE_STEPS: [string, string][] = [
  ['Select Tenant', 'Choose the tenant and branch to support.'], ['Provide Support Reason', 'Specify the reason and related ticket.'],
  ['Choose Allowed Access Level', 'Define permissions and data access.'], ['Start Time-Limited Session', 'Set duration and begin the session.'],
  ['Display Visible Support-Mode Banner', 'Clearly show that support mode is active.'], ['Record Every Action in Audit Logs', 'All actions are recorded automatically.'],
  ['Automatically End Session', 'Session ends and access is revoked.'],
];
const QUICK_ACTIONS = ['Open Ticket', 'Start Support Mode', 'Assign Agent', 'Upload Logs', 'Create KB Article', 'Export Report'];

export function SupportAccessScreen() {
  const [d, setD] = useState<SupportOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [fCat, setFCat] = useState(''); const [fPriority, setFPriority] = useState(''); const [fSla, setFSla] = useState('');
  const flashT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = useCallback((m: string) => { setFlash(m); if (flashT.current) clearTimeout(flashT.current); flashT.current = setTimeout(() => setFlash(null), 4000); }, []);

  const load = useCallback((params?: { category?: string; priority?: string; slaStatus?: string }) => {
    superAdminSupportApi.dashboard(params).then((r) => { setD(r); setError(null); }).catch((e: any) => setError(e?.message || 'Failed to load Support Center.'));
  }, []);
  useEffect(load, [load]);
  const [createOpen, setCreateOpen] = useState(false);
  const [supportModeOpen, setSupportModeOpen] = useState(false);
  const createTicket = useCallback(async (input: { tenantId: string; branchId?: string; subject: string; description?: string; category?: string; priority?: string }) => {
    try {
      const r = await superAdminSupportApi.createTicket(input);
      if (r.ok) { setCreateOpen(false); say(`Ticket ${r.ticket?.ticketNumber ?? ''} created for the tenant (audited).`); load(); }
      else say(r.error === 'tenant_required' ? 'A valid tenant is required.' : r.error === 'subject_required' ? 'A subject is required.' : r.error === 'invalid_branch' ? 'That branch id is invalid.' : 'Could not create the ticket.');
    } catch { say('Could not create the ticket.'); }
  }, [say, load]);

  const [detail, setDetail] = useState<import('../api/superAdminSupportApi').SupportTicketDetail | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const openTicket = useCallback(async (id: string) => {
    setDetailId(id); setDetail(null);
    try { const r = await superAdminSupportApi.ticketDetail(id); setDetail(r); } catch { say('Could not open the ticket.'); setDetailId(null); }
  }, [say]);
  const refreshDetail = useCallback(async (id: string) => { try { setDetail(await superAdminSupportApi.ticketDetail(id)); } catch { /* keep */ } }, []);
  const replyTicket = useCallback(async (id: string, body: string) => {
    try { const r = await superAdminSupportApi.reply(id, body); if (r.ok) { await refreshDetail(id); say('Reply sent (recorded as an agent message).'); } else say('Could not send the reply.'); }
    catch { say('Could not send the reply.'); }
  }, [say, refreshDetail]);
  const changeTicketStatus = useCallback(async (id: string, to: string) => {
    try { const r = await superAdminSupportApi.setTicketStatus(id, to); if (r.ok) { await refreshDetail(id); load(); say(`Ticket moved to ${to.replace(/_/g, ' ')} (audited).`); } else say(r.error === 'invalid_transition' ? `Can't move the ticket to ${to.replace(/_/g, ' ')} from its current status.` : 'Could not change status.'); }
    catch { say('Could not change status.'); }
  }, [say, refreshDetail, load]);
  const addInternalNote = useCallback(async (id: string, body: string) => {
    try { const r = await superAdminSupportApi.addInternalNote(id, body); if (r.ok) { await refreshDetail(id); say('Internal note added (not visible to the tenant).'); } else say('Could not add the note.'); }
    catch { say('Could not add the note.'); }
  }, [say, refreshDetail]);


  const queue = d?.queue ?? [];

  if (error) return <div className="screen"><div className="state" role="alert">{error} <button className="linkbtn" onClick={() => load()}>Retry</button></div></div>;
  if (!d) return <div className="screen"><div className="state" style={{ padding: 28 }}>Loading Support Center…</div></div>;

  const k = d.kpis;
  const kpis = [
    { l: 'Open Tickets', v: num(k.openTickets) }, { l: 'Urgent Tickets', v: num(k.urgentTickets), warn: k.urgentTickets > 0 },
    { l: 'Assigned Tickets', v: num(k.assignedTickets) }, { l: 'Waiting-for-Customer', v: num(k.waitingForCustomer) },
    { l: 'Resolved Today', v: num(k.resolvedToday) }, { l: 'SLA Breaches', v: num(k.slaBreaches), warn: k.slaBreaches > 0 },
    { l: 'Audited Sessions', v: num(k.auditedSessions) }, { l: 'Knowledge Articles', v: num(k.knowledgeArticles) },
    { l: 'Ticket CSAT', v: k.ticketCsat == null ? '—' : `${k.ticketCsat} / 5` }, { l: 'Avg First Response', v: k.avgFirstResponseMin == null ? '—' : `${k.avgFirstResponseMin} min` },
  ];

  return (
    <div className="screen" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="flex flex-col lg:flex-row justify-between gap-3" >
        <div>
          <h1 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 26, display: 'flex', alignItems: 'center', gap: 8 }}>Support Center <span style={{ color: GOLD }} aria-hidden>★</span></h1>
          <div className="sub" style={{ color: 'var(--muted)', fontSize: 13 }}>Manages tenant support, technical incidents, requests, and controlled account assistance.</div>
        </div>
        <div className="self-baseline flex-wrap" style={{ display: 'flex', gap: 8 }}>
          <button className="btn ghost" onClick={() => say('Preparing a support report export with the current filters (audited).')}>Export Support Report</button>
          <button className='btn' onClick={() => setCreateOpen(true)}>+ Create Ticket</button>
        </div>
      </div>

      {/* WHO HAS ACCESS RIGHT NOW — and the button that takes it away.
          A session could be STARTED and never seen or ended. "It auto-expires" is not a revocation story. */}
      <ActiveSupportSessions onChanged={say} />

      {/* support-mode info banner */}
      <div role="note" style={{ display: 'flex', gap: 8, alignItems: 'center', background: '#EAF2FB', border: '1px solid #C6DBF2', color: '#2F5D86', borderRadius: 10, padding: '9px 12px', fontSize: 12.5 }}>
        <span aria-hidden>ⓘ</span> Support sessions must be time-limited, reason-based, visibly labeled, and fully recorded in Audit Logs.
      </div>
      {flash ? <div role="status" style={{ fontSize: 12.5, color: GOLD, background: 'var(--cream,#FBF6EC)', border: '1px solid #E7D6B8', borderRadius: 10, padding: '7px 12px' }}>{flash}</div> : null}

      {/* 10 KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-10 gap-2">
        {kpis.map((c) => (
          <div key={c.l} style={{ background: 'var(--card,#fff)', border: '1px solid var(--line,#eee)', borderRadius: 12, padding: '11px 9px' }}>
            <div style={{ fontSize: 9.5, color: 'var(--muted)', fontWeight: 700 }}>{c.l}</div>
            <div style={{ fontFamily: 'Playfair Display, serif', fontSize: 17, marginTop: 4, color: c.warn ? '#B84A3D' : undefined }}>{c.v}</div>
          </div>
        ))}
      </div>

      {/* 8 filters */}
      <div className="bg-[var(--card,#fff)] border border-[var(--line,#eee)] rounded-xl p-3 flex flex-wrap items-end gap-3">
        <label className="flex gap-2 whitespace-nowrap items-center"><span className="flabel font-semibold ">Tenant</span><select style={inp} disabled><option>All Tenants</option></select></label>
        <label className="flex gap-2 whitespace-nowrap items-center"><span className="flabel font-semibold ">Branch</span><select style={inp} disabled><option>All Branches</option></select></label>
        <label className="flex gap-2 whitespace-nowrap items-center"><span className="flabel font-semibold ">Issue Category</span><select value={fCat} onChange={(e) => setFCat(e.target.value)} style={inp}><option value="">All Categories</option>{[...new Set(d.queue.map((r) => r.category))].map((c) => <option key={c} value={c}>{TITLE(c)}</option>)}</select></label>
        <label className="flex gap-2 whitespace-nowrap items-center"><span className="flabel font-semibold ">Priority</span><select value={fPriority} onChange={(e) => setFPriority(e.target.value)} style={inp}><option value="">All Priorities</option>{['critical', 'urgent', 'high', 'normal', 'low'].map((p) => <option key={p} value={p}>{TITLE(p)}</option>)}</select></label>
        <label className="flex gap-2 whitespace-nowrap items-center"><span className="flabel font-semibold ">SLA Status</span><select value={fSla} onChange={(e) => setFSla(e.target.value)} style={inp}><option value="">All Statuses</option>{['on_track', 'near_breach', 'breached', 'paused', 'not_applicable'].map((s) => <option key={s} value={s}>{TITLE(s)}</option>)}</select></label>
        <label className="flex gap-2 whitespace-nowrap items-center"><span className="flabel font-semibold ">Assigned Agent</span><select style={inp} disabled><option>All Agents</option></select></label>
        <label className="flex gap-2 whitespace-nowrap items-center"><span className="flabel font-semibold ">Support Mode</span><select style={inp} disabled><option>All Modes</option></select></label>
        <label className="flex gap-2 whitespace-nowrap items-center"><span className="flabel font-semibold ">Date Range</span><input disabled value="Last 7 days" style={{ ...inp, opacity: 0.7 }} /></label>
        <button className='btn !h-9 !min-h-9 flex items-center' onClick={() => { load({ category: fCat || undefined, priority: fPriority || undefined, slaStatus: fSla || undefined }); say('Filters applied to the Open Support Queue (server-side).'); }}>Apply Filters</button>
        <button className="btn ghost !h-9 !min-h-9 flex items-center" onClick={() => { setFCat(''); setFPriority(''); setFSla(''); load(); }}>Reset Filters</button>
      </div>

      {/* 11 Support Controls */}
      <section style={{ background: 'var(--card,#fff)', border: '1px solid var(--line,#eee)', borderRadius: 12, padding: 12 }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 14 }}>Support Controls</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-11 gap-2">
          {CONTROLS.map(([t, desc]) => (
            <button key={t} onClick={() => (t === 'Create Tickets' ? setCreateOpen(true) : t === 'Start Support Mode' ? setSupportModeOpen(true) : say(`Opening: ${t}`))} style={{ textAlign: 'left', background: 'var(--cream,#FBF6EC)', border: '1px solid #EFE3CB', borderRadius: 10, padding: '8px 7px', cursor: 'pointer' }}>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--ink,#3a3a3a)' }}>{t}</div>
              <div className="muted" style={{ fontSize: 8, marginTop: 2 }}>{desc}</div>
            </button>
          ))}
        </div>
      </section>

      {/* Open Support Queue + Controlled Support Mode */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)] gap-3.5">
        <Panel title="Open Support Queue">
          <Table head={['Ticket', 'Tenant', 'Branch', 'Category', 'Priority', 'Assigned', 'SLA', 'Device', 'Txn', 'Updated', 'Status']}
            rows={queue.map((r) => [<button className="linkbtn" style={{ fontSize: 10.5, fontWeight: 700 }} onClick={() => openTicket(r.id)}>{r.ticketNumber}</button>, r.tenant ?? '—', r.branch ?? '—', TITLE(r.category), <Pill label={r.priority} />, r.assignedTo ?? '—', <Pill label={r.slaStatus} />, r.relatedDevice ?? '—', r.relatedTransaction ?? '—', ago(r.lastUpdate), <Pill label={r.status} />])}
            empty="No tickets match the filters." />
        </Panel>
        <Panel title="Controlled Support Mode">
          <ol style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
            {SUPPORT_MODE_STEPS.map(([t, desc], i) => (
              <li key={t} style={{ display: 'flex', gap: 8, padding: '6px 0', borderTop: i ? '1px solid var(--line,#eee)' : 'none' }}>
                <span style={{ flexShrink: 0, width: 20, height: 20, borderRadius: '50%', background: 'var(--cream,#FBF6EC)', border: '1px solid #EFE3CB', color: GOLD, fontSize: 10.5, fontWeight: 700, display: 'grid', placeItems: 'center' }}>{i + 1}</span>
                <span><span style={{ fontSize: 11.5, fontWeight: 700 }}>{t}</span><br /><span className="muted" style={{ fontSize: 10 }}>{desc}</span></span>
              </li>
            ))}
          </ol>
          <button style={{ marginTop: 10, width: '100%', background: GOLD, color: '#fff', border: 0, borderRadius: 8, padding: '8px', fontWeight: 700, cursor: 'pointer' }} onClick={() => setSupportModeOpen(true)}>Start Support Mode</button>
        </Panel>
      </div>

      {/* 5 analytics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3.5">
        <Panel title="Ticket Volume Trend (Last 7 Days)">
          {d.ticketVolumeTrend.length === 0 ? <NotConnected>No tickets in range.</NotConnected> : <AreaLine series={d.ticketVolumeTrend.map((x) => ({ label: x.day.slice(5), valueCents: x.count }))} height={130} />}
        </Panel>
        <Panel title="Tickets by Priority"><Donut data={d.ticketsByPriority.slices.map((s) => ({ label: s.key, value: s.count }))} centerLabel={`${d.ticketsByPriority.total}`} /></Panel>
        <Panel title="SLA Status Breakdown"><Donut data={d.slaBreakdown.slices.map((s) => ({ label: s.key, value: s.count }))} centerLabel={`${d.slaBreakdown.total}`} /></Panel>
        <Panel title="Support Performance by Agent">
          <Table head={['Agent', 'Assigned', 'Resolved', 'CSAT']} rows={d.agentPerformance.map((a) => [a.agent, num(a.assigned), num(a.resolved), a.csat == null ? '—' : a.csat])} empty="No agent activity." />
        </Panel>
        <Panel title="Urgent Incidents">
          {d.urgentIncidents.length === 0 ? <NotConnected>No urgent incidents.</NotConnected> : d.urgentIncidents.map((u) => (
            <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 6, padding: '6px 0', borderTop: '1px solid var(--line,#eee)', fontSize: 10.5 }}>
              <span style={{ minWidth: 0 }}><Pill label={u.priority} /> <span style={{ fontWeight: 600 }}>{u.subject}</span> <span className="muted">{u.tenant ?? ''}</span></span>
              <span className="muted" style={{ whiteSpace: 'nowrap' }}>{ago(u.createdAt)}</span>
            </div>
          ))}
        </Panel>
      </div>

      {/* 6 ticket-detail / workflow modules */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5">
        <Panel title="Related Devices & Transactions"><NotConnected>Linked device/transaction records open inside a ticket. No links on the current queue.</NotConnected></Panel>
        <Panel title="Support Conversation"><NotConnected>Select a ticket to view its tenant-visible conversation and reply.</NotConnected></Panel>
        <Panel title="Attachments & Internal Notes"><NotConnected>Select a ticket to view attachments and internal notes (internal notes never shown to tenants).</NotConnected></Panel>
        <Panel title="Resolved Tickets Today">
          <Table head={['Ticket', 'Tenant', 'Resolved At', 'CSAT']} rows={d.resolvedToday.map((r) => [r.ticketNumber, r.tenant ?? '—', ago(r.resolvedAt), r.csat == null ? '—' : r.csat])} empty="No tickets resolved today." />
        </Panel>
        <Panel title="Waiting-for-Customer Tickets">
          <Table head={['Ticket', 'Tenant', 'Waiting Since']} rows={d.waitingForCustomer.map((r) => [r.ticketNumber, r.tenant ?? '—', ago(r.waitingSince)])} empty="None waiting." />
        </Panel>
        <Panel title="Escalated Technical Issues">
          <Table head={['Ticket', 'Tenant', 'Escalated To']} rows={d.escalated.map((r) => [r.ticketNumber, r.tenant ?? '—', r.escalatedTo ?? '—'])} empty="No escalations." />
        </Panel>
      </div>

      {/* Recent audited sessions + KB */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-3.5">
        <Panel title="Recent Audited Support Sessions">
          <Table head={['Session', 'Tenant', 'Access', 'Reason', 'Started', 'Ended', 'Duration', 'By', 'Audit']}
            rows={d.recentSessions.map((s) => [s.id.slice(0, 8), s.tenant ?? '—', s.accessLevel ?? '—', s.reason, ago(s.started), s.ended ? ago(s.ended) : '—', `${s.durationMin}m`, s.startedBy ?? '—', <Pill label={s.auditStatus} />])}
            empty="No support sessions yet." />
        </Panel>
        <Panel title="Knowledge Base Drafts / Articles">
          <Table head={['Article', 'Status', 'Updated']} rows={d.knowledgeBase.map((a) => [a.title, <Pill label={a.status} />, ago(a.updated)])} empty="No articles." />
        </Panel>
      </div>

      {/* Quick actions */}
      <section style={{ background: 'var(--card,#fff)', border: '1px solid var(--line,#eee)', borderRadius: 12, padding: 12 }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 14 }}>Quick Actions</h2>
        <div className=" grid  grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2.5 ">
          {QUICK_ACTIONS.map((a) => <button key={a} onClick={() => (a === 'Open Ticket' ? setCreateOpen(true) : a === 'Start Support Mode' ? setSupportModeOpen(true) : say(`Opening: ${a}`))} style={{ background: 'var(--cream,#FBF6EC)', border: '1px solid #EFE3CB', borderRadius: 10, padding: '10px 8px', fontSize: 11, fontWeight: 600, cursor: 'pointer', color: 'var(--ink,#3a3a3a)' }}>{a}</button>)}
        </div>
      </section>

      {/* At-a-Glance */}
      <section style={{ background: 'var(--card,#fff)', border: '1px solid var(--line,#eee)', borderRadius: 12, padding: 12 }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 14 }}>At-a-Glance Summary (Today)</h2>
        <div className=" grid  grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2.5 ">
          {[['New Tickets', num(d.atAGlance.newTickets)], ['Tickets Resolved', num(d.atAGlance.ticketsResolved)], ['Urgent Cases', num(d.atAGlance.urgentCases)], ['Avg Response Time', d.atAGlance.avgResponseMin == null ? '—' : `${d.atAGlance.avgResponseMin} min`], ['Support Sessions Started', num(d.atAGlance.sessionsStarted)], ['CSAT', d.atAGlance.csat == null ? '—' : `${d.atAGlance.csat} / 5`]].map(([l, v]) => (
            <div key={l} style={{ minWidth: 0 }} className='border border-[var(--line)] p-2 rounded-lg'><div className="muted" style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em' }}>{l}</div><div style={{ fontFamily: 'Playfair Display, serif', fontSize: 18, marginTop: 3 }}>{v}</div></div>
          ))}
        </div>
      </section>
      {detailId ? <TicketDetailDrawer detail={detail} onClose={() => { setDetailId(null); setDetail(null); }} onReply={(b) => replyTicket(detailId, b)} onStatus={(to) => changeTicketStatus(detailId, to)} onNote={(b) => addInternalNote(detailId, b)} /> : null}
      {createOpen ? <CreateTicketModal onClose={() => setCreateOpen(false)} onCreate={createTicket} /> : null}
      {supportModeOpen ? <StartSupportModeModal onClose={() => setSupportModeOpen(false)} onStarted={(m) => { setSupportModeOpen(false); say(m); }} /> : null}
    </div>
  );
}

const inp: React.CSSProperties = { width: '100%', padding: '7px 9px', border: '1px solid var(--line,#ddd)', borderRadius: 8, fontSize: 12, boxSizing: 'border-box' };
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section style={{ background: 'var(--card,#fff)', border: '1px solid var(--line,#eee)', borderRadius: 12, padding: 12, minWidth: 0 }}><div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}><h2 style={{ margin: 0, fontSize: 13 }}>{title}</h2></div>{children}</section>;
}
function Table({ head, rows, empty }: { head: string[]; rows: React.ReactNode[][]; empty: string }) {
  if (rows.length === 0) return <div className="muted" style={{ fontSize: 12, padding: '6px 0' }}>{empty}</div>;
  return (
    <div style={{ overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10.5 }}>
        <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 9 }}>{head.map((h) => <th key={h} style={{ padding: '5px 5px', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} style={{ borderTop: '1px solid var(--line,#eee)' }}>{r.map((c, j) => <td key={j} style={{ padding: '5px 5px' }}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export default SupportAccessScreen;

const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(30,24,16,.35)', display: 'grid', placeItems: 'center', zIndex: 50, padding: 20 };
const card: React.CSSProperties = { background: 'var(--card,#fff)', borderRadius: 14, padding: 20, width: 'min(560px, 96vw)', maxHeight: '88vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.25)' };
const primary: React.CSSProperties = { background: GOLD, color: '#fff', border: 0, borderRadius: 8, padding: '8px 14px', fontWeight: 700, cursor: 'pointer' };
const CATEGORIES = ['general', 'account_access', 'login_issue', 'booking', 'pos_error', 'device_offline', 'payment_failure', 'refund', 'subscription', 'integration', 'reporting'];
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

function CreateTicketModal({ onClose, onCreate }: { onClose: () => void; onCreate: (i: { tenantId: string; branchId?: string; subject: string; description?: string; category?: string; priority?: string }) => void }) {
  const [tenantId, setTenantId] = useState(''); const [subject, setSubject] = useState(''); const [description, setDescription] = useState('');
  const [category, setCategory] = useState('general'); const [priority, setPriority] = useState('normal');
  const canSave = isUuid(tenantId) && subject.trim().length > 0;
  return (
    <div style={overlay} role="dialog" aria-label="Create support ticket">
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}><h2 style={{ margin: 0, fontSize: 17, fontFamily: 'Playfair Display, serif' }}>Create Ticket</h2><button className="linkbtn" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="muted" style={{ fontSize: 11.5, marginBottom: 12 }}>Creates a support ticket for the selected tenant with an SLA target derived from priority. Tenant-scoped and audited.</div>
        <label style={{ display: 'block', marginBottom: 8 }}><span className="flabel">Tenant ID</span><input value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="tenant UUID" style={inp} aria-label="Tenant ID" /></label>
        <label style={{ display: 'block', marginBottom: 8 }}><span className="flabel">Subject</span><input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Payment failing at checkout" style={inp} aria-label="Subject" /></label>
        <label style={{ display: 'block', marginBottom: 8 }}><span className="flabel">Description</span><input value={description} onChange={(e) => setDescription(e.target.value)} style={inp} aria-label="Description" /></label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
          <label><span className="flabel">Category</span><select value={category} onChange={(e) => setCategory(e.target.value)} style={inp}>{CATEGORIES.map((c) => <option key={c} value={c}>{TITLE(c)}</option>)}</select></label>
          <label><span className="flabel">Priority</span><select value={priority} onChange={(e) => setPriority(e.target.value)} style={inp}>{['critical', 'urgent', 'high', 'normal', 'low'].map((p) => <option key={p} value={p}>{TITLE(p)}</option>)}</select></label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="linkbtn" onClick={onClose}>Cancel</button>
          <button disabled={!canSave} style={{ ...primary, opacity: canSave ? 1 : 0.6, cursor: canSave ? 'pointer' : 'not-allowed' }} onClick={() => onCreate({ tenantId, subject: subject.trim(), description, category, priority })}>Create Ticket</button>
        </div>
      </div>
    </div>
  );
}

function StartSupportModeModal({ onClose, onStarted }: { onClose: () => void; onStarted: (msg: string) => void }) {
  const [tenantId, setTenantId] = useState(''); const [reason, setReason] = useState(''); const [accessLevel, setAccessLevel] = useState('READ_ONLY'); const [minutes, setMinutes] = useState(30); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const canStart = isUuid(tenantId) && reason.trim().length >= 5;
  const start = async () => {
    setBusy(true); setErr(null);
    try {
      const r: any = await superAdminApi.startSupportSession({ tenantId, reason: reason.trim(), minutes, scope: accessLevel });   // Constitution 7 §81 scope class
      if (r && r.ok !== false) onStarted(`Controlled support session started (${minutes}m, ${TITLE(accessLevel)}) — visible banner active, every action audited, auto-expires.`);
      else setErr((r?.errors && r.errors[0]) || 'Could not start the session (step-up may be required).');
    } catch { setErr('Could not start the session (step-up may be required).'); }
    finally { setBusy(false); }
  };
  return (
    <div style={overlay} role="dialog" aria-label="Start controlled support mode">
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}><h2 style={{ margin: 0, fontSize: 17, fontFamily: 'Playfair Display, serif' }}>Start Controlled Support Mode</h2><button className="linkbtn" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="muted" style={{ fontSize: 11.5, marginBottom: 12 }}>Time-limited, reason-based, visibly labeled, and fully audited. Never unrestricted access — the session auto-expires and every action is recorded.</div>
        <label style={{ display: 'block', marginBottom: 8 }}><span className="flabel">Tenant ID</span><input value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="tenant UUID" style={inp} aria-label="Support Tenant ID" /></label>
        <label style={{ display: 'block', marginBottom: 8 }}><span className="flabel">Support reason (min 5 chars)</span><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Investigate payment gateway declines" style={inp} aria-label="Support reason" /></label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
          <label><span className="flabel">Access level</span><select value={accessLevel} onChange={(e) => setAccessLevel(e.target.value)} style={inp}>{[['READ_ONLY', 'Read only'], ['STANDARD_SUPPORT', 'Standard support'], ['ELEVATED_SUPPORT', 'Elevated support (writes — needs tenant-edit)']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label><span className="flabel">Duration</span><select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} style={inp}>{[15, 30, 45, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}</select></label>
        </div>
        {err ? <div role="alert" style={{ color: '#B84A3D', fontSize: 12, marginBottom: 8 }}>{err}</div> : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="linkbtn" onClick={onClose}>Cancel</button>
          <button disabled={!canStart || busy} style={{ ...primary, opacity: canStart && !busy ? 1 : 0.6, cursor: canStart && !busy ? 'pointer' : 'not-allowed' }} onClick={start}>{busy ? 'Starting…' : 'Start Session'}</button>
        </div>
      </div>
    </div>
  );
}

function TicketDetailDrawer({ detail, onClose, onReply, onStatus, onNote }: {
  detail: import('../api/superAdminSupportApi').SupportTicketDetail | null;
  onClose: () => void; onReply: (body: string) => void; onStatus: (to: string) => void; onNote: (body: string) => void;
}) {
  const [reply, setReply] = useState(''); const [note, setNote] = useState('');
  const wrap: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(30,24,16,.35)', display: 'flex', justifyContent: 'flex-end', zIndex: 60 };
  const panel: React.CSSProperties = { background: 'var(--card,#fff)', width: 'min(560px, 96vw)', height: '100%', overflow: 'auto', padding: 20, boxShadow: '-12px 0 40px rgba(0,0,0,.2)' };
  const t = detail?.ticket;
  const STATUS_NEXT: Record<string, string[]> = { open: ['assigned', 'in_progress', 'waiting_customer', 'escalated'], assigned: ['in_progress', 'waiting_customer', 'escalated'], in_progress: ['waiting_customer', 'escalated', 'resolved'], waiting_customer: ['in_progress', 'resolved'], escalated: ['in_progress', 'resolved'], reopened: ['in_progress', 'resolved'], resolved: ['closed', 'reopened'] };
  return (
    <div style={wrap} role="dialog" aria-label="Ticket detail" onClick={onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontFamily: 'Playfair Display, serif' }}>{t?.ticketNumber ?? 'Ticket'}</h2>
          <button className="linkbtn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {!detail ? <div className="muted" style={{ fontSize: 12.5 }}>Loading ticket…</div> : detail.error || !t ? <div style={{ color: '#B84A3D', fontSize: 12.5 }}>Could not load this ticket.</div> : (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>{t.subject}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
              <Pill label={t.priority} /> <Pill label={t.status} /> <span className="muted" style={{ fontSize: 11 }}>{t.tenant ?? t.tenantId} · {TITLE(t.category)}{t.assignedAgent ? ` · ${t.assignedAgent}` : ''}{t.csatScore != null ? ` · CSAT ${t.csatScore}/5` : ''}</span>
            </div>
            {t.description ? <div style={{ fontSize: 12, background: 'var(--cream,#FBF6EC)', border: '1px solid #EFE3CB', borderRadius: 8, padding: '8px 10px', marginBottom: 12 }}>{t.description}</div> : null}

            <h3 style={{ fontSize: 12.5, margin: '4px 0 6px' }}>Support Conversation</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
              {(detail.conversation ?? []).length === 0 ? <div className="muted" style={{ fontSize: 11.5 }}>No messages yet.</div> : detail.conversation!.map((m) => (
                <div key={m.id} style={{ alignSelf: m.authorKind === 'agent' ? 'flex-end' : 'flex-start', maxWidth: '85%', background: m.authorKind === 'agent' ? '#EAF2FB' : 'var(--cream,#FBF6EC)', border: '1px solid', borderColor: m.authorKind === 'agent' ? '#C6DBF2' : '#EFE3CB', borderRadius: 10, padding: '7px 10px' }}>
                  <div style={{ fontSize: 9.5, fontWeight: 700, color: m.authorKind === 'agent' ? '#2F5D86' : '#8a6d3b' }}>{m.authorKind === 'agent' ? 'Support' : 'Tenant'} · {new Date(m.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
                  <div style={{ fontSize: 12 }}>{m.body}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
              <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply to the tenant…" style={{ ...inp, flex: 1 }} aria-label="Reply body" />
              <button disabled={!reply.trim()} style={{ ...primary, opacity: reply.trim() ? 1 : 0.6, cursor: reply.trim() ? 'pointer' : 'not-allowed' }} onClick={() => { onReply(reply.trim()); setReply(''); }}>Send</button>
            </div>

            <h3 style={{ fontSize: 12.5, margin: '4px 0 6px' }}>Change Status</h3>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
              {(STATUS_NEXT[t.status] ?? []).map((to) => <button key={to} className="linkbtn" style={{ fontSize: 11, border: '1px solid #EFE3CB', borderRadius: 16, padding: '3px 10px' }} onClick={() => onStatus(to)}>{TITLE(to)}</button>)}
              {(STATUS_NEXT[t.status] ?? []).length === 0 ? <span className="muted" style={{ fontSize: 11 }}>No further transitions.</span> : null}
            </div>

            <h3 style={{ fontSize: 12.5, margin: '4px 0 4px' }}>Internal Note <span className="muted" style={{ fontWeight: 400, fontSize: 10 }}>— not visible to the tenant</span></h3>
            <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add an internal note…" style={{ ...inp, flex: 1 }} aria-label="Internal note body" />
              <button disabled={!note.trim()} style={{ ...primary, background: '#7A5AA6', opacity: note.trim() ? 1 : 0.6, cursor: note.trim() ? 'pointer' : 'not-allowed' }} onClick={() => { onNote(note.trim()); setNote(''); }}>Add Note</button>
            </div>

            <h3 style={{ fontSize: 12.5, margin: '4px 0 6px' }}>Internal Timeline</h3>
            {(detail.events ?? []).length === 0 ? <div className="muted" style={{ fontSize: 11.5 }}>No events.</div> : (detail.events ?? []).map((e) => (
              <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 6, padding: '4px 0', borderTop: '1px solid var(--line,#eee)', fontSize: 10.5 }}>
                <span>{TITLE(e.kind)}{e.detail ? <span className="muted"> — {e.detail}</span> : null}</span>
                <span className="muted" style={{ whiteSpace: 'nowrap' }}>{new Date(e.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
