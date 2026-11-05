// POSUsersRolesScreen.tsx — /tenant/account/users-roles. Linked from the Account screen ("Manage Access").
// Real data throughout:
//   • User roster — GET /pos/team (users table, tenant-scoped): name, email, role, status, 2FA, last login, branch.
//   • Role summary — RBAC catalog (rbac.ts) surfaced by the same endpoint: permissions per role + users per role.
//   • Branch names — GET /tenant/locations, to resolve each user's branch id to a name.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { posTeamApi, type TeamResult, type TeamUser } from '../api/posTeamApi';
import { posLocationsApi } from '../api/posLocationsApi';

const G = '#A96F22';
const cardBox: React.CSSProperties = { background: 'var(--card,#FFFDF8)', border: '1px solid var(--line)', borderRadius: 16, padding: 16 };
const input: React.CSSProperties = { height: 34, border: '1px solid var(--line)', borderRadius: 10, padding: '0 11px', fontFamily: 'inherit', fontSize: 12.5, background: '#FFFDF8', outline: 'none' };
const roleLabel = (r: string) => (r || '').replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
const cap = (s?: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '—');
const isAdmin = (r: string) => r === 'OWNER' || r === 'MANAGER';
const fmtWhen = (iso: string | null) => { if (!iso) return 'Never'; const d = new Date(iso); if (isNaN(d.getTime())) return '—'; return `${d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })} — ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`; };
const headRow = (title: string, right?: React.ReactNode) => (<div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}><div style={{ fontWeight: 800, fontSize: 14 }}>{title}</div>{right ? <div style={{ marginLeft: 'auto' }}>{right}</div> : null}</div>);
const RoleBadge = ({ role }: { role: string }) => (<span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 8px', borderRadius: 999, background: isAdmin(role) ? 'rgba(169,111,34,0.12)' : 'var(--line)', color: isAdmin(role) ? G : 'var(--soft, #6B5D4A)' }}>{roleLabel(role)}</span>);

export function POSUsersRolesScreen() {
  const nav = useNavigate();
  const [data, setData] = useState<TeamResult | null>(null);
  const [branches, setBranches] = useState<Record<string, string>>({});
  const [err, setErr] = useState(false);
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState('');

  useEffect(() => {
    posTeamApi.list().then(setData).catch(() => { setData({ users: [], roles: [], summary: { total: 0, active: 0, admins: 0 } }); setErr(true); });
    posLocationsApi.list().then((d) => { const m: Record<string, string> = {}; (d?.locations || []).forEach((l: any) => { if (l?.id) m[l.id] = l.name; }); setBranches(m); }).catch(() => {});
  }, []);

  const users = data?.users || [];
  const roles = data?.roles || [];
  const maxPerm = Math.max(1, ...roles.map((r) => r.permissionCount));
  const branchName = (id: string | null) => (id ? branches[id] || 'Branch' : 'All branches');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return users.filter((u) => (!roleFilter || u.role === roleFilter) && (!needle || u.name.toLowerCase().includes(needle) || (u.email || '').toLowerCase().includes(needle)));
  }, [users, q, roleFilter]);

  const kpis = [
    { l: 'Team Members', v: data === null ? '…' : String(data.summary.total), d: 'user accounts' },
    { l: 'Active', v: data === null ? '…' : String(data.summary.active), d: 'can sign in' },
    { l: 'Admins', v: data === null ? '…' : String(data.summary.admins), d: 'owners & managers' },
    { l: 'Roles In Use', v: data === null ? '…' : String(roles.filter((r) => r.userCount > 0).length), d: `of ${roles.length} roles` },
  ];

  const cols = '1.7fr 0.9fr 1fr 64px 1.2fr 92px';
  const th: React.CSSProperties = { display: 'grid', gridTemplateColumns: cols, gap: 10, padding: '10px 14px', fontSize: 10, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' };

  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
     <div className="vh flex flex-col md:flex-row items-start md:items-end justify-between gap-3">
        <div><h1>Users &amp; Roles</h1><div className="sub">Your team's accounts and what each role can do.</div></div>
        <button className="btn ghost" onClick={() => nav('/tenant/account/overview')}>← Back to Account</button>
      </div>

      <div className="kpis" style={{ margin: 0 }}>
        {kpis.map((k) => (
          <div className="kpi" key={k.l} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div className="l">{k.l}</div><div className="v" style={{ color: G, fontSize: 20 }}>{k.v}</div><div className="d" style={{ color: G }}>{k.d}</div>
          </div>
        ))}
      </div>

      <section style={{ ...cardBox, padding: 0 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: 14, borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 800, fontSize: 14, flex: 1 }}>Team Members</div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email…" style={{ ...input, flex: '0 1 240px' }} />
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} style={input} aria-label="Role">
            <option value="">All roles</option>
            {roles.map((r) => <option key={r.role} value={r.role}>{roleLabel(r.role)}</option>)}
          </select>
        </div>
        <div className="overflow-x-auto w-full">
          <div style={{ minWidth: 700, width: '100%' }}>
            <div style={{ ...th, borderBottom: '1px solid var(--line)' }}><div>User</div><div>Role</div><div>Branch</div><div>2FA</div><div>Last Login</div><div>Status</div></div>
            <div style={{ maxHeight: 320, overflowY: 'auto' }}>
              {data === null ? (
                <div className="muted" style={{ padding: '24px 14px', textAlign: 'center' }}>Loading team…</div>
              ) : filtered.length === 0 ? (
                <div style={{ padding: '28px 14px', textAlign: 'center', fontSize: 12, color: 'var(--muted)' }}>{err ? "You don't have permission to view the team roster." : users.length === 0 ? 'No team members yet.' : 'No members match your search.'}</div>
              ) : (
                filtered.map((u: TeamUser) => (
                  <div key={u.id} style={{ display: 'grid', gridTemplateColumns: cols, gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--line)', fontSize: 12, alignItems: 'center' }}>
                    <div style={{ minWidth: 0 }}><div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>{u.name}{u.isYou ? <span style={{ fontSize: 9.5, fontWeight: 800, color: G, background: 'rgba(169,111,34,0.12)', padding: '1px 6px', borderRadius: 999 }}>You</span> : null}</div><div style={{ fontSize: 10.5, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email || '—'}</div></div>
                    <div><RoleBadge role={u.role} /></div>
                    <div style={{ color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{branchName(u.branchId)}</div>
                    <div style={{ color: u.mfaEnabled ? G : 'var(--muted)', fontWeight: 800 }}>{u.mfaEnabled ? '✓' : '—'}</div>
                    <div style={{ color: 'var(--muted)' }}>{fmtWhen(u.lastLoginAt)}</div>
                    <div><span className={'pill ' + (u.status === 'active' ? 'ok' : 'mut')}>{cap(u.status)}</span></div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      <section style={cardBox}>
        {headRow('Roles & Permissions', <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>Permissions are set by role</span>)}
        {data === null ? <div className="muted">Loading…</div> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            {roles.map((r) => (
              <div key={r.role} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}><RoleBadge role={r.role} /><span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)' }}>{r.userCount} {r.userCount === 1 ? 'user' : 'users'}</span></div>
                <div style={{ height: 6, borderRadius: 4, background: 'var(--line)', overflow: 'hidden' }}><div style={{ width: `${Math.round((r.permissionCount / maxPerm) * 100)}%`, height: '100%', background: isAdmin(r.role) ? G : 'var(--soft, #B79B6E)' }} /></div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5 }}>{r.permissionCount} permissions</div>
              </div>
            ))}
          </div>
        )}
        <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 10 }}>Roles and their permissions are defined platform-wide. To add a member or change someone's role, contact your account team.</div>
      </section>
    </div>
  );
}
