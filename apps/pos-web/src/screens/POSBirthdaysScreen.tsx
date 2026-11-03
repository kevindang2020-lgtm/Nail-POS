// POSBirthdaysScreen.tsx — Marketing & Growth → Birthday Campaigns (/tenant/marketing/birthdays). Birthday Campaigns guide
// (Oct 31 2026), rebuilt in place. Kept from the original page: the "Birthdays" title and subtitle, the Month dropdown
// (defaults to the current month), the matching-customer count and the customer list / empty state.
// Added (all server-side, /pos/birthdays/*):
//   KPI strip      birthdays in range · next 7 days · eligible SMS / email · sent this year · offers redeemed · visits after a message
//   ranges         Today / Next 7 Days / This Month / Next Month / This Year / Custom (a real month calendar, may cross years)
//   scopes         Selected period · All customers with birthdays · Missing birthdays; date basis occurrence / customer created
//   table          search (name / phone / email / ID / "10/15"), eligibility, sort, pages of 10 / 20 / 50 with exact totals
//   overlay        month/day only (never the age), source, visits, appointments, refunds, birthday messages and offers;
//                  Update birthday (customers.edit, versioned); Book Appointment with the customer preselected; Close
//   Missing Birthdays Center (read-only) · history · Feb 29 setting · Smart Birthday Campaign Assistant (an UNSENT draft)
// Nothing on this page sends a message, issues an offer or approves a campaign — that happens in Campaign Center.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posBirthdaysApi, type BirthdayQuery, type AssistantInput } from '../api/posBirthdaysApi';
import { posDealsOffersApi } from '../api/posDealsOffersApi';
import { useCan } from '../components/usePermissions';
import { errorTextOf } from '../i18n/error-text';
import { fmtMoney, fmtNumber, fmtInZone, fmtYmd } from '../i18n/format';
import { FitDialog, KpiCard, Pager, Empty, ErrorRetry, useDebounced, requestId } from '../components/FitKit';
import { RangeCalendar } from '../components/FinanceKit';
import { monthLong } from '../components/codeLabel';
import { deviceToday } from '../lib/deviceToday';

const PRESETS = ['today', 'next7', 'month', 'next_month', 'year'] as const;
const SCOPES = ['period', 'all', 'missing'] as const;
const SORTS = ['upcoming', 'newest', 'name_asc', 'name_desc'] as const;
const ELIG = ['sms_eligible', 'email_eligible', 'not_eligible'] as const;
const SIZES = [10, 20, 50];
const OBJECTIVES = ['greeting', 'service_promotion', 'loyalty_reward'] as const;
const nf = (n: number | null | undefined) => (n == null ? '—' : fmtNumber(n));
const md = (v: string | null | undefined) => (v ? fmtYmd(`2000-${v}`, { month: 'long', day: 'numeric' }, '—') : null);   // month/day only, never a year
const ymd = (v: string | null | undefined) => (v ? fmtYmd(v, { month: 'short', day: 'numeric', year: 'numeric' }, '—') : '—');
const when = (v: string | null | undefined) => (v ? fmtInZone(v, { month: 'short', day: 'numeric', year: 'numeric' }) : null);
const st = (s: string) => tx('bd.st.' + s) !== 'bd.st.' + s ? tx('bd.st.' + s) : s.replace(/_/g, ' ');

type Dlg = { kind: 'customer'; id: string } | { kind: 'missing' } | { kind: 'history' } | { kind: 'settings' } | { kind: 'assistant' } | null;

