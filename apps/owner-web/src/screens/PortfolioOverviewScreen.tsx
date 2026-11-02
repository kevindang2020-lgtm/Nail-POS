import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useOwnerSalon } from '../shell/OwnerSalonContext';
import { formatCurrency } from '@aipowersalon/money';   // BUILD_PLAN Phase 13 E (C6 §99–100): shared money / branch-zone date display

// PortfolioOverviewScreen — the "All Salons" dashboard from the reference image.
//
// Every number here is REAL: it comes from `GET /owner/portfolio/summary`, which aggregates across only the salons
// this owner may see figures for, in integer cents. Nothing on this screen is hard-coded, and nothing is
// fabricated when data is missing — an unavailable figure says so rather than rendering a confident zero.
//
// The change percentages in the reference image (↑18.6%, ↑20.3%) are deliberately NOT shown: a period-over-period
// comparison is not modelled on the backend, and inventing one would be a fabricated dashboard value. When the
// comparison exists, the card renders it; until then it doesn't pretend.

const GOLD = 'var(--owner-primary, #A96F22)';
const LINE = 'var(--line, #E4DACA)';
const TEXT = 'var(--text, #2A2118)';
const MUTED = '#8A7A66';

interface Summary {
  totalSalons: number;
  activeSalons: number;
  totalBranches: number;
  appointmentsToday: number;
  checkedIn: number;
  customersWaiting: number;
  servicesInProgress: number;
  readyForCheckout: number;
  techniciansWorking: number;
  newClientsToday: number;
  revenueTodayCents: number;
  revenueMonthCents: number;
  tipsTodayCents: number;
  aiReceptionist: 'live' | 'degraded' | 'none';
  salonsWithheldForPermission: number;
  /** Change vs yesterday, COMPUTED on the server. `null` = no baseline, so the card shows nothing. */
  changes: {
    revenueTodayPct: number | null;
    tipsTodayPct: number | null;
    appointmentsPct: number | null;
    checkedInPct: number | null;
    newClientsPct: number | null;
  };
}

/** One salon in the ranked list. Only salons this owner may REPORT on ever appear — the backend never even
 *  queries the others, so an unauthorized salon's revenue cannot reach this component to be rendered. */
interface TopSalon { rank: number; tenantId: string; salonName: string; revenueTodayCents: number }

/** One hour of the Revenue Overview chart. Integer cents, refund-netted, straight from the server. */
interface RevenuePoint { hour: number; revenueCents: number }

/** Integer cents → money. Never floats: a portfolio sums many salons and float drift is real. */
function money(cents: number): string {
  return formatCurrency(Math.round(cents), { fractionDigits: 0 });
}

const card: React.CSSProperties = {
  background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: '12px 14px',
  boxShadow: '0 1px 3px rgba(42,33,24,.05)',
};

/**
 * A change chip (↑12.4% / ↓3.1%) — rendered ONLY when the server actually computed one.
 *
 * `null` means the comparison is undefined (a salon that took nothing yesterday did not grow by a percentage),
 * and the chip is then simply absent. It is never "+100%", never "0%", and never a filler. The reference image
 * shows these deltas; they are real now because they are DERIVED from yesterday's refund-netted figures, not
 * typed into the component.
 */
function Delta({ pct }: { pct: number | null | undefined }) {
  if (pct == null || pct === 0) return null;
  const up = pct > 0;
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color: up ? '#3F6B46' : '#9E4A3C', marginLeft: 6 }}>
      {up ? '↑' : '↓'}{Math.abs(pct).toFixed(1)}%
    </span>
  );
}

