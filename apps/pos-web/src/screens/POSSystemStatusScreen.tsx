// POSSystemStatusScreen.tsx — the full-page System Status view (Jul 29, 2026), reached from the sidebar's
// existing System Status footer card (no sidebar changes — Kevin's rule: keep the sidebar names as they are).
//
// HONESTY CONTRACT: this renders ONLY what GET /tenant/help/status actually serves — overall {status,label,
// healthy}, components[{key,name,status}], incidents[{title,status,impact,startedAt,resolvedAt}] — plus the
// client-side fetch time as "Last checked". The mockup's response-time/uptime%/system-metrics figures are not
// measured tenant-side, so they are not rendered; nothing here is fabricated.
import { useCallback, useEffect, useState } from 'react';
import { posHelpCenterApi, type HelpSystemStatus } from '../api/posHelpCenterApi';
import { t } from '@aipowersalon/mobile-sdk/i18n';

const card: React.CSSProperties = { background: 'var(--aps-card)', border: '1px solid var(--aps-line)', borderRadius: 12, padding: 14 };
const head: React.CSSProperties = { fontSize: 13.5, fontWeight: 700, marginBottom: 8 };

function StatusPill({ status }: { status: string }) {
  const s = (status || '').toLowerCase();
  const good = s === 'operational' || s === 'ok' || s === 'healthy';
  const bad = s === 'outage' || s === 'down' || s === 'critical';
  const bg = good ? '#E9F5EC' : bad ? '#FBEAE6' : '#FBF1DE';
  const fg = good ? '#3E9463' : bad ? '#C4574E' : '#96703A';
  return <span style={{ background: bg, color: fg, borderRadius: 999, padding: '2px 10px', fontSize: 11.5, fontWeight: 600, textTransform: 'capitalize' }}>{status || 'unknown'}</span>;
}

export function POSSystemStatusScreen() {
  const [data, setData] = useState<HelpSystemStatus | null | undefined>(undefined);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setBusy(true);
    posHelpCenterApi.status()
      .then((r) => { setData(r); setCheckedAt(new Date()); })
      .catch(() => setData(null))
      .finally(() => setBusy(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const unhealthy = (data && data !== null ? data.components : []).filter((c) => (c.status || '').toLowerCase() !== 'operational');
  const openIncidents = (data && data !== null ? data.incidents : []).filter((i) => !i.resolvedAt);
  const pastIncidents = (data && data !== null ? data.incidents : []).filter((i) => i.resolvedAt);

  return (
    <div style={{ padding: 16, display: 'grid', gap: 12, alignContent: 'start', overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div>
          <div style={{ fontSize: 19, fontWeight: 800 }}>{t('pos.system_status')}</div>
          <div className="muted" style={{ fontSize: 12.5 }}>{t('pos.real_time_platform_health_for_your_lh0l')}</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {checkedAt && <span className="muted" style={{ fontSize: 12 }}>{t('pos.last_checked')}{' '}{checkedAt.toLocaleTimeString()}</span>}
          <button className="btn" onClick={load} disabled={busy}>{busy ? t('pos.refreshing') : t('pos.refresh_status')}</button>
        </div>
      </div>

      {data === undefined ? <div className="muted">{t('pos.checking_status')}</div>
        : data === null ? <div style={card}><div style={head}>{t('pos.status_unavailable')}</div><div className="muted" style={{ fontSize: 12.5 }}>{t('pos.the_status_service_could_not_be_1p38')}</div></div>
        : (<>
        <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 10, height: 10, borderRadius: 999, background: data.overall.healthy ? '#3E9463' : '#C4574E' }} />
          <div style={{ fontWeight: 700 }}>{data.overall.label}</div>
          <StatusPill status={data.overall.status} />
        </div>

        <div style={card}>
          <div style={head}>{t('pos.service_status')}</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead><tr className="muted" style={{ textAlign: 'left' }}><th style={{ padding: '6px 4px' }}>{t('pos.service_3')}</th><th style={{ padding: '6px 4px' }}>{t('pos.status')}</th><th style={{ padding: '6px 4px' }}>{t('pos.last_check')}</th></tr></thead>
            <tbody>
              {data.components.map((c) => (
                <tr key={c.key} style={{ borderTop: '1px solid var(--aps-line)' }}>
                  <td style={{ padding: '7px 4px' }}>{c.name}</td>
                  <td style={{ padding: '7px 4px' }}><StatusPill status={c.status} /></td>
                  {/* Real column: status_components.updated_at. Response time and uptime have no source — see the note below. */}
                  <td style={{ padding: '7px 4px' }} className="muted">{c.lastCheckedAt ? new Date(c.lastCheckedAt).toLocaleTimeString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>{t('pos.last_check_is_when_the_platform_1g7v')}</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
          <div style={card}>
            <div style={head}>{t('pos.active_alerts')}</div>
            {unhealthy.length === 0 && openIncidents.length === 0
              ? <div className="muted" style={{ fontSize: 12.5 }}>{t('pos.no_active_alerts_all_services_are_babm')}</div>
              : (<div style={{ display: 'grid', gap: 6 }}>
                  {unhealthy.map((c) => <div key={c.key} style={{ fontSize: 12.5 }}><StatusPill status={c.status} /> <span style={{ marginLeft: 6 }}>{c.name}</span></div>)}
                  {openIncidents.map((i) => <div key={i.id} style={{ fontSize: 12.5 }}><StatusPill status={i.impact || i.status} /> <span style={{ marginLeft: 6 }}>{i.title}</span></div>)}
                </div>)}
          </div>
          <div style={card}>
            <div style={head}>{t('pos.recent_incidents')}</div>
            {pastIncidents.length === 0
              ? <div className="muted" style={{ fontSize: 12.5 }}>{t('pos.no_recent_incidents')}</div>
              : (<div style={{ display: 'grid', gap: 6 }}>
                  {pastIncidents.slice(0, 6).map((i) => (
                    <div key={i.id} style={{ fontSize: 12.5 }}>
                      <span style={{ fontWeight: 600 }}>{i.title}</span>
                      <span className="muted" style={{ marginLeft: 6 }}>{i.resolvedAt ? t('pos.resolved_v0', { v0: String(new Date(i.resolvedAt).toLocaleDateString()) }) : i.status}</span>
                    </div>
                  ))}
                </div>)}
          </div>
        </div>
        <div className="muted" style={{ fontSize: 11.5 }}>{t('pos.all_systems_are_monitored_24_7_1hiu')}</div>
      </>)}
    </div>
  );
}