export function POSBirthdaysScreen() {
  const nav = useNavigate();
  const can = useCan();
  const canManage = can('marketing.manage');
  const canEdit = can('customers.edit');
  const [month, setMonth] = useState<number>(new Date().getMonth() + 1);
  const [preset, setPreset] = useState<string>('month');
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [calOpen, setCalOpen] = useState(false);
  const [scope, setScope] = useState<(typeof SCOPES)[number]>('period');
  const [basis, setBasis] = useState<'occurrence' | 'created'>('occurrence');
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 300);
  const [elig, setElig] = useState('');
  const [sort, setSort] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sum, setSum] = useState<any | null>(null);
  const [list, setList] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [reload, setReload] = useState(0);
  const [dlg, setDlg] = useState<Dlg>(null);

  // the range sent to the server: Month dropdown = "month", a preset, or a custom From → To
  const rangeQ = useMemo(() => (preset === 'custom' && range ? { preset: 'custom', from: range.from, to: range.to } : preset === 'month' ? { preset: 'month', month } : { preset }), [preset, range, month]);
  const query: BirthdayQuery = useMemo(() => ({ ...rangeQ, scope, basis: scope === 'period' ? basis : undefined, q: q || undefined, eligibility: elig || undefined, sort: sort || undefined, page, pageSize }),
    [rangeQ, scope, basis, q, elig, sort, page, pageSize]);
  useEffect(() => { setPage(1); }, [rangeQ, scope, basis, q, elig, sort, pageSize]);   // any filter change → page 1

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [s, l] = await Promise.all([posBirthdaysApi.summary(rangeQ), posBirthdaysApi.customers(query)]);
      setSum(s); setList(l);
    } catch (e: any) {
      if (e?.status === 403 || e?.code === 'PERMISSION_DENIED') setForbidden(true);
      setErr(errorTextOf(e, tx('pos.loading')));
    }
  }, [rangeQ, query]);
  useEffect(() => { void load(); }, [load, reload]);

  const rows: any[] = list?.items ?? [];
  const k = sum?.kpis; const comp = sum?.completeness;
  const rangeText = sum?.range ? tx('bd.range', { from: ymd(sum.range.from), to: ymd(sum.range.to) }) : '';
  const anyFilter = !!(search || elig || sort || scope !== 'period' || basis !== 'occurrence');
  const clearAll = () => { setSearch(''); setElig(''); setSort(''); setScope('period'); setBasis('occurrence'); };
  const label = preset === 'month' ? monthLong(month - 1) : rangeText;

  if (forbidden) return <div className="work sg bd" data-testid="birthdays-screen"><Empty title={tx('bd.noAccess')} /></div>;
  return (
    <div className="work rt rt2 sg bd" data-testid="birthdays-screen">
      <div className="vh bd-head">
        <div><h1>{tx('pos.birthdays')}</h1><div className="sub">{tx('pos.reach_customers_celebrating_this_month')}</div>
          {sum ? <div className="fk-muted bd-upd">{tx('bd.updated', { time: when(sum.asOf) ?? '', tz: sum.timezone })}</div> : null}</div>
        <div className="bd-actions">
          <button type="button" className="fk-btn ghost" onClick={() => setReload((n) => n + 1)} data-testid="bd-refresh">{tx('bd.refresh')}</button>
          <button type="button" className="fk-btn ghost" onClick={() => setDlg({ kind: 'history' })} data-testid="bd-history">{tx('bd.history')}</button>
          <button type="button" className="fk-btn ghost" onClick={() => setDlg({ kind: 'settings' })} data-testid="bd-settings">{tx('bd.settings')}</button>
          <button type="button" className="fk-btn primary" onClick={() => setDlg({ kind: 'assistant' })} disabled={!canManage} title={!canManage ? tx('bd.ai.noManage') : undefined} data-testid="bd-create">{tx('bd.create')}</button>
        </div>
      </div>

      <div className="fk-kpis six" data-testid="bd-kpis">
        <KpiCard label={tx('bd.kpi.range')} value={nf(k?.inRange)} sub={label} loading={!sum} testId="bd-kpi-range" />
        <KpiCard label={tx('bd.kpi.next7')} value={nf(k?.next7Days)} loading={!sum} onClick={() => { setPreset('next7'); setScope('period'); }} testId="bd-kpi-next7" />
        <KpiCard label={tx('bd.kpi.eligible')} value={nf(k ? k.eligibleSms : null)} sub={k ? tx('bd.kpi.eligibleSub', { sms: nf(k.eligibleSms), email: nf(k.eligibleEmail) }) : undefined} loading={!sum} testId="bd-kpi-eligible" />
        <KpiCard label={tx('bd.kpi.sent')} value={nf(k?.messagesSent)} sub={k ? tx('bd.kpi.sentSub', { year: String(k.occasionYear), inFlight: nf(k.messagesInFlight) }) : undefined} loading={!sum} onClick={() => setDlg({ kind: 'history' })} testId="bd-kpi-sent" />
        <KpiCard label={tx('bd.kpi.redeemed')} value={nf(k?.offersRedeemed)} loading={!sum} testId="bd-kpi-redeemed" />
        <KpiCard label={tx('bd.kpi.bookings')} value={nf(k?.bookingsAfterMessage)} sub={k ? `${fmtMoney(k.bookingsAfterMessageCents)} · ${tx('bd.kpi.bookingsSub', { days: String(k.associationDays) })}` : undefined} loading={!sum} testId="bd-kpi-bookings" />
      </div>

      <div className="rt-filters sg-tools bd-tools">
        <label className="bd-month"><span className="sub">{tx('pos.month')}</span>
          <select className="fk-select" value={preset === 'month' ? month : ''} onChange={(e) => { setMonth(Number(e.target.value)); setPreset('month'); setScope('period'); }} data-testid="bd-month">
            {preset !== 'month' ? <option value="">—</option> : null}
            {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{monthLong(i)}</option>)}
          </select></label>
        <span className="sub bd-count" data-testid="bd-count">{list ? `${nf(list.totalItems)} ${list.totalItems === 1 ? tx('pos.customer').toLowerCase() : tx('pos.customers').toLowerCase()}` : ''}</span>
        <div className="fk-seg bd-presets">
          {PRESETS.map((p) => <button key={p} type="button" className={preset === p ? 'on' : ''} aria-pressed={preset === p} onClick={() => { setPreset(p); setScope('period'); setCalOpen(false); }} data-testid={'bd-preset-' + p}>{tx('bd.preset.' + p)}</button>)}
          <button type="button" className={preset === 'custom' ? 'on' : ''} aria-pressed={preset === 'custom'} aria-haspopup="dialog" aria-expanded={calOpen} onClick={() => setCalOpen((o) => !o)} data-testid="bd-preset-custom">{preset === 'custom' && range ? rangeText : tx('bd.preset.custom')}</button>
        </div>
        {calOpen ? <div className="bd-cal" role="dialog" aria-label={tx('bd.preset.custom')}>
          <RangeCalendar initial={{ from: range?.from ?? sum?.range?.from, to: range?.to ?? sum?.range?.to }} today={sum?.today ?? deviceToday()}
            onApply={(r) => { setRange(r); setPreset('custom'); setScope('period'); setCalOpen(false); }} onCancel={() => setCalOpen(false)} onClear={() => { setRange(null); setPreset('month'); setCalOpen(false); }} />
        </div> : null}
      </div>
      <div className="rt-filters sg-tools bd-tools">
        <div className="fk-seg" role="tablist">
          {SCOPES.map((s) => <button key={s} type="button" role="tab" aria-selected={scope === s} className={scope === s ? 'on' : ''} onClick={() => setScope(s)} data-testid={'bd-scope-' + s}>{tx('bd.scope.' + s)}</button>)}
        </div>
        {scope === 'period' ? <select className="fk-select" aria-label={tx('bd.basis')} value={basis} onChange={(e) => setBasis(e.target.value === 'created' ? 'created' : 'occurrence')} data-testid="bd-basis">
          <option value="occurrence">{tx('bd.basis.occurrence')}</option><option value="created">{tx('bd.basis.created')}</option></select> : null}
        <input className="fk-input fk-search sg-search" type="search" placeholder={tx('bd.search')} aria-label={tx('bd.search')} value={search} onChange={(e) => setSearch(e.target.value)} data-testid="bd-search" />
        <select className="fk-select" aria-label={tx('bd.elig.any')} value={elig} onChange={(e) => setElig(e.target.value)} data-testid="bd-elig">
          <option value="">{tx('bd.elig.any')}</option>{ELIG.map((x) => <option key={x} value={x}>{tx('bd.elig.' + x)}</option>)}</select>
        <select className="fk-select" aria-label={tx('bd.sort.upcoming')} value={sort} onChange={(e) => setSort(e.target.value)} data-testid="bd-sort">
          <option value="">{scope === 'missing' ? tx('bd.sort.newest') : tx('bd.sort.upcoming')}</option>{SORTS.filter((s) => s !== (scope === 'missing' ? 'newest' : 'upcoming')).map((s) => <option key={s} value={s}>{tx('bd.sort.' + s)}</option>)}</select>
        {anyFilter ? <button type="button" className="fk-link" onClick={clearAll} data-testid="bd-clear">{tx('bd.clear')}</button> : null}
      </div>
      {scope === 'period' && basis === 'created' && rangeText ? <div className="fk-hint">{tx('bd.basis.created')}: {rangeText}</div> : null}

      <section className="fk-panel sg-panel" data-testid="bd-results">
        <div className="sg-table-wrap">
          {err ? <ErrorRetry message={err} onRetry={() => setReload((n) => n + 1)} /> : !list ? <div className="fk-loading">{tx('bd.loading')}</div> : rows.length === 0 ? (
            list.hint === 'no_match_in_period' ? <Empty title={tx('bd.noMatchInPeriod', { q: search })}><button type="button" className="fk-btn ghost" onClick={() => setScope('all')}>{tx('bd.scope.all')}</button></Empty>
              : scope === 'missing' ? <Empty title={tx('bd.emptyMissing')} />
              : <Empty title={tx('bd.emptyPeriod', { range: label })}><span className="fk-muted">{tx('bd.emptyPeriodHint')}</span>
                  <button type="button" className="fk-btn ghost" onClick={() => setDlg({ kind: 'missing' })} data-testid="bd-check-missing-empty">{tx('bd.checkMissing')}</button></Empty>
          ) : scope === 'missing' ? (
            <table className="fk-table rt-table sg-table bd-table">
              <thead><tr><th>{tx('pos.customer')}</th><th>{tx('bd.col.created')}</th><th>{tx('bd.col.lastVisit')}</th><th>{tx('bd.col.actions')}</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.customerId} data-testid="bd-row">
                  <td><button type="button" className="fk-li-t link sg-name" onClick={() => setDlg({ kind: 'customer', id: r.customerId })}>{r.name}</button><div className="fk-muted sg-contact">{r.maskedPhone ?? r.maskedEmail ?? '—'}</div></td>
                  <td>{when(r.createdAt) ?? '—'}</td>
                  <td>{when(r.lastVisitAt) ?? <span className="fk-muted">{tx('bd.never')}</span>}</td>
                  <td><button type="button" className="fk-btn ghost sg-why" onClick={() => setDlg({ kind: 'customer', id: r.customerId })} disabled={!canEdit} data-testid="bd-add">{tx('bd.addBirthday')}</button></td>
                </tr>))}</tbody>
            </table>
          ) : (
            <table className="fk-table rt-table sg-table bd-table">
              <thead><tr><th>{tx('pos.customer')}</th><th>{tx('bd.col.birthday')}</th><th>{tx('bd.col.next')}</th><th>{tx('bd.col.lastVisit')}</th><th>{tx('bd.col.loyalty')}</th>
                <th>{tx('bd.col.eligibility')}</th><th>{tx('bd.col.message')}</th><th>{tx('bd.col.actions')}</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.customerId} data-testid="bd-row">
                  <td><button type="button" className="fk-li-t link sg-name" onClick={() => setDlg({ kind: 'customer', id: r.customerId })} data-testid="bd-open">{r.name}</button>
                    <div className="fk-muted sg-contact">{r.maskedPhone ?? r.maskedEmail ?? '—'}</div></td>
                  <td>{md(r.birthdayMonthDay) ?? <span className="fk-muted">{tx('bd.notRecorded')}</span>}</td>
                  <td>{r.daysUntil === 0 ? <span className="fk-chip gold">{tx('bd.today')}</span> : r.daysUntil === 1 ? tx('bd.tomorrow') : r.daysUntil != null ? tx('bd.inDays', { n: String(r.daysUntil) }) : '—'}</td>
                  <td>{when(r.lastVisitAt) ?? <span className="fk-muted">{tx('bd.never')}</span>}</td>
                  <td>{r.loyaltyTier || '—'}</td>
                  <td><span className="sg-tags"><span className={'fk-chip ' + (r.sms === 'eligible' ? 'ok' : 'mut')}>SMS {st(r.sms)}</span><span className={'fk-chip ' + (r.email === 'eligible' ? 'ok' : 'mut')}>Email {st(r.email)}</span></span></td>
                  <td>{r.birthdayMessage ? tx('bd.msg.' + r.birthdayMessage) : '—'}</td>
                  <td><button type="button" className="fk-btn ghost sg-why" onClick={() => setDlg({ kind: 'customer', id: r.customerId })}>{tx('bd.details')}</button></td>
                </tr>))}</tbody>
            </table>
          )}
        </div>
        <footer className="sg-foot">
          <select className="fk-select" aria-label={tx('bd.rows')} value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} data-testid="bd-size">
            {SIZES.map((n) => <option key={n} value={n}>{tx('bd.rows')}: {n}</option>)}</select>
          <Pager info={list} onPage={setPage} />
        </footer>
      </section>
      <div className="sub bd-foot" style={{ fontSize: 12 }}>
        {tx('pos.only_customers_with_a_birthday_saved_1t73')}{' '}
        {comp ? <button type="button" className="fk-link" onClick={() => setDlg({ kind: 'missing' })} data-testid="bd-check-missing">{tx('bd.checkMissing')} · {tx('bd.kpi.completeSub', { missing: nf(comp.missing) })}</button> : null}
      </div>

      {dlg?.kind === 'customer' ? <CustomerDialog id={dlg.id} canEdit={canEdit} onClose={() => setDlg(null)} onSaved={() => setReload((n) => n + 1)}
        onBook={(id) => nav(`/booking/new?customerId=${encodeURIComponent(id)}&from=birthdays`)} onProfile={(id) => nav(`/tenant/customers/profiles?customerId=${encodeURIComponent(id)}`)} /> : null}
      {dlg?.kind === 'missing' ? <MissingDialog onClose={() => setDlg(null)} onShow={() => { setScope('missing'); setDlg(null); }} /> : null}
      {dlg?.kind === 'history' ? <HistoryDialog onClose={() => setDlg(null)} /> : null}
      {dlg?.kind === 'settings' ? <SettingsDialog canManage={canManage} onClose={() => setDlg(null)} onSaved={() => setReload((n) => n + 1)} /> : null}
      {dlg?.kind === 'assistant' ? <AssistantDialog canManage={canManage} initial={rangeQ} onClose={() => setDlg(null)} onOpenCampaigns={() => nav('/tenant/marketing/campaigns')} /> : null}
    </div>
  );
}