function Kpi({ label, value, sub, tone, pct, loading }: { label: string; value?: string; sub?: string; tone?: 'ok' | 'warn' | 'none'; pct?: number | null; loading?: boolean }) {
  const color = tone === 'ok' ? '#3F6B46' : tone === 'warn' ? '#8F6B26' : tone === 'none' ? MUTED : TEXT;
  return (
    <div style={card}>
      <div style={{ fontSize: 11.5, color: MUTED, fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, lineHeight: 1.15, display: 'flex', alignItems: 'baseline' }}>
        {loading ? <div className="owner-skel" style={{ width: 40, height: 24, margin: 0, borderRadius: 4 }} /> : <>{value}<Delta pct={pct} /></>}
      </div>
      {loading ? <div className="owner-skel" style={{ width: 60, height: 12, marginTop: 4, borderRadius: 4 }} /> : sub ? <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{sub}</div> : null}
    </div>
  );
}

/**
 * Revenue Overview — a plain SVG line, drawn from the server's hourly points.
 *
 * Deliberately NOT a chart library: this is one polyline, and pulling in a dependency to draw it would be the
 * only thing in owner-web that needed one. The y-axis is scaled to the real maximum, so a quiet day is a low
 * line rather than a rescaled one that flatters it.
 *
 * An EMPTY series renders "no revenue recorded yet" — never a flat zero line, which reads as a real, confident
 * "you took nothing today" when in fact nothing was measured.
 */
function RevenueChart({ points }: { points: RevenuePoint[] }) {
  const W = 320, H = 120, PAD_L = 6, PAD_B = 16, PAD_T = 8;

  if (!points.length) {
    return <div style={{ color: MUTED, fontSize: 12.5, padding: '18px 0', textAlign: 'center' }}>No revenue recorded yet today.</div>;
  }

  const max = Math.max(...points.map((p) => p.revenueCents), 0);
  const min = Math.min(...points.map((p) => p.revenueCents), 0);   // refunds can push an hour negative
  const span = max - min || 1;
  const plotH = H - PAD_B - PAD_T;
  const x = (i: number) => PAD_L + (i * (W - PAD_L * 2)) / Math.max(1, points.length - 1);
  const y = (c: number) => PAD_T + plotH - ((c - min) / span) * plotH;

  const d = points.map((p, i) => `${x(i)},${y(p.revenueCents)}`).join(' ');
  const zeroY = y(0);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Revenue by hour, today">
      {/* the zero line only appears when an hour actually went negative (a refund), so it means something */}
      {min < 0 ? <line x1={PAD_L} x2={W - PAD_L} y1={zeroY} y2={zeroY} stroke={LINE} strokeWidth={1} strokeDasharray="3 3" /> : null}
      <polyline points={d} fill="none" stroke={GOLD} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => <circle key={p.hour} cx={x(i)} cy={y(p.revenueCents)} r={2} fill={GOLD} />)}
      {points.filter((_, i) => i % 4 === 0).map((p) => (
        <text key={p.hour} x={x(points.indexOf(p))} y={H - 3} fontSize={8} fill={MUTED} textAnchor="middle">
          {p.hour === 0 ? '12a' : p.hour < 12 ? `${p.hour}a` : p.hour === 12 ? '12p' : `${p.hour - 12}p`}
        </text>
      ))}
    </svg>
  );
}

/** Top Performing Salons. Tapping a row switches the owner into that salon — the same server-verified switch. */
function TopSalons({ salons, onOpen }: { salons: TopSalon[]; onOpen: (tenantId: string) => void }) {
  if (!salons.length) {
    return <div style={{ color: MUTED, fontSize: 12.5, padding: '10px 0' }}>No salon revenue to rank yet today.</div>;
  }
  return (
    <div>
      {salons.map((s) => (
        <button
          key={s.tenantId}
          onClick={() => onOpen(s.tenantId)}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 0',
            background: 'none', border: 0, borderBottom: `1px solid ${LINE}`, cursor: 'pointer', textAlign: 'left',
          }}
        >
          <span style={{ fontSize: 12, color: MUTED, fontWeight: 700, minWidth: 14 }}>{s.rank}</span>
          <span style={{ flex: 1, fontSize: 13.5, color: TEXT, fontWeight: 600 }}>{s.salonName}</span>
          <span style={{ fontSize: 13.5, color: GOLD, fontWeight: 700 }}>{money(s.revenueTodayCents)}</span>
        </button>
      ))}
    </div>
  );
}

