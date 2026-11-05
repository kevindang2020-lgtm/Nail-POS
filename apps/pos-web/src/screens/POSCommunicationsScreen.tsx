// POSCommunicationsScreen.tsx — Communications › SMS Inbox (/tenant/communications/sms). Communications / SMS Inbox guide
// (Oct 30 2026) + Claude Build Addendum §4.1–§4.3, built on the existing screen (route, sidebar entry, title, 13 KPI tiles, the
// inbox split, the six lower modules and the seven quick actions are all kept):
//   • ASUS 27" at 100 %: the page scrolls vertically; the thread list and the conversation scroll on their own; the reply
//     composer stays anchored at the bottom of the conversation pane.
//   • one search box (server-side, whole salon, beyond page 1): name · phone (any format) · email · customer / conversation /
//     message id · ticket number · message text. Channel, status, assignee, Waiting-only, period (Today … Custom From/To month
//     calendar, salon time zone) with a date basis. Numbered pages 10 / 20 / 50. Sorts: Newest activity (default — a new or
//     newly active conversation is on page 1) · Unread first · Longest unanswered · Follow-up due.
//   • the conversation: identity (linked / possible match / Unknown contact — never guessed by name), consent (opted out of
//     texts), branch, next appointment; chronological messages with evidence-based delivery (Submitted → Sent → Delivered |
//     Failed), older messages on demand without losing the reading position; a Timeline tab joining SMS, automated texts
//     (reminders, follow-ups, receipts, campaigns), review requests, AI Receptionist calls and appointments.
//   • the composer: templates fill an editable draft (never send), segment counter, one request key per Send (a retry is the
//     same message), the truthful sender readiness when sending is blocked, Book Appointment (existing New Appointment with the
//     verified customer preselected; Unknown / ambiguous → choose the customer first).
//   • live: conversation_updated events (ids only) refresh the list, KPIs and the open conversation — the selection, scroll
//     position and every unsent draft are kept. Live / Reconnecting / Polling is shown honestly.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posCommunicationsApi, newRequestKey, type InboxPage, type InboxDetail, type InboxMessage, type InboxSummary, type InboxThread, type InboxTimelineEvent, type ActivityMetric } from '../api/posCommunicationsApi';
import { fmtInZone } from '../i18n/format';
import { useRealtime } from '../realtime/useRealtime';
import { REALTIME_STATUS, realtimeStatus } from '../realtime/realtime-client';
import type { RealtimeStatus } from '../realtime/realtime-core';
import { liveModeOf, type LiveMode } from './teamLiveCore';
import { TeamLiveBadge } from './teamLive';
import { RangeCalendar } from '../components/FinanceKit';
import { useDebounced, useEscapeToClose } from '../components/FitKit';
import { readUrlState, writeUrlState, withFilter, listQuery, waitedFor, waitTone, deliveryTone, segmentsOf, DraftBook, atBottom, SORTS, CHANNELS, STATUSES, PRESETS, BASES, SIZES, type InboxUrlState } from './commsInboxCore';
import { deviceToday } from '../lib/deviceToday';
import { authApi } from '../api/authApi';

