import { useCallback, useEffect, useState } from 'react';
import { useOwnerBranch } from '../shell/OwnerBranchContext';
import { useOwnerNav } from '../shell/nav';
import { ownerAiCenterApi, type OwnerAiCenterResp, type AiMetric } from '../api/ownerApi';
import { OwnerSkeletonBlocks, OwnerSkeletonCards, OwnerSkeletonList } from '../components/OwnerSkeleton';

// AI Center — Module 11 (read surface). Delegates to the canonical AI Center overview, which honestly flags every metric
// as tracked or not-yet-tracked. Untracked metrics render "—" with a quiet note rather than a fabricated number, and the
// capabilities list shows exactly which AI panels have real telemetry.

const fmt = (v: number): string => new Intl.NumberFormat('en-US').format(v);
function mtext(m?: AiMetric): string {
  if (!m || !m.tracked || m.value == null) return '—';
  const pre = m.estimated ? '~' : '';
  const u = (m.unit || '').toLowerCase();
  if (u === '%' || u === 'pct' || u === 'percent') return `${pre}${m.value}%`;
  if (u === 's' || u === 'sec' || u === 'seconds') return `${pre}${m.value}s`;
  return `${pre}${fmt(m.value)}`;
}
const timeOf = (iso: string): string => { try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };

function Kpi({ label, m, loading }: { label: string; m?: AiMetric; loading?: boolean }) {
  const tracked = !!m && m.tracked && m.value != null;
  return (
    <div className="owner-kpi">
      <div className="label">{label}</div>
      <div className="val">{loading ? <div className="owner-skel" style={{ width: 40, height: 24, margin: '0 auto' }} /> : mtext(m)}</div>
      {!loading && !tracked && <div className="sub owner-text-muted" style={{ fontSize: 11 }}>not tracked yet</div>}
    </div>
  );
}

export function AiCenterScreen() {
  const { back } = useOwnerNav();
  const { effectiveBranchId } = useOwnerBranch();
  const [data, setData] = useState<OwnerAiCenterResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    ownerAiCenterApi.overview(effectiveBranchId)
      .then((d) => { setData(d); setLoading(false); })
      .catch((e: any) => { setError(e?.message || 'Could not load AI Center.'); setLoading(false); });
  }, [effectiveBranchId]);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <header className="owner-header">
        <button className="owner-back" aria-label="Back" onClick={back}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--owner-text)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <div className="owner-greet" style={{ textAlign: 'center' }}><div className="n owner-serif" style={{ cursor: 'default', justifyContent: 'center' }}>AI Center</div></div>
        <div style={{ width: 40 }} />
      </header>

      {error ? (
        <div className="owner-state" role="alert">{error}</div>
      ) : (
        <div style={{ padding: '6px 16px 24px' }}>
          <div className="owner-kpigrid three" style={{ marginBottom: 8 }}>
            <Kpi label="AI Calls Handled" m={data?.kpis.aiCallsHandled} loading={loading && !data} />
            <Kpi label="Bookings by AI" m={data?.kpis.bookingsCapturedByAi} loading={loading && !data} />
            <Kpi label="Calls Recovered" m={data?.kpis.missedCallsRecovered} loading={loading && !data} />
          </div>
          <div className="owner-kpigrid three" style={{ marginBottom: 14 }}>
            <Kpi label="Conversations Today" m={data?.kpis.aiConversationsToday} loading={loading && !data} />
            <Kpi label="Automation Success" m={data?.kpis.automationSuccessRate} loading={loading && !data} />
            <Kpi label="Sentiment" m={data?.kpis.customerSentiment} loading={loading && !data} />
          </div>

          <div className="owner-chartcard" style={{ marginBottom: 12 }}>
            <div className="owner-sechead"><div className="h">Call Intelligence</div></div>
            <div className="owner-kpigrid three">
              <Kpi label="Handled" m={data?.callIntelligence.callsHandled} loading={loading && !data} />
              <Kpi label="Recovered" m={data?.callIntelligence.recovered} loading={loading && !data} />
              <Kpi label="Call → Booking" m={data?.callIntelligence.callToBookingRatePct} loading={loading && !data} />
            </div>
          </div>

          <div className="owner-chartcard" style={{ marginBottom: 12 }}>
            <div className="owner-sechead"><div className="h">Booking Assistant</div></div>
            <div className="owner-kpigrid three">
              <Kpi label="Completed" m={data?.bookingAssistant.completed} loading={loading && !data} />
              <Kpi label="AI Bookings" m={data?.bookingAssistant.aiBookings} loading={loading && !data} />
              <Kpi label="Rebookings" m={data?.bookingAssistant.rebookings} loading={loading && !data} />
            </div>
          </div>

          <div className="owner-sechead"><div className="h">Recent Activity</div></div>
          {loading && !data ? (
            <div className="owner-drill" style={{ marginBottom: 12 }}>
              <OwnerSkeletonList count={3} />
            </div>
          ) : data!.activity.length > 0 ? (
            <div className="owner-drill" style={{ marginBottom: 12 }}>
              {data!.activity.slice(0, 8).map((a, i) => (
                <div className="owner-drillrow" key={i}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700 }}>{a.assistant}</div>
                    <div className="owner-text-muted" style={{ fontSize: 12 }}>{a.action} · {timeOf(a.at)}</div>
                  </div>
                  <div className="owner-text-muted" style={{ fontSize: 12, marginLeft: 10, whiteSpace: 'nowrap' }}>{a.status}</div>
                </div>
              ))}
            </div>
          ) : null}

          <div className="owner-sechead"><div className="h">AI Capabilities</div><div className="d">live telemetry</div></div>
          {loading && !data ? (
            <div className="owner-drill">
              <OwnerSkeletonList count={3} />
            </div>
          ) : data!.sections.length > 0 ? (
            <div className="owner-drill">
              {data!.sections.map((s) => (
                <div className="owner-drillrow" key={s.key}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700 }}>{s.title}</div>
                    {!s.tracked && s.needs && <div className="owner-text-muted" style={{ fontSize: 11 }}>needs: {s.needs}</div>}
                  </div>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: s.tracked ? 'var(--owner-success)' : 'var(--owner-text-secondary)', marginLeft: 10, whiteSpace: 'nowrap' }}>
                    <span style={{ width: 8, height: 8, borderRadius: 4, background: s.tracked ? 'var(--owner-success)' : 'var(--owner-border)' }} />
                    {s.tracked ? 'Live' : 'Not tracked'}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