function CustomerDialog({ id, canEdit, onClose, onSaved, onBook, onProfile }: { id: string; canEdit: boolean; onClose: () => void; onSaved: () => void; onBook: (id: string) => void; onProfile: (id: string) => void }) {
  const [o, setO] = useState<any | null>(null); const [err, setErr] = useState<string | null>(null);
  const [val, setVal] = useState(''); const [busy, setBusy] = useState(false); const [ok, setOk] = useState(false); const [n, setN] = useState(0);
  useEffect(() => { setO(null); posBirthdaysApi.customer(id).then((x) => { setO(x); setVal(''); }).catch((e) => setErr(errorTextOf(e, tx('pos.loading')))); }, [id, n]);
  const save = async () => {
    setBusy(true); setErr(null); setOk(false);
    try { await posBirthdaysApi.updateBirthday(id, { birthday: val.trim() || null, expectedVersion: o.birthday.recordVersion }); setOk(true); onSaved(); setN((x) => x + 1); }
    catch (e) { setErr(errorTextOf(e, tx('bd.ov.save'))); } finally { setBusy(false); }
  };
  const b = o?.birthday;
  return (
    <FitDialog wide title={tx('bd.ov.title')} subtitle={o?.customerName ?? o?.name} onClose={onClose} busy={busy} testId="bd-overlay"
      footer={<>
        <button type="button" className="fk-btn primary" onClick={() => onBook(id)} data-testid="bd-book">{tx('bd.ov.book')}</button>
        <button type="button" className="fk-btn ghost" onClick={() => onProfile(id)}>{tx('bd.ov.profile')}</button>
        <button type="button" className="fk-btn ghost" onClick={onClose} data-testid="bd-close">{tx('bd.ov.close')}</button></>}>
      {err ? <div className="err">{err}</div> : null}
      {!o ? <div className="fk-loading">{tx('pos.loading')}</div> : (
        <div className="bd-ov">
          <section className="fk-panel bd-sec"><h3>{tx('bd.ov.birthday')}</h3>
            <div data-testid="bd-ov-birthday">{b.monthDay ? md(b.monthDay) : tx('bd.notRecorded')}{b.monthDay && b.yearKnown === false ? <span className="fk-muted"> · {tx('bd.ov.yearUnknown')}</span> : null}</div>
            {b.nextOccurrence ? <div className="fk-muted">{tx('bd.ov.next')}: {ymd(b.nextOccurrence.date)} ({b.nextOccurrence.daysUntil === 0 ? tx('bd.today') : tx('bd.inDays', { n: String(b.nextOccurrence.daysUntil) })})</div> : null}
            <div className="fk-muted">{tx('bd.ov.source')}: {tx('bd.ov.source.' + (b.source ?? 'none'))}{b.updatedAt ? ` · ${when(b.updatedAt)}` : ''}</div>
            {canEdit ? <div className="sg-form bd-edit">
              <label>{tx('bd.ov.edit')}<input className="fk-input" value={val} onChange={(e) => setVal(e.target.value)} placeholder="YYYY-MM-DD / MM-DD" inputMode="numeric" data-testid="bd-edit-input" /></label>
              <button type="button" className="fk-btn" onClick={save} disabled={busy} data-testid="bd-edit-save">{tx('bd.ov.save')}</button>
              <span className="fk-muted">{tx('bd.ov.editHint')}</span>
              {ok ? <span className="fk-ok" role="status">{tx('bd.ov.saved')}</span> : null}
            </div> : null}
          </section>
          <section className="fk-panel bd-sec"><h3>{tx('bd.ov.contact')}</h3>
            <div>{o.contact?.maskedPhone ?? '—'} · {o.contact?.maskedEmail ?? '—'}</div>
            <div className="fk-muted">{tx('bd.ov.consent')}: {tx('bd.ov.consentSms', { v: o.preferences?.smsOptedOut ? tx('bd.ov.optedOut') : o.preferences?.smsMarketingConsent ? tx('bd.ov.yes') : tx('bd.ov.no') })} · {tx('bd.ov.consentEmail', { v: o.preferences?.emailOptedOut ? tx('bd.ov.optedOut') : o.preferences?.emailMarketingConsent ? tx('bd.ov.yes') : tx('bd.ov.no') })}</div>
            <div className="fk-muted">{tx('bd.ov.loyalty')}: {o.loyalty?.tier ?? '—'} · {nf(o.loyalty?.pointsBalance)}</div>
          </section>
          <section className="fk-panel bd-sec"><h3>{tx('bd.ov.messages')}</h3>
            {o.noHistory ? <div className="fk-muted" data-testid="bd-ov-nohistory">{tx('bd.ov.noHistory')}</div> : <ul className="sg-list">{o.birthdayMessages.map((m: any, i: number) => <li key={i}>{m.occasionYear} · {m.channel.toUpperCase()} · {tx('bd.hist.status.' + m.status)} · {m.campaignName ?? '—'}</li>)}</ul>}
            <h3>{tx('bd.ov.offers')}</h3>
            {o.birthdayOffers.length ? <ul className="sg-list">{o.birthdayOffers.map((x: any) => <li key={x.redemptionId}>{x.title} · {x.status}{x.redeemedAt ? ` · ${when(x.redeemedAt)}` : ''}</li>)}</ul> : <div className="fk-muted">{tx('bd.ov.none')}</div>}
          </section>
          <section className="fk-panel bd-sec"><h3>{tx('bd.ov.visits')}</h3>
            {o.visits?.length ? <ul className="sg-list">{o.visits.slice(0, 8).map((v: any, i: number) => <li key={i}>{when(v.at ?? v.paidAt ?? v.date) ?? '—'}{v.totalCents != null ? ` · ${fmtMoney(v.totalCents)}` : ''}</li>)}</ul> : <div className="fk-muted">{tx('bd.never')}</div>}
            <h3>{tx('bd.ov.appointments')}</h3>
            {o.appointments?.length ? <ul className="sg-list">{o.appointments.slice(0, 6).map((a: any) => <li key={a.appointmentId}>{ymd(a.date)} {a.startTime ?? ''} · {a.status}</li>)}</ul> : <div className="fk-muted">{tx('bd.ov.none')}</div>}
            <h3>{tx('bd.ov.refunds')}</h3>
            {o.refunds?.length ? <ul className="sg-list">{o.refunds.map((r: any) => <li key={r.refundId}>{fmtMoney(r.amountCents)} · {r.status} · {when(r.at)}</li>)}</ul> : <div className="fk-muted">{tx('bd.ov.none')}</div>}
          </section>
        </div>)}
    </FitDialog>
  );
}