const when = (iso: string | null | undefined) => { if (!iso) return ''; try { return fmtInZone(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return iso; } };
const waitText = (iso: string | null | undefined) => { const w = waitedFor(iso); if (!w) return ''; return w.d ? tx('ci.wait.dh', { d: String(w.d), h: String(w.h) }) : w.h ? tx('ci.wait.hm', { h: String(w.h), m: String(w.m) }) : tx('ci.wait.m', { m: String(w.m) }); };
/** a translated code, or the fallback when the namespace has no entry for it (t() returns the key itself then) */
const txOr = (key: string, fallback: string, vars?: Record<string, string>) => { const s = tx(key, vars); return s === key ? fallback : s; };
const errText = (e: unknown, fallback: string) => { const x = e as { code?: string; message?: string } | null; return x?.code ? txOr('ci.err.' + x.code, x.message || fallback) : (x?.message || fallback); };
const reasonText = (code: string | null | undefined) => txOr('ci.reason.' + (code ?? 'SEND_FAILED'), tx('ci.reason.SEND_FAILED'));
const isConflict = (e: unknown) => (e as { code?: string } | null)?.code === 'INBOX_VERSION_CONFLICT';
const COMMS_POLL_FALLBACK_MS = 30_000;

/** live updates on the existing stream: conversation_updated → 'communications' (no new transport) */
function useCommsLive(): { tick: number; mode: LiveMode; lastAt: number | null; refreshNow: () => void } {
  const [status, setStatus] = useState<RealtimeStatus>(() => realtimeStatus());
  const [polled, setPolled] = useState(false); const [tick, setTick] = useState(0); const [lastAt, setLastAt] = useState<number | null>(null);
  useEffect(() => {
    const h = (e: Event) => { const s = (e as CustomEvent<{ status: RealtimeStatus }>).detail?.status; if (s) { setStatus(s); if (s === 'CONNECTED') setPolled(false); } };
    window.addEventListener(REALTIME_STATUS, h); setStatus(realtimeStatus());
    return () => window.removeEventListener(REALTIME_STATUS, h);
  }, []);
  const refresh = useCallback(() => { setTick((n) => n + 1); setLastAt(Date.now()); }, []);
  useRealtime(['communications'], (reason) => { if (reason === 'interval' && realtimeStatus() !== 'CONNECTED') setPolled(true); refresh(); },
    { intervalMs: status === 'CONNECTED' ? 60_000 : COMMS_POLL_FALLBACK_MS, hiddenMs: 60_000 });
  return { tick, mode: liveModeOf(status, polled), lastAt, refreshNow: refresh };
}

function Metric({ label, value, sub, tone, title, testId }: { label: string; value: string; sub?: string; tone?: string; title?: string; testId?: string }) {
  return (
    <div className="ci-kpi" title={title} data-testid={testId}>
      <span className="ci-kpi-l">{label}</span>
      <span className="ci-kpi-v" style={tone ? { color: tone } : undefined}>{value}</span>
      {sub ? <span className="ci-kpi-s">{sub}</span> : null}
    </div>
  );
}
const metricText = (m: ActivityMetric | undefined | null, suffix = '') => (m === undefined ? '…' : m && m.available && m.value != null ? `${m.value.toLocaleString()}${suffix}` : '—');

export function POSCommunicationsScreen() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const st = useMemo(() => readUrlState(sp), [sp]);
  const go = useCallback((next: InboxUrlState, replace = false) => setSp(writeUrlState(next), { replace }), [setSp]);
  const setFilter = (patch: Partial<InboxUrlState>) => go(withFilter(st, patch));
  const [search, setSearch] = useState('');
  const q = useDebounced(search, 300);
  const firstQ = useRef(true);
  useEffect(() => { if (firstQ.current) { firstQ.current = false; return; } if (st.page !== 1) go({ ...st, page: 1 }, true); }, [q]);   // new search → page 1
  const live = useCommsLive();

  // ── list (one request at a time: a newer answer always wins) ──
  const [list, setList] = useState<InboxPage | null>(null); const [listErr, setListErr] = useState<string | null>(null); const [listBusy, setListBusy] = useState(false);
  const listReq = useRef(0);
  const qs = JSON.stringify(listQuery(st, q));
  useEffect(() => {
    const n = ++listReq.current; setListBusy(true);
    posCommunicationsApi.inbox.list(JSON.parse(qs)).then((d) => { if (n !== listReq.current) return; setList(d); setListErr(null); if (d.page !== st.page) go({ ...st, page: d.page }, true); },
      (e) => { if (n !== listReq.current) return; setListErr(errText(e, tx('ci.listFailed'))); }).finally(() => { if (n === listReq.current) setListBusy(false); });
  }, [qs, live.tick]);

  // ── KPIs (conversation counts from SQL; activity from its own sources — each honest about availability) ──
  const [sum, setSum] = useState<InboxSummary | null | undefined>(undefined);
  const [act, setAct] = useState<Awaited<ReturnType<typeof posCommunicationsApi.getActivity>> | null | undefined>(undefined);
  useEffect(() => {
    posCommunicationsApi.inbox.summary(st.branch || null).then(setSum, () => setSum(null));
    posCommunicationsApi.getActivity(30, st.branch || null).then(setAct, () => setAct(null));
  }, [live.tick, st.branch]);
  // C2 audit (Nov 4 2026): the location filter (the server refuses a location the user may not see)
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { authApi.branches().then((r) => setBranches((r.branches ?? []).map((b) => ({ id: String(b.id), name: String(b.name ?? '') })))).catch(() => setBranches([])); }, []);

  // ── the open conversation ──
  const [detail, setDetail] = useState<InboxDetail | null>(null); const [detailErr, setDetailErr] = useState<string | null>(null);
  const [older, setOlder] = useState<InboxMessage[]>([]); const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [tab, setTab] = useState<'conversation' | 'timeline'>('conversation');
  const detailReq = useRef(0); const scroller = useRef<HTMLDivElement | null>(null); const stick = useRef(true);
  const selId = st.thread;
  const loadDetail = useCallback((id: string, markRead: boolean) => {
    const n = ++detailReq.current;
    posCommunicationsApi.inbox.detail(id).then((d) => {
      if (n !== detailReq.current) return;
      stick.current = atBottom(scroller.current);
      setDetail(d); setDetailErr(null);
      setOlderCursor((c) => c ?? d.olderCursor);
      if (markRead && d.thread.unreadCount > 0) posCommunicationsApi.inbox.read(id).then(() => live.refreshNow(), () => undefined);
    }, (e) => { if (n !== detailReq.current) return; setDetailErr(errText(e, tx('ci.openFailed'))); setDetail(null); });
  }, [live.refreshNow]);
  useEffect(() => { setOlder([]); setOlderCursor(null); setTab('conversation'); stick.current = true; setDetail(null); setDetailErr(null); if (selId) loadDetail(selId, true); }, [selId]);
  useEffect(() => { if (selId && live.tick) loadDetail(selId, false); }, [live.tick]);   // a live event never changes the selection or the draft
  const messages = useMemo(() => { const seen = new Set<string>(); return [...older, ...(detail?.messages ?? [])].filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true))); }, [older, detail]);
  useEffect(() => { const el = scroller.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [messages.length, detail?.thread.id]);
  const loadOlder = async () => {
    if (!selId || !olderCursor) return;
    const el = scroller.current; const fromBottom = el ? el.scrollHeight - el.scrollTop : 0;
    const r = await posCommunicationsApi.inbox.older(selId, olderCursor).catch(() => null);
    if (!r) return;
    stick.current = false; setOlder((o) => [...r.items, ...o]); setOlderCursor(r.olderCursor);
    requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - fromBottom; });   // keep the reader's place
  };
  const select = (id: string) => go({ ...st, thread: id });

  // ── drafts + send ──
  const drafts = useRef(new DraftBook()); const [draft, setDraftState] = useState('');
  useEffect(() => { setDraftState(drafts.current.get(selId)); }, [selId]);
  const setDraft = (v: string) => { drafts.current.set(selId, v); setDraftState(v); };
  const sendKey = useRef<{ thread: string; body: string; key: string } | null>(null);
  const [sending, setSending] = useState(false); const [note, setNote] = useState<{ tone: 'ok' | 'bad' | 'warn'; text: string } | null>(null);
  const send = async () => {
    if (!selId || !draft.trim() || sending) return;
    const body = draft.trim();
    // the same intended message (retry after a network error) keeps its key → one text; a new message gets a new key
    if (!sendKey.current || sendKey.current.thread !== selId || sendKey.current.body !== body) sendKey.current = { thread: selId, body, key: newRequestKey() };
    setSending(true); setNote(null);
    try {
      // 740: the message records the salon template it came from (only while the inserted text is still in the draft)
      const fromTpl = tplUsed.current && tplUsed.current.thread === selId && body.includes(tplUsed.current.text.slice(0, 24)) ? tplUsed.current.id : null;
      const r = await posCommunicationsApi.inbox.reply(selId, body, sendKey.current.key, fromTpl);
      const d = r.message?.delivery ?? 'blocked';
      if (d === 'blocked' || d === 'failed') setNote({ tone: 'bad', text: tx('ci.send.notSent', { why: reasonText(r.message?.reasonCode) }) });
      else { setNote({ tone: 'ok', text: r.readiness && !r.readiness.deliveryTracking ? tx('ci.send.submittedNoTracking') : tx('ci.send.submitted') }); setDraft(''); tplUsed.current = null; }
      sendKey.current = null; stick.current = true; loadDetail(selId, false); live.refreshNow();
    } catch (e) { setNote({ tone: 'bad', text: errText(e, tx('ci.send.failed')) }); }   // key kept: pressing Send again is the SAME message
    finally { setSending(false); }
  };

  // ── templates ──
  const [tpl, setTpl] = useState<{ id: string; name: string; body: string; scope: string }[] | null>(null); const [tplOpen, setTplOpen] = useState(false);
  const openTemplates = () => { setTplOpen((o) => !o); if (!tpl) posCommunicationsApi.inbox.templates().then((r) => setTpl(r.items), () => setTpl([])); };
  const tplUsed = useRef<{ thread: string; id: string; text: string } | null>(null);
  // 740 (guide P0): the template is filled in for THIS conversation's customer by the server ([name] / {customer_first_name}
  // become the real first name) — it fills the draft, never sends. If the server cannot render it, the raw text is used.
  const useTemplate = async (x: { id: string; body: string; scope: string }) => {
    setTplOpen(false);
    let text = x.body;
    if (selId) try {
      const r = await posCommunicationsApi.inbox.renderTemplate(selId, x.id);
      text = r.text;
      if (r.missing.length || r.unknown.length) setNote({ tone: 'warn', text: tx('ci.tpl.checkVars', { list: [...r.missing.map((m) => `{${m}}`), ...r.unknown].join(', ') }) });
      if (x.scope === 'salon') tplUsed.current = { thread: selId, id: x.id, text };
    } catch { /* fall back to the template's own text; staff edit it before sending */ }
    setDraft(draft ? draft.replace(/\s*$/, ' ') + text : text);
  };

  // ── conversation actions (version-checked; a conflict refreshes) ──
  const [dlg, setDlg] = useState<null | 'new' | 'link' | 'assign' | 'follow'>(null);
  const act2 = async (fn: () => Promise<unknown>) => {
    try { await fn(); setNote(null); } catch (e) { setNote({ tone: 'bad', text: isConflict(e) ? tx('ci.conflict') : errText(e, tx('ci.actionFailed')) }); }
    if (selId) loadDetail(selId, false); live.refreshNow();
  };
  const v = detail?.thread.version ?? 1;
  const book = () => {
    if (!detail) return;
    if (!detail.customer) { setDlg('link'); setNote({ tone: 'warn', text: tx('ci.book.chooseFirst') }); return; }
    nav(`/booking/new?customerId=${encodeURIComponent(detail.customer.id)}&from=communications&conversationId=${encodeURIComponent(detail.thread.id)}`);
  };

  const k = sum?.conversations; const chan = (c: string) => sum?.channelMix.find((x) => x.channel === c)?.count ?? 0;
  const n = (x: number | undefined) => (sum === undefined ? '…' : sum === null || x == null ? '—' : x.toLocaleString());
  const filtersOn = !!(st.channel || st.status || st.assignee || st.awaiting || st.preset !== 'all' || st.sort !== 'newest' || search);

  return (
    <div className="work ci-page" data-testid="comms-inbox">
      <div className="ci-head">
        <div>
          <h1 className="ci-title">{tx('pos.communications')}</h1>
          <div className="ci-sub">{tx('ci.subtitle')}</div>
        </div>
        <div className="ci-head-r">
          <TeamLiveBadge mode={live.mode} lastAt={live.lastAt} />
          <button type="button" className="ci-btn" onClick={live.refreshNow} data-testid="ci-refresh">{tx('ci.refresh')}</button>
          <button type="button" className="ci-btn gold" onClick={() => setDlg('new')} data-testid="ci-new">{tx('pos.new_message')}</button>
        </div>
      </div>

      {/* 13 KPI tiles — six activity metrics (their own sources, '—' when the source is absent) + seven conversation counts (SQL) */}
      <section className="ci-kpis" aria-label={tx('ci.kpis')}>
        <div className="ci-kpi-row six">
        <Metric testId="kpi-sent-today" label={tx('pos.messages_sent_today')} value={sum ? sum.sentToday.total.toLocaleString() : metricText(act?.messagesSentToday)}
          sub={sum ? tx('ci.kpi.sentSplit', { d: String(sum.sentToday.delivered), f: String(sum.sentToday.failed) }) : tx('ci.kpi.today')} title={tx('ci.def.sentToday')} />
        <Metric label={tx('pos.campaign_delivery')} value={metricText(act === null ? null : act?.campaignDeliveryRatePct, '%')} sub={tx('ci.kpi.allTime')} tone="var(--aps-ok)" title={act?.campaignDeliveryRatePct?.reason ?? tx('ci.def.campaign')} />
        <Metric label={tx('pos.ai_calls_handled')} value={metricText(act === null ? null : act?.aiCallsHandled)} sub={tx('ci.kpi.days30')} title={act?.aiCallsHandled?.reason ?? tx('ci.def.aiCalls')} />
        <Metric label={tx('pos.review_requests_sent')} value={metricText(act === null ? null : act?.reviewRequestsSent)} sub={tx('ci.kpi.days30')} title={act?.reviewRequestsSent?.reason ?? tx('ci.def.reviews')} />
        <Metric label={tx('pos.avg_response')} value={metricText(act === null ? null : act?.avgResponseMinutes, ' m')} sub={tx('ci.kpi.staffMean30')} tone="var(--aps-gold)" title={act?.avgResponseMinutes?.reason ?? tx('ci.def.avgResponse')} />
        <Metric label={tx('pos.rebooking_conv')} value={metricText(act === null ? null : act?.rebookingConversionPct, '%')} sub={act?.rebookingConversionPct?.available ? tx('ci.kpi.rebookSub') : tx('ci.kpi.notTracked')} title={act?.rebookingConversionPct?.reason ?? tx('ci.kpi.rebookDef')} />
        </div>
        <div className="ci-kpi-row seven">
        <Metric testId="kpi-open" label={tx('pos.open_conversations')} value={n(k?.open)} sub={tx('ci.kpi.now')} tone="var(--aps-info)" title={sum?.definitions.openConversations} />
        <Metric testId="kpi-unread" label={tx('pos.unread_2')} value={n(k?.unreadThreads)} sub={k ? tx('ci.kpi.unreadMsgs', { n: String(k.unreadMessages) }) : tx('ci.kpi.now')} tone="var(--aps-warn)" title={sum?.definitions.unread} />
        <Metric label={tx('pos.replied')} value={n(k?.replied)} sub={tx('ci.kpi.now')} tone="var(--aps-ok)" title={sum?.definitions.replied} />
        <Metric label={tx('pos.missed')} value={n(k?.missed)} sub={tx('ci.kpi.missedCalls')} tone="var(--aps-danger)" title={sum?.definitions.missed} />
        <Metric label="SMS" value={n(chan('sms'))} sub={tx('ci.kpi.conversations')} title={sum?.definitions.sms} />
        <Metric label={tx('pos.email')} value={n(chan('email'))} sub={tx('ci.kpi.conversations')} title={sum?.definitions.email} />
        <Metric testId="kpi-total" label={tx('pos.total_conversations')} value={n(k?.total)} sub={k && k.awaiting ? tx('ci.kpi.waiting', { n: String(k.awaiting) }) : tx('ci.kpi.allChannels')} tone="var(--aps-gold)" title={sum?.definitions.totalConversations} />
        </div>
      </section>

      {/* search + filters (server-side; page 1 on every change; the search text never goes in the URL) */}
      <section className="ci-tools" aria-label={tx('ci.filters')}>
        <input className="ci-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tx('ci.searchPh')} aria-label={tx('ci.searchPh')} data-testid="ci-search" />
        {branches.length > 1 ? <select className="ci-sel" value={st.branch} onChange={(e) => setFilter({ branch: e.target.value })} aria-label={tx('ci.f.branch')} data-testid="ci-branch">
          <option value="">{tx('ci.f.allBranches')}</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select> : null}
        <select className="ci-sel" value={st.channel} onChange={(e) => setFilter({ channel: e.target.value })} aria-label={tx('pos.channel_filter')} data-testid="ci-channel">
          <option value="">{tx('pos.all_channels')}</option>{CHANNELS.map((c) => <option key={c} value={c}>{tx('ci.ch.' + c)}</option>)}
        </select>
        <select className="ci-sel" value={st.status} onChange={(e) => setFilter({ status: e.target.value })} aria-label={tx('pos.status_filter')} data-testid="ci-status">
          <option value="">{tx('pos.all_statuses')}</option>{STATUSES.map((s) => <option key={s} value={s}>{tx('ci.st.' + s)}</option>)}
        </select>
        <select className="ci-sel" value={st.assignee} onChange={(e) => setFilter({ assignee: e.target.value })} aria-label={tx('ci.assignee')} data-testid="ci-assignee">
          <option value="">{tx('ci.anyone')}</option><option value="me">{tx('ci.assignedToMe')}</option><option value="unassigned">{tx('ci.unassigned')}</option>
        </select>
        <select className="ci-sel wide" value={st.sort} onChange={(e) => setFilter({ sort: e.target.value as InboxUrlState['sort'] })} aria-label={tx('ci.sortBy')} data-testid="ci-sort">
          {SORTS.map((s) => <option key={s} value={s}>{tx('ci.sort.' + s)}</option>)}
        </select>
        <label className="ci-chk"><input type="checkbox" checked={st.awaiting} onChange={(e) => setFilter({ awaiting: e.target.checked })} data-testid="ci-awaiting" />{tx('ci.waitingOnly')}</label>
        <PeriodPicker st={st} server={list?.period ?? null} onChange={setFilter} />
        {filtersOn ? <button type="button" className="ci-btn ghost" onClick={() => { setSearch(''); go({ ...st, sort: 'newest', channel: '', status: '', assignee: '', awaiting: false, preset: 'all', from: '', to: '', basis: 'last_activity', page: 1 }); }} data-testid="ci-clear">{tx('ci.clear')}</button> : null}
      </section>

      {note ? <div className={'ci-note ' + note.tone} role="status" data-testid="ci-note">{note.text}</div> : null}

      <section className="ci-work" aria-label={tx('pos.sms_inbox')}>
        {/* thread list */}
        <div className="ci-list" data-testid="ci-list">
          <div className="ci-list-h">
            <span data-testid="ci-count">{list ? tx('ci.count', { n: String(list.total) }) : '…'}{listBusy ? ' · ' + tx('ci.loading') : ''}</span>
            <span className="ci-sortnote">{tx('ci.sortShort.' + st.sort)}</span>
          </div>
          <div className="ci-list-b" role="list">
            {listErr ? <div className="ci-empty bad">{listErr} <button type="button" className="ci-link" onClick={live.refreshNow}>{tx('ci.retry')}</button></div>
              : list && list.items.length === 0 ? (
                <div className="ci-empty" data-testid="ci-empty">
                  <b>{filtersOn ? tx('ci.noMatch') : tx('pos.no_conversations_yet_2')}</b>
                  <span>{filtersOn ? tx('ci.noMatchHint') : tx('ci.emptyHint')}</span>
                  <div className="ci-row"><button type="button" className="ci-btn gold" onClick={() => setDlg('new')}>{tx('pos.new_message')}</button><button type="button" className="ci-btn" onClick={() => nav('/tenant/communications/messaging-setup')}>{tx('ci.setupDiag')}</button></div>
                </div>
              ) : list?.items.map((t) => <ThreadRow key={t.id} t={t} on={t.id === selId} draft={drafts.current.has(t.id)} onOpen={() => select(t.id)} />)}
          </div>
          <div className="ci-list-f">
            <Pager page={list?.page ?? st.page} pageCount={list?.pageCount ?? 1} onPage={(p) => go({ ...st, page: p })} />
            <select className="ci-sel small" value={String(st.size)} onChange={(e) => setFilter({ size: Number(e.target.value) })} aria-label={tx('ci.perPage')} data-testid="ci-size">
              {SIZES.map((s) => <option key={s} value={s}>{tx('ci.nPerPage', { n: String(s) })}</option>)}
            </select>
          </div>
        </div>

        {/* conversation */}
        <div className="ci-conv" data-testid="ci-conv">
          {!selId ? <div className="ci-empty center"><b>{tx('pos.select_a_conversation')}</b><span>{tx('pos.choose_a_thread_from_the_inbox_1o03')}</span></div>
            : detailErr ? <div className="ci-empty center bad">{detailErr}</div>
            : !detail ? <div className="ci-empty center">{tx('ci.loading')}</div> : (
              <>
                <ConvHeader d={detail} onBook={book} onLink={() => setDlg('link')} onAssign={() => setDlg('assign')} onFollow={() => setDlg('follow')}
                  onUnread={() => act2(() => posCommunicationsApi.inbox.unread(detail.thread.id))}
                  onClose={() => act2(() => posCommunicationsApi.inbox.status(detail.thread.id, detail.thread.status === 'closed' ? 'open' : 'closed', v))}
                  onProfile={() => detail.customer && nav(`/customers?customerId=${encodeURIComponent(detail.customer.id)}`)}
                  onHistory={() => detail.customer && nav(`/tenant/customers/appointment-history?customerId=${encodeURIComponent(detail.customer.id)}`)} />
                <div className="ci-tabs" role="tablist">
                  <button type="button" role="tab" aria-selected={tab === 'conversation'} className={tab === 'conversation' ? 'on' : ''} onClick={() => setTab('conversation')} data-testid="tab-conversation">{tx('ci.tab.conversation')}</button>
                  <button type="button" role="tab" aria-selected={tab === 'timeline'} className={tab === 'timeline' ? 'on' : ''} onClick={() => setTab('timeline')} data-testid="tab-timeline">{detail.customer ? tx('ci.tab.timeline') : tx('ci.tab.timelineContact')}</button>
                </div>
                {tab === 'conversation' ? (
                  <div className="ci-msgs" ref={scroller} onScroll={() => { stick.current = atBottom(scroller.current); }} data-testid="ci-msgs">
                    {olderCursor ? <button type="button" className="ci-btn ghost older" onClick={loadOlder} data-testid="ci-older">{tx('ci.loadOlder')}</button> : null}
                    {messages.length === 0 ? <div className="ci-empty">{tx('ci.noMessages')}</div> : messages.map((m) => <Bubble key={m.id} m={m} name={detail.customer?.name ?? null} />)}
                  </div>
                ) : <Timeline threadId={detail.thread.id} tick={live.tick} />}
                <Composer d={detail} draft={draft} setDraft={setDraft} sending={sending} onSend={send} onBook={book} tplOpen={tplOpen} tpl={tpl} onTemplates={openTemplates} onUseTemplate={useTemplate}
                  onSetup={() => nav(detail.composer.readiness?.fixLink || '/tenant/communications/messaging-setup')} />
              </>
            )}
        </div>
      </section>

      {/* lower modules (kept) */}
      <section className="ci-mods">
        <div className="ci-card">
          <div className="ci-card-t">{tx('pos.channel_mix')}</div>
          <ChannelMix items={(sum?.channelMix ?? []).map((x) => ({ label: tx('ci.ch.' + x.channel), count: x.count }))} loading={sum === undefined} />
        </div>
        <div className="ci-card">
          <div className="ci-card-t">{tx('pos.ai_receptionist_missed_calls')}</div>
          <div className="ci-pair">
            <div><span>{tx('pos.missed_threads')}</span><b style={{ color: 'var(--aps-danger)' }}>{n((k as { missedThreads?: number } | undefined)?.missedThreads)}</b></div>
            <div><span>{tx('pos.ai_calls_handled')}</span><b>{metricText(act === null ? null : act?.aiCallsHandled)}</b></div>
            <div><span>{tx('pos.open_threads')}</span><b>{n(k?.open)}</b></div>
          </div>
          <div className="ci-row"><button type="button" className="ci-btn" onClick={() => nav('/tenant/communications/ai-receptionist')}>{tx('pos.open_ai_receptionist')}</button><button type="button" className="ci-btn" onClick={() => nav('/follow-ups')}>{tx('pos.missed_call_follow_up')}</button></div>
        </div>
        <div className="ci-card">
          <div className="ci-card-t">{tx('pos.communication_performance')}</div>
          <div className="ci-pair">
            <div><span>{tx('ci.perf.submittedToday')}</span><b>{sum ? sum.sentToday.submitted : '—'}</b></div>
            <div><span>{tx('ci.perf.deliveredToday')}</span><b style={{ color: 'var(--aps-ok)' }}>{sum ? sum.sentToday.delivered : '—'}</b></div>
            <div><span>{tx('ci.perf.failedToday')}</span><b style={{ color: 'var(--aps-danger)' }}>{sum ? sum.sentToday.failed : '—'}</b></div>
            <div><span>{tx('ci.perf.waiting')}</span><b>{n(k?.awaiting)}</b></div>
          </div>
          <div className="ci-small">{k?.oldestAwaitingSince ? tx('ci.perf.oldest', { t: waitText(k.oldestAwaitingSince) }) : tx('ci.perf.none')} · {tx('ci.perf.basis')}</div>
        </div>
        <div className="ci-card">
          <div className="ci-card-t">{tx('pos.campaign_center')}</div>
          <div className="ci-small">{tx('ci.campaignHint')}</div>
          <div className="ci-row"><button type="button" className="ci-btn" onClick={() => nav('/tenant/marketing/campaigns')}>{tx('pos.open_campaigns')}</button></div>
        </div>
        <div className="ci-card">
          <div className="ci-card-t">{tx('pos.automations_templates')}</div>
          <div className="ci-small">{tx('ci.autoHint')}</div>
          <div className="ci-row wrap">
            <button type="button" className="ci-btn" onClick={() => nav('/tenant/communications/reminders')}>{tx('pos.appointment_reminders')}</button>
            <button type="button" className="ci-btn" onClick={() => nav('/settings/follow-ups')}>{tx('pos.follow_up_settings')}</button>
            <button type="button" className="ci-btn" onClick={() => nav('/tenant/communications/templates')}>{tx('pos.open_templates')}</button>
          </div>
        </div>
        <div className="ci-card">
          <div className="ci-card-t">{tx('pos.ai_communication_insights')} <span className="ci-tag">{tx('ci.aiLabel')}</span></div>
          <div className="ci-small">{tx('ci.aiHint')}</div>
          <div className="ci-row"><button type="button" className="ci-btn" onClick={() => nav('/tenant/ai/usage')}>{tx('ci.aiOpen')}</button></div>
        </div>
      </section>

      <section className="ci-card">
        <div className="ci-card-t">{tx('pos.quick_actions_2')}</div>
        <div className="ci-row wrap" data-testid="ci-quick">
          <button type="button" className="ci-btn" onClick={() => setDlg('new')} data-testid="qa-new">{tx('pos.new_message')}</button>
          <button type="button" className="ci-btn" onClick={() => nav('/tenant/marketing/campaigns')} data-testid="qa-campaign">{tx('pos.send_campaign')}</button>
          <button type="button" className="ci-btn" onClick={() => nav('/tenant/communications/reminders')} data-testid="qa-reminder">{tx('pos.schedule_reminder')}</button>
          <button type="button" className="ci-btn" onClick={() => nav('/tenant/communications/ai-receptionist')} data-testid="qa-ai">{tx('pos.ai_receptionist')}</button>
          <button type="button" className="ci-btn" onClick={() => nav('/tenant/ai/reviews')} data-testid="qa-review">{tx('pos.request_review')}</button>
          <button type="button" className="ci-btn" onClick={() => nav('/tenant/communications/templates')} data-testid="qa-template">{tx('pos.create_template')}</button>
          <button type="button" className="ci-btn" onClick={() => nav('/reports')} data-testid="qa-reports">{tx('pos.view_reports')}</button>
        </div>
      </section>

      {dlg === 'new' ? <NewMessageDialog onClose={() => setDlg(null)} onOpened={(id) => { setDlg(null); go({ ...st, thread: id }); live.refreshNow(); }} /> : null}
      {dlg === 'link' && detail ? <LinkDialog title={tx('ci.link.title')} onClose={() => setDlg(null)} onPick={(cid) => { setDlg(null); act2(() => posCommunicationsApi.inbox.linkCustomer(detail.thread.id, cid, v)); }} /> : null}
      {dlg === 'assign' && detail ? <AssignDialog current={detail.thread.assignedTo} onClose={() => setDlg(null)} onPick={(uid) => { setDlg(null); act2(() => posCommunicationsApi.inbox.assign(detail.thread.id, uid, v)); }} /> : null}
      {dlg === 'follow' && detail ? <FollowUpDialog current={detail.thread.followUpDueAt} onClose={() => setDlg(null)} onSave={(at, reason) => { setDlg(null); act2(() => posCommunicationsApi.inbox.followUp(detail.thread.id, at, v, reason)); }} /> : null}
    </div>
  );
}

