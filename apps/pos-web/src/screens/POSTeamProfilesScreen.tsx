// POSTeamProfilesScreen.tsx — Team → Profiles. Wired to GET /pos/team/state
// (permission-gated settings.view). Team roster with KPIs and a member table.
import { useEffect, useState } from 'react';
import { posTeamApi } from '../api/posTeamApi';
import { money, reportError } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { statusLabel } from '../i18n/status-label';

type Member = { employeeId: string; name: string; role: string; department: string; status: string; servicesCount: number; revenueCents: number; performanceLabel: string | null };
type TeamState = {
  kpis: { totalMembers: number; activeToday: number; onShiftNow: number; avgPerformance: number; totalServices: number; totalCommissionCents: number };
  rows: { items: Member[] };
};

export function POSTeamProfilesScreen() {
  const [s, setS] = useState<TeamState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true; setLoading(true); setError(null);
    (async () => {
      try { const d = await posTeamApi.getState(); if (alive) setS(d as any); }
      catch (e: any) { if (alive) setError(reportError(e, t('admin.team.noun.roster'))); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  if (loading) return <div className="work"><div className="state">{t('pos.loading_team')}</div></div>;
  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!s) return <div className="work"><div className="state">{t('pos.no_team_data')}</div></div>;

  const k = s.kpis || ({} as TeamState['kpis']);
  const members = s.rows?.items || [];

  return (
    <div className="work">
      <div className="vh" style={{ marginBottom: 10 }}><h1>{t('pos.team_profiles')}</h1><div className="sub">{t('pos.your_salon_team_and_their_activity')}</div></div>
      <div className="kpis">
        <div className="kpi"><div className="l">{t('pos.total_members')}</div><div className="v">{k.totalMembers ?? 0}</div></div>
        <div className="kpi"><div className="l">{t('pos.active_today')}</div><div className="v">{k.activeToday ?? 0}</div></div>
        <div className="kpi"><div className="l">{t('pos.on_shift_now')}</div><div className="v">{k.onShiftNow ?? 0}</div></div>
        <div className="kpi"><div className="l">{t('pos.avg_performance')}</div><div className="v">{k.avgPerformance != null ? `${k.avgPerformance}%` : '—'}</div></div>
        <div className="kpi"><div className="l">{t('pos.services')}</div><div className="v">{k.totalServices ?? 0}</div></div>
        <div className="kpi"><div className="l">{t('pos.commission')}</div><div className="v">{money(k.totalCommissionCents)}</div></div>
      </div>
      <section className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        {members.length === 0 ? <div className="state" style={{ padding: 16 }}>{t('pos.no_team_members_yet')}</div> : (
         <div className="w-full overflow-x-auto">
        <table className="tbl min-w-[900px]">
            <thead><tr><th>{t('pos.name')}</th><th>{t('pos.role_2')}</th><th>{t('pos.department')}</th><th>{t('pos.status')}</th><th style={{ textAlign: 'right' }}>{t('pos.services')}</th><th style={{ textAlign: 'right' }}>{t('pos.revenue')}</th></tr></thead>
            <tbody>{members.slice(0, 100).map((m) => (
              <tr key={m.employeeId}>
                <td>{m.name}</td><td>{statusLabel('role', m.role)}</td><td>{m.department || '—'}</td><td>{statusLabel('teamMember', m.status)}</td>
                <td style={{ textAlign: 'right' }}>{m.servicesCount ?? 0}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(m.revenueCents)}</td>
              </tr>
            ))}</tbody>
          </table>
          </div>
        )}
      </section>
    </div>
  );
}