function MissingDialog({ onClose, onShow }: { onClose: () => void; onShow: () => void }) {
  const [m, setM] = useState<any | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { posBirthdaysApi.missing().then(setM).catch((e) => setErr(errorTextOf(e, tx('pos.loading')))); }, []);
  const c = m?.counts;
  return (
    <FitDialog title={tx('bd.mc.title')} subtitle={m ? tx('bd.mc.status.' + m.status) : undefined} onClose={onClose} testId="bd-missing"
      footer={<><button type="button" className="fk-btn primary" onClick={onShow} disabled={!c?.missing} data-testid="bd-mc-show">{tx('bd.mc.show')}</button><button type="button" className="fk-btn ghost" onClick={onClose}>{tx('bd.ov.close')}</button></>}>
      {err ? <div className="err">{err}</div> : !m ? <div className="fk-loading">{tx('pos.loading')}</div> : (
        <div className="bd-mc">
          <div className="fk-kpis bd-mc-k">
            <KpiCard label={tx('bd.mc.total')} value={nf(c.total)} /><KpiCard label={tx('bd.mc.recorded')} value={nf(c.recorded)} />
            <KpiCard label={tx('bd.mc.missing')} value={nf(c.missing)} tone={c.missing ? 'warn' : 'ok'} testId="bd-mc-missing" /><KpiCard label={tx('bd.mc.invalid')} value={nf(c.invalid)} tone={c.invalid ? 'bad' : undefined} />
            <KpiCard label={tx('bd.mc.yearUnknown')} value={nf(c.yearUnknown)} /><KpiCard label={tx('bd.mc.percent')} value={c.completenessPercent == null ? '—' : `${c.completenessPercent}%`} />
          </div>
          <h3>{tx('bd.mc.sources')}</h3>
          <ul className="sg-list">
            <li>{tx('bd.ov.source.staff')}: {nf(m.sources.staff)}</li><li>{tx('bd.ov.source.customer_app')}: {nf(m.sources.customerApp)}</li>
            <li>{tx('bd.ov.source.import')}: {nf(m.sources.import)}</li><li>{tx('bd.ov.source.created')}: {nf(m.sources.atCreation)}</li><li>{tx('bd.ov.source.none')}: {nf(m.sources.notRecorded)}</li>
          </ul>
          <div className="fk-muted">{tx('bd.mc.importUnknown', { reason: m.importRejectedReason })}</div>
          <div className="fk-muted">{tx('bd.mc.checked', { time: when(m.checkedAt) ?? '' })}</div>
        </div>)}
    </FitDialog>
  );
}