function ThreadRow({ t, on, draft, onOpen }: { t: InboxThread; on: boolean; draft: boolean; onOpen: () => void }) {
  const w = waitedFor(t.awaitingSince); const tone = waitTone(w?.minutes ?? null);
  const name = t.identity === 'linked' ? (t.displayName || tx('ci.customer')) : t.identity === 'ambiguous' ? tx('ci.possibleMatch') : tx('ci.unknownContact');
  return (
    <button type="button" role="listitem" className={'ci-thread' + (on ? ' on' : '') + (t.unreadCount ? ' unread' : '')} onClick={onOpen} aria-current={on || undefined} data-testid="ci-thread" data-thread-id={t.id}>
      <div className="ci-thread-1"><span className="ci-name">{name}</span><span className="ci-time">{when(t.lastActivityAt)}</span></div>
      <div className="ci-thread-2">
        <span className={'ci-ch ' + t.channel}>{tx('ci.ch.' + t.channel)}</span>
        <span className={'ci-st ' + t.status}>{tx('ci.st.' + t.status)}</span>
        {t.contactMasked ? <span className="ci-mask">{t.contactMasked}</span> : null}
        {t.unreadCount ? <span className="ci-unread" aria-label={tx('ci.unreadN', { n: String(t.unreadCount) })}>{t.unreadCount}</span> : null}
      </div>
      <div className="ci-thread-3">{draft ? <span className="ci-draft">{tx('ci.draft')}</span> : null}{t.lastDirection === 'outbound' ? tx('ci.you') + ' ' : ''}{t.lastMessagePreview || '—'}</div>
      {(w || t.assignedToName || t.followUpDueAt || t.branchName) ? (
        <div className="ci-thread-4">
          {w ? <span className={'ci-wait ' + tone}>{tx('ci.waiting', { t: waitText(t.awaitingSince) })}</span> : null}
          {t.followUpDueAt ? <span className="ci-fu">{tx('ci.followBy', { t: when(t.followUpDueAt) })}</span> : null}
          {t.assignedToName ? <span className="ci-as">{t.assignedToName}</span> : null}
          {t.branchName ? <span className="ci-br">{t.branchName}</span> : null}
        </div>
      ) : null}
    </button>
  );
}

