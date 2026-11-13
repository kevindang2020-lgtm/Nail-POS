// CustomerProfilesDirectory.tsx — Customers → Customer Profiles (SUNMI guide, Nov 9 2026): the browse workspace around the
// existing profile page, and the Customer 360 Quick View.
//
//   • three balanced metrics — Total Customers · Recently Active · Needs Review (shared phone / email = Duplicate Review
//     signal) — from the Customer Search summary (one definition, never a second count)
//   • view mode All · Recently Active · New · Needs Review · which date (created / updated / last completed visit / next
//     booking) + presets / From–To · sort (newest created first by default) · numbered pages 10 / 25 / 50 / 100
//   • equal customer cards in a four-column grid (three → two → one as the width shrinks)
//   • Quick View: one customer id, the SAME /pos/customers/:id read as the Full View, four tabs — Overview · Loyalty &
//     Membership · Visits · Notes & Preferences — with Message, + Booking, Full View and Close. Read-only here: notes are edited
//     in Customer Notes (one editor, its own draft guard), points through the protected Request Bonus Points on the Full View.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { posCustomerSearchApi, type CustomerSearchQuery } from '../api/posCustomerSearchApi';
import { posCustomersApi } from '../api/posCustomersApi';
import { FitDialog, KpiCard, Pager, Empty, ErrorRetry } from './FitKit';
import { RangeCalendar, isForbidden } from './FinanceKit';
import { errorTextOf } from '../i18n/error-text';
import { fmtInZone, fmtNumber, fmtYmd } from '../i18n/format';
import { money } from '../screens/reportsCommon';
import { deviceToday } from '../lib/deviceToday';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { LoyaltyBonusRequest } from './LoyaltyBonusRequest';
import { useCan } from './usePermissions';
import { auditActionLabel } from './codeLabel';
import type { CustomerQuickActivity } from '@aipowersalon/api-contracts/tenant';

const tt = (k: string, v?: Record<string, string | number>) => t(k, v as Parameters<typeof t>[1]);
const VIEWS = [{ k: 'all', status: 'all', sort: 'newest' }, { k: 'active', status: 'active', sort: 'last_visit' }, { k: 'new', status: 'new', sort: 'newest' }, { k: 'review', status: 'duplicate', sort: 'newest' }] as const;
const DATE_FIELDS = ['created', 'updated', 'last_visit', 'appointment'] as const;
const SORTS = ['newest', 'last_visit', 'name', 'visits'] as const;
const day = (iso?: string | null) => (!iso ? '—' : /^\d{4}-\d{2}-\d{2}$/.test(iso) ? fmtYmd(iso, { month: 'short', day: '2-digit', year: 'numeric' }) || iso : fmtInZone(iso, { month: 'short', day: '2-digit', year: 'numeric' }) || '—');
const initials = (n?: string | null) => String(n ?? '').trim().split(/\s+/).slice(0, 2).map((x) => x.charAt(0).toUpperCase()).join('') || '•';
const errText = (e: unknown) => (isForbidden(e) ? tt('cpf.err.forbidden') : errorTextOf(e, tt('cpf.loadFailed')));

export type CpxCard = { id: string; name: string };

