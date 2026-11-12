// POSAICustomerProfileAssistantScreen.tsx — AI Center → AI Customer Profile Assistant (/tenant/ai/customer-insights). AI Customer
// Profile Assistant guide (Nov 2 2026, built Nov 3 2026). The add-on header stays and is honest (AiPackagePanel). Below it, the
// assistant's dashboard reads Customer Intelligence (/pos/customer-intelligence/*, which owns the classification): the cards from the
// latest scan (or "not scanned yet" — never zeros), the customer list (search name / phone / email — contact masked unless the role
// may see it · status · flag · which date · presets + From/To month calendar · sort · numbered pages) and Check Customer
// Intelligence System. Nothing here edits a profile, merges, or messages a customer.
import { AiPackagePanel } from './POSAiPackageScreen';
import { AssistantDashboard } from '../components/AssistantDashboard';
import { posCustomerIntelligenceApi } from '../api/posCustomerIntelligenceApi';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { fmtNumber, fmtInZone } from '../i18n/format';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { asWhen } from '../components/AssistantDashboard';
import { CustomerQuickView, type CpxCard } from '../components/CustomerProfilesDirectory';   // extras #04: the REAL profile overlay, read-only

const t = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);
const STATUSES = ['all', 'active', 'rebooking_soon', 'due_for_return', 'inactive_all', 'inactive', 'long_term_inactive', 'insufficient_history', 'never_served', 'not_scanned'];
// Kevin, Nov 12 2026: churn belongs to Customer Retention — this page shows Retention's classification (summary.retention,
// row.retention, read by the server from the Retention module) and links to it; it has no churn rule, flag or filter of its own.
const FLAGS = ['rebooking', 'upcoming', 'duplicate'];
const RET_TONE: Record<string, string> = { at_risk: 'warn', approaching: 'gold', active: 'ok', never_visited: '' };
const RETENTION_ROUTE = '/tenant/customers/retention';
const DATES = ['last_visit', 'created', 'next_appointment', 'profile_updated'];
const SORTS = ['last_visit', 'recently_added', 'name', 'visits', 'days_since'];
const day = (iso?: string | null) => (iso ? fmtInZone(iso.length === 10 ? iso + 'T12:00:00Z' : iso, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const card = (s: any, k: string) => (s?.cards ? fmtNumber(s.cards[k] ?? 0) : t('cpx.notScanned'));
const ci = posCustomerIntelligenceApi;

export function POSAICustomerProfileAssistantScreen() {
  // Customer Snapshot (extras #04): a row opens the existing Customer 360 Quick View (same GET /pos/customers/:id as the
  // profile page, contact masked by the server for the role) with its Booking / History / Notes links — no second profile
  // record and nothing private kept on this AI page. Full View opens the profile page for that id.
  const nav = useNavigate();
  const [snap, setSnap] = useState<CpxCard | null>(null);
  return (
    <>
    <AiPackagePanel code="ai_customer_profile_assistant" title={t('pos.ai_customer_insights')}>
      <AssistantDashboard testId="cpx-dashboard"
        summary={ci.summary}
        kpis={[
          { key: 'scanned', label: t('cpx.kpi.scanned'), value: (s) => card(s, 'scanned') },
          { key: 'active', label: t('cpx.kpi.active'), value: (s) => card(s, 'active') },
          { key: 'upcoming', label: t('cpx.kpi.upcoming'), value: (s) => card(s, 'withUpcoming') },
          { key: 'inactive', label: t('cpx.kpi.inactive'), value: (s) => card(s, 'inactive') },
          { key: 'churn', label: t('cpx.kpi.retAtRisk'), value: (s) => (s?.retention ? fmtNumber(s.retention.atRisk) : '—'), tone: (s) => (s?.retention?.atRisk ? 'warn' : undefined) },
          { key: 'rebooking', label: t('cpx.kpi.rebooking'), value: (s) => card(s, 'rebooking'), tone: (s) => (s?.cards?.rebooking ? 'gold' : undefined) },
        ]}
        list={ci.customers}
        rowKey={(r) => r.id}
        columns={[
          { key: 'customer', label: t('cpx.col.customer'), render: (r) => <><button className="aic-link" data-testid="cpx-snapshot-open" onClick={() => setSnap({ id: r.id, name: r.name ?? '' })} aria-label={t('cpx.snapshot.open', { name: r.name ?? '—' })}><b>{r.name ?? '—'}</b></button>{r.phone ? <div className="sub">{r.phone}</div> : null}</> },
          { key: 'status', label: t('cpx.col.status'), render: (r) => <span className="chip">{t('cix.status.' + (r.scanned ? (STATUSES.includes(r.status) ? r.status : 'not_scanned') : (r.neverServed ? 'never_served' : 'not_scanned')))}</span> },
          { key: 'last', label: t('cpx.col.last'), render: (r) => <>{day(r.lastVisitAt)}{r.daysSinceLast != null ? <div className="sub">{t('cpx.daysAgo', { n: fmtNumber(r.daysSinceLast) })}</div> : null}</> },
          { key: 'visits', label: t('cpx.col.visits'), render: (r) => (r.completedVisits == null ? '—' : fmtNumber(r.completedVisits)) },
          { key: 'next', label: t('cpx.col.next'), render: (r) => day(r.nextAppointmentDate) },
          { key: 'retention', label: t('cpx.col.retention'), render: (r) => (r.retention ? <button type="button" className={'chip ' + (RET_TONE[r.retention.segment] ?? '')} data-testid="cpx-retention" onClick={() => nav(RETENTION_ROUTE)} title={t('cpx.ret.open')}>{t('cpx.ret.seg.' + r.retention.segment)}</button> : '—') },
          { key: 'flags', label: t('cpx.col.flags'), render: (r) => <>{r.rebooking ? <span className="chip">{t('cix.flag.rebooking')}</span> : null} {r.duplicate ? <span className="chip">{t('cix.flag.duplicate')}</span> : null}</> },
        ]}
        filters={[
          { key: 'status', label: t('cpx.f.status'), options: STATUSES.map((v) => ({ value: v, label: v === 'all' ? t('cpx.anyStatus') : t('cix.status.' + v) })) },
          { key: 'flag', label: t('cpx.f.flag'), options: [{ value: '', label: t('cpx.anyFlag') }, ...FLAGS.map((v) => ({ value: v, label: t('cix.flag.' + v) }))] },
          { key: 'dateField', label: t('cpx.dateLabel'), options: DATES.map((v) => ({ value: v, label: t('cix.date.' + v) })) },
        ]}
        sorts={SORTS.map((v) => ({ value: v, label: t('cix.sort.' + v) }))}
        presets={['today', 'yesterday', 'week', 'last_7', 'month', 'last_30', 'last_90', 'last_month', 'year']}
        searchPlaceholder={t('cpx.searchPh')} listTitle={t('cpx.list')}
        emptyText={(filtered) => (filtered ? t('cpx.noMatch') : t('cpx.empty'))}
        check={ci.check} checkLabel={t('cpx.check')}
        checkText={{ title: (k) => t('cix.health.k.' + k), detail: (k, s, x) => (k === 'eligibility' && x?.detail ? t('cix.health.eligibility', { s: fmtNumber(x.detail.scanned), a: fmtNumber(x.detail.active), i: fmtNumber(x.detail.inactiveCard),
          n: fmtNumber(x.detail.neverServed), u: fmtNumber(x.detail.underCadence), r: fmtNumber(x.detail.rebookingSoon + x.detail.dueForReturn) }) : t('cix.health.d.' + k + '.' + s)) }}
        openTo="/tenant/ai/customer-profile" openLabel={t('cpx.open')} note={t('cpx.note')} evidence={(s) => <CpxEvidence s={s} />} />
      <div className="sub" data-testid="cpx-retention-source">{t('cpx.ret.source')} <button type="button" className="aic-link" data-testid="cpx-retention-link" onClick={() => nav(RETENTION_ROUTE)}>{t('cpx.ret.open')}</button></div>
    </AiPackagePanel>
    {snap ? <CustomerQuickView customer={snap} onClose={() => setSnap(null)} onFullView={() => { const id = snap.id; setSnap(null); nav(`/tenant/customers/profiles?customerId=${encodeURIComponent(id)}`); }} /> : null}
    </>
  );
}

const FRESH_TONE: Record<string, string> = { up_to_date: 'ok', stale: 'warn', failed: 'bad', never: '', running: 'gold' };
/** Evidence + Freshness (extras #03): where each part of this page comes from and how old it is — read from the SAME summary the
 *  cards use (Customer Intelligence's last scan + freshness, Customer Retention read live, the duplicate review's last scan).
 *  No parallel source ledger; an unknown time is "—", never invented. */
function CpxEvidence({ s }: { s: any }) {
  const f = s?.freshness; const dup = s?.duplicateReview;
  return (
    <section className="panel" style={{ padding: 12, marginTop: 12 }} data-testid="cpx-evidence" aria-label={t('cpx.ev.title')}>
      <div className="p-h">{t('cpx.ev.title')}</div>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        <li data-testid="cpx-ev-scan">{t('cpx.ev.scan')}{' '}
          {f ? <span className={'chip ' + (FRESH_TONE[f.state] ?? '')} data-testid="cpx-ev-scan-state">{t('cix.fresh.' + f.state, { at: asWhen(f.lastSuccessAt) })}</span> : '—'}
          {f?.state === 'stale' ? <div className="sub">{t('cpx.ev.stale', { n: fmtNumber(f.staleAfterMinutes ?? 0) })}</div> : null}
          {s?.breakdown?.newSinceScan ? <div className="sub" data-testid="cpx-ev-new">{t('cpx.ev.newSince', { n: fmtNumber(s.breakdown.newSinceScan) })}</div> : null}</li>
        <li data-testid="cpx-ev-retention">{s?.retention ? t('cpx.ev.retention', { d: fmtNumber(s.retention.atRiskDays) }) : t('cpx.ev.retentionUnknown')}</li>
        <li data-testid="cpx-ev-dup">{dup?.lastScanAt ? t('cpx.ev.dup', { at: asWhen(dup.lastScanAt) }) : t('cpx.ev.dupNever')}</li>
        <li className="sub">{t('cpx.ev.prefs')}</li>
      </ul>
    </section>
  );
}