function ConvHeader({ d, onBook, onLink, onAssign, onFollow, onUnread, onClose, onProfile, onHistory }: { d: InboxDetail; onBook: () => void; onLink: () => void; onAssign: () => void; onFollow: () => void; onUnread: () => void; onClose: () => void; onProfile: () => void; onHistory: () => void }) {
  const t = d.thread; const m = d.permissions.canManage;
  const name = d.customer?.name || (t.identity === 'ambiguous' ? tx('ci.possibleMatch') : tx('ci.unknownContact'));
  return (
    <div className="ci-conv-h" data-testid="ci-conv-head">
      <div className="ci-who">
        <div className="ci-who-1"><b data-testid="ci-conv-name">{name}</b>
          {t.identity === 'linked' ? <span className="ci-id ok">{t.customerMatch === 'manual' ? tx('ci.id.manual') : tx('ci.id.linked')}</span>
            : t.identity === 'ambiguous' ? <span className="ci-id warn">{tx('ci.id.ambiguous', { n: String(d.ambiguousCandidates) })}</span> : <span className="ci-id">{tx('ci.id.unknown')}</span>}
          <span className={'ci-ch ' + t.channel}>{tx('ci.ch.' + t.channel)}</span><span className={'ci-st ' + t.status}>{tx('ci.st.' + t.status)}</span>
        </div>
        <div className="ci-who-2">
          <span data-testid="ci-conv-contact">{t.contact ?? ''}</span>
          {t.branchName ? <span>· {t.branchName}</span> : null}
          {t.assignedToName ? <span>· {tx('ci.assignedTo', { n: t.assignedToName })}</span> : null}
          {d.consent.smsOptedOut ? <span className="ci-id bad" data-testid="ci-optedout">{tx('ci.optedOut')}</span> : null}
          {d.customer ? <span className="ci-small">{d.consent.marketingSmsOptIn ? tx('ci.mktYes') : tx('ci.mktNo')}</span> : null}
          {d.nextAppointment ? <span className="ci-id ok">{tx('ci.nextAppt', { d: d.nextAppointment.date, t: d.nextAppointment.startTime ?? '' })}</span> : null}
          {t.followUpDueAt ? <span className="ci-fu">{tx('ci.followBy', { t: when(t.followUpDueAt) })}</span> : null}
        </div>
      </div>
      <div className="ci-actions">
        {d.customer ? <button type="button" className="ci-btn" onClick={onProfile} data-testid="ci-view-customer">{tx('ci.viewCustomer')}</button> : null}
        {d.customer ? <button type="button" className="ci-btn" onClick={onHistory}>{tx('ci.history')}</button> : null}
        {!d.customer && m ? <button type="button" className="ci-btn" onClick={onLink} data-testid="ci-link">{tx('ci.link.action')}</button> : null}
        <button type="button" className="ci-btn gold" onClick={onBook} data-testid="ci-book">{tx('ci.book')}</button>
        {m ? <button type="button" className="ci-btn" onClick={onAssign} data-testid="ci-assign">{tx('ci.assign')}</button> : null}
        {m ? <button type="button" className="ci-btn" onClick={onFollow} data-testid="ci-follow">{tx('ci.followUp')}</button> : null}
        <button type="button" className="ci-btn" onClick={onUnread} data-testid="ci-unread">{tx('ci.markUnread')}</button>
        {m ? <button type="button" className="ci-btn" onClick={onClose} data-testid="ci-close">{t.status === 'closed' ? tx('ci.reopen') : tx('ci.close')}</button> : null}
      </div>
    </div>
  );
}

