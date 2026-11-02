// PlatformInfrastructurePanels.tsx — Super Admin › System Status: the Storage and Deployments panels (Oct 14 build plan,
// rebuilt Oct 21 2026). Driven by GET /super-admin/system-status/infrastructure. Honest rendering: a reading the API could
// not take (`available: false`) shows NotConnected with its reason — never a number that means nothing. Nothing here
// is secret: bucket and region NAMES, a commit, a migration filename.
import { useEffect, useState } from 'react';
import { superAdminApi, type PlatformInfrastructure } from '../api/superAdminApi';
import { NotConnected } from '../screens/_chartkit';

export function fmtBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${i === 0 ? v : v.toFixed(v >= 100 ? 0 : 1)} ${u[i]}`;
}
export function fmtUptime(s: number): string {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

export function PlatformInfrastructurePanels() {
  const [data, setData] = useState<PlatformInfrastructure | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { superAdminApi.infrastructure().then(setData).catch((e: any) => setErr(e?.message || 'Could not load storage and deployments.')); }, []);
  const st = data?.storage, dp = data?.deployments;
  return (
    <div className="grid lg:grid-cols-2 gap-3" style={{ marginBottom: 12 }}>
      <section className="panel" data-testid="storage-panel" aria-label="Storage">
        <div className="phead"><h2>Storage</h2><span className="muted" style={{ fontSize: 11 }}>database and media</span></div>
        {err ? <div className="muted" role="alert">{err}</div> : !data ? <div className="muted">Loading…</div> : (
          <>
            <div className="grid grid-cols-2 gap-1.5" style={{ marginBottom: 8 }}>
              <div className="kpi" style={{ border: '1px solid var(--line)' }}><div className="l" style={{ fontSize: 10 }}>Database size</div><div className="v" style={{ fontSize: 15 }}>{st!.database.available ? fmtBytes(st!.database.sizeBytes) : <NotConnected />}</div>{!st!.database.available && st!.database.reason ? <div className="d flat" style={{ fontSize: 9.5 }}>{st!.database.reason}</div> : null}</div>
              <div className="kpi" style={{ border: '1px solid var(--line)' }}><div className="l" style={{ fontSize: 10 }}>Media store</div>
                <div className="v" style={{ fontSize: 15 }}>{st!.media.store === 'object_storage' ? 'Object storage' : 'Container disk'}</div>
                <div className="d flat" style={{ fontSize: 9.5, color: st!.media.productionSafe ? undefined : '#C0453B' }}>
                  {st!.media.store === 'object_storage' ? [st!.media.bucket, st!.media.region, st!.media.endpoint].filter(Boolean).join(' · ') || 'bucket not set' : st!.media.diskAccepted ? 'disk accepted (MEDIA_STORE_ALLOW_DISK=1) — uploads are lost at every deploy' : 'uploads are lost at every deploy — production refuses this'}
                </div>
              </div>
            </div>
            {st!.database.available && st!.database.tables.length ? (
              <table className="tbl" style={{ fontSize: 11 }}>
                <thead><tr><th scope="col">Heaviest tables</th><th scope="col" style={{ textAlign: 'right' }}>Size</th><th scope="col" style={{ textAlign: 'right' }}>Rows (est.)</th></tr></thead>
                <tbody>{st!.database.tables.map((t) => <tr key={t.table}><td>{t.table}</td><td style={{ textAlign: 'right' }}>{fmtBytes(t.totalBytes)}</td><td style={{ textAlign: 'right' }}>{t.rows == null ? '—' : t.rows.toLocaleString()}</td></tr>)}</tbody>
              </table>
            ) : null}
          </>
        )}
      </section>
      <section className="panel" data-testid="deployments-panel" aria-label="Deployments">
        <div className="phead"><h2>Deployments</h2><span className="muted" style={{ fontSize: 11 }}>{dp ? `${dp.build.environment} · up ${fmtUptime(dp.uptimeSeconds)}` : ''}</span></div>
        {err ? <div className="muted" role="alert">{err}</div> : !data ? <div className="muted">Loading…</div> : (
          <>
            <div className="grid grid-cols-2 gap-1.5" style={{ marginBottom: 8 }}>
              <div className="kpi" style={{ border: '1px solid var(--line)' }}><div className="l" style={{ fontSize: 10 }}>Running build</div><div className="v" style={{ fontSize: 15 }}>{dp!.build.version}</div><div className="d flat" style={{ fontSize: 9.5 }}>commit {dp!.build.commit.slice(0, 12)}{dp!.build.deployment !== 'unknown' ? ` · deployment ${dp!.build.deployment}` : ''} · started {when(dp!.build.startedAt)}</div></div>
              <div className="kpi" style={{ border: '1px solid var(--line)' }}><div className="l" style={{ fontSize: 10 }}>Schema</div>
                <div className="v" style={{ fontSize: 15 }}>{dp!.schema ? dp!.schema.status : <NotConnected />}</div>
                <div className="d flat" style={{ fontSize: 9.5 }}>{dp!.schema ? `${dp!.schema.applied} applied · ${dp!.schema.pending.length} pending${dp!.schema.mismatches.length ? ` · ${dp!.schema.mismatches.length} drifted` : ''} · latest ${dp!.schema.latest ?? '—'}` : 'migration ledger not readable'}</div>
              </div>
            </div>
            {dp!.migrations.available ? (
              <table className="tbl" style={{ fontSize: 11 }}>
                <thead><tr><th scope="col">Recent migrations</th><th scope="col" style={{ textAlign: 'right' }}>Applied</th></tr></thead>
                <tbody>{dp!.migrations.recent.map((m) => <tr key={m.filename}><td>{m.filename}</td><td style={{ textAlign: 'right' }}>{when(m.appliedAt)}</td></tr>)}</tbody>
              </table>
            ) : <div className="muted" style={{ fontSize: 11 }}><NotConnected /> {dp!.migrations.reason}</div>}
          </>
        )}
      </section>
    </div>
  );
}
