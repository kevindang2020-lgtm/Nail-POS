// TechMyWorkScreens — the Technician App's own-data screens (merge Oct 12 2026; the other chat's workforce audit #26/#99
// screens on OUR routes): Time Clock, Performance, Tips, My Clients. Each reads ONE server endpoint scoped to her session;
// numbers come from the canonical stores (punches, breaks, compensation snapshots, reviews). Unknown values show "—".
// Data stays on screen while it refreshes; money through the shared formatter.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { techApi, type TechCustomerRow, type TechPerformanceView, type TechTimeClockView, type TechTipsView } from '../api/techApi';
import { useTechNav } from '../shell/nav';
import { money2 } from '../lib/tech';

const Back = () => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>);
const money = (c: number | null | undefined) => (c == null ? '—' : money2(c));
const hm = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
const time = (iso: string | null) => { if (!iso) return 'now'; const d = new Date(iso); return isNaN(d.getTime()) ? '—' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
const day = (iso: string | null) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString([], { month: 'short', day: 'numeric' }); };

export function MyWorkShell({ title, children }: { title: string; children: ReactNode }) {
  const nav = useTechNav();
  return (
    <div>
      <div className="tech-topbar" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="tech-iconbtn" aria-label="Back" onClick={() => nav.back()}><Back /></button>
        <h1 className="t-title" style={{ margin: 0, fontSize: 19 }}>{title}</h1>
      </div>
      <div className="tech-main-2">{children}</div>
    </div>
  );
}
function useLoad<T>(fn: () => Promise<T>, key: string) {
  const [data, setData] = useState<T | null>(null); const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(() => fn().then((d) => { setData(d); setError(null); }).catch((e: any) => setError(e?.message || 'Could not load.')), [key]);
  useEffect(() => { void load(); }, [load]);
  return { data, error };
}
const Metric = ({ label, value }: { label: string; value: ReactNode }) => (
  <div className="tech-card" style={{ padding: 12 }}><div className="tech-muted" style={{ fontSize: 11.5 }}>{label}</div><div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>{value}</div></div>
);
const Err = ({ error }: { error: string | null }) => (error ? <div className="tech-state" role="alert" style={{ color: '#B3261E' }}>{error}</div> : null);
function Windows<T extends number>({ options, value, onPick }: { options: readonly T[]; value: T; onPick: (v: T) => void }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 12 }} role="tablist" aria-label="Window">
      {options.map((d) => <button key={d} role="tab" aria-selected={value === d} className={value === d ? 'tech-btn gold' : 'tech-btn ghost'} onClick={() => onPick(d)}>{d} days</button>)}
    </div>
  );
}

export function TechTimeClockScreen() {
  const { data, error } = useLoad<TechTimeClockView>(() => techApi.timeClockSummary(), 'tc');
  const label = data ? (data.clockStatus === 'CLOCKED_IN' ? 'Clocked in' : data.clockStatus === 'ON_BREAK' ? 'On break' : 'Clocked out') : '—';
  return (
    <MyWorkShell title="Time Clock">
      <Err error={error} />
      {!data && !error ? <div className="tech-skel" style={{ height: 80, borderRadius: 12 }} /> : data ? <>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
          <Metric label="Right now" value={label} />
          <Metric label="Worked today" value={hm(data.today.workedMinutes)} />
          <Metric label="Breaks today" value={hm(data.today.breakMinutes)} />
          <Metric label="This week" value={hm(data.weekWorkedMinutes)} />
        </div>
        <div className="tech-section-title" style={{ margin: '6px 0 8px' }}>Today's punches</div>
        {data.today.punches.length === 0 ? <div className="tech-muted">No punches today. Clock in at the salon kiosk.</div> : data.today.punches.map((p, i) => (
          <div key={i} className="tech-card" style={{ padding: 10, marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}><span>{time(p.start)} → {time(p.end)}</span><b>{hm(p.minutes)}</b></div>
        ))}
        {data.today.breaks.length ? <>
          <div className="tech-section-title" style={{ margin: '12px 0 8px' }}>Breaks</div>
          {data.today.breaks.map((b, i) => <div key={i} className="tech-muted" style={{ fontSize: 13, padding: '3px 0' }}>{b.kind === 'lunch' ? 'Lunch' : 'Break'} · {time(b.start)} → {time(b.end)} · {hm(b.minutes)}</div>)}
        </> : null}
        <div className="tech-muted" style={{ fontSize: 12, marginTop: 12 }}>Times are in the salon's time zone ({data.timezone}). Start or end a break from Home; a manager can correct a punch at the salon.</div>
      </> : null}
    </MyWorkShell>
  );
}

export function TechPerformanceScreen() {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const { data, error } = useLoad<TechPerformanceView>(() => techApi.performance(days), `p${days}`);
  return (
    <MyWorkShell title="Performance">
      <Windows options={[7, 30, 90] as const} value={days} onPick={setDays} />
      <Err error={error} />
      {!data && !error ? <div className="tech-skel" style={{ height: 120, borderRadius: 12 }} /> : data ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Metric label="Clients served" value={data.ticketsServed} />
          <Metric label="Services done" value={data.servicesCompleted} />
          <Metric label="Sales" value={money(data.salesCents)} />
          <Metric label="Average ticket" value={data.ticketsServed ? money(data.averageTicketCents) : '—'} />
          <Metric label="Tips" value={money(data.tipsCents)} />
          <Metric label="Tip rate" value={data.tipRatePercent == null ? '—' : `${data.tipRatePercent}%`} />
          <Metric label="Rating" value={data.rating.average == null ? '—' : `${data.rating.average}★ (${data.rating.count})`} />
          <Metric label="Returning clients" value={data.returningCustomerPercent == null ? '—' : `${data.returningCustomerPercent}%`} />
        </div>
      ) : null}
    </MyWorkShell>
  );
}