function Bubble({ m, name }: { m: InboxMessage; name: string | null }) {
  const out = m.direction === 'outbound';
  const who = out ? (m.authorKind === 'ai' ? tx('ci.by.ai') : m.authorKind === 'system' ? tx('ci.by.system') : (m.authorName || tx('pos.staff'))) : (name || tx('ci.customer'));
  return (
    <div className={'ci-bub ' + (out ? 'out' : 'in') + (m.authorKind === 'ai' || m.authorKind === 'system' ? ' auto' : '')} data-testid="ci-bubble" data-delivery={m.delivery}>
      <div className="ci-bub-b">{m.body}{m.mediaCount ? <div className="ci-small">{tx('ci.media', { n: String(m.mediaCount) })}</div> : null}</div>
      <div className="ci-bub-m">
        <span>{who} · {when(m.createdAt)}</span>
        {out ? <span className={'ci-dl ' + deliveryTone(m.delivery)} data-testid="ci-delivery">{tx('ci.dl.' + m.delivery)}{m.reasonCode ? ' — ' + reasonText(m.reasonCode) : ''}{m.providerErrorCode ? ` (${m.providerErrorCode})` : ''}</span> : null}
      </div>
    </div>
  );
}

function Composer({ d, draft, setDraft, sending, onSend, onBook, tplOpen, tpl, onTemplates, onUseTemplate, onSetup }: { d: InboxDetail; draft: string; setDraft: (v: string) => void; sending: boolean; onSend: () => void; onBook: () => void; tplOpen: boolean; tpl: { id: string; name: string; body: string; scope: string }[] | null; onTemplates: () => void; onUseTemplate: (x: { id: string; body: string; scope: string }) => void; onSetup: () => void }) {
  const c = d.composer; const seg = segmentsOf(draft);
  return (
    <div className="ci-compose" data-testid="ci-composer">
      {!c.enabled ? (
        <div className="ci-blocked" data-testid="ci-composer-blocked" data-reason={c.reasonCode ?? ''}>
          <span>{txOr('ci.blocked.' + (c.reasonCode ?? 'SENDER_NOT_READY'), tx('ci.blocked.SENDER_NOT_READY'))}</span>
          {c.reasonCode && !['NO_PERMISSION', 'CALL_THREAD', 'OPTED_OUT'].includes(c.reasonCode) ? <button type="button" className="ci-link" onClick={onSetup}>{tx('ci.openSetup')}</button> : null}
        </div>
      ) : c.readiness && c.readiness.warnings.length ? <div className="ci-small warn">{tx('ci.readinessWarn')}</div> : null}
      <div className="ci-compose-r">
        <textarea className="ci-text" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={tx('pos.type_a_message')} aria-label={tx('pos.type_a_message')} rows={2} maxLength={1600}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSend(); } }} data-testid="ci-text" />
        <div className="ci-compose-b">
          <button type="button" className="ci-btn gold" disabled={!c.enabled || sending || !draft.trim()} onClick={onSend} data-testid="ci-send">{sending ? tx('pos.sending') : tx('pos.send')}</button>
          <div className="ci-row">
            <button type="button" className="ci-btn" onClick={onTemplates} aria-expanded={tplOpen} data-testid="ci-templates">{tx('ci.templates')}</button>
            <button type="button" className="ci-btn" onClick={onBook} data-testid="ci-book-2">{tx('ci.bookShort')}</button>
          </div>
        </div>
      </div>
      <div className="ci-small">{seg.chars ? tx('ci.segments', { c: String(seg.chars), s: String(seg.segments), e: seg.encoding }) : tx('ci.ctrlEnter')}</div>
      {tplOpen ? (
        <div className="ci-tpl" role="listbox" data-testid="ci-tpl-list">
          {tpl === null ? <div className="ci-small">{tx('ci.loading')}</div> : tpl.length === 0 ? <div className="ci-small">{tx('ci.noTemplates')}</div>
            : tpl.map((x) => <button type="button" role="option" key={x.id} className="ci-tpl-i" onClick={() => onUseTemplate(x)} data-testid="ci-tpl"><b>{x.name}</b><span>{x.body}</span></button>)}
        </div>
      ) : null}
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = { message: 'ci.src.message', automated: 'ci.src.automated', review_request: 'ci.src.review', call: 'ci.src.call', ai_follow_up: 'ci.src.followup', appointment: 'ci.src.appointment' };
function Timeline({ threadId, tick }: { threadId: string; tick: number }) {
  const [src, setSrc] = useState<string>('');
  const [ev, setEv] = useState<InboxTimelineEvent[] | null>(null); const [cur, setCur] = useState<string | null>(null); const [scope, setScope] = useState<'customer' | 'contact'>('customer'); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { let alive = true; posCommunicationsApi.inbox.timeline(threadId, { sources: src || null }).then((r) => { if (!alive) return; setEv(r.events); setCur(r.olderCursor); setScope(r.scope); setErr(null); }, (e) => alive && setErr(errText(e, tx('ci.timelineFailed')))); return () => { alive = false; }; }, [threadId, src, tick]);
  const more = async () => { if (!cur) return; const r = await posCommunicationsApi.inbox.timeline(threadId, { before: cur, sources: src || null }).catch(() => null); if (r) { setEv((x) => [...r.events, ...(x ?? [])]); setCur(r.olderCursor); } };
  return (
    <div className="ci-msgs ci-tl" data-testid="ci-timeline">
      <div className="ci-row wrap">
        <span className="ci-small">{scope === 'customer' ? tx('ci.tl.customerScope') : tx('ci.tl.contactScope')}</span>
        <select className="ci-sel small" value={src} onChange={(e) => setSrc(e.target.value)} aria-label={tx('ci.tl.filter')} data-testid="ci-tl-source">
          <option value="">{tx('ci.tl.all')}</option>{Object.keys(SOURCE_LABEL).map((s) => <option key={s} value={s}>{tx(SOURCE_LABEL[s])}</option>)}
        </select>
      </div>
      {cur ? <button type="button" className="ci-btn ghost older" onClick={more}>{tx('ci.loadOlder')}</button> : null}
      {err ? <div className="ci-empty bad">{err}</div> : ev === null ? <div className="ci-empty">{tx('ci.loading')}</div> : ev.length === 0 ? <div className="ci-empty">{tx('ci.tl.none')}</div> : ev.map((e) => (
        <div key={e.source + e.id} className={'ci-ev ' + e.source} data-testid="ci-event" data-type={e.type}>
          <div className="ci-ev-h"><span className={'ci-ch ' + e.channel}>{tx('ci.ch.' + e.channel)}</span><b>{txOr('ci.ev.' + e.type, tx('ci.ev.other'))}</b><span className="ci-time">{when(e.at)}</span>
            {e.actorKind === 'ai' ? <span className="ci-tag">{tx('ci.aiLabel')}</span> : null}
            {e.state ? <span className={'ci-dl ' + deliveryTone(e.state)}>{txOr('ci.dl.' + e.state, txOr('ci.state.' + e.state, tx('ci.state.other')))}</span> : null}</div>
          {e.body ? <div className="ci-ev-b">{e.body}</div> : null}
          {e.summary ? <div className="ci-ev-b muted">{e.summary}</div> : null}
        </div>
      ))}
    </div>
  );
}

