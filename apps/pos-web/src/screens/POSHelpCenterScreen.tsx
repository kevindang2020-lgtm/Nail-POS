import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { posHelpCenterApi, type HelpArticleSummary, type HelpProductUpdate, type HelpSystemStatus, type HelpTicketRow, type HelpTicketStats, type HelpVideoSummary } from '../api/posHelpCenterApi';
import { t as tx, enPlural } from '@aipowersalon/mobile-sdk/i18n';
import { useLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { viIncludes } from '@aipowersalon/api-contracts';
import { ImeSafeInput } from '../components/ImeSafeInput';
import { codeLabel } from '../components/codeLabel';
import { statusLabel } from '../i18n/status-label';
import { serverText } from '../i18n/server-text';

// POSHelpCenterScreen.tsx — T21 Help Center (the "Visit AI PowerSalon Help Center" destination, /tenant/account/support).
// A salon-specific support hub: a working client-side search over a curated set of help topics, category cards and quick
// actions that deep-link into the REAL POS sections, an AI-assistant entry point, and the support contact channels.
// Jul 28, 2026: the backend has had all of this since migrations 130/135/147 — help_articles (+view counts), video
// guides, the full support-ticket system (SLA stats, priorities), a real DB-probed platform status, and the
// product-updates feed. This screen now reads those live endpoints. Sections load independently and a failed or
// empty section says so — no metric here is invented, and status is never hardcoded green (invariant §10).

type Topic = { title: string; category: string; route: string; keywords: string };
const TOPICS: Topic[] = [
  { get title() { return tx('pos.how_to_process_a_refund'); }, category: 'payments', route: '/tenant/payments/overview', keywords: 'refund return void money payment chargeback' },
  { get title() { return tx('pos.setting_up_online_booking'); }, category: 'booking', route: '/booking', keywords: 'booking online appointment schedule calendar' },
  { get title() { return tx('pos.checking_in_a_customer'); }, category: 'booking', route: '/check-in', keywords: 'check-in checkin arrival walk-in queue' },
  { get title() { return tx('pos.managing_the_customer_queue'); }, category: 'booking', route: '/queue', keywords: 'queue waitlist wait customer flow' },
  { get title() { return tx('pos.adding_a_new_staff_member'); }, category: 'staff', route: '/technicians', keywords: 'staff technician team employee add hire role' },
  { get title() { return tx('pos.running_payroll'); }, category: 'staff', route: '/tenant/team/payroll', keywords: 'payroll pay commission tips wages period' },
  { get title() { return tx('pos.connecting_your_card_terminal'); }, category: 'devices', route: '/tenant/devices/overview', keywords: 'terminal clover fiserv device hardware pair integration' },
  { get title() { return tx('pos.creating_managing_gift_cards'); }, category: 'payments', route: '/tenant/payments/overview', keywords: 'gift card balance redeem money' },
  { get title() { return tx('pos.understanding_the_reports_dashboard'); }, category: 'reports', route: '/reports', keywords: 'reports analytics revenue dashboard metrics export' },
  { get title() { return tx('pos.using_ai_insights_for_your_salon'); }, category: 'ai', route: '/tenant/ai/command-center', keywords: 'ai insights assistant automation forecast' },
  { get title() { return tx('pos.setting_up_marketing_campaigns'); }, category: 'marketing', route: '/tenant/marketing/campaigns', keywords: 'marketing campaign sms email promotion growth' },
  { get title() { return tx('pos.managing_communications_messages'); }, category: 'comms', route: '/tenant/communications/sms', keywords: 'communications sms message inbox text reply' },
];
const CATEGORIES: { id: string; label: string; desc: string; route: string }[] = [
  { id: 'start', get label() { return tx('pos.getting_started'); }, get desc() { return tx('pos.new_to_ai_powersalon_start_here'); }, route: '/overview' },
  { id: 'booking', get label() { return tx('pos.booking_check_in'); }, get desc() { return tx('pos.learn_booking_check_in_queue'); }, route: '/booking' },
  { id: 'payments', get label() { return tx('pos.payments_money'); }, get desc() { return tx('pos.invoices_payments_refunds'); }, route: '/tenant/payments/overview' },
  { id: 'devices', get label() { return tx('pos.devices_integrations'); }, get desc() { return tx('pos.hardware_apps_integrations'); }, route: '/tenant/devices/overview' },
  { id: 'ai', get label() { return tx('pos.ai_center'); }, get desc() { return tx('pos.ai_tools_automations_insights'); }, route: '/tenant/ai/command-center' },
  { id: 'reports', get label() { return tx('pos.reports'); }, get desc() { return tx('pos.analytics_reports_dashboards'); }, route: '/reports' },
  { id: 'staff', get label() { return tx('pos.staff_team'); }, get desc() { return tx('pos.manage_staff_roles_permissions'); }, route: '/technicians' },
  { id: 'marketing', get label() { return tx('pos.marketing_growth'); }, get desc() { return tx('pos.attract_clients_grow_revenue'); }, route: '/tenant/marketing/campaigns' },
];
/** a topic's category id → its label (the Communications topic has no category card; it uses the nav name) */
const categoryLabel = (id: string) => CATEGORIES.find((c) => c.id === id)?.label ?? (id === 'comms' ? tx('glossary.nav.communications') : id);
// popular searches and suggested questions: read at render, in the POS language
const POPULAR = () => [tx('pos.refund_3'), tx('admin.help.popular.checkIn'), tx('admin.help.popular.giftCard'), tx('pos.payroll_2'), tx('admin.help.popular.integrations'), tx('admin.help.popular.reports')];
const SUGGESTED = () => [
  { q: tx('admin.help.suggested.refund'), route: '/tenant/payments/overview' },
  { q: tx('admin.help.suggested.checkIn'), route: '/check-in' },
  { q: tx('admin.help.suggested.addStaff'), route: '/technicians' },
  { q: tx('admin.help.suggested.payroll'), route: '/tenant/team/payroll' },
];

const cardBox: React.CSSProperties = { background: '#FFFCF6', border: '1px solid var(--line)', borderRadius: 14, padding: 14 };
const headStyle: React.CSSProperties = { fontWeight: 800, fontSize: 13.5, marginBottom: 10, fontFamily: 'var(--aps-font-head, Playfair Display)' };
const sel: React.CSSProperties = { height: 38, border: '1px solid var(--line)', borderRadius: 9, padding: '0 12px', background: '#fff', fontFamily: 'inherit', fontSize: 13 };

export function POSHelpCenterScreen() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  useLanguage();   // a language switch re-renders the screen; the topic search below runs every render (titles are translated)
  const [articles, setArticles] = useState<HelpArticleSummary[] | null | undefined>(undefined); // undefined=loading, null=failed
  const [videos, setVideos] = useState<HelpVideoSummary[] | null | undefined>(undefined);
  const [stats, setStats] = useState<HelpTicketStats | null | undefined>(undefined);
  const [tickets, setTickets] = useState<HelpTicketRow[] | null | undefined>(undefined);
  // Ticket attachments (Jul 29, 2026): first frontend consumer of the existing backend CRUD. Files travel as
  // base64 JSON (the backend contract); one expander open at a time; every state honest (loading/failed/empty).
  const [attFor, setAttFor] = useState<string | null>(null);
  const [attList, setAttList] = useState<{ id: string; fileName: string; sizeBytes?: number }[] | null | undefined>(undefined);
  const [attMsg, setAttMsg] = useState<string | null>(null);
  const loadAtt = (ticketId: string) => {
    setAttList(undefined);
    posHelpCenterApi.listAttachments(ticketId).then(setAttList).catch(() => setAttList(null));
  };
  const toggleAtt = (ticketId: string) => {
    setAttMsg(null);
    if (attFor === ticketId) { setAttFor(null); return; }
    setAttFor(ticketId); loadAtt(ticketId);
  };
  const onAttachFile = (ticketId: string, file: File | undefined) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setAttMsg(tx('admin.help.att.tooLarge')); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const b64 = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : '';
      if (!b64) { setAttMsg(tx('admin.help.att.unreadable')); return; }
      posHelpCenterApi.uploadAttachment(ticketId, { fileName: file.name, contentType: file.type || undefined, data: b64 })
        .then((r) => { if (r && r.ok === false) { setAttMsg(r.error || tx('pos.upload_failed_2')); } else { setAttMsg(null); loadAtt(ticketId); } })
        .catch((e: any) => setAttMsg(e?.message || tx('pos.upload_failed_2')));
    };
    reader.onerror = () => setAttMsg(tx('admin.help.att.unreadable'));
    reader.readAsDataURL(file);
  };
  const downloadAtt = (ticketId: string, attachmentId: string, fileName: string) => {
    posHelpCenterApi.downloadAttachment(ticketId, attachmentId).then((r) => {
      if (!r?.ok || !r.data) { setAttMsg(r?.error || tx('pos.download_unavailable')); return; }
      const bytes = atob(r.data); const arr = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([arr], { type: r.contentType || 'application/octet-stream' }));
      const a = document.createElement('a'); a.href = url; a.download = r.fileName || fileName; a.click();
      URL.revokeObjectURL(url);
    }).catch(() => setAttMsg(tx('admin.help.att.downloadFailed')));
  };
  const removeAtt = (ticketId: string, attachmentId: string) => {
    posHelpCenterApi.deleteAttachment(ticketId, attachmentId).then(() => loadAtt(ticketId)).catch(() => setAttMsg(tx('admin.help.att.deleteFailed')));
  };
  const [status, setStatus] = useState<HelpSystemStatus | null | undefined>(undefined);
  const [updates, setUpdates] = useState<HelpProductUpdate[] | null | undefined>(undefined);
  const [tSubject, setTSubject] = useState(''); const [tBody, setTBody] = useState(''); const [tPriority, setTPriority] = useState('normal');
  const [tMsg, setTMsg] = useState('');
  useEffect(() => { // each section independent — one outage never blanks the others
    posHelpCenterApi.articles(100).then(setArticles).catch(() => setArticles(null));
    posHelpCenterApi.videos(50).then(setVideos).catch(() => setVideos(null));
    posHelpCenterApi.ticketStats().then(setStats).catch(() => setStats(null));
    posHelpCenterApi.listTickets().then(setTickets).catch(() => setTickets(null));
    posHelpCenterApi.status().then(setStatus).catch(() => setStatus(null));
    posHelpCenterApi.updates(6).then(setUpdates).catch(() => setUpdates(null));
  }, []);
  const submitTicket = () => {
    const subject = tSubject.trim();
    if (!subject) { setTMsg(tx('admin.help.ticket.subjectRequired')); return; }
    setTMsg(tx('pos.submitting'));
    posHelpCenterApi.createTicket({ subject, description: tBody.trim() || undefined, priority: tPriority })
      .then((t) => { setTMsg(tx('admin.help.ticket.submitted')); setTSubject(''); setTBody(''); setTickets((prev) => [t, ...(prev ?? [])]); posHelpCenterApi.ticketStats().then(setStats).catch(() => {}); })
      .catch((e: any) => setTMsg(e?.message || tx('pos.the_ticket_could_not_be_submitted')));
  };
  const popularArticles = useMemo(() => (articles ?? []).slice().sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0)).slice(0, 6), [articles]);

  const results = (() => {
    const s = q.trim();
    // accent-insensitive (WP-E foldVi): "hoan tien" finds "Hoàn tiền"; English keywords keep working in both languages
    return TOPICS.filter((t) => (!cat || t.category === cat) && (!s || viIncludes(t.title, s) || viIncludes(t.keywords, s) || viIncludes(categoryLabel(t.category), s)));
  })();

  const n = (x: { length: number } | null | undefined) => (x === undefined ? '…' : x === null ? '—' : String(x.length));
  const kpis = [
    { l: tx('pos.help_articles'), v: n(articles), note: articles === null },
    { l: tx('pos.video_guides'), v: n(videos), note: videos === null },
    { l: tx('pos.help_topics'), v: String(TOPICS.length) },
    { l: tx('pos.help_categories'), v: String(CATEGORIES.length) },
    { l: tx('pos.open_tickets'), v: stats === undefined ? '…' : stats === null ? '—' : String(stats.open), note: stats === null },
    { l: tx('pos.awaiting_response'), v: stats === undefined ? '…' : stats === null ? '—' : String(stats.awaitingFirstResponse), note: stats === null },
    { l: tx('pos.system_status'), v: status === undefined ? '…' : status === null ? tx('pos.unavailable') : serverText(status.overall.label), ok: status?.overall?.healthy === true, note: status === null },
    { l: tx('pos.product_updates'), v: n(updates), note: updates === null },
  ];

  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="vh"><h1>{tx('pos.ai_powersalon_help_center')}</h1><div className="sub">{tx('pos.your_complete_resource_for_support_learning_l7cr')}</div></div>

      <div className="kpis">{kpis.map((c) => (<div className="kpi" key={c.l}><div className="l">{c.l}</div><div className="v" style={(c as any).note ? { color: '#8A7A66' } : (c as any).ok ? { color: '#3F8F6B' } : undefined}>{c.v}</div>{(c as any).note ? <div className="s" style={{ color: '#8A7A66' }}>{tx('pos.could_not_be_loaded')}</div> : null}</div>))}</div>

      {/* Functional search over curated topics */}
      <section style={cardBox}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <ImeSafeInput type="search" enterKeyHint="search" style={{ ...sel, flex: 1, minWidth: 220 }} placeholder={tx('pos.search_help_articles_guides_and_troubleshooting_1sbf')} value={q} onValue={setQ} />
          <select style={sel} value={cat} onChange={(e) => setCat(e.target.value)} aria-label={tx('pos.category_filter')}>
            <option value="">{tx('pos.all_categories')}</option>
            {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
          <span className="s" style={{ color: '#8A7A66' }}>{tx('pos.popular')}</span>
          {POPULAR().map((p) => <button key={p} className="btn ghost" style={{ padding: '2px 9px', fontSize: 11.5 }} onClick={() => setQ(p)}>{p}</button>)}
        </div>
        {(q || cat) ? (
          <div className="list" style={{ marginTop: 10 }}>
            {results.length === 0 ? <div className="muted">{tx('pos.no_topics_match')}{q}{tx('pos.try_a_different_term_or_contact_rru1')}</div> : results.map((t) => (
              <div className="row" key={t.title} style={{ cursor: 'pointer' }} onClick={() => nav(t.route)}>
                <div className="t" style={{ flex: 1 }}>{t.title}<div className="s">{categoryLabel(t.category)}</div></div>
                <span className="s" style={{ color: 'var(--gold)' }}>{tx('pos.open_2')}</span>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {/* Quick Help — real navigation into POS sections */}
      <section style={cardBox}>
        <div style={headStyle}>{tx('pos.quick_help')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          {CATEGORIES.map((c) => (
            <button key={c.label} onClick={() => nav(c.route)} style={{ textAlign: 'left', background: '#fff', border: '1px solid var(--line)', borderRadius: 12, padding: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{c.label}</div>
              <div className="s" style={{ color: '#8A7A66', marginTop: 2 }}>{c.desc}</div>
            </button>
          ))}
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
        <section style={cardBox}>
          <div style={headStyle}>{tx('pos.popular_articles')}</div>
          {articles === undefined ? <div className="muted">{tx('pos.loading_articles')}</div>
            : articles === null ? <div className="muted">{tx('pos.articles_could_not_be_loaded')}</div>
            : popularArticles.length === 0 ? <div className="muted">{tx('pos.no_help_articles_have_been_published_juja')}</div>
            : <div className="list">{popularArticles.map((a) => (
                <div className="row" key={a.id}>
                  <div className="t" style={{ flex: 1 }}>{a.title}<div className="s">{a.categoryLabel || tx('pos.general')}{a.readingMinutes ? tx('pos.readingminutes_min', { readingMinutes: String(a.readingMinutes) }) : ''}</div></div>
                  <span className="s" style={{ color: '#8A7A66' }}>{a.viewCount ?? 0} {tx('pos.views')}</span>
                </div>
              ))}</div>}
        </section>
        <section style={cardBox}>
          <div style={headStyle}>{tx('pos.recent_product_updates')}</div>
          {updates === undefined ? <div className="muted">{tx('pos.loading_updates')}</div>
            : updates === null ? <div className="muted">{tx('pos.the_updates_feed_could_not_be_f9zi')}</div>
            : updates.length === 0 ? <div className="muted">{tx('pos.no_product_updates_have_been_published_1bvj')}</div>
            : <div className="list">{updates.map((u) => (
                <div className="row" key={u.id}>
                  <div className="t" style={{ flex: 1 }}>{u.title}<div className="s">{[u.version, u.category, u.publishedAt ? u.publishedAt.slice(0, 10) : null].filter(Boolean).join(' · ')}</div></div>
                </div>
              ))}</div>}
        </section>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
        <section style={cardBox}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={headStyle}>{tx('pos.ai_support_assistant')}</div><span className="pill" style={{ background: '#EFE6D6' }}>{tx('pos.beta')}</span></div>
          <div className="s" style={{ color: '#8A7A66', marginBottom: 8 }}>{tx('pos.suggested_questions_tap_to_jump_to_2hre')}</div>
          <div className="list">
            {SUGGESTED().map((s) => (
              <div className="row" key={s.q} style={{ cursor: 'pointer' }} onClick={() => nav(s.route)}><div className="t" style={{ flex: 1 }}>{s.q}</div><span className="s" style={{ color: 'var(--gold)' }}>→</span></div>
            ))}
          </div>
          <div style={{ marginTop: 8 }}><button className="btn" style={{ width: '100%' }} onClick={() => nav('/tenant/ai/command-center')}>{tx('pos.ask_ai_assistant')}</button></div>
        </section>
        <section style={cardBox}>
          <div style={headStyle}>{tx('pos.submit_a_support_ticket')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input style={sel} placeholder={tx('pos.subject_required')} value={tSubject} onChange={(e) => setTSubject(e.target.value)} aria-label={tx('pos.ticket_subject')} />
            <textarea style={{ ...sel, height: 64, padding: 8, resize: 'vertical' }} placeholder={tx('pos.describe_the_issue')} value={tBody} onChange={(e) => setTBody(e.target.value)} aria-label={tx('pos.ticket_description')} />
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select style={{ ...sel, flex: 1 }} value={tPriority} onChange={(e) => setTPriority(e.target.value)} aria-label={tx('pos.ticket_priority')}>
                <option value="low">{tx('pos.low_priority')}</option><option value="normal">{tx('pos.normal_priority')}</option><option value="high">{tx('pos.high_priority')}</option><option value="urgent">{tx('pos.urgent')}</option>
              </select>
              <button className="btn" onClick={submitTicket}>{tx('pos.submit_ticket')}</button>
            </div>
            {tMsg ? <div className="s" style={{ color: '#8A7A66' }}>{tMsg}</div> : null}
          </div>
          <div className="list" style={{ marginTop: 8 }}>
            {tickets === undefined ? <div className="muted">{tx('pos.loading_your_tickets')}</div>
              : tickets === null ? <div className="muted">{tx('pos.your_tickets_could_not_be_loaded')}</div>
              : tickets.length === 0 ? <div className="muted">{tx('pos.no_support_tickets_yet')}</div>
              : tickets.slice(0, 4).map((t) => (
                  <div key={t.id}>
                    <div className="row"><div className="t" style={{ flex: 1 }}>{t.subject}<div className="s">{codeLabel('admin.help.ticketStatus', t.status, ['payment', 'drawer'])} · {statusLabel('priority', t.priority)}</div></div>
                      <button className="link" style={{ background: 'none', border: 'none', color: 'var(--gold)', fontSize: 12.5, cursor: 'pointer' }} onClick={() => toggleAtt(t.id)}>{tx('pos.attachments')}</button>
                    </div>
                    {attFor === t.id && (
                      <div style={{ padding: '4px 0 8px 10px' }}>
                        {attList === undefined ? <div className="muted">{tx('pos.loading_attachments')}</div>
                          : attList === null ? <div className="muted">{tx('pos.attachments_could_not_be_loaded')}</div>
                          : attList.length === 0 ? <div className="muted">{tx('pos.no_attachments_yet')}</div>
                          : attList.map((a) => (
                              <div className="row" key={a.id}><div className="s" style={{ flex: 1 }}>{a.fileName}{a.sizeBytes ? tx('pos.v0_kb', { v0: String(Math.max(1, Math.round(a.sizeBytes / 1024))) }) : ''}</div>
                                <button className="link" style={{ background: 'none', border: 'none', color: 'var(--gold)', fontSize: 12, cursor: 'pointer' }} onClick={() => downloadAtt(t.id, a.id, a.fileName)}>{tx('pos.download')}</button>
                                <button className="link" style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 12, cursor: 'pointer' }} onClick={() => removeAtt(t.id, a.id)}>{tx('pos.remove')}</button>
                              </div>
                            ))}
                        <label className="s" style={{ display: 'inline-block', marginTop: 4, color: 'var(--gold)', cursor: 'pointer' }}>
                          {tx('pos.attach_a_file')}
                          <input type="file" aria-label={tx('pos.attach_file_to_subject', { subject: String(t.subject) })} style={{ display: 'none' }} onChange={(e) => onAttachFile(t.id, e.target.files?.[0])} />
                        </label>
                        {attMsg && <div className="muted" role="status" style={{ marginTop: 4 }}>{attMsg}</div>}
                      </div>
                    )}
                  </div>
                ))}
          </div>
          <div className="row" style={{ marginTop: 6 }}><div className="t" style={{ flex: 1 }}>{tx('pos.email_support')}</div><a href="mailto:support@aipowersalon.com" style={{ color: 'var(--gold)', fontSize: 12.5, textDecoration: 'none' }}>{tx('pos.support_aipowersalon_com')}</a></div>
        </section>
        <section style={cardBox}>
          <div style={headStyle}>{tx('pos.system_status')}</div>
          {status === undefined ? <div className="muted">{tx('pos.checking_status')}</div>
            : status === null ? <div className="muted">{tx('pos.status_is_unavailable_right_now_that_1fot')}</div>
            : (<>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className={status.overall.healthy ? 'pill ok' : 'pill'} style={status.overall.healthy ? undefined : { background: '#F3DFD3', color: '#8A4B2E' }}>{serverText(status.overall.label)}</span></div>
                {status.components.length ? <div className="list" style={{ marginTop: 8 }}>{status.components.slice(0, 5).map((c) => (
                  <div className="row" key={c.key}><div className="t" style={{ flex: 1 }}>{c.name}</div><span className="s" style={{ color: c.status === 'operational' ? '#3F8F6B' : '#8A4B2E' }}>{statusLabel('systemComponent', c.status)}</span></div>
                ))}</div> : null}
                {status.incidents.length ? <div className="s" style={{ color: '#8A4B2E', marginTop: 6 }}>{status.incidents.length} {tx('pos.recent_incident')}{enPlural(status.incidents.length === 1 ? '' : 's')} {tx('pos.on_record')}</div> : null}
              </>)}
          <div style={{ marginTop: 8 }}><button className="btn ghost" onClick={() => nav('/tenant/account/activity-logs')}>{tx('pos.view_activity_logs')}</button></div>
        </section>
      </div>

      <section style={cardBox}>
        <div style={headStyle}>{tx('pos.quick_actions_2')}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {[
            { l: tx('pos.search_help'), fn: () => { const el = document.querySelector('input'); (el as HTMLInputElement | null)?.focus(); } },
            { l: tx('pos.ask_ai_assistant'), fn: () => nav('/tenant/ai/command-center') },
            { l: tx('pos.email_support'), fn: () => { window.location.href = 'mailto:support@aipowersalon.com'; } },
            { l: tx('pos.reports'), fn: () => nav('/reports') },
            { l: tx('pos.account'), fn: () => nav('/tenant/account/overview') },
          ].map((a) => <button key={a.l} className="btn ghost" onClick={a.fn}>{a.l}</button>)}
        </div>
      </section>
    </div>
  );
}
