import { useCallback, useEffect, useState } from 'react';
import { superAdminApi } from '../api/superAdminApi';

// Super-Admin → System Health — reads GET /super-admin/system-health (real process + DB metrics). Replaces the former
// placeholder. `ok` reflects live database connectivity; values come from the running API process and a Postgres probe.
type Health = {
  ok: boolean;
  generatedAt: string;
  process: { uptimeSeconds: number; node: string; pid: number; memoryRssMb: number; memoryHeapUsedMb: number; env: string };
  database: { driver: string; ok: boolean; latencyMs?: number; serverVersion?: string; tableCount?: number; counts?: { tenants: number; users: number; activeSubscriptions: number }; error?: string };
};

const fmtUptime = (s: number) => {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return [d ? `${d}d` : '', h ? `${h}h` : '', m ? `${m}m` : '', `${sec}s`].filter(Boolean).join(' ');
};

export function SystemHealthScreen() {
  const [h, setH] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    (superAdminApi.systemHealth() as Promise<Health>)
      .then((r) => { setH(r); setError(null); })
      .catch((e: any) => setError(e?.message || 'Failed to load system health.'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error) return <div className="work"><div className="vh"><h1>System Health</h1></div><div className="err">{error}</div></div>;
  if (!h) return <div className="work"><div className="state">Loading system health…</div></div>;

  const db = h.database;
  const kpis: { l: string; v: string; warn?: boolean }[] = [
    { l: 'Uptime', v: fmtUptime(h.process.uptimeSeconds) },
    { l: 'Memory (RSS)', v: `${h.process.memoryRssMb} MB` },
    { l: 'Heap Used', v: `${h.process.memoryHeapUsedMb} MB` },
    { l: 'Node', v: h.process.node },
    { l: 'Environment', v: h.process.env },
    { l: 'DB Driver', v: db.driver },
    { l: 'DB Latency', v: db.latencyMs != null ? `${db.latencyMs} ms` : '—', warn: (db.latencyMs ?? 0) > 250 },
    { l: 'DB Tables', v: db.tableCount != null ? String(db.tableCount) : '—' },
  ];

  return (
    <div className="work">
      <div className="vh" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div>  <h1 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 26, display: 'flex', alignItems: 'center', gap: 8 }}>System Health <span style={{ color: '#DCB056' }} aria-hidden>★</span></h1><div className="sub">Updated {new Date(h.generatedAt).toLocaleTimeString()} · PID {h.process.pid}</div></div>
        <button onClick={load} disabled={loading} style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid var(--line)', background: 'transparent', color: 'inherit', cursor: 'pointer' }}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>

      <div className='mt-3' style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, marginBottom: 14, background: h.ok ? 'rgba(60,160,90,0.12)' : 'rgba(200,60,60,0.12)', border: `1px solid ${h.ok ? 'rgba(60,160,90,0.4)' : 'var(--danger)'}` }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: h.ok ? '#3ca05a' : 'var(--danger)' }} />
        <strong>{h.ok ? 'Operational' : 'Degraded'}</strong>
        <span className="muted">{h.ok ? 'API process running; database reachable.' : 'Database not reachable — see details below.'}</span>
      </div>

      <div className="kpis">
        {kpis.map((c) => (<div className="kpi" key={c.l}><div className="l">{c.l}</div><div className="font-medium text-base" style={c.warn ? { color: 'var(--danger)' } : undefined}>{c.v}</div></div>))}
      </div>

      <section className="panel">
        <h2>Database</h2>
        {db.ok ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 }}>
            <Row l="Server" v={db.serverVersion || '—'} />
            <Row l="Round-trip latency" v={db.latencyMs != null ? `${db.latencyMs} ms` : '—'} />
            <Row l="Public tables" v={db.tableCount != null ? String(db.tableCount) : '—'} />
            <Row l="Tenants" v={String(db.counts?.tenants ?? '—')} />
            <Row l="Users" v={String(db.counts?.users ?? '—')} />
            <Row l="Active subscriptions" v={String(db.counts?.activeSubscriptions ?? '—')} />
          </div>
        ) : (
          <div className="err" style={{ marginTop: 4 }}>{db.error || 'Database unavailable.'}</div>
        )}
      </section>
    </div>
  );
}

function Row({ l, v }: { l: string; v: string }) {
  return <div className='border border-[var(--line)] rounded-lg p-2' style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span className="s muted text-base">{l}</span><span className="font-medium" style={{ fontSize: 16 }}>{v}</span></div>;
}