function HistoryDialog({ onClose }: { onClose: () => void }) {
  const [page, setPage] = useState(1); const [h, setH] = useState<any | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { posBirthdaysApi.history({ page, pageSize: 10 }).then(setH).catch((e) => setErr(errorTextOf(e, tx('pos.loading')))); }, [page]);
  return (
    <FitDialog wide title={tx('bd.hist.title')} onClose={onClose} testId="bd-hist" footer={<button type="button" className="fk-btn ghost" onClick={onClose}>{tx('bd.ov.close')}</button>}>
      {err ? <div className="err">{err}</div> : !h ? <div className="fk-loading">{tx('pos.loading')}</div> : !h.items.length ? <Empty title={tx('bd.hist.empty')} /> : (
        <><table className="fk-table rt-table"><thead><tr><th>{tx('pos.customer')}</th><th>{tx('bd.hist.year')}</th><th>SMS / Email</th><th>{tx('bd.col.message')}</th><th>{tx('bd.hist.campaign')}</th><th>{tx('bd.col.created')}</th></tr></thead>
          <tbody>{h.items.map((x: any) => <tr key={x.id}><td>{x.customerName}</td><td>{x.occasionYear}</td><td>{x.channel.toUpperCase()}</td><td>{tx('bd.hist.status.' + x.status)}</td><td>{x.campaignName ?? '—'}</td><td>{when(x.claimedAt)}</td></tr>)}</tbody></table>
          <Pager info={h} onPage={setPage} /></>)}
    </FitDialog>
  );
}

