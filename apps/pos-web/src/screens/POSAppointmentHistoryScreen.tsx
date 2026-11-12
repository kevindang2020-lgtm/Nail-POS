// POSAppointmentHistoryScreen.tsx — Customers → Appointment History (/tenant/customers/appointment-history). Appointment History
// SUNMI guide (Nov 9 2026). The salon-wide workspace (from /pos/appointment-history/*, read-only):
//   • six cards over the table's filters — appointments · upcoming · completed · canceled · no-shows · rescheduled (tap = filter)
//   • search (customer · phone · service · technician) · status · technician · which date + presets / From–To · sort · pages
//   • an appointment's details · Check Appointment History System
// The original page (search a customer → their history with the money details per row) stays: the header search opens it as a
// dialog, and so does "Customer history" on any appointment's details.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SavedViews, vStr, vNum } from '../components/SavedViews';
import { posAppointmentHistoryApi, type AppointmentHistoryQuery } from '../api/posAppointmentHistoryApi';
import type { AhListResponse, AhSummaryResponse, AhCheckResponse } from '@aipowersalon/api-contracts/tenant';
import { FitDialog, KpiCard, Pager, Empty, ErrorRetry } from '../components/FitKit';
import { RangeCalendar, isForbidden } from '../components/FinanceKit';
import { errorTextOf } from '../i18n/error-text';
import { deviceToday } from '../lib/deviceToday';
import { fmtInZone, fmtInTz, fmtNumber } from '../i18n/format';
import { posCustomersApi } from '../api/posCustomersApi';
import { money, reportError } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { ImeSafeInput } from '../components/ImeSafeInput';
import { statusLabel } from '../i18n/status-label';
import { codeLabel } from '../components/peopleLabels';
import { useInRouterContext, useNavigate } from 'react-router-dom';
import { useCan } from '../components/usePermissions';

type CustomerItem = { customerId: string; fullName: string; phone: string; visitsCount: number };
type Appt = { 
  appointmentId: string; startsAt: string; serviceName: string; technicianName: string; status: string;
  branchName?: string; source?: string; scheduledDurationMinutes?: number; actualDurationMinutes?: number;
  originalPriceCents?: number; discountsCents?: number; finalPriceCents?: number; tipCents?: number;
  taxCents?: number; totalCents?: number; cancelReason?: string; notes?: string;
  paymentMethodMasked?: string; loyaltyPointsEarned?: number; loyaltyPointsRedeemed?: number;
  giftCardUsageCents?: number; membershipBenefitUsage?: string; refundStatus?: string; rebooked?: boolean;
};

const _SearchIcon = () => <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>;

// F1 §46 (Nov 6 2026): the location's time zone (the salon's day and hour), not the device's
const fmtDateTime = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' }) || '—' : '—');
const statusChip = (status: string) => {
  const s = (status || '').toLowerCase();
  const map: Record<string, { bg: string; fg: string, border: string }> = { 
    completed: { bg: '#EEF7EF', fg: '#2E7D32', border: '#A5D6A7' }, 
    booked: { bg: '#F0F9FF', fg: '#0284C7', border: '#BAE6FD' }, 
    confirmed: { bg: '#F0F9FF', fg: '#0284C7', border: '#BAE6FD' }, 
    cancelled: { bg: '#FDF0EE', fg: '#C0392B', border: '#FCA5A5' }, 
    no_show: { bg: '#FDF0EE', fg: '#C0392B', border: '#FCA5A5' }, 
    'no-show': { bg: '#FDF0EE', fg: '#C0392B', border: '#FCA5A5' } 
  };
  const m = map[s] || { bg: '#FAFAF9', fg: '#8A7A6D', border: '#EFEAE1' };
  const label = status ? statusLabel('appointment', status.replace(/-/g, '_')) : '—';
  return <span style={{ display: 'inline-block', padding: '4px 12px', borderRadius: 20, fontSize: 13, fontWeight: 700, background: m.bg, color: m.fg, border: `1px solid ${m.border}` }}>{label}</span>;
};

// a recorded change value: a status through its label, a record id never shown raw, anything else as recorded
const changeValue = (field: string | null, v: string | null) => v == null || v === '' ? '—' : field === 'status' ? statusLabel('appointment', v.replace(/-/g, '_'))
  : /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? t('ahx.changes.record') : v;