function ChannelMix({ items, loading }: { items: { label: string; count: number }[]; loading: boolean }) {
  const total = items.reduce((a, x) => a + x.count, 0);
  if (loading) return <div className="ci-small" data-testid="ci-mix">{tx('ci.loading')}</div>;
  if (!total) return <div className="ci-small" data-testid="ci-mix">{tx('pos.no_conversations_yet')}</div>;
  return (
    <div className="ci-mix" data-testid="ci-mix">
      {items.filter((x) => x.count > 0).map((x) => (
        <div key={x.label} className="ci-mix-r"><span>{x.label}</span><span className="ci-bar"><i style={{ width: `${Math.max(2, Math.round((x.count / total) * 100))}%` }} /></span><b>{x.count} · {Math.round((x.count / total) * 100)}%</b></div>
      ))}
    </div>
  );
}

function Pager({ page, pageCount, onPage }: { page: number; pageCount: number; onPage: (p: number) => void }) {
  const nums: number[] = [];
  const lo = Math.max(1, Math.min(page - 1, pageCount - 2)); for (let i = lo; i <= Math.min(pageCount, lo + 2); i++) nums.push(i);
  return (
    <nav className="ci-pager" aria-label={tx('ci.pages')} data-testid="ci-pager">
      <button type="button" className="ci-pg" disabled={page <= 1} onClick={() => onPage(page - 1)} data-testid="pg-prev">{tx('ci.prev')}</button>
      {nums.map((p) => <button type="button" key={p} className={'ci-pg' + (p === page ? ' on' : '')} aria-current={p === page ? 'page' : undefined} onClick={() => onPage(p)} data-testid={'pg-' + p}>{p}</button>)}
      <button type="button" className="ci-pg" disabled={page >= pageCount} onClick={() => onPage(page + 1)} data-testid="pg-next">{tx('ci.next')}</button>
    </nav>
  );
}