export function TechTipsScreen() {
  const [days, setDays] = useState<7 | 14 | 30>(14);
  const { data, error } = useLoad<TechTipsView>(() => techApi.tips(days), `t${days}`);
  return (
    <MyWorkShell title="Tips">
      <Windows options={[7, 14, 30] as const} value={days} onPick={setDays} />
      <Err error={error} />
      {!data && !error ? <div className="tech-skel" style={{ height: 80, borderRadius: 12 }} /> : data ? <>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
          <Metric label="Total" value={money(data.totalCents)} /><Metric label="Card" value={money(data.cardCents)} /><Metric label="Cash" value={money(data.cashCents)} />
        </div>
        {data.byDay.length === 0 ? <div className="tech-muted">No tips in this window yet.</div> : data.byDay.map((r) => (
          <div key={r.date} className="tech-card" style={{ padding: 10, marginBottom: 6, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span>{day(r.date + 'T12:00:00')}</span><span className="tech-muted">card {money(r.cardCents)} · cash {money(r.cashCents)}</span><b>{money(r.cardCents + r.cashCents)}</b>
          </div>
        ))}
        <div className="tech-muted" style={{ fontSize: 12, marginTop: 10 }}>Tips are recorded when the client checks out. Payouts follow the salon's pay period (see Payroll &amp; Payouts).</div>
      </> : null}
    </MyWorkShell>
  );
}

export function TechCustomersScreen() {
  const [search, setSearch] = useState(''); const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 300); return () => clearTimeout(t); }, [search]);
  const { data, error } = useLoad<TechCustomerRow[]>(() => techApi.myCustomers(q || undefined), `c${q}`);
  return (
    <MyWorkShell title="My Clients">
      <input className="tech-input" placeholder="Search by name" aria-label="Search clients" value={search} onChange={(e) => setSearch(e.target.value)} style={{ marginBottom: 12 }} />
      <Err error={error} />
      {!data && !error ? <div className="tech-skel" style={{ height: 80, borderRadius: 12 }} /> : data && data.length === 0 ? <div className="tech-muted">No clients yet{q ? ' matching that name' : ''}.</div> : (data ?? []).map((c) => (
        <div key={c.customerKey} className="tech-card" style={{ padding: 12, marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><strong>{c.displayName}</strong><span className="tech-muted" style={{ fontSize: 12.5 }}>{c.visits} visit{c.visits === 1 ? '' : 's'} · last {day(c.lastVisitAt)}</span></div>
          {c.lastServices.length ? <div className="tech-muted" style={{ fontSize: 12.5, marginTop: 4 }}>{c.lastServices.join(' · ')}</div> : null}
        </div>
      ))}
      <div className="tech-muted" style={{ fontSize: 12, marginTop: 10 }}>Clients you served in the last year at this salon. Contact details stay with the salon.</div>
    </MyWorkShell>
  );
}