const tt = (k: string, v?: Record<string, string | number>) => t(k, v as Parameters<typeof t>[1]);
const STATUSES = ['all', 'upcoming', 'completed', 'canceled', 'no_show', 'rescheduled'] as const;
const DATE_FIELDS = ['scheduled', 'created', 'updated', 'completed', 'canceled'] as const;
const SORTS = ['newest', 'scheduled', 'upcoming', 'updated'] as const;
const errText = (e: unknown) => {
  const x = e as { code?: string; body?: { code?: string }; details?: { code?: string } } | null; const c = x?.body?.code ?? x?.details?.code ?? x?.code;
  if (c && ['APPOINTMENT_HISTORY_INVALID_PERIOD', 'APPOINTMENT_HISTORY_SEARCH_TOO_SHORT'].includes(c)) return tt('ahx.err.' + c);
  if (isForbidden(e)) return tt('ahx.err.forbidden');
  return errorTextOf(e, tt('ahx.loadFailed'));
};
const day = (d: string, time?: string | null) => `${fmtInTz(`${d}T12:00:00Z`, 'UTC', { month: 'short', day: '2-digit', year: 'numeric' }) || d}${time ? ` · ${time}` : ''}`;

/** Smarter Follow-up and Rebooking Review (Extras · Appointment History 03): for a COMPLETED appointment, whether the customer
 *  already has a future appointment (from their own appointment list) and review-only shortcuts to the existing Rebooking
 *  Opportunities overlay and the AI Booking Assistant. Navigation only — nothing is booked or sent here. */