function PeriodPicker({ st, server, onChange }: { st: InboxUrlState; server: { from: string | null; to: string | null; tz: string; today: string } | null; onChange: (p: Partial<InboxUrlState>) => void }) {
  const [open, setOpen] = useState(false);
  const label = st.preset === 'custom' ? `${st.from} → ${st.to}` : tx('ci.preset.' + st.preset);
  return (
    <div className="ci-period">
      <select className="ci-sel" value={st.preset === 'custom' ? 'custom' : st.preset} onChange={(e) => { const p = e.target.value as InboxUrlState['preset']; if (p === 'custom') setOpen(true); else onChange({ preset: p, from: '', to: '' }); }} aria-label={tx('ci.period')} data-testid="ci-preset">
        {PRESETS.map((p) => <option key={p} value={p}>{p === 'custom' && st.preset === 'custom' ? label : tx('ci.preset.' + p)}</option>)}
      </select>
      {st.preset !== 'all' ? (
        <select className="ci-sel" value={st.basis} onChange={(e) => onChange({ basis: e.target.value as InboxUrlState['basis'] })} aria-label={tx('ci.basis')} data-testid="ci-basis">
          {BASES.map((b) => <option key={b} value={b}>{tx('ci.basis.' + b)}</option>)}
        </select>
      ) : null}
      {st.preset !== 'all' && server?.tz ? <span className="ci-small" data-testid="ci-active-period" title={server.tz}>{server.from && server.to ? `${server.from} → ${server.to}` : ''}</span> : null}
      {open ? (
        <div className="ci-cal" data-testid="ci-calendar">
          <RangeCalendar initial={{ from: st.from || undefined, to: st.to || undefined }} today={server?.today ?? deviceToday()}
            onApply={(r) => { setOpen(false); onChange({ preset: 'custom', from: r.from, to: r.to }); }} onCancel={() => setOpen(false)} onClear={() => { setOpen(false); onChange({ preset: 'all', from: '', to: '' }); }} />
        </div>
      ) : null}
    </div>
  );
}