function SettingsDialog({ canManage, onClose, onSaved }: { canManage: boolean; onClose: () => void; onSaved: () => void }) {
  const [s, setS] = useState<any | null>(null); const [pol, setPol] = useState<'feb28' | 'mar1'>('feb28'); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { posBirthdaysApi.settings().then((x) => { setS(x); setPol(x.feb29Policy); }).catch((e) => setErr(errorTextOf(e, tx('pos.loading')))); }, []);
  const save = async () => { setBusy(true); setErr(null); try { await posBirthdaysApi.saveSettings({ feb29Policy: pol, expectedVersion: s.version }); onSaved(); onClose(); } catch (e) { setErr(errorTextOf(e, tx('bd.set.save'))); } finally { setBusy(false); } };
  return (
    <FitDialog title={tx('bd.set.title')} onClose={onClose} busy={busy} testId="bd-set"
      footer={<><button type="button" className="fk-btn primary" onClick={save} disabled={!canManage || busy || !s} data-testid="bd-set-save">{tx('bd.set.save')}</button><button type="button" className="fk-btn ghost" onClick={onClose}>{tx('bd.ov.close')}</button></>}>
      {err ? <div className="err">{err}</div> : null}
      <div className="sg-scope"><span>{tx('bd.set.text')}</span>
        {(['feb28', 'mar1'] as const).map((p) => <label key={p}><input type="radio" name="feb29" checked={pol === p} onChange={() => setPol(p)} disabled={!canManage} data-testid={'bd-set-' + p} />{tx('bd.set.' + p)}</label>)}</div>
      <div className="fk-muted">{tx('bd.set.note')}</div>
    </FitDialog>
  );
}