export function CustomerProfilesDirectory({ onOpen }: { onOpen: (c: CpxCard) => void }) {
  const [view, setView] = useState<(typeof VIEWS)[number]['k']>('all');
  const [f, setFState] = useState<CustomerSearchQuery>({ status: 'all', sort: 'newest', page: 1, pageSize: 25 });
  const [sum, setSum] = useState<any>(null); const [sumErr, setSumErr] = useState<string | null>(null);
  const [list, setList] = useState<any>(null); const [listErr, setListErr] = useState<string | null>(null);
  const [cal, setCal] = useState(false);
  const seq = useRef(0);
  const setF = (p: Partial<CustomerSearchQuery>, keepPage = false) => setFState((cur) => ({ ...cur, ...p, page: keepPage ? (p.page ?? cur.page) : 1 }));
  const loadSum = useCallback(() => { setSumErr(null); posCustomerSearchApi.summary({}).then(setSum).catch((e) => setSumErr(errText(e))); }, []);
  const loadList = useCallback(() => {
    const my = ++seq.current; setListErr(null);
    posCustomerSearchApi.customers(f).then((d) => { if (my === seq.current) setList(d); }).catch((e) => { if (my === seq.current) setListErr(errText(e)); });
  }, [f]);
  useEffect(loadSum, [loadSum]);
  useEffect(loadList, [loadList]);
  const k = sum?.kpis;
  const pickView = (v: (typeof VIEWS)[number]) => { setView(v.k); setF({ status: v.status, sort: v.sort }); };
  const items: any[] = list?.items ?? [];

  return (
    <div className="cpx" data-testid="cpx-directory">
      {sumErr ? <ErrorRetry message={sumErr} onRetry={loadSum} /> : null}
      <div className="rvw-kpis cpx-kpis" data-testid="cpx-kpis">
        <KpiCard testId="cpx-kpi-total" label={tt('cpf.kpi.total')} value={k ? fmtNumber(k.customers) : sumErr ? tt('cpf.unavailable') : '—'} loading={!sum && !sumErr} tone="gold" onClick={() => pickView(VIEWS[0])} />
        <KpiCard testId="cpx-kpi-active" label={tt('cpf.kpi.active')} value={k ? fmtNumber(k.active) : sumErr ? tt('cpf.unavailable') : '—'} loading={!sum && !sumErr} tone="ok"
          sub={sum?.definitions?.activeDays ? tt('cpf.kpi.activeSub', { d: sum.definitions.activeDays }) : undefined} onClick={() => pickView(VIEWS[1])} />
        <KpiCard testId="cpx-kpi-review" label={tt('cpf.kpi.review')} value={k ? fmtNumber(k.sharedContactProfiles) : sumErr ? tt('cpf.unavailable') : '—'} loading={!sum && !sumErr} tone={k?.sharedContactProfiles ? 'warn' : undefined}
          sub={tt('cpf.kpi.reviewSub')} onClick={() => pickView(VIEWS[3])} />
      </div>

      <section className="panel rvw-filters" data-testid="cpx-filters">
        <div className="rvw-tabs" role="tablist" data-testid="cpx-views">
          {VIEWS.map((v) => <button key={v.k} role="tab" aria-selected={view === v.k} className={'btn ghost' + (view === v.k ? ' on' : '')} data-testid={`cpx-view-${v.k}`} onClick={() => pickView(v)}>{tt('cpf.view.' + v.k)}</button>)}
        </div>
        <div className="rvw-dates" data-testid="cpx-dates">
          <label className="rvw-f"><span>{tt('cpf.f.dateField')}</span>
            <select data-testid="cpx-datefield" value={f.dateField ?? 'created'} onChange={(e) => setF({ dateField: e.target.value === 'created' ? undefined : e.target.value })}>
              {DATE_FIELDS.map((d) => <option key={d} value={d}>{tt('cpf.date.' + d)}</option>)}</select></label>
          <button className={'btn ghost' + (!f.preset ? ' on' : '')} data-testid="cpx-preset-all" onClick={() => setF({ preset: undefined, from: undefined, to: undefined })}>{tt('cnx.preset.all')}</button>
          {(['today', 'week', 'month', 'year'] as const).map((p) => <button key={p} className={'btn ghost' + (f.preset === p ? ' on' : '')} data-testid={`cpx-preset-${p}`} onClick={() => setF({ preset: p, from: undefined, to: undefined })}>{tt('cnx.preset.' + p)}</button>)}
          <button className={'btn ghost' + (f.preset === 'custom' ? ' on' : '')} data-testid="cpx-preset-custom" onClick={() => setCal(true)}>{f.preset === 'custom' ? `${f.from} → ${f.to}` : tt('cnx.preset.custom')}</button>
        </div>
        <label className="rvw-f"><span>{tt('cpf.f.sort')}</span>
          <select data-testid="cpx-sort" value={f.sort ?? 'newest'} onChange={(e) => setF({ sort: e.target.value })}>{SORTS.map((s) => <option key={s} value={s}>{tt('cpf.sort.' + s)}</option>)}</select></label>
        {cal ? <div className="rvw-cal" data-testid="cpx-cal"><RangeCalendar initial={{ from: f.from, to: f.to }} today={list?.period?.today ?? deviceToday()}
          onApply={(r) => { setF({ preset: 'custom', from: r.from, to: r.to }); setCal(false); }} onCancel={() => setCal(false)} onClear={() => { setF({ preset: undefined, from: undefined, to: undefined }); setCal(false); }} /></div> : null}
      </section>

      <section className="panel rvw-feed" data-testid="cpx-results">
        <div className="p-h">{tt('cpf.view.' + view)}<span className="sub rvw-scope" data-testid="cpx-count">{list ? tt('cpf.count', { n: fmtNumber(list.total ?? items.length), order: tt('cpf.sort.' + (f.sort ?? 'newest')) }) : ''}</span></div>
        {listErr ? <ErrorRetry message={listErr} onRetry={loadList} />
          : !list ? <div className="state">{tt('cpf.loading')}</div>
          : items.length === 0 ? <Empty title={tt('cpf.empty')} />
          : <div className="cpx-grid" data-testid="cpx-grid">{items.map((c) => (
            <button key={c.id} type="button" className="cpx-card" data-testid="cpx-card" onClick={() => onOpen({ id: String(c.id), name: String(c.name ?? '') })} title={c.name || undefined}>
              <span className="cpx-av" aria-hidden>{initials(c.name)}</span>
              <span className="cpx-card-b">
                <b className="cpx-name">{c.name || tt('cpf.unnamed')}</b>
                <span className="sub">{c.phone ?? tt('cpf.noPhone')}</span>
                <span className="cpx-meta">
                  <span>{tt('cpf.visits', { n: fmtNumber(Number(c.visits ?? 0)) })}</span>
                  <span className="sub">{c.lastVisitAt ? tt('cpf.lastVisit', { d: day(c.lastVisitAt) }) : tt('cpf.noVisitYet')}</span>
                </span>
                <span className="cpx-tags">
                  {c.lifecycle ? <span className="chip">{tt('cpf.life.' + c.lifecycle)}</span> : null}
                  {c.member ? <span className="chip ok">{tt('cpf.member')}</span> : null}
                  {c.nextAppointment ? <span className="chip info">{tt('cpf.next', { d: day(c.nextAppointment.date) })}</span> : null}
                  {c.sharedContactProfiles ? <span className="chip warn">{tt('cpf.shared', { n: c.sharedContactProfiles })}</span> : null}
                </span>
              </span>
            </button>))}</div>}
        <div className="rvw-pager">
          <Pager info={list ? { page: list.page ?? f.page ?? 1, pageSize: list.pageSize ?? f.pageSize ?? 25, totalItems: list.total ?? items.length, totalPages: list.totalPages ?? list.pageCount ?? 1 } : null} onPage={(p) => setF({ page: p }, true)} />
          <label className="rvw-f"><span>{tt('cnx.rows')}</span><select data-testid="cpx-pagesize" value={String(f.pageSize ?? 25)} onChange={(e) => setF({ pageSize: Number(e.target.value) })}>
            {['10', '25', '50', '100'].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
        </div>
      </section>
    </div>
  );
}

const QV_TABS = ['overview', 'loyalty', 'visits', 'notes', 'activity'] as const;   // 'activity' = receipts + activity (extras Customer 03)
/** Customer 360 Quick View — the same GET /pos/customers/:id the Full View reads; four tabs. */
/** extras Customer 05 — advisory follow-up status from the server's detail read (Booking, AI Follow-Ups, the profile's contact
 *  fields). Indicators only: nothing here messages the customer or changes a booking. Unknown (no permission) shows "—". */
type CpxFollowUpView = { upcoming: { count: number; nextDate: string | null; nextTime: string | null }; followUps: { active: number; overdue: number; nextDueAt: string | null } | null; contact: { hasPhone: boolean; phoneVerified: boolean; hasEmail: boolean } };
function FollowUpStatusStrip({ f }: { f: CpxFollowUpView }) {
  const contactGaps = [!f.contact.hasPhone ? tt('cpf.fu.noPhone') : !f.contact.phoneVerified ? tt('cpf.fu.phoneUnverified') : null, !f.contact.hasEmail ? tt('cpf.fu.noEmail') : null].filter(Boolean) as string[];
  return <div className="cpx-wide cpx-fu" data-testid="cpx-followup" role="group" aria-label={tt('cpf.fu.title')}>
    <b>{tt('cpf.fu.title')}</b>
    <span className={'chip ' + (f.upcoming.count ? 'ok' : 'muted')} data-testid="cpx-fu-upcoming">{f.upcoming.count ? tt('cpf.fu.upcoming', { n: fmtNumber(f.upcoming.count) }) : tt('cpf.fu.noUpcoming')}</span>
    <span className={'chip ' + (!f.followUps ? 'muted' : f.followUps.overdue ? 'bad' : f.followUps.active ? 'warn' : 'muted')} data-testid="cpx-fu-tasks">
      {!f.followUps ? tt('cpf.fu.tasksUnknown') : f.followUps.overdue ? tt('cpf.fu.overdue', { n: fmtNumber(f.followUps.overdue), a: fmtNumber(f.followUps.active) }) : f.followUps.active ? tt('cpf.fu.open', { n: fmtNumber(f.followUps.active) }) : tt('cpf.fu.noTasks')}</span>
    <span className={'chip ' + (contactGaps.length ? 'warn' : 'ok')} data-testid="cpx-fu-contact">{contactGaps.length ? contactGaps.join(' · ') : tt('cpf.fu.contactOk')}</span>
    <span className="hint">{tt('cpf.fu.note')}</span>
  </div>;
}

/** extras Customer 03 (Nov 13 2026): the Quick View's receipts + activity, read on first open of the tab from the read-only staff
 *  endpoint GET /pos/customers/:id/quick-activity. No print / resend controls here — the Full View keeps those. */
function QuickActivityPanel({ customerId, onFullView }: { customerId: string; onFullView: () => void }) {
  const [a, setA] = useState<CustomerQuickActivity | null>(null); const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { setErr(null); posCustomersApi.quickActivity(customerId).then(setA).catch((e: unknown) => setErr(errText(e))); }, [customerId]);
  useEffect(load, [load]);
  if (err) return <ErrorRetry message={err} onRetry={load} />;
  if (!a) return <div className="state">{tt('cpf.loading')}</div>;
  return (
    <div className="cpx-two" data-testid="cpx-activity">
      <div>
        <div className="cpx-subhead">{tt('cpf.qa.receipts', { n: a.receiptsTotal })}</div>
        {a.receipts.length === 0 ? <Empty title={tt('cpf.qa.noReceipts')} /> : <table className="tbl rvw-table"><thead><tr><th>{tt('cpf.col.date')}</th><th>{tt('cpf.qa.number')}</th><th>{tt('cpf.qa.sent')}</th><th className="num">{tt('cpf.col.total')}</th></tr></thead>
          <tbody>{a.receipts.map((r) => <tr key={r.receiptId} data-testid="cpx-receipt"><td className="nowrap">{day(r.date)}</td><td>{r.receiptNumber ?? '—'}</td><td>{tt('cpf.qa.channel.' + r.channel)}</td><td className="num">{money(r.totalCents)}</td></tr>)}</tbody></table>}
        {a.receiptsTotal > a.receipts.length ? <button className="btn ghost" data-testid="cpx-receipts-more" onClick={onFullView}>{tt('cpf.qa.more', { n: a.receiptsTotal - a.receipts.length })}</button> : null}
      </div>
      <div>
        <div className="cpx-subhead">{tt('cpf.qa.activity')}</div>
        {a.activity.length === 0 ? <Empty title={tt('cpf.qa.noActivity')} /> : <ul className="cpx-feed">{a.activity.map((x, i) => (
          <li key={i} data-testid="cpx-activity-item"><span className="nowrap">{day(x.at)}</span> · {x.kind === 'receipt' ? tt('cpf.qa.receiptIssued', { amount: money(x.amountCents ?? 0) }) : auditActionLabel(x.code)}{x.actorName ? <span className="sub"> · {x.actorName}</span> : null}</li>))}</ul>}
      </div>
    </div>
  );
}