function Dialog({ title, onClose, children, testId }: { title: string; onClose: () => void; children: React.ReactNode; testId?: string }) {
  useEscapeToClose(onClose);
  return (
    <div className="ci-dlg-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ci-dlg" role="dialog" aria-modal="true" aria-label={title} data-testid={testId}>
        <div className="ci-dlg-h"><b>{title}</b><button type="button" className="ci-x" onClick={onClose} aria-label={tx('ci.closeDialog')}>✕</button></div>
        {children}
      </div>
    </div>
  );
}

function CustomerSearch({ onPick, allowPhone, onPhone }: { onPick: (id: string) => void; allowPhone?: boolean; onPhone?: (p: string) => void }) {
  const [q, setQ] = useState(''); const dq = useDebounced(q, 250);
  const [items, setItems] = useState<{ id: string; name: string | null; phoneMasked: string | null; hasPhone: boolean; emailMasked: string | null }[] | null>(null);
  useEffect(() => { if (dq.trim().length < 2) { setItems(null); return; } let alive = true; posCommunicationsApi.inbox.customers(dq.trim()).then((r) => alive && setItems(r.items), () => alive && setItems([])); return () => { alive = false; }; }, [dq]);
  const digits = q.replace(/\D/g, '');
  return (
    <div className="ci-csearch">
      <input className="ci-search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx('ci.custSearchPh')} aria-label={tx('ci.custSearchPh')} data-testid="ci-cust-q" />
      <div className="ci-clist">
        {items === null ? <div className="ci-small">{tx('ci.custSearchHint')}</div> : items.length === 0 ? <div className="ci-small">{tx('ci.custNone')}</div>
          : items.map((c) => <button type="button" key={c.id} className="ci-cust" onClick={() => onPick(c.id)} disabled={allowPhone && !c.hasPhone} data-testid="ci-cust"><b>{c.name || '—'}</b><span>{c.phoneMasked ?? tx('ci.noPhone')}{c.emailMasked ? ' · ' + c.emailMasked : ''}</span></button>)}
      </div>
      {allowPhone && onPhone && digits.length >= 10 ? <button type="button" className="ci-btn" onClick={() => onPhone(q)} data-testid="ci-use-phone">{tx('ci.textNumber', { n: q.trim() })}</button> : null}
    </div>
  );
}

function NewMessageDialog({ onClose, onOpened }: { onClose: () => void; onOpened: (threadId: string) => void }) {
  const [err, setErr] = useState<string | null>(null); const key = useRef(newRequestKey());
  const open = (b: { customerId?: string; phone?: string }) => posCommunicationsApi.inbox.start(b, key.current).then((r) => onOpened(r.threadId), (e) => { key.current = newRequestKey(); setErr(errText(e, tx('ci.actionFailed'))); });
  return (
    <Dialog title={tx('pos.new_message')} onClose={onClose} testId="ci-dlg-new">
      <div className="ci-small">{tx('ci.newHint')}</div>
      <CustomerSearch allowPhone onPick={(id) => open({ customerId: id })} onPhone={(p) => open({ phone: p })} />
      {err ? <div className="ci-note bad">{err}</div> : null}
    </Dialog>
  );
}
function LinkDialog({ title, onClose, onPick }: { title: string; onClose: () => void; onPick: (id: string) => void }) {
  return (<Dialog title={title} onClose={onClose} testId="ci-dlg-link"><div className="ci-small">{tx('ci.link.hint')}</div><CustomerSearch onPick={onPick} /></Dialog>);
}
function AssignDialog({ current, onClose, onPick }: { current: string | null; onClose: () => void; onPick: (id: string | null) => void }) {
  const [staff, setStaff] = useState<{ id: string; name: string }[] | null>(null);
  useEffect(() => { posCommunicationsApi.inbox.staff().then((r) => setStaff(r.items), () => setStaff([])); }, []);
  return (
    <Dialog title={tx('ci.assign')} onClose={onClose} testId="ci-dlg-assign">
      <div className="ci-clist">
        {current ? <button type="button" className="ci-cust" onClick={() => onPick(null)}><b>{tx('ci.unassign')}</b></button> : null}
        {staff === null ? <div className="ci-small">{tx('ci.loading')}</div> : staff.map((s) => <button type="button" key={s.id} className={'ci-cust' + (s.id === current ? ' on' : '')} onClick={() => onPick(s.id)} data-testid="ci-staff"><b>{s.name}</b></button>)}
      </div>
    </Dialog>
  );
}
function FollowUpDialog({ current, onClose, onSave }: { current: string | null; onClose: () => void; onSave: (at: string | null, reason?: string) => void }) {
  const toLocal = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  const [at, setAt] = useState(toLocal(current)); const [reason, setReason] = useState('');
  const quick = (h: number) => setAt(toLocal(new Date(Date.now() + h * 3600_000).toISOString()));
  return (
    <Dialog title={tx('ci.followUp')} onClose={onClose} testId="ci-dlg-follow">
      <div className="ci-small">{tx('ci.followHint')}</div>
      <div className="ci-row wrap"><button type="button" className="ci-btn" onClick={() => quick(1)}>{tx('ci.in1h')}</button><button type="button" className="ci-btn" onClick={() => quick(4)}>{tx('ci.in4h')}</button><button type="button" className="ci-btn" onClick={() => quick(24)}>{tx('ci.tomorrow')}</button></div>
      <input className="ci-search" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} aria-label={tx('ci.followAt')} data-testid="ci-follow-at" />
      <input className="ci-search" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder={tx('ci.followReason')} aria-label={tx('ci.followReason')} />
      <div className="ci-row">
        <button type="button" className="ci-btn gold" disabled={!at} onClick={() => onSave(new Date(at).toISOString(), reason.trim() || undefined)} data-testid="ci-follow-save">{tx('ci.save')}</button>
        {current ? <button type="button" className="ci-btn" onClick={() => onSave(null)}>{tx('ci.clearFollow')}</button> : null}
        <button type="button" className="ci-btn ghost" onClick={onClose}>{tx('ci.cancel')}</button>
      </div>
    </Dialog>
  );
}