export function PortfolioOverviewScreen() {
  const { epoch, viewingAllSalons, switchSalon } = useOwnerSalon();
  const [data, setData] = useState<Summary | null>(null);
  const [top, setTop] = useState<TopSalon[]>([]);
  const [series, setSeries] = useState<RevenuePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const ctl = new AbortController();

    (async () => {
      setLoading(true);
      setError(null);
      try {
        // Both reads are scoped to the SAME authorized set on the server (reportable salons only), so the chart
        // and the ranking can never contain a salon the KPI cards excluded.
        const [r, sr] = await Promise.all([
          api.get<{ summary: Summary; topSalons: TopSalon[] }>('/owner/portfolio/summary'),
          api.get<{ points: RevenuePoint[] }>('/owner/portfolio/revenue-series'),
        ]);
        if (!cancelled) {
          setData(r.summary);
          setTop(r.topSalons || []);
          setSeries(sr.points || []);
        }
      } catch (e: any) {
        // An error shows an error. It does NOT fall back to zeros — a dashboard that reports 0 revenue when it
        // simply failed to load is worse than one that says it could not load.
        if (!cancelled) { setError(e?.message || 'We could not load your portfolio.'); setData(null); setTop([]); setSeries([]); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; ctl.abort(); };
    // Re-fetches on every salon switch: `epoch` changes, so nothing from the previous context survives.
  }, [epoch, viewingAllSalons]);

  if (error) {
    return (
      <div style={{ paddingTop: 16 }}>
        <h1 style={{ fontSize: 20, color: TEXT, margin: '0 0 12px' }}>All Salons</h1>
        <div role="alert" style={{ ...card, background: '#FBEDE9', borderColor: '#F0D2C9', color: '#8F3226', fontSize: 13.5 }}>
          {error}
        </div>
      </div>
    );
  }

  // Sep 2026 merge: while the portfolio loads, say so — the redesign rendered the dashboard skeleton with no status
  if (loading && !data) {
    return (
      <div style={{ paddingTop: 16 }}>
        <h1 style={{ fontSize: 20, color: TEXT, margin: '0 0 12px' }}>All Salons</h1>
        <div role="status" style={{ ...card, color: MUTED, fontSize: 14 }}>Loading your salons…</div>
      </div>
    );
  }

  if (!loading && (!data || data.totalSalons === 0)) {
    return (
      <div style={{ paddingTop: 16 }}>
        <h1 style={{ fontSize: 20, color: TEXT, margin: '0 0 12px' }}>All Salons</h1>
        <div style={{ ...card, color: MUTED, fontSize: 14 }}>
          No salons are assigned to your account yet.
        </div>
      </div>
    );
  }

  const ai = data
    ? data.aiReceptionist === 'live' ? { value: 'Online', sub: 'All systems operational', tone: 'ok' as const }
      : data.aiReceptionist === 'degraded' ? { value: 'Partial', sub: 'Not running at every salon', tone: 'warn' as const }
      // "None" — NOT "Offline". Offline implies something is broken; these salons never set one up.
      : { value: 'Not set up', sub: 'No salon has one configured', tone: 'none' as const }
    : { value: '', sub: '', tone: 'none' as const };

  return (
    <div style={{ padding: '14px 16px max(20px, env(safe-area-inset-bottom))' }}>
      <h1 style={{ fontSize: 20, color: TEXT, margin: '0 0 2px', fontWeight: 700 }}>All Salons</h1>
      <p style={{ fontSize: 12.5, color: MUTED, margin: '0 0 14px' }}>Portfolio overview · today</p>

      {data && data.salonsWithheldForPermission > 0 ? (
        // Honest: some salons are NOT in these totals. Silently adding them as zero would make the figures look
        // precise while being wrong.
        <div style={{ ...card, background: '#FBF3DE', borderColor: '#ECDCAE', color: '#7A5A12', fontSize: 12.5, marginBottom: 12 }}>
          {data.salonsWithheldForPermission} salon{data.salonsWithheldForPermission === 1 ? '' : 's'} not included —
          your role there doesn’t include reporting.
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
        <Kpi label="Total Salons" value={data ? String(data.totalSalons) : undefined} sub={data ? `Active: ${data.activeSalons}` : undefined} loading={loading} />
        <Kpi label="Total Branches" value={data ? String(data.totalBranches) : undefined} loading={loading} />
        <Kpi label="Appointments" value={data ? String(data.appointmentsToday) : undefined} pct={data?.changes?.appointmentsPct} loading={loading} />
        <Kpi label="Checked In" value={data ? String(data.checkedIn) : undefined} pct={data?.changes?.checkedInPct} loading={loading} />
        <Kpi label="Revenue (Today)" value={data ? money(data.revenueTodayCents) : undefined} pct={data?.changes?.revenueTodayPct} loading={loading} />
        <Kpi label="Tips (Today)" value={data ? money(data.tipsTodayCents) : undefined} pct={data?.changes?.tipsTodayPct} loading={loading} />
        <Kpi label="Technicians Working" value={data ? String(data.techniciansWorking) : undefined} loading={loading} />
        <Kpi label="Clients Waiting" value={data ? String(data.customersWaiting) : undefined} loading={loading} />
        <Kpi label="Services In Progress" value={data ? String(data.servicesInProgress) : undefined} loading={loading} />
        <Kpi label="Ready For Checkout" value={data ? String(data.readyForCheckout) : undefined} loading={loading} />
        <Kpi label="New Clients (Today)" value={data ? String(data.newClientsToday) : undefined} pct={data?.changes?.newClientsPct} loading={loading} />
        <Kpi label="AI Receptionist" value={ai.value} sub={ai.sub} tone={ai.tone} loading={loading} />
      </div>

      <div style={{ ...card, marginTop: 12 }}>
        <div style={{ fontSize: 12.5, color: MUTED, fontWeight: 600, marginBottom: 4 }}>Revenue Overview</div>
        {loading ? (
          <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="owner-skel" style={{ width: '100%', height: '100%', borderRadius: 8 }} />
          </div>
        ) : (
          <RevenueChart points={series} />
        )}
      </div>

      <div style={{ ...card, marginTop: 12 }}>
        <div style={{ fontSize: 12.5, color: MUTED, fontWeight: 600, marginBottom: 2 }}>Top Performing Salons (Today)</div>
        {/* Tapping a salon performs the SAME server-verified switch as the switcher — the client never assumes
            the switch succeeded, and the screen re-fetches under the new epoch. */}
        {loading ? (
          <div style={{ padding: '8px 0' }}>
            <div className="owner-skel" style={{ width: '100%', height: 32, marginBottom: 8, borderRadius: 4 }} />
            <div className="owner-skel" style={{ width: '100%', height: 32, marginBottom: 8, borderRadius: 4 }} />
            <div className="owner-skel" style={{ width: '100%', height: 32, borderRadius: 4 }} />
          </div>
        ) : (
          <TopSalons salons={top} onOpen={(tenantId) => { void switchSalon(tenantId).catch(() => {}); }} />
        )}
      </div>

      <div style={{ ...card, marginTop: 12 }}>
        <div style={{ fontSize: 12.5, color: MUTED, fontWeight: 600 }}>Revenue this month</div>
        <div style={{ fontSize: 26, fontWeight: 700, color: GOLD, marginTop: 2 }}>
          {loading ? <div className="owner-skel" style={{ width: 100, height: 30, borderRadius: 4 }} /> : money(data!.revenueMonthCents)}
        </div>
        <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>
          {loading ? <div className="owner-skel" style={{ width: 140, height: 14, borderRadius: 4, marginTop: 4 }} /> : `Across ${data!.activeSalons} active salon${data!.activeSalons === 1 ? '' : 's'}`}
        </div>
      </div>
    </div>
  );
}