function AssistantDialog({ canManage, initial, onClose, onOpenCampaigns }: { canManage: boolean; initial: Record<string, unknown>; onClose: () => void; onOpenCampaigns: () => void }) {
  const [objective, setObjective] = useState<(typeof OBJECTIVES)[number]>('greeting');
  const [channel, setChannel] = useState<'sms' | 'email'>('sms');
  const [dealId, setDealId] = useState(''); const [templateId, setTemplateId] = useState('');
  const [deals, setDeals] = useState<any[]>([]);
  const [plan, setPlan] = useState<any | null>(null); const [message, setMessage] = useState(''); const [name, setName] = useState('');
  const [busy, setBusy] = useState<'' | 'plan' | 'save'>(''); const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<any | null>(null); const [key] = useState(() => requestId());
  useEffect(() => { posDealsOffersApi.library({ status: 'active', pageSize: 50 }).then((r: any) => setDeals(r?.items ?? [])).catch(() => setDeals([])); }, []);
  const input = (): AssistantInput => ({ objective, channel, ...(initial as object), dealId: dealId || null, templateId: templateId || null });
  const check = async () => {
    setBusy('plan'); setErr(null); setSaved(null);
    try { const p = await posBirthdaysApi.plan(input()); setPlan(p); setMessage(p.suggestions.message); setName((n) => n || `${tx('bd.title')} ${p.range.from} – ${p.range.to}`); }
    catch (e) { setErr(errorTextOf(e, tx('bd.ai.check'))); } finally { setBusy(''); }
  };
  const save = async () => {
    setBusy('save'); setErr(null);
    try { setSaved(await posBirthdaysApi.save({ ...input(), name, message, idempotencyKey: key })); }
    catch (e) { setErr(errorTextOf(e, tx('bd.ai.save'))); } finally { setBusy(''); }
  };
  const p = plan; const reasons = p ? Object.entries(p.audience.excludedReasons as Record<string, number>) : [];
  return (
    <FitDialog wide title={tx('bd.ai.title')} subtitle={tx('bd.ai.safety')} onClose={onClose} busy={!!busy} testId="bd-ai"
      footer={<>
        <button type="button" className="fk-btn" onClick={check} disabled={!!busy} data-testid="bd-ai-check">{tx('bd.ai.check')}</button>
        {p && !saved ? <button type="button" className="fk-btn primary" onClick={save} disabled={!!busy || !canManage || !p.audience.eligible} title={!canManage ? tx('bd.ai.noManage') : undefined} data-testid="bd-ai-save">{tx('bd.ai.save')}</button> : null}
        {saved ? <button type="button" className="fk-btn primary" onClick={onOpenCampaigns} data-testid="bd-ai-open">{tx('bd.ai.open')}</button> : null}
        <button type="button" className="fk-btn ghost" onClick={onClose}>{tx('bd.ov.close')}</button></>}>
      {err ? <div className="err" role="alert">{err}</div> : null}
      <div className="sg-form bd-ai">
        <label>{tx('bd.ai.objective')}<select className="fk-select" value={objective} onChange={(e) => { const v = OBJECTIVES.find((o) => o === e.target.value); if (v) setObjective(v); setPlan(null); }} data-testid="bd-ai-objective">
          {OBJECTIVES.map((o) => <option key={o} value={o}>{tx('bd.ai.obj.' + o)}</option>)}</select></label>
        <label>{tx('bd.ai.channel')}<select className="fk-select" value={channel} onChange={(e) => { setChannel(e.target.value === 'email' ? 'email' : 'sms'); setPlan(null); }} data-testid="bd-ai-channel">
          <option value="sms">SMS</option><option value="email">Email</option></select></label>
        <label>{tx('bd.ai.offer')}<select className="fk-select" value={dealId} onChange={(e) => { setDealId(e.target.value); setPlan(null); }} data-testid="bd-ai-offer">
          <option value="">{tx('bd.ai.noOffer')}</option>{deals.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        {p ? <label>{tx('bd.ai.template')}<select className="fk-select" value={templateId} onChange={(e) => { setTemplateId(e.target.value); setPlan(null); }} data-testid="bd-ai-template">
          <option value="">{tx('bd.ai.noTemplate')}</option>{p.templates.map((t: any) => <option key={t.templateId} value={t.templateId}>{t.name}</option>)}</select></label> : null}
      </div>
      {p ? <div className="bd-ai-plan" data-testid="bd-ai-plan">
        <h3>{tx('bd.ai.audience')}</h3>
        <div data-testid="bd-ai-counts">{ymd(p.range.from)} – {ymd(p.range.to)} · {tx('bd.ai.counts', { selected: nf(p.audience.selected), eligible: nf(p.audience.eligible), excluded: nf(p.audience.excluded) })}</div>
        {reasons.length ? <ul className="sg-list">{reasons.map(([r, n]) => <li key={r}>{tx('bd.ai.reason', { reason: tx('bd.ai.reason.' + r) !== 'bd.ai.reason.' + r ? tx('bd.ai.reason.' + r) : st(r), n: nf(n) })}</li>)}</ul> : null}
        {p.offer && !p.offer.usable ? <div className="err">{tx('bd.ai.problem', { text: p.offer.problems.join(' ') })}</div> : null}
        {p.template && !p.template.usable ? <div className="err" data-testid="bd-ai-template-problem">{tx('bd.ai.problem', { text: p.template.problems.join(' ') })}</div> : null}
        <h3>{tx('bd.ai.schedule')}</h3><div className="fk-muted">{ymd(p.suggestions.schedule.date)} · {p.timezone}</div>
        <h3>{tx('bd.ai.review')}</h3>
        <label className="sg-msg">{tx('bd.ai.name')}<input className="fk-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></label>
        <label className="sg-msg">{tx('bd.ai.message')}<textarea className="fk-input" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1600} data-testid="bd-ai-message" /></label>
        {p.suggestions.messageIsSuggestion ? <div className="fk-hint">{tx('bd.ai.suggestion')}</div> : null}
        <div className="fk-muted">{tx('bd.ai.variables', { vars: p.variables.join(', ') })}</div>
        {saved ? <div className="fk-ok" role="status" data-testid="bd-ai-saved">{tx('bd.ai.saved', { eligible: nf(saved.eligible) })}</div> : null}
      </div> : null}
    </FitDialog>
  );
}