const OPEN_STATUSES = new Set(['booked', 'confirmed', 'pending_confirmation', 'checked_in', 'waiting', 'in_service', 'arrived']);
export function nextFutureAppointment(appts: Array<{ startsAt?: string | null; status?: string | null }>, nowMs: number): string | null {
  let best: number | null = null;
  for (const a of appts) {
    const at = a.startsAt ? Date.parse(a.startsAt) : NaN;
    if (!Number.isFinite(at) || at <= nowMs || !OPEN_STATUSES.has(String(a.status ?? '').toLowerCase())) continue;
    if (best == null || at < best) best = at;
  }
  return best == null ? null : new Date(best).toISOString();
}
function GoButton({ to, testId, children }: { to: string; testId: string; children: React.ReactNode }) {
  const nav = useNavigate();
  return <button type="button" className="btn ghost sm" data-testid={testId} onClick={() => nav(to)}>{children}</button>;
}
function Go({ to, testId, children }: { to: string; testId: string; children: React.ReactNode }) {
  return useInRouterContext() ? <GoButton to={to} testId={testId}>{children}</GoButton> : <a className="btn ghost sm" data-testid={testId} href={to}>{children}</a>;
}
function RebookingShortcut({ customerId }: { customerId: string }) {
  const can = useCan();
  const [next, setNext] = useState<string | null | undefined>(undefined); const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true; setNext(undefined); setFailed(false);
    posCustomersApi.appointments(customerId).then((a) => { if (alive) setNext(nextFutureAppointment((a ?? []) as Appt[], Date.now())); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [customerId]);
  return (
    <div data-testid="ahx-rebook" style={{ marginTop: 8 }}>
      <h3 className="p-h" style={{ margin: '8px 0 4px' }}>{tt('ahx.rebook.title')}</h3>
      <p className="sub" data-testid="ahx-rebook-next">{failed ? tt('ahx.rebook.unknown') : next === undefined ? tt('ahx.rebook.loading') : next ? tt('ahx.rebook.next', { when: fmtDateTime(next) }) : tt('ahx.rebook.none')}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {can('pos.ai_customer_profile.view') ? <Go to={`/tenant/ai/customer-profile/rebooking?customerId=${encodeURIComponent(customerId)}`} testId="ahx-rebook-review">{tt('ahx.rebook.review')}</Go> : null}
        {can('pos.booking.create') ? <Go to="/tenant/ai/booking" testId="ahx-rebook-assistant">{tt('ahx.rebook.assistant')}</Go> : null}
      </div>
      <p className="sub" style={{ fontSize: 12 }}>{tt('ahx.rebook.note')}</p>
    </div>
  );
}

/** the original per-customer history (money details on each row) — unchanged, now in a dialog */
function CustomerHistory({ customer, onClose }: { customer: CustomerItem; onClose: () => void }) {
  const [appts, setAppts] = useState<Appt[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  useEffect(() => { posCustomersApi.appointments(customer.customerId).then((a) => setAppts(a as Appt[])).catch((e) => setError(reportError(e, t('admin.history.noun')))); }, [customer.customerId]);
  return (
    <FitDialog wide testId="ahx-customer" title={customer.fullName || t('pos.unnamed_customer')} subtitle={`${customer.phone || t('pos.no_phone')} · ${tt('ahx.visits', { n: customer.visitsCount ?? 0 })}${appts ? ` · ${tt('ahx.onRecord', { n: appts.length })}` : ''}`}
      onClose={onClose} footer={<button className="btn ghost" onClick={onClose}>{t('pos.close')}</button>}>
      {error ? <div className="err">{error}</div> : !appts ? <div className="state">{t('pos.loading_history')}</div>
        : appts.length === 0 ? <div className="state">{t('pos.no_appointments_on_record_for_this_13o5')}</div>
        : <div className="rvw-table-wrap"><table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#FFFFFF', color: '#A09388', fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '2px solid #F1ECE4' }}>
                    <th style={{ padding: '20px 32px', textAlign: 'left', fontWeight: 600 }}>{t('pos.date_time')}</th>
                    <th style={{ padding: '20px 32px', textAlign: 'left', fontWeight: 600 }}>{t('pos.service_provided')}</th>
                    <th style={{ padding: '20px 32px', textAlign: 'left', fontWeight: 600 }}>{t('pos.technician')}</th>
                    <th style={{ padding: '20px 32px', textAlign: 'right', fontWeight: 600 }}>{t('pos.status')}</th>
                  </tr>
                </thead>
                <tbody>{appts.map((a, idx) => (
                  <React.Fragment key={a.appointmentId}>
                    <tr onClick={() => setExpandedId(expandedId === a.appointmentId ? null : a.appointmentId)} style={{ borderBottom: expandedId === a.appointmentId ? 'none' : (idx === appts.length - 1 ? 'none' : '1px solid #F1ECE4'), transition: 'background 0.2s', cursor: 'pointer' }} onMouseOver={e => e.currentTarget.style.background = '#FDFCFB'} onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                      <td style={{ padding: '20px 32px', color: '#5A514A', whiteSpace: 'nowrap', fontSize: 15 }}>{fmtDateTime(a.startsAt)}</td>
                      <td style={{ padding: '20px 32px', color: '#2C2A29', fontWeight: 600, fontSize: 15 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 12, color: '#B5821F' }}>{expandedId === a.appointmentId ? '▼' : '▶'}</span>
                          {a.serviceName || '—'}
                        </div>
                      </td>
                      <td style={{ padding: '20px 32px', color: '#5A514A', fontSize: 15 }}>{a.technicianName ? <span style={{ background: '#F8F6F3', padding: '4px 10px', borderRadius: 20, border: '1px solid #EFEAE1' }}>{a.technicianName}</span> : '—'}</td>
                      <td style={{ padding: '20px 32px', textAlign: 'right' }}>{statusChip(a.status)}</td>
                    </tr>
                    {expandedId === a.appointmentId && (
                      <tr style={{ borderBottom: idx === appts.length - 1 ? 'none' : '1px solid #F1ECE4' }}>
                        <td colSpan={4} style={{ padding: 0 }}>
                          <div style={{ padding: '24px 32px', background: '#FAFAF9', borderTop: '1px dashed #EADBB6', borderBottom: '1px dashed #EADBB6', animation: 'fadeIn 0.2s ease-out' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 24 }}>
                              <div>
                                <div style={{ fontSize: 12, color: '#8A7A6D', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{t('pos.financials')}</div>
                                <div style={{ fontSize: 14, color: '#2C2A29', display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{t('pos.original_price')}</span> <span>{money(a.originalPriceCents || 0)}</span></div>
                                  {a.discountsCents ? <div style={{ display: 'flex', justifyContent: 'space-between', color: '#2E7D32' }}><span>{t('pos.discount')}</span> <span>-{money(a.discountsCents)}</span></div> : null}
                                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{t('pos.tax_2')}</span> <span>{money(a.taxCents || 0)}</span></div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{t('pos.tip_2')}</span> <span>{money(a.tipCents || 0)}</span></div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, paddingTop: 4, borderTop: '1px solid #EADBB6', marginTop: 4 }}><span>{t('pos.total_2')}</span> <span>{money(a.totalCents || 0)}</span></div>
                                </div>
                              </div>
                              <div>
                                <div style={{ fontSize: 12, color: '#8A7A6D', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{t('pos.details')}</div>
                                <div style={{ fontSize: 14, color: '#2C2A29', display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{t('pos.branch_2')}</span> <span>{a.branchName || '—'}</span></div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{t('pos.source_2')}</span> <span><span style={{ background: '#F0F9FF', color: '#0284C7', padding: '2px 8px', borderRadius: 12, fontSize: 12 }}>{statusLabel('source', a.source)}</span></span></div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{t('pos.duration_2')}</span> <span>{a.scheduledDurationMinutes || 0} {t('pos.mins_sched')}{' '}{a.actualDurationMinutes || 0} {t('pos.mins_act')}</span></div>
                                  {a.paymentMethodMasked ? <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{t('pos.payment_2')}</span> <span>{a.paymentMethodMasked}</span></div> : null}
                                  {a.refundStatus ? <div style={{ display: 'flex', justifyContent: 'space-between', color: '#C0392B', fontWeight: 600 }}><span>{t('pos.refund_2')}</span> <span>{a.refundStatus}</span></div> : null}
                                  {a.loyaltyPointsEarned ? <div style={{ display: 'flex', justifyContent: 'space-between', color: '#2D6CBF' }}><span>{t('pos.loyalty_earned')}</span> <span>+{a.loyaltyPointsEarned} {t('pos.pts')}</span></div> : null}
                                  {a.loyaltyPointsRedeemed ? <div style={{ display: 'flex', justifyContent: 'space-between', color: '#2D6CBF' }}><span>{t('pos.loyalty_used')}</span> <span>-{a.loyaltyPointsRedeemed} {t('pos.pts')}</span></div> : null}
                                  {a.giftCardUsageCents ? <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{t('pos.gift_card')}</span> <span>{money(a.giftCardUsageCents)}</span></div> : null}
                                  {a.membershipBenefitUsage ? <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{t('pos.membership_3')}</span> <span>{a.membershipBenefitUsage}</span></div> : null}
                                  {a.rebooked ? <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{t('pos.rebooked_2')}</span> <span>{t('pos.yes')}</span></div> : null}
                                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{t('pos.photos_2')}</span> <span style={{ color: '#8A7A6D' }}>{t('pos.no_photos_available_consent_required')}</span></div>
                                </div>
                              </div>
                              {(a.notes || a.cancelReason) ? (
                                <div>
                                  <div style={{ fontSize: 12, color: '#8A7A6D', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{t('pos.notes_exceptions')}</div>
                                  <div style={{ fontSize: 14, color: '#2C2A29', display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    {a.notes ? <div><span style={{ fontWeight: 600 }}>{t('pos.notes_2')}</span> {a.notes}</div> : null}
                                    {a.cancelReason ? <div><span style={{ fontWeight: 600, color: '#C0392B' }}>{t('pos.cancel_reason')}</span> {a.cancelReason}</div> : null}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}</tbody>
              </table></div>}
    </FitDialog>
  );
}

export function POSAppointmentHistoryScreen() {
  // ── the original "look up a customer" search (header) ──
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CustomerItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [findErr, setFindErr] = useState<string | null>(null);
  const [searchedFor, setSearchedFor] = useState('');
  const [customer, setCustomer] = useState<CustomerItem | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runSearch = useCallback((q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setSearching(true); setFindErr(null);
    posCustomersApi.quickSearch(q).then((r) => { setResults((r?.items || []) as CustomerItem[]); setSearchedFor(q); }).catch((e) => { setResults([]); setFindErr(reportError(e, 'customers')); }).finally(() => setSearching(false));
  }, []);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => runSearch(query), 250);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [query, runSearch]);

  // ── the workspace ──
  const [f, setFState] = useState<AppointmentHistoryQuery>({ page: 1, pageSize: 25, sort: 'newest', status: 'all' });
  const [draft, setDraft] = useState('');
  const [sum, setSum] = useState<AhSummaryResponse | null>(null); const [sumErr, setSumErr] = useState<string | null>(null);
  const [list, setList] = useState<AhListResponse | null>(null); const [listErr, setListErr] = useState<string | null>(null);
  const [techs, setTechs] = useState<{ id: string; name: string }[]>([]);
  const [cal, setCal] = useState(false);
  const [open, setOpen] = useState<AhListResponse['items'][number] | null>(null);
  const [health, setHealth] = useState<AhCheckResponse | 'loading' | { error: string } | null>(null);
  const seq = useRef(0);
  const setF = (p: Partial<AppointmentHistoryQuery>, keepPage = false) => setFState((cur) => ({ ...cur, ...p, page: keepPage ? (p.page ?? cur.page) : 1 }));
  const filterKey = JSON.stringify({ q: f.q, technician: f.technician, dateField: f.dateField, preset: f.preset, from: f.from, to: f.to });
  const loadSum = useCallback(() => { setSumErr(null); posAppointmentHistoryApi.summary(JSON.parse(filterKey)).then(setSum).catch((e) => setSumErr(errText(e))); }, [filterKey]);
  const loadList = useCallback(() => {
    const my = ++seq.current; setListErr(null);
    posAppointmentHistoryApi.list(f).then((d) => { if (my === seq.current) setList(d); }).catch((e) => { if (my === seq.current) setListErr(errText(e)); });
  }, [f]);
  useEffect(loadSum, [loadSum]);
  useEffect(loadList, [loadList]);
  useEffect(() => { posAppointmentHistoryApi.options().then((o) => setTechs(o.technicians ?? [])).catch(() => setTechs([])); }, []);
  const refresh = () => { loadSum(); loadList(); };
  const runCheck = () => { setHealth('loading'); posAppointmentHistoryApi.check().then(setHealth).catch((e) => setHealth({ error: errText(e) })); };
  const c = sum?.cards;
  const anyFilter = !!(f.q || f.technician || f.preset || (f.status && f.status !== 'all'));
  const card = (key: string, label: string, v: number | undefined, status: string, tone?: 'ok' | 'warn' | 'bad' | 'gold') =>
    <KpiCard key={key} testId={`ahx-kpi-${key}`} label={label} value={c ? fmtNumber(v ?? 0) : sumErr ? tt('ahx.unavailable') : '—'} loading={!sum && !sumErr} tone={tone}
      onClick={() => setF({ status, sort: status === 'upcoming' ? 'upcoming' : f.sort === 'upcoming' ? 'newest' : f.sort })} />;

  return (
    <div className="work" data-testid="ahx-screen">
      <div className="vh cnx-head">
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <h1>{t('pos.appointment_history')}</h1>
          <div className="sub">{tt('ahx.subtitle')}</div>
        </div>
        <div className="cnx-find">
          <ImeSafeInput type="search" className="rvw-search" data-testid="ahx-find" value={query} onValue={(v) => setQuery(v)} placeholder={t('pos.search_by_name_phone_or_email_2')} aria-label={tt('ahx.findLabel')} />
          {searching ? <span className="sub">{t('pos.searching')}</span> : null}
          {results.length ? <div className="cnx-find-list" role="listbox" data-testid="ahx-find-list">
            {results.map((r) => <button key={r.customerId} type="button" role="option" aria-selected={false} className="cnx-find-item" data-testid="ahx-find-item" onClick={() => { setCustomer(r); setQuery(''); setResults([]); }}>
              <b>{r.fullName || t('pos.unnamed_customer')}</b><span className="sub">{r.phone || t('pos.no_phone_on_file')} · {tt('ahx.visits', { n: r.visitsCount ?? 0 })}</span></button>)}
          </div> : findErr ? <div className="cnx-find-list err" role="alert">{findErr}</div>
            : query.trim() && !searching && searchedFor === query ? <div className="cnx-find-list sub">{t('pos.no_profiles_found')}</div> : null}
        </div>
        <button className="btn ghost" data-testid="ahx-check" onClick={runCheck}>{tt('ahx.check')}</button>
        <button className="btn ghost" data-testid="ahx-refresh" onClick={refresh}>{tt('ahx.refresh')}</button>
      </div>

      {sumErr ? <ErrorRetry message={sumErr} onRetry={loadSum} /> : null}
      <div className="rvw-kpis ahx-kpis" data-testid="ahx-kpis">
        {card('appointments', tt('ahx.kpi.appointments'), c?.appointments, 'all', 'gold')}
        {card('upcoming', tt('ahx.kpi.upcoming'), c?.upcoming, 'upcoming')}
        {card('completed', tt('ahx.kpi.completed'), c?.completed, 'completed', 'ok')}
        {card('canceled', tt('ahx.kpi.canceled'), c?.canceled, 'canceled', c?.canceled ? 'warn' : undefined)}
        {card('noshows', tt('ahx.kpi.noShows'), c?.noShows, 'no_show', c?.noShows ? 'bad' : undefined)}
        {card('rescheduled', tt('ahx.kpi.rescheduled'), c?.rescheduled, 'rescheduled')}
      </div>

      <section className="panel rvw-filters" data-testid="ahx-filters">
        <form className="cnx-searchrow" onSubmit={(e) => { e.preventDefault(); setF({ q: draft.trim() || undefined }); }}>
          <input className="rvw-search" type="search" data-testid="ahx-search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={tt('ahx.searchPh')} aria-label={tt('ahx.searchPh')} />
          <button className="btn" type="submit" data-testid="ahx-search-btn">{tt('ahx.search')}</button>
          {f.q ? <button className="btn ghost" type="button" data-testid="ahx-search-clear" onClick={() => { setDraft(''); setF({ q: undefined }); }}>{tt('ahx.clearSearch')}</button> : null}
        </form>
        <label className="rvw-f"><span>{tt('ahx.f.status')}</span>
          <select data-testid="ahx-status" value={f.status ?? 'all'} onChange={(e) => setF({ status: e.target.value })}>{STATUSES.map((k) => <option key={k} value={k}>{tt('ahx.st.' + k)}</option>)}</select></label>
        <label className="rvw-f"><span>{tt('ahx.f.technician')}</span>
          <select data-testid="ahx-technician" value={f.technician ?? ''} onChange={(e) => setF({ technician: e.target.value || undefined })}>
            <option value="">{tt('ahx.anyTech')}</option>{techs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label className="rvw-f"><span>{tt('ahx.f.sort')}</span>
          <select data-testid="ahx-sort" value={f.sort ?? 'newest'} onChange={(e) => setF({ sort: e.target.value })}>{SORTS.map((k) => <option key={k} value={k}>{tt('ahx.sort.' + k)}</option>)}</select></label>
        <div className="rvw-dates" data-testid="ahx-dates">
          <label className="rvw-f"><span>{tt('ahx.f.dateField')}</span>
            <select data-testid="ahx-datefield" value={f.dateField ?? 'scheduled'} onChange={(e) => setF({ dateField: e.target.value === 'scheduled' ? undefined : e.target.value })}>
              {DATE_FIELDS.map((k) => <option key={k} value={k}>{tt('ahx.date.' + k)}</option>)}</select></label>
          <button className={'btn ghost' + (!f.preset ? ' on' : '')} data-testid="ahx-preset-all" onClick={() => setF({ preset: undefined, from: undefined, to: undefined })}>{tt('cnx.preset.all')}</button>
          {(['today', 'week', 'month', 'year'] as const).map((p) => <button key={p} className={'btn ghost' + (f.preset === p ? ' on' : '')} data-testid={`ahx-preset-${p}`} onClick={() => setF({ preset: p, from: undefined, to: undefined })}>{tt('cnx.preset.' + p)}</button>)}
          <button className={'btn ghost' + (f.preset === 'custom' ? ' on' : '')} data-testid="ahx-preset-custom" onClick={() => setCal(true)}>{f.preset === 'custom' ? `${f.from} → ${f.to}` : tt('cnx.preset.custom')}</button>
        </div>
        <SavedViews surface="appointments.history" testId="ahx-views" current={{ ...f, page: undefined }}
          onApply={(v) => { setDraft(vStr(v, 'q')); setFState({ page: 1, pageSize: vNum(v, 'pageSize', 25), sort: vStr(v, 'sort', 'newest'), status: vStr(v, 'status', 'all'),
            q: vStr(v, 'q') || undefined, technician: vStr(v, 'technician') || undefined, dateField: vStr(v, 'dateField') || undefined, preset: vStr(v, 'preset') || undefined, from: vStr(v, 'from') || undefined, to: vStr(v, 'to') || undefined }); }} />
        {anyFilter ? <button className="btn ghost" data-testid="ahx-clear" onClick={() => { setDraft(''); setFState({ page: 1, pageSize: f.pageSize, sort: 'newest', status: 'all' }); }}>{tt('cnx.clear')}</button> : null}
        {cal ? <div className="rvw-cal" data-testid="ahx-cal"><RangeCalendar initial={{ from: f.from, to: f.to }} today={list?.period.today ?? deviceToday()}
          onApply={(r) => { setF({ preset: 'custom', from: r.from, to: r.to }); setCal(false); }} onCancel={() => setCal(false)} onClear={() => { setF({ preset: undefined, from: undefined, to: undefined }); setCal(false); }} /></div> : null}
      </section>

      <section className="panel rvw-feed" data-testid="ahx-results">
        <div className="p-h">{t('pos.appointment_history')}<span className="sub rvw-scope" data-testid="ahx-count">{list ? tt('ahx.count', { n: fmtNumber(list.total), order: tt('ahx.sort.' + (list.applied.sort || 'newest')) }) : ''}</span></div>
        {listErr ? <ErrorRetry message={listErr} onRetry={loadList} />
          : !list ? <div className="state">{t('pos.loading_history')}</div>
          : list.items.length === 0 ? <Empty title={anyFilter ? tt('ahx.noMatch') : tt('ahx.empty')} />
          : <div className="rvw-table-wrap"><table className="tbl rvw-table ahx-table">
            <thead><tr><th>{t('pos.date_time')}</th><th>{tt('ahx.col.customer')}</th><th>{tt('ahx.col.services')}</th><th>{t('pos.technician')}</th><th>{t('pos.status')}</th><th>{tt('ahx.col.created')}</th><th /></tr></thead>
            <tbody>{list.items.map((r) => (
              <tr key={r.id} data-testid="ahx-row">
                <td className="nowrap">{day(r.date, r.startTime)}{r.durationMinutes ? <div className="sub">{tt('ahx.minutes', { n: r.durationMinutes })}</div> : null}</td>
                <td><b>{r.customer ?? t('pos.unnamed_customer')}</b>{r.phone ? <div className="sub">{r.phone}</div> : null}</td>
                <td className="ahx-services">{r.services ?? '—'}</td>
                <td>{r.technician ?? (r.anyTechnician ? tt('ahx.anyTechnician') : '—')}{r.branch ? <div className="sub">{r.branch}</div> : null}</td>
                <td>{statusChip(r.status)}{r.rescheduled ? <div className="sub" data-testid="ahx-row-moved">{tt('ahx.moved', { n: r.rescheduled })}</div> : null}</td>
                <td className="sub">{fmtDateTime(r.createdAt)}</td>
                <td className="nowrap cnx-acts"><button className="btn ghost sm" data-testid="ahx-view" onClick={() => setOpen(r)}>{tt('ahx.view')}</button></td>
              </tr>))}</tbody></table></div>}
        <div className="rvw-pager">
          <Pager info={list ? { page: list.page, pageSize: list.pageSize, totalItems: list.total, totalPages: list.totalPages } : null} onPage={(p) => setF({ page: p }, true)} />
          <label className="rvw-f"><span>{tt('cnx.rows')}</span><select data-testid="ahx-pagesize" value={String(f.pageSize ?? 25)} onChange={(e) => setF({ pageSize: Number(e.target.value) })}>
            {['10', '25', '50', '100'].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
        </div>
        <p className="sub">{tt('ahx.footNote')}</p>
      </section>

      {open ? <FitDialog wide testId="ahx-detail" title={open.customer ?? t('pos.unnamed_customer')} subtitle={`${day(open.date, open.startTime)}${open.endTime ? `–${open.endTime}` : ''}`} onClose={() => setOpen(null)}
        footer={<>{open.customerId ? <button className="btn" data-testid="ahx-detail-customer" onClick={() => { setCustomer({ customerId: open.customerId!, fullName: open.customer ?? '', phone: open.phone ?? '', visitsCount: 0 }); setOpen(null); }}>{tt('ahx.customerHistory')}</button> : null}
          <button className="btn ghost" onClick={() => setOpen(null)}>{t('pos.close')}</button></>}>
        <dl className="ahx-dl">
          {/* extras (Appointment History 12 · A): header and customer context — booking reference, scheduled time in the
              salon's time zone, the masked contact the list already returned (never the full number) */}
          <dt>{tt('ahx.detail.bookingId')}</dt><dd><code data-testid="ahx-detail-id" title={open.id}>{open.id.slice(0, 8).toUpperCase()}</code></dd>
          <dt>{tt('ahx.detail.scheduled')}</dt><dd data-testid="ahx-detail-when">{day(open.date, open.startTime)}{open.endTime ? `–${open.endTime}` : ''}{open.durationMinutes ? ` · ${tt('ahx.detail.minutes', { n: open.durationMinutes })}` : ''}{list?.period.timeZone ? <span className="sub"> · {tt('ahx.detail.tz', { tz: list.period.timeZone })}</span> : null}</dd>
          <dt>{tt('ahx.detail.contact')}</dt><dd data-testid="ahx-detail-contact">{open.phone ?? '—'}</dd>
          <dt>{tt('ahx.col.services')}</dt><dd>{open.services ?? '—'}</dd>
          <dt>{t('pos.technician')}</dt><dd>{open.technician ?? (open.anyTechnician ? tt('ahx.anyTechnician') : '—')}</dd>
          <dt>{t('pos.status')}</dt><dd>{statusChip(open.status)}</dd>
          <dt>{t('pos.branch_2')}</dt><dd>{open.branch ?? '—'}</dd>
          <dt>{t('pos.source_2')}</dt><dd data-testid="ahx-detail-source">{open.source ? statusLabel('source', open.source) : '—'}</dd>
          <dt>{tt('ahx.col.created')}</dt><dd>{fmtDateTime(open.createdAt)}</dd>
          <dt>{tt('ahx.updated')}</dt><dd>{fmtDateTime(open.updatedAt)}</dd>
          {open.completedAt ? <><dt>{tt('ahx.completedAt')}</dt><dd>{fmtDateTime(open.completedAt)}</dd></> : null}
          {open.canceledAt ? <><dt>{tt('ahx.canceledAt')}</dt><dd>{fmtDateTime(open.canceledAt)}</dd></> : null}
          <dt>{tt('ahx.kpi.rescheduled')}</dt><dd>{open.rescheduled ? tt('ahx.moved', { n: open.rescheduled }) : tt('ahx.never')}</dd>
        </dl>
        {/* extras (Appointment History 04) — change & source evidence: what the append-only change log recorded (original → new
            value, who, which booking path, when), newest first. Read-only; changes are made in Booking. */}
        {open.changes ? <><h3 className="p-h" style={{ margin: '8px 0 4px' }}>{tt('ahx.changes.title')}</h3>
          {open.changes.length ? <ul className="sub" data-testid="ahx-changes" style={{ margin: 0, paddingLeft: 18 }}>{open.changes.map((c) => <li key={c.id} data-testid="ahx-change">
            <b>{codeLabel('ahx.changes.k.' + c.changeType, c.changeType)}</b>{c.field ? ` · ${codeLabel('ahx.changes.f.' + c.field, c.field)}` : ''}
            {c.oldValue != null || c.newValue != null ? ` · ${changeValue(c.field, c.oldValue)} → ${changeValue(c.field, c.newValue)}` : ''}
            {` · ${fmtDateTime(c.at)} · ${c.actor ?? (c.actorType ? codeLabel('ahx.changes.a.' + c.actorType, c.actorType) : tt('ahx.changes.unknownActor'))}`}{c.source ? ` · ${statusLabel('source', c.source)}` : ''}
          </li>)}</ul> : <p className="sub" data-testid="ahx-changes-none">{tt('ahx.changes.none')}</p>}</> : null}
        {open.customerId && String(open.status).toLowerCase() === 'completed' ? <RebookingShortcut customerId={open.customerId} /> : null}
        <p className="sub">{tt('ahx.detailNote')}</p>
      </FitDialog> : null}
      {customer ? <CustomerHistory customer={customer} onClose={() => setCustomer(null)} /> : null}
      {health ? <FitDialog wide testId="ahx-health" title={tt('ahx.check')} onClose={() => setHealth(null)} footer={<button className="btn ghost" onClick={() => setHealth(null)}>{t('pos.close')}</button>}
        subtitle={health !== 'loading' && !('error' in health) ? tt('cnx.health.overall', { s: tt('cnx.health.' + health.overall), at: fmtDateTime(health.checkedAt) }) : undefined}>
        {health === 'loading' ? <div className="state">{tt('cnx.health.running')}</div> : 'error' in health ? <div className="err">{health.error}</div> : <>
          <p className="sub">{tt('ahx.health.readOnly')}</p>
          {health.checks.map((x) => <div key={x.key} className="rvw-check" data-testid={`ahx-chk-${x.key}`}>
            <div><span className={'chip ' + (x.state === 'READY' ? 'ok' : x.state === 'WARNING' ? 'warn' : 'bad')}>{tt('cnx.health.' + x.state)}</span> <b>{tt('ahx.health.k.' + x.key)}</b>{x.count ? <span className="sub"> · {fmtNumber(x.count)}</span> : null}</div>
            <div className="sub">{tt('ahx.health.d.' + x.key + '.' + x.state)}</div></div>)}
        </>}
      </FitDialog> : null}
    </div>
  );
}