export function CustomerQuickView({ customer, onClose, onFullView }: { customer: CpxCard; onClose: () => void; onFullView: () => void }) {
  const nav = useNavigate();
  const can = useCan();
  const [d, setD] = useState<any>(null); const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof QV_TABS)[number]>('overview');
  const [vp, setVp] = useState(1);
  const load = useCallback(() => { setErr(null); posCustomersApi.getDetail(customer.id).then(setD).catch((e: unknown) => setErr(errText(e))); }, [customer.id]);
  useEffect(load, [load]);
  const visits: any[] = d?.recentVisits ?? [];
  const VP = 10; const pages = Math.max(1, Math.ceil(visits.length / VP));
  const n = d?.notes ?? {};
  const field = (label: string, value: React.ReactNode) => <div className="cpx-f"><dt>{label}</dt><dd>{value ?? '—'}</dd></div>;
  return (
    <FitDialog side wide testId="cpx-quick" title={d?.displayName || customer.name || tt('cpf.unnamed')}
      subtitle={d ? `${d.status ? tt('cpf.status.' + d.status) : ''}${d.loyaltyTier ? ` · ${d.loyaltyTier}` : ''}${d.isVip ? ` · ${tt('cpf.vip')}` : ''}` : undefined} onClose={onClose}
      footer={<>
        <button className="btn ghost" data-testid="cpx-message" onClick={() => nav('/messages')}>{tt('cpf.act.message')}</button>
        <button className="btn ghost" data-testid="cpx-book" onClick={() => nav(`/booking/new?customerId=${encodeURIComponent(customer.id)}&from=customer-profiles`)}>{tt('cpf.act.book')}</button>
        <button className="btn" data-testid="cpx-full" onClick={onFullView}>{tt('cpf.act.full')}</button>
        <button className="btn ghost" onClick={onClose}>{tt('cpf.act.close')}</button>
      </>}>
      <div className="rvw-tabs cpx-qtabs" role="tablist">
        {QV_TABS.map((k) => <button key={k} role="tab" aria-selected={tab === k} className={'btn ghost' + (tab === k ? ' on' : '')} data-testid={`cpx-tab-${k}`} onClick={() => setTab(k)}>{tt('cpf.tab.' + k)}</button>)}
      </div>
      {err ? <ErrorRetry message={err} onRetry={load} /> : !d ? <div className="state">{tt('cpf.loading')}</div> : (
        <div className="cpx-qbody" role="tabpanel" data-testid={`cpx-panel-${tab}`}>
          {tab === 'overview' ? <div className="cpx-two">
            <dl className="cpx-dl">{field(tt('cpf.f.phone'), d.phone)}{field(tt('cpf.f.email'), d.email)}{field(tt('cpf.f.birthday'), d.birthday ? day(d.birthday) : null)}
              {field(tt('cpf.f.tags'), (d.tags ?? []).join(', ') || null)}
              {field(tt('cpf.f.consent'), [d.smsOptIn ? 'SMS' : null, d.emailOptIn ? 'Email' : null, d.marketingOptIn ? tt('cpf.marketing') : null].filter(Boolean).join(' · ') || tt('cpf.noConsent'))}</dl>
            <dl className="cpx-dl">{field(tt('cpf.f.visits'), fmtNumber(Number(d.visitCount ?? 0)))}{field(tt('cpf.f.spend'), money(Number(d.totalSpendCents ?? 0)))}
              {field(tt('cpf.f.avg'), money(Number(d.averageSpendCents ?? 0)))}{field(tt('cpf.f.last'), d.lastVisitAt ? day(d.lastVisitAt) : tt('cpf.noVisitYet'))}
              {field(tt('cpf.f.next'), d.followUpStatus?.upcoming?.nextDate ? fmtYmd(d.followUpStatus.upcoming.nextDate) + (d.followUpStatus.upcoming.nextTime ? ` · ${d.followUpStatus.upcoming.nextTime}` : '') : d.nextAppointmentAt ? day(d.nextAppointmentAt) : tt('cpf.none'))}</dl>
            {d.followUpStatus ? <FollowUpStatusStrip f={d.followUpStatus as CpxFollowUpView} /> : null}
          </div> : null}
          {tab === 'loyalty' ? <div className="cpx-two">
            <dl className="cpx-dl">{field(tt('cpf.f.points'), fmtNumber(Number(d.loyalty?.points ?? d.loyaltyPoints ?? 0)))}{field(tt('cpf.f.tier'), d.loyalty?.tier || d.loyaltyTier || null)}
              {field(tt('cpf.f.earned'), fmtNumber(Number(d.loyalty?.earned ?? 0)))}{field(tt('cpf.f.redeemed'), fmtNumber(Number(d.loyalty?.redeemed ?? 0)))}</dl>
            <dl className="cpx-dl">{field(tt('cpf.f.membership'), d.membership?.plan ? `${d.membership.plan} · ${d.membership.status}` : tt('cpf.none'))}
              {field(tt('cpf.f.giftCards'), (d.giftCards ?? []).length ? (d.giftCards as { maskedCode: string; balanceCents: number }[]).map((g) => `${g.maskedCode} ${money(Number(g.balanceCents ?? 0))}`).join(' · ') : tt('cpf.none'))}</dl>
            {/* Global Loyalty Protection: a POSITIVE bonus is requested and the owner approves it — points are never edited by hand */}
            <div className="cpx-wide" data-testid="cpx-bonus"><LoyaltyBonusRequest customerId={customer.id} currentPoints={d.loyalty?.points ?? d.loyaltyPoints ?? null} canRequest={can('pos.customers.loyalty.edit')} /></div>
          </div> : null}
          {tab === 'visits' ? <>
            {visits.length === 0 ? <Empty title={tt('cpf.noVisits')} /> : <div className="rvw-table-wrap"><table className="tbl rvw-table">
              <thead><tr><th>{tt('cpf.col.date')}</th><th>{tt('cpf.col.service')}</th><th>{tt('cpf.col.tech')}</th><th className="num">{tt('cpf.col.total')}</th></tr></thead>
              <tbody>{visits.slice((vp - 1) * VP, vp * VP).map((v) => <tr key={v.visitId} data-testid="cpx-visit"><td className="nowrap">{day(v.date)}</td><td>{v.serviceName}</td><td>{v.technicianName}</td><td className="num">{money(Number(v.totalCents ?? 0))}</td></tr>)}</tbody>
            </table></div>}
            {pages > 1 ? <div className="rvw-pager"><Pager info={{ page: vp, pageSize: VP, totalItems: visits.length, totalPages: pages }} onPage={setVp} /></div> : null}
            <button className="btn ghost" data-testid="cpx-history" onClick={() => nav('/tenant/customers/appointment-history')}>{tt('cpf.act.history')}</button>
          </> : null}
          {tab === 'notes' ? <div className="cpx-two">
            <dl className="cpx-dl">{field(tt('cpf.f.warnings'), n.warnings || null)}{field(tt('cpf.f.allergies'), n.allergyNotes || null)}</dl>
            <dl className="cpx-dl">{field(tt('cpf.f.prefTech'), n.preferredTechnician || null)}{field(tt('cpf.f.prefStyle'), n.preferredStyle || null)}
              {field(tt('cpf.f.prefService'), n.servicePreferences || null)}{field(tt('cpf.f.salonNotes'), n.salonNotes || null)}</dl>
            <button className="btn ghost cpx-wide" data-testid="cpx-edit-notes" onClick={() => nav('/tenant/customers/notes')}>{tt('cpf.act.editNotes')}</button>
          </div> : null}
          {tab === 'activity' ? <QuickActivityPanel customerId={customer.id} onFullView={onFullView} /> : null}
        </div>
      )}
    </FitDialog>
  );
}
