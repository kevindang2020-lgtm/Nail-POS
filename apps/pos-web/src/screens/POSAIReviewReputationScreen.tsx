// POSAIReviewReputationScreen.tsx — the tenant AI Review & Reputation workspace. Sections: Overview, Review Inbox,
// Response Approvals, Serious Complaints, Feedback Trends, Branch Comparison, Review Requests, Integrations. Cream/gold
// design system. Reads are honest: when the backend read layer returns nothing yet, sections show empty states rather
// than fabricated data. Publishing/approval actions require the manage permission (enforced server-side).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { posAiReviewReputationApi as apiR } from '../api/posAiReviewReputationApi';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

import { statusLabels } from '../i18n/status-label';
import { growthCode } from './growthLabels';
const GOLD = 'var(--aps-orange,#A96F22)';
const LINE = 'var(--line,#E7DBC6)';
const MUTED = 'var(--muted,#7A6C57)';
const PAGE = 'var(--page,#F7EFE3)';

type Tab = 'overview' | 'inbox' | 'approvals' | 'serious' | 'trends' | 'branches' | 'requests' | 'integrations';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', get label() { return tx('pos.overview'); } }, { key: 'inbox', get label() { return tx('pos.review_inbox'); } }, { key: 'approvals', get label() { return tx('pos.response_approvals'); } },
  { key: 'serious', get label() { return tx('pos.serious_complaints'); } }, { key: 'trends', get label() { return tx('pos.feedback_trends'); } }, { key: 'branches', get label() { return tx('pos.branch_comparison'); } },
  { key: 'requests', get label() { return tx('pos.review_requests'); } }, { key: 'integrations', get label() { return tx('pos.integrations'); } },
];

const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 14 };
const h2: React.CSSProperties = { font: '600 15px/1.2 "Playfair Display",serif', color: 'var(--text,#2B2118)', margin: 0 };

function Empty({ msg }: { msg: string }) { return <div style={{ ...card, color: MUTED, textAlign: 'center', padding: 28, fontSize: 13 }}>{msg}</div>; }
function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: 'danger' | 'default' }) {
  return <div style={card}><div style={{ fontSize: 11, color: MUTED, marginBottom: 6 }}>{label}</div><div style={{ font: '700 22px/1 "Playfair Display",serif', color: tone === 'danger' ? '#B0413E' : 'var(--text,#2B2118)' }}>{value}</div></div>;
}

export function POSAIReviewReputationScreen() {
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<any>(null);
  const [inbox, setInbox] = useState<any>(null);
  const [urgent, setUrgent] = useState<any[]>([]);
  const [branches, setBranches] = useState<any>(null);
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [a, i, u, b, ig] = await Promise.all([
        apiR.analytics().catch(() => null), apiR.inbox().catch(() => null), apiR.urgentQueue().catch(() => []),
        apiR.branchComparison().catch(() => null), apiR.integrationStatus().catch(() => []),
      ]);
      setAnalytics(a); setInbox(i); setUrgent(Array.isArray(u) ? u : []); setBranches(b); setIntegrations(Array.isArray(ig) ? ig : []);
    } catch (e: any) { setErr(e?.message || tx('pos.could_not_load_review_data')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const m = analytics?.metrics;
  const trend = analytics?.trend;
  const reviews: any[] = useMemo(() => inbox?.items || [], [inbox]);
  const awaiting = useMemo(() => reviews.filter((r) => r.responseStatus === 'awaiting_approval' || r.response_status === 'awaiting_approval'), [reviews]);

  const act = async (fn: () => Promise<unknown>, id: string) => { setBusyId(id); try { await fn(); await load(); } catch (e: any) { setErr(e?.message || tx('pos.action_failed')); } finally { setBusyId(null); } };

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '16px 20px 24px', background: PAGE, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h1 style={{ font: '600 22px/1.1 "Playfair Display",serif', color: 'var(--text,#2B2118)', margin: 0 }}>{tx('pos.ai_review_and_reputation')}</h1>
        <div style={{ fontSize: 12.5, color: MUTED, marginTop: 3 }}>{tx('pos.monitor_feedback_respond_professionally_with_approval_1lex')}</div>
      </div>

      <div role="tablist" aria-label={tx('pos.review_sections')} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', borderBottom: `1px solid ${LINE}`, paddingBottom: 8 }}>
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${tab === t.key ? GOLD : LINE}`, background: tab === t.key ? GOLD : '#fff', color: tab === t.key ? '#fff' : 'var(--text,#2B2118)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
            {t.label}{t.key === 'serious' && urgent.length ? ` (${urgent.length})` : ''}
          </button>
        ))}
      </div>

      {loading ? <div style={{ ...card, color: MUTED }}>{tx('pos.loading')}</div> : err ? (
        <div style={{ ...card, borderColor: '#E4B7B5', color: '#B0413E' }}>{err} <button onClick={() => void load()} style={{ marginLeft: 8, color: GOLD, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>{tx('pos.retry')}</button></div>
      ) : (
        <>
          {tab === 'overview' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3" style={{gap: 10 }}>
              <Kpi label={tx('pos.average_rating_3')} value={m ? m.avgRating : '—'} />
              <Kpi label={tx('pos.reviews_2')} value={m ? m.reviewCount : '—'} />
              <Kpi label={tx('pos.negative_share')} value={m ? `${m.negativePct}%` : '—'} />
              <Kpi label={tx('pos.awaiting_approval')} value={awaiting.length} />
              <Kpi label={tx('pos.serious_complaints_2')} value={urgent.length} tone={urgent.length ? 'danger' : 'default'} />
              <Kpi label={tx('pos.response_rate')} value={m ? `${m.responseRate}%` : '—'} />
            </div>
          )}

          {tab === 'inbox' && (reviews.length ? (
            <div style={card}>
              <div className="overflow-x-auto w-full"><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }} className="w-full min-w-max">
                <thead><tr style={{ textAlign: 'left', color: MUTED }}><th style={{ padding: 6 }}>{tx('pos.rating')}</th><th>{tx('pos.sentiment')}</th><th>{tx('pos.status')}</th><th>{tx('pos.review')}</th></tr></thead>
                <tbody>{reviews.map((r) => (
                  <tr key={r.id} style={{ borderTop: `1px solid ${LINE}` }}><td style={{ padding: 6 }}>{r.rating ?? '—'}</td><td>{r.sentiment ?? '—'}</td><td>{r.responseStatus ?? r.response_status ?? '—'}</td><td style={{ color: MUTED }}>{(r.comment || '').slice(0, 80)}</td></tr>
                ))}</tbody>
              </table></div>
            </div>
          ) : <Empty msg={tx('pos.no_reviews_yet_connect_a_review_1dy4')} />)}

          {tab === 'approvals' && (awaiting.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{awaiting.map((r) => (
              <div key={r.id} style={card}>
                <div style={{ fontSize: 12.5, marginBottom: 8 }}>{(r.comment || '').slice(0, 160)}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <button disabled={busyId === r.id} onClick={() => act(() => apiR.approve(r.id), r.id)} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: GOLD, color: '#fff', fontWeight: 600, cursor: 'pointer' }}>{tx('pos.approve')}</button>
                  <button disabled={busyId === r.id} onClick={() => act(() => apiR.publish(r.id), r.id)} style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${LINE}`, background: '#fff', fontWeight: 600, cursor: 'pointer' }}>{tx('pos.publish')}</button>
                  <button disabled={busyId === r.id} onClick={() => act(() => apiR.reject(r.id, 'Not appropriate'), r.id)} style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${LINE}`, background: '#fff', color: '#B0413E', fontWeight: 600, cursor: 'pointer' }}>{tx('pos.reject')}</button>
                </div>
              </div>
            ))}</div>
          ) : <Empty msg={tx('pos.no_responses_awaiting_approval_drafts_you_1kdv')} />)}

          {tab === 'serious' && (urgent.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{urgent.map((e) => (
              <div key={e.id} style={{ ...card, borderColor: '#E4B7B5' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, color: '#B0413E', textTransform: 'capitalize' }}>{growthCode(e.severity, 'level')} {tx('pos.complaint')}</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <button disabled={busyId === e.id} onClick={() => act(() => apiR.acknowledge(e.id), e.id)} style={{ padding: '5px 10px', borderRadius: 8, border: `1px solid ${LINE}`, background: '#fff', fontWeight: 600, cursor: 'pointer' }}>{tx('pos.acknowledge')}</button>
                    <button disabled={busyId === e.id} onClick={() => act(() => apiR.resolveEscalation(e.id, e.reviewId), e.id)} style={{ padding: '5px 10px', borderRadius: 8, border: 'none', background: GOLD, color: '#fff', fontWeight: 600, cursor: 'pointer' }}>{tx('pos.resolve')}</button>
                  </div>
                </div>
              </div>
            ))}</div>
          ) : <Empty msg={tx('pos.no_serious_complaints_in_the_queue_19tn')} />)}

          {tab === 'trends' && (trend ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={card}><h2 style={h2}>{tx('pos.what_improved')}</h2><div style={{ fontSize: 12.5, color: MUTED, marginTop: 6 }}>{trend.improved?.length ? statusLabels('reviewTopic', trend.improved) : tx('pos.no_improvements_this_period')}</div></div>
              <div style={card}><h2 style={h2}>{tx('pos.what_declined')}</h2><div style={{ fontSize: 12.5, color: MUTED, marginTop: 6 }}>{trend.declined?.length ? statusLabels('reviewTopic', trend.declined) : tx('pos.no_declines_this_period')}</div></div>
            </div>
          ) : <Empty msg={tx('pos.trends_compare_two_periods_once_there_10bq')} />)}

          {tab === 'branches' && (branches?.branches?.length ? (
            <div style={card}>
              <div className="overflow-x-auto w-full"><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }} className="w-full min-w-max">
                <thead><tr style={{ textAlign: 'left', color: MUTED }}><th style={{ padding: 6 }}>{tx('pos.branch')}</th><th>{tx('pos.avg_rating')}</th><th>{tx('pos.negative')}</th></tr></thead>
                <tbody>{branches.branches.map((b: any) => (
                  <tr key={b.branchId} style={{ borderTop: `1px solid ${LINE}` }}><td style={{ padding: 6 }}>{b.branchName}{b.branchId === branches.bestByRating ? ' ★' : ''}</td><td>{b.metrics?.avgRating ?? '—'}</td><td>{b.metrics?.negativePct ?? '—'}%</td></tr>
                ))}</tbody>
              </table></div>
            </div>
          ) : <Empty msg={tx('pos.branch_comparison_appears_here_for_multi_12dh')} />)}

          {tab === 'requests' && <Empty msg={tx('pos.post_visit_review_requests_send_automatically_17lj')} />}

          {tab === 'integrations' && (integrations.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{integrations.map((s) => (
              <div key={s.source} style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ textTransform: 'capitalize', fontWeight: 600 }}>{growthCode(s.source, 'source')}</span>
                <span style={{ fontSize: 12, color: s.connected ? '#2E7D5B' : MUTED }}>{s.connected ? tx('pos.connected_last_sync_v0', { v0: String(s.lastSyncAt || '—') }) : tx('pos.not_connected_2')}</span>
              </div>
            ))}</div>
          ) : <Empty msg={tx('pos.no_review_sources_connected_yet_google_1jo7')} />)}
        </>
      )}
    </div>
  );
}
