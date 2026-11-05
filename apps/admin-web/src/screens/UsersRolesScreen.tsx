// UsersRolesScreen.tsx — Super Admin · Tenant Management · Users & Roles · All Users.
// Platform identity & access-management center, restructured to the reference IA and wired to the REAL backend:
// the directory + 10 KPI cards + Role Health + Role Distribution + Permissions Overview + User Growth + Pending
// Invitations + Recent Activity + Top Tenants + Branch Access all come from /super-admin/platform/users[-dashboard]
// (SuperAdminGuard). Every mutation (invite, role change, enable/disable, reset password, 2FA, sessions, branch
// access) calls the existing audited routes. Honest gaps (Access Requests, custom roles, day-over-day deltas) render
// as "—/Not connected" rather than fabricated values — no mock data on an access-management screen.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useInlineConfirm } from '@aipowersalon/ui';
import { useNavigate } from 'react-router-dom';
import { superAdminApi } from '../api/superAdminApi';
import { hwApi } from '../api/superAdminHardwarePackagesApi';
import { ProfileAvatarWithPreview } from '@aipowersalon/ui';
import { useCan } from '../auth/useCan';

// ── small presentational helpers ───────────────────────────────────────────
const ROLE_META: Record<string, { label: string; bg: string; fg: string }> = {
  SUPER_ADMIN: { label: 'Super Admin', bg: '#EAE3F6', fg: '#5B3FA0' },
  OWNER: { label: 'Owner', bg: '#EAE3F6', fg: '#6B4BA8' },
  MANAGER: { label: 'Branch Manager', bg: '#E3EEF8', fg: '#2F6DA8' },
  FRONT_DESK: { label: 'Front Desk', bg: '#E7F5EC', fg: '#2F7D4E' },
  RECEPTION: { label: 'Receptionist', bg: '#E7F5EC', fg: '#2F7D4E' },
  TECHNICIAN: { label: 'Technician', bg: '#FBEFD8', fg: '#9A6B16' },
  CUSTOMER: { label: 'Customer', bg: '#EFEAE2', fg: '#7A6A55' },
};
const STATUS_META: Record<string, { label: string; bg: string; fg: string }> = {
  active: { label: 'Active', bg: '#E7F5EC', fg: '#2F7D4E' },
  invited: { label: 'Invited', bg: '#FBEFD8', fg: '#9A6B16' },
  inactive: { label: 'Inactive', bg: '#EFEAE2', fg: '#7A6A55' },
  suspended: { label: 'Suspended', bg: '#F8E4E0', fg: '#B0473A' },
  disabled: { label: 'Suspended', bg: '#F8E4E0', fg: '#B0473A' },
};
const PERM_COLOR: Record<string, string> = { 'Full Access': '#7B5BB6', 'Branch Admin': '#3C7FB6', 'Limited Access': '#D08A2E', 'Basic Access': '#3E8F57' };
const DONUT_PALETTE = ['#D09A36', '#3E8F57', '#3C7FB6', '#7B5BB6', '#B85B4D', '#9C8B7F', '#5BA8A0'];

function roleBadge(role: string) { const m = ROLE_META[role] || { label: role, bg: '#EFEAE2', fg: '#7A6A55' }; return <span style={{ background: m.bg, color: m.fg, fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999 }}>{m.label}</span>; }
function statusBadge(status: string) { const m = STATUS_META[status] || { label: status, bg: '#EFEAE2', fg: '#7A6A55' }; return <span style={{ background: m.bg, color: m.fg, fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999 }}>{m.label}</span>; }
function initials(name: string, email: string) { const base = (name || email || '?').trim(); const parts = base.split(/\s+/); return ((parts[0]?.[0] || '') + (parts[1]?.[0] || base[1] || '')).toUpperCase(); }
function ago(iso: string | null): string { if (!iso) return 'never'; const ms = Date.now() - new Date(iso).getTime(); if (ms < 0) return 'just now'; const m = Math.floor(ms / 60000); if (m < 1) return 'just now'; if (m < 60) return `${m}m ago`; const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`; const d = Math.floor(h / 24); return `${d}d ago`; }

function Donut({ items, centerTop, centerBottom }: { items: { label: string; count: number; color?: string }[]; centerTop: string; centerBottom: string }) {
  const total = items.reduce((a, x) => a + x.count, 0);
  let acc = 0; const R = 52, C = 2 * Math.PI * R;
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
      <svg viewBox="0 0 140 140" style={{ width: 116, height: 116, flex: 'none' }} role="img" aria-label={`${centerTop} ${centerBottom}`}>
        {total === 0 ? <circle cx="70" cy="70" r={R} fill="none" stroke="var(--line,#E9DAC4)" strokeWidth="16" /> : items.map((it, i) => { const dash = (it.count / total) * C; const seg = <circle key={i} cx="70" cy="70" r={R} fill="none" stroke={it.color || DONUT_PALETTE[i % DONUT_PALETTE.length]} strokeWidth="16" strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc} transform="rotate(-90 70 70)" />; acc += dash; return seg; })}
        <text x="70" y="66" textAnchor="middle" fontSize="19" fontWeight="800" fill="var(--text,#2C2118)">{centerTop}</text>
        <text x="70" y="84" textAnchor="middle" fontSize="9" fill="var(--muted,#9B8B78)">{centerBottom}</text>
      </svg>
      <div style={{ flex: 1, minWidth: 0 }}>{items.map((it, i) => (<div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, padding: '2px 0' }}><span style={{ width: 9, height: 9, borderRadius: 2, background: it.color || DONUT_PALETTE[i % DONUT_PALETTE.length], flex: 'none' }} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</span><span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>{it.count}{total ? ` (${Math.round((it.count / total) * 1000) / 10}%)` : ''}</span></div>))}</div>
    </div>
  );
}

export function UsersRolesScreen() {
  const nav = useNavigate();
  const [dash, setDash] = useState<any | null>(null);
  const [roles, setRoles] = useState<Record<string, string[]> | null>(null);
  const [tenants, setTenants] = useState<{ id: string; name: string }[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [filters, setFilters] = useState<{ role: string; tenantId: string; branchId: string; status: string; search: string }>({ role: '', tenantId: '', branchId: '', status: '', search: '' });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [oneTime, setOneTime] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [permOpen, setPermOpen] = useState(false);
  const [arOpen, setArOpen] = useState(false);
  const [invOpen, setInvOpen] = useState(false);
  const [schedOpen, setSchedOpen] = useState(false);
  const [sessionsFor, setSessionsFor] = useState<any | null>(null);
  const [inviteForm, setInviteForm] = useState({ role: 'MANAGER', email: '', phone: '', fullName: '', tenantId: '', branchId: '' });
  const [inviteTenantList, setInviteTenantList] = useState<Array<{ id: string; name: string; ownerEmail?: string; code?: string }>>([]);
  const [inviteBranchList, setInviteBranchList] = useState<Array<{ id: string; name: string }>>([]);
  const [inviteTenantSearch, setInviteTenantSearch] = useState('');
  const [form, setForm] = useState({ email: '', fullName: '' });
  const searchTimer = useRef<any>(null);

  const loadDirectory = (over?: Partial<{ page: number; pageSize: number } & typeof filters>) => {
    const p = over?.page ?? page; const ps = over?.pageSize ?? pageSize;
    const f = { ...filters, ...over };
    setLoading(true);
    superAdminApi.users({ page: p, pageSize: ps, ...(f.role ? { role: f.role } : {}), ...(f.tenantId ? { tenantId: f.tenantId } : {}), ...(f.branchId ? { branchId: f.branchId } : {}), ...(f.status ? { status: f.status } : {}), ...(f.search ? { search: f.search } : {}) })
      .then((r: any) => { setRows(r.rows || []); setTotal(r.total || 0); setErr(null); })
      .catch((e: any) => setErr(e?.message || 'Failed to load users.'))
      .finally(() => setLoading(false));
  };

  const can = useCan(); const mayDash = can('super_admin.analytics.view'), mayHw = can('super_admin.billing.view');
  useEffect(() => { if (mayDash) superAdminApi.usersDashboard().then((d: any) => setDash(d)).catch(() => setDash(null)); }, [mayDash]);
  useEffect(() => { superAdminApi.roles().then((r: any) => setRoles(r)).catch(() => {}); }, []);
  useEffect(() => { if (!mayHw) return; hwApi.listTenants().then((t: any) => setTenants((t || []).map((x: any) => ({ id: x.id, name: x.name })))).catch(() => {}); }, [mayHw]);
  useEffect(() => {
    superAdminApi.state().then((r: any) => {
      if (r?.tenants && Array.isArray(r.tenants)) {
        setInviteTenantList(r.tenants.map((x: any) => ({
          id: x.id,
          name: x.n || x.displayName || x.name || x.code || 'Salon',
          ownerEmail: x.email || x.ownerEmail || '',
          code: x.code || '',
        })));
      }
    }).catch(() => {});
  }, []);
   
  useEffect(() => { loadDirectory({ page, pageSize }); }, [page, pageSize, filters.role, filters.tenantId, filters.branchId, filters.status]);

  const onSearch = (v: string) => { setFilters((f) => ({ ...f, search: v })); if (searchTimer.current) clearTimeout(searchTimer.current); searchTimer.current = setTimeout(() => { setPage(1); loadDirectory({ page: 1, search: v }); }, 350); };
  const setFilter = (k: keyof typeof filters, v: string) => { setPage(1); setFilters((f) => ({ ...f, [k]: v })); };

  const dashTenants = useMemo(() => { const seen = new Map<string, string>(); tenants.forEach((t) => seen.set(t.id, t.name)); (dash?.topTenants?.rows || []).forEach((t: any) => seen.set(t.tenantId, t.tenantName)); rows.forEach((r) => { if (r.tenantId) seen.set(r.tenantId, r.tenantName || r.tenantId); }); return Array.from(seen, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)); }, [tenants, dash, rows]);
  const branchOpts = useMemo(() => { const seen = new Map<string, string>(); rows.forEach((r) => { if (r.branchId) seen.set(r.branchId, r.branchName || r.branchId); }); return Array.from(seen, ([id, name]) => ({ id, name })); }, [rows]);

  const filteredInviteTenants = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; ownerEmail?: string; code?: string }>();
    inviteTenantList.forEach((t) => seen.set(t.id, t));
    dashTenants.forEach((t) => { if (!seen.has(t.id)) seen.set(t.id, { id: t.id, name: t.name }); });
    const list = Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
    if (!inviteTenantSearch.trim()) return list;
    const q = inviteTenantSearch.trim().toLowerCase();
    return list.filter((t) => (t.name || '').toLowerCase().includes(q) || (t.ownerEmail || '').toLowerCase().includes(q) || (t.code || '').toLowerCase().includes(q));
  }, [inviteTenantList, dashTenants, inviteTenantSearch]);

  const handleTenantSelect = (tid: string) => {
    setInviteForm((f) => ({ ...f, tenantId: tid, branchId: '' }));
    setInviteBranchList([]);
    if (tid) {
      superAdminApi.tenantUsersAndBranches(tid)
        .then((res: any) => setInviteBranchList(res.branches || []))
        .catch(() => setInviteBranchList([]));
    }
  };

  const act = async (key: string, fn: () => Promise<any>, after?: () => void) => {
    setBusy(key); setErr(null);
    try { await fn(); loadDirectory(); if (mayDash) superAdminApi.usersDashboard().then((d: any) => setDash(d)).catch(() => {}); after?.(); }
    catch (e: any) { setErr(e?.message || 'Action failed.'); } finally { setBusy(null); }
  };
  const changeRole = (u: any, next: string) => act('role' + u.id, async () => { const r: any = await superAdminApi.setUserRole(u.id, next); setOneTime(`${u.fullName || u.email}: role changed ${r.before} → ${r.after} (audited)`); });
  const toggleMfa = (u: any) => act('mfa' + u.id, async () => { const want = !u.mfaEnabled; const r: any = await superAdminApi.setUserMfa(u.id, want); setOneTime(`${u.fullName || u.email}: 2FA ${r.mfaEnabled ? 'required' : 'cleared'}${r.changed ? ' (audited)' : ' (no change)'}`); });
  const reset = (u: any) => act('r' + u.id, async () => { const r: any = await superAdminApi.resetUserPassword(u.id); setOneTime(`${r.email || u.email} · temporary password: ${r.temporaryPassword} (shown once — only the hash is stored)`); });
  const resendInvite = (u: any) => act('ri' + u.id, async () => { const r: any = await superAdminApi.resendInvite(u.id); setOneTime(`${r.email} · invite resent · temporary password: ${r.temporaryPassword} (shown once)`); });
  const cancelInvite = (u: any) => act('ci' + u.id, async () => { await superAdminApi.cancelInvite(u.id); setOneTime(`${u.email || u.fullName}: invite cancelled (account set inactive, audited)`); });
  const invite = () => act('invite', async () => {
    const f = inviteForm;
    const r: any = await superAdminApi.inviteUser({ email: f.email || undefined, phone: f.phone || undefined, fullName: f.fullName, role: f.role, tenantId: f.role === 'SUPER_ADMIN' ? null : (f.tenantId || null), branchId: f.branchId || null });
    setOneTime(`${r.email || r.phone} invited as ${r.role} · temporary password: ${r.temporaryPassword} (shown once — only the hash is stored)`);
    setInviteForm({ role: 'MANAGER', email: '', phone: '', fullName: '', tenantId: '', branchId: '' }); setAddOpen(false);
  });
  const tokenInvite = () => act('tokeninvite', async () => {
    const f = inviteForm;
    // No channel is forced: the server sends by SMS when only a phone was given, by email otherwise.
    const to = f.email || f.phone;
    const r: any = await superAdminApi.createInvitation({ email: f.email || undefined, phone: f.phone || undefined, fullName: f.fullName, role: f.role, tenantId: f.role === 'SUPER_ADMIN' ? null : (f.tenantId || null), branchId: f.branchId || null });
    if (r.reused) setOneTime(`A pending invitation already exists for ${to}.`);
    else if (r.manualAcceptToken) setOneTime(`Secure invite created for ${to} — no email/SMS provider is connected, so share this one-time link manually: ${window.location.origin}/accept-invite?token=${r.manualAcceptToken} (expires ${new Date(r.expiresAt).toLocaleString()}).`);
    else setOneTime(`Secure invite created for ${to} · delivery: ${r.deliveryStatus}. No temporary password is set — the invitee sets their own at the link.`);
    setInviteForm({ role: 'MANAGER', email: '', phone: '', fullName: '', tenantId: '', branchId: '' }); setAddOpen(false);
  });
  const create = () => act('create', async () => {
    const r: any = await superAdminApi.createSuperAdmin(form);
    setOneTime(`${r.email} · temporary password: ${r.temporaryPassword} (shown once — only the hash is stored)`);
    setForm({ email: '', fullName: '' }); setCreateOpen(false);
  });

  const exportCsv = () => act('export', async () => {
    // Server-side audited export: ALL rows matching the current filters (not just this page), one audit record written.
    const f = { role: filters.role || undefined, tenantId: filters.tenantId || undefined, branchId: filters.branchId || undefined, status: filters.status || undefined, search: filters.search || undefined };
    const res: any = await superAdminApi.exportUsers(f);
    const blob = new Blob([res.csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = res.filename || `users-export-${Date.now()}.csv`; a.click(); URL.revokeObjectURL(a.href);
    setOneTime(`Exported ${res.rowCount} of ${res.total} matching user(s), server-side and audited.${res.truncated ? ' Result was capped — narrow the filters to export the rest.' : ''}`);
  });

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const kpiCards: any[] = dash?.kpiCards || [];
  const kpiIcon = (key: string) => {
    const m: Record<string, string> = { totalUsers: '#7B5BB6', activeUsers: '#3E8F57', totalRoles: '#3C7FB6', pendingInvites: '#D09A36', suspended: '#B85B4D', branchManagers: '#3C7FB6', technicians: '#D09A36', receptionists: '#3E8F57', ownersAdmins: '#7B5BB6', openAccessRequests: '#9C8B7F' };
    return m[key] || 'var(--g7,#A96F22)';
  };
  const kpiTo = (key: string): string => {
    switch (key) {
      case 'activeUsers': return '?status=active'; case 'suspended': return '?status=suspended'; case 'pendingInvites': return '?status=invited';
      case 'branchManagers': return '?role=MANAGER'; case 'technicians': return '?role=TECHNICIAN'; case 'receptionists': return '?role=RECEPTION';
      case 'ownersAdmins': return '?role=OWNER'; default: return '';
    }
  };
  const applyKpi = (key: string) => {
    if (key === 'activeUsers') setFilter('status', 'active'); else if (key === 'suspended') setFilter('status', 'suspended'); else if (key === 'pendingInvites') setFilter('status', 'invited');
    else if (key === 'branchManagers') setFilter('role', 'MANAGER'); else if (key === 'technicians') setFilter('role', 'TECHNICIAN'); else if (key === 'receptionists') setFilter('role', 'RECEPTION');
    else if (key === 'ownersAdmins') setFilter('role', 'OWNER'); else if (key === 'totalRoles') setPermOpen(true); else if (key === 'openAccessRequests') setArOpen(true); else { setFilters({ role: '', tenantId: '', branchId: '', status: '', search: '' }); setPage(1); }
  };

  return (
    <div className="work">
      {/* Header */}
      <div className="vh flex flex-col lg:flex-row justify-between gap-3" >
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>Users &amp; Roles
            <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--g7,#A96F22)" aria-hidden="true"><path d="M12 2l2.9 6.3 6.9.7-5.1 4.6 1.4 6.8L12 17.8 5.9 20.4l1.4-6.8L2.2 9l6.9-.7z" /></svg>
          </h1>
          <div className="sub">Manage platform users, roles, permissions, and access across all tenants and branches.</div>
        </div>
        <div className="self-baseline flex-wrap whitespace-nowrap" style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn ghost" onClick={exportCsv}>Export Report</button>
          <button className="btn ghost" onClick={() => setBranchOpen(true)}>Branch Access</button>
          <button className="btn" onClick={() => { setAddOpen((v) => !v); setCreateOpen(false); }}>{addOpen ? 'Close' : '+ Add User'}</button>
          <button className="btn ghost" onClick={() => { setCreateOpen((v) => !v); setAddOpen(false); }}>{createOpen ? 'Close' : 'Create Super Admin'}</button>
        </div>
      </div>

      {oneTime ? <div className="err" style={{ margin: '10px 0', background: 'var(--warn-bg,#FFF6E5)', borderColor: '#F0D79A', color: '#5a3d12', cursor: 'pointer' }} onClick={() => setOneTime(null)}>{oneTime} — tap to dismiss</div> : null}

      {/* Add User (invite) */}
      {addOpen ? (
        <section className="panel" style={{ margin: '10px 0' }}>
          <h2 style={{ marginBottom: 8 }}>Add User · secure invitation</h2>
          <div className="fieldrow" style={{ flexWrap: 'wrap', gap: 8 }}>
            <select aria-label="Invite role" value={inviteForm.role} onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })} style={{ height: 36, padding: '0 8px' }}>
              <option value="SUPER_ADMIN">Super Admin (platform)</option><option value="OWNER">Tenant Owner</option><option value="MANAGER">Branch Manager</option><option value="FRONT_DESK">Front Desk</option><option value="RECEPTION">Receptionist</option><option value="TECHNICIAN">Technician</option>
            </select>
            <input placeholder="Email" type="email" value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })} style={{ minWidth: 220 }} />
            {/* A technician often has a mobile number and no work email. Either identifier is enough: it becomes
                her login, and a phone-addressed invitation is delivered by SMS. */}
            <input placeholder="or Phone number" type="tel" inputMode="tel" aria-label="Invite phone number" value={inviteForm.phone} onChange={(e) => setInviteForm({ ...inviteForm, phone: e.target.value })} style={{ minWidth: 190 }} />
            <input placeholder="Full name" value={inviteForm.fullName} onChange={(e) => setInviteForm({ ...inviteForm, fullName: e.target.value })} style={{ minWidth: 180 }} />
            {inviteForm.role !== 'SUPER_ADMIN' && (
              <input
                placeholder="Filter Tenant (name/email)"
                value={inviteTenantSearch}
                onChange={(e) => setInviteTenantSearch(e.target.value)}
                style={{ minWidth: 170 }}
                title="Filter tenant list by salon name, owner email, or code"
              />
            )}
            {inviteForm.role !== 'SUPER_ADMIN' && (
              <select
                aria-label="Select Tenant (required)"
                value={inviteForm.tenantId}
                onChange={(e) => handleTenantSelect(e.target.value)}
                style={{ minWidth: 220, height: 36, padding: '0 8px' }}
              >
                <option value="">Select Tenant (required)</option>
                {filteredInviteTenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} {t.ownerEmail ? `(${t.ownerEmail})` : ''}
                  </option>
                ))}
              </select>
            )}
            {inviteForm.role !== 'SUPER_ADMIN' && (
              <select
                aria-label="Select Branch (optional)"
                value={inviteForm.branchId}
                disabled={!inviteForm.tenantId}
                onChange={(e) => setInviteForm((f) => ({ ...f, branchId: e.target.value }))}
                style={{ minWidth: 190, height: 36, padding: '0 8px' }}
              >
                <option value="">
                  {!inviteForm.tenantId ? 'Select Tenant first' : 'All Branches (Optional)'}
                </option>
                {inviteBranchList.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
            <button className="btn" disabled={busy === 'invite' || (!inviteForm.email && !inviteForm.phone) || inviteForm.fullName.length < 2 || (inviteForm.role !== 'SUPER_ADMIN' && !inviteForm.tenantId)} onClick={invite}>{busy === 'invite' ? 'Inviting…' : 'Send Invitation'}</button>
            <button className="btn ghost" disabled={busy === 'tokeninvite' || (!inviteForm.email && !inviteForm.phone) || inviteForm.fullName.length < 2 || (inviteForm.role !== 'SUPER_ADMIN' && !inviteForm.tenantId)} onClick={tokenInvite} title="Single-use expiring token; the invitee sets their own password (no admin-set temp password)">{busy === 'tokeninvite' ? 'Creating…' : 'Send token invite'}</button>
          </div>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}><b>Send token invite</b> is the secure flow (§23): a single-use, expiring token; the invitee sets their own password — no admin-set temp password. Email/SMS delivery is a seam (honest <span style={{ color: 'var(--danger,#B85B4D)' }}>not connected</span> until a provider is configured — the one-time link is surfaced for manual delivery). <b>Send Invitation</b> is the legacy temp-password path.</div>
        </section>
      ) : null}
      {createOpen ? (
        <section className="panel" style={{ margin: '10px 0' }}>
          <h2 style={{ marginBottom: 8 }}>New Super Admin</h2>
          <div className="fieldrow">
            <input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={{ minWidth: 240 }} />
            <input placeholder="Full name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} style={{ minWidth: 200 }} />
            <button className="btn" disabled={busy === 'create' || !form.email || !form.fullName} onClick={create}>{busy === 'create' ? 'Creating…' : 'Create Super Admin'}</button>
            <span className="muted" style={{ fontSize: 11.5 }}>New super admins must enroll MFA at first login.</span>
          </div>
        </section>
      ) : null}

      {/* 10 KPI cards (2×5) */}
      <div className=" grid  grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 mb-3 mt-3">
        {(kpiCards.length ? kpiCards : Array.from({ length: 10 }, () => null)).map((c: any, i: number) => {
          const KPI_META: Record<string, { glyph: string; bg: string; fg: string }> = {
            totalUsers: { glyph: '👥', bg: '#F3ECFB', fg: '#7B5BB6' },
            activeUsers: { glyph: '✓', bg: '#E7F5EC', fg: '#1F9254' },
            totalRoles: { glyph: '🏷️', bg: '#EAF1FF', fg: '#2F6FED' },
            pendingInvites: { glyph: '⏳', bg: '#FBF0DC', fg: '#B7791F' },
            suspended: { glyph: '⛔', bg: '#FBE7E4', fg: '#C0392B' },
            branchManagers: { glyph: '👔', bg: '#EAF1FF', fg: '#2F6FED' },
            technicians: { glyph: '✂️', bg: '#FBF0DC', fg: '#B7791F' },
            receptionists: { glyph: '🛎️', bg: '#E7F5EC', fg: '#1F9254' },
            ownersAdmins: { glyph: '👑', bg: '#F3ECFB', fg: '#7B5BB6' },
            openAccessRequests: { glyph: '🔑', bg: '#EEF0F3', fg: '#6B7280' },
          };
          const meta = (c && KPI_META[c.key]) || { glyph: '📊', bg: '#FFF9EF', fg: '#A96F22' };
          const clickable = !!c && c.available !== false;
          return (
            <button
              key={c?.key || i}
              onClick={() => c && applyKpi(c.key)}
              title={c?.available === false ? 'Not connected' : `Filter directory: ${c?.label}`}
              disabled={!clickable && !c}
              style={{
                textAlign: 'left',
                background: '#FFFDF8',
                border: '1px solid var(--line)',
                borderRadius: 14,
                padding: '12px 14px',
                cursor: clickable ? 'pointer' : 'default',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)',
                minWidth: 0,
                font: 'inherit',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (clickable) {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.borderColor = 'var(--g7, #A96F22)';
                  e.currentTarget.style.boxShadow = '0 4px 14px rgba(169, 111, 34, 0.12)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'none';
                e.currentTarget.style.borderColor = 'var(--line)';
                e.currentTarget.style.boxShadow = '0 2px 8px rgba(169, 111, 34, 0.04)';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <span style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {c ? c.label : '—'}
                </span>
                <span style={{ width: 26, height: 26, borderRadius: 7, background: meta.bg, color: meta.fg, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, flex: 'none' }}>
                  {meta.glyph}
                </span>
              </div>
              <div style={{ fontFamily: 'Playfair Display, serif', fontSize: 21, fontWeight: 700, color: c?.available === false ? '#B4A88E' : 'var(--text)', marginTop: 6, lineHeight: 1.2 }}>
                {!c ? '—' : c.available === false ? '—' : Number(c.value || 0).toLocaleString()}
              </div>
              <div style={{ fontSize: 10.5, color: c?.available === false ? 'var(--danger,#B85B4D)' : 'var(--muted)', marginTop: 4, fontWeight: 600 }}>
                {c && c.available === false ? 'Not connected' : 'Platform total'}
              </div>
            </button>
          );
        })}
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: -8, marginBottom: 14 }}>Counts are live platform totals. Day-over-day trend deltas need a daily KPI snapshot feed — <span style={{ color: 'var(--danger,#B85B4D)' }}>not connected</span>, so no fabricated “vs yesterday”.</div>

      {/* Directory + right rail */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-3.5 items-start">
        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 0, overflow: 'hidden', boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)' }}>
          <div className="hd" style={{ background: '#FFF9EF', padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 16, fontWeight: 700 }}>
              All Users Directory <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted)' }}>({total.toLocaleString()})</span>
            </h2>
            <span style={{ marginLeft: 'auto' }} />
            <select aria-label="All Roles" value={filters.role} onChange={(e) => setFilter('role', e.target.value)} style={{ height: 32, padding: '0 8px', fontSize: 12, borderRadius: 8, border: '1px solid var(--line)', background: '#FFFDF8' }}>
              <option value="">All Roles</option><option value="SUPER_ADMIN">Super Admin</option><option value="OWNER">Owner</option><option value="MANAGER">Branch Manager</option><option value="RECEPTION">Receptionist</option><option value="FRONT_DESK">Front Desk</option><option value="TECHNICIAN">Technician</option>
            </select>
            <select aria-label="All Tenants" value={filters.tenantId} onChange={(e) => setFilter('tenantId', e.target.value)} style={{ height: 32, padding: '0 8px', fontSize: 12, maxWidth: 150, borderRadius: 8, border: '1px solid var(--line)', background: '#FFFDF8' }}>
              <option value="">All Tenants</option>{dashTenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select aria-label="All Branches" value={filters.branchId} onChange={(e) => setFilter('branchId', e.target.value)} style={{ height: 32, padding: '0 8px', fontSize: 12, maxWidth: 140, borderRadius: 8, border: '1px solid var(--line)', background: '#FFFDF8' }}>
              <option value="">All Branches</option>{branchOpts.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <select aria-label="All Status" value={filters.status} onChange={(e) => setFilter('status', e.target.value)} style={{ height: 32, padding: '0 8px', fontSize: 12, borderRadius: 8, border: '1px solid var(--line)', background: '#FFFDF8' }}>
              <option value="">All Status</option><option value="active">Active</option><option value="invited">Invited</option><option value="suspended">Suspended</option><option value="inactive">Inactive</option>
            </select>
            <input aria-label="Search users" placeholder="Search users..." value={filters.search} onChange={(e) => onSearch(e.target.value)} style={{ height: 32, padding: '0 10px', fontSize: 12, minWidth: 150, borderRadius: 8, border: '1px solid var(--line)', background: '#FFFDF8' }} />
          </div>

          {err ? <div className="err" style={{ margin: 12 }}>{err}</div> : null}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5,minWidth:900 }}>
              <thead>
                <tr style={{ background: '#FFFBF2', borderBottom: '1px solid var(--line)', textAlign: 'left', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <th style={{ padding: '12px 12px' }}>User</th>
                  <th style={{ padding: '12px 10px' }}>Role</th>
                  <th style={{ padding: '12px 10px' }}>Tenant</th>
                  <th style={{ padding: '12px 10px' }}>Branch</th>
                  <th style={{ padding: '12px 10px' }}>Status</th>
                  <th style={{ padding: '12px 10px' }}>Last Active</th>
                  <th style={{ padding: '12px 10px', textAlign: 'center' }}>Devices</th>
                  <th style={{ padding: '12px 10px' }}>Permission Level</th>
                  <th style={{ padding: '12px 12px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && rows.length === 0 ? (
                  <tr><td colSpan={9} style={{ padding: 36, textAlign: 'center', color: 'var(--muted)' }}>Loading directory…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={9} style={{ padding: 36, textAlign: 'center', color: 'var(--muted)' }}>No users match these filters.</td></tr>
                ) : rows.map((u, idx) => (
                  <tr
                    key={u.id}
                    style={{
                      borderBottom: '1px solid var(--line)',
                      background: idx % 2 === 1 ? '#FFFDF8' : '#FFFFFF',
                      transition: 'background 0.15s ease',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#FFF9EF'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = idx % 2 === 1 ? '#FFFDF8' : '#FFFFFF'; }}
                  >
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                        <ProfileAvatarWithPreview name={u.fullName || u.email || 'User'} url={u.avatarUrl} size={32} type={u.role === 'TECHNICIAN' ? 'technician' : 'superadmin'} />
                        <span style={{ minWidth: 0 }}>
                          <span style={{ fontWeight: 700, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }}>
                            {u.fullName || u.email || u.id} {u.mfaEnabled ? <span style={{ color: 'var(--ok,#3E8F57)', fontSize: 10, fontWeight: 800, background: '#EAF5EE', padding: '1px 5px', borderRadius: 4, marginLeft: 4 }} title="MFA enabled">MFA</span> : null}
                          </span>
                          <span className="muted" style={{ fontSize: 11, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email || '—'}</span>
                        </span>
                      </div>
                    </td>
                    <td style={{ padding: '10px 10px' }}>{roleBadge(u.role)}</td>
                    <td style={{ padding: '10px 10px', color: 'var(--text)', fontWeight: 500 }}>{u.tenantName || '—'}</td>
                    <td style={{ padding: '10px 10px', color: 'var(--muted)' }}>{u.branchName || '—'}</td>
                    <td style={{ padding: '10px 10px' }}>{statusBadge(u.status)}</td>
                    <td style={{ padding: '10px 10px' }} className="muted">{ago(u.lastLoginAt)}</td>
                    <td style={{ padding: '10px 10px', textAlign: 'center', fontWeight: 600 }}>{u.assignedDevices ?? 0}</td>
                    <td style={{ padding: '10px 10px' }}>{u.permissionLevel ? <span style={{ color: PERM_COLOR[u.permissionLevel] || 'var(--text)', fontWeight: 700, fontSize: 11.5 }}>{u.permissionLevel}</span> : <span className="muted">—</span>}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', position: 'relative' }}>
                      <button className="btn ghost" aria-label={`Actions for ${u.fullName || u.email}`} onClick={() => setMenuFor(menuFor === u.id ? null : u.id)} style={{ padding: '3px 10px', fontWeight: 800, minHeight: 28, fontSize: 12 }}>⋯</button>
                      {menuFor === u.id ? (
                        <div role="menu" style={{ position: 'absolute', right: 8, top: 'calc(100% + 4px)', zIndex: 60, background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 12, boxShadow: '0 16px 40px rgba(0,0,0,0.2)', padding: 8, minWidth: 210, display: 'flex', flexDirection: 'column', gap: 6, textAlign: 'left' }}>
                          {u.role === 'SUPER_ADMIN' ? (
                            <span className="muted" style={{ fontSize: 11 }}>Platform account — change it in Platform Staff</span>
                          ) : (
                          <label style={{ fontSize: 11 }}><span className="muted">Change role</span>
                            <select aria-label={`Change role for ${u.fullName || u.email}`} defaultValue={u.role} disabled={busy === 'role' + u.id} onChange={(e) => { const n = e.target.value; if (n && n !== u.role) changeRole(u, n); }} style={{ width: '100%', height: 30, padding: '0 6px', fontSize: 12, marginTop: 3, borderRadius: 6, border: '1px solid var(--line)', background: '#fff' }}>
                              {/* Salon roles only (Oct 6 2026): platform accounts are made in Platform Staff (step-up + platform_roles.manage). */}
                              {['OWNER', 'MANAGER', 'FRONT_DESK', 'RECEPTION', 'TECHNICIAN'].map((r) => <option key={r} value={r}>{r}</option>)}
                            </select>
                          </label>
                          )}
                          {u.status === 'suspended'
                            ? <button className="btn ghost" disabled={busy === 'e' + u.id} onClick={() => act('e' + u.id, () => superAdminApi.enableUser(u.id), () => setMenuFor(null))}>Enable</button>
                            : <button className="btn ghost" disabled={busy === 'd' + u.id} onClick={() => act('d' + u.id, () => superAdminApi.disableUser(u.id), () => setMenuFor(null))}>Disable</button>}
                          <button className="btn ghost" disabled={busy === 'r' + u.id} onClick={() => reset(u)}>Reset Password</button>
                          <button className="btn ghost" disabled={busy === 'mfa' + u.id} onClick={() => toggleMfa(u)}>{u.mfaEnabled ? 'Clear 2FA' : 'Require 2FA'}</button>
                          <button className="btn ghost" onClick={() => { setSessionsFor(u); setMenuFor(null); }}>Sessions</button>
                          {u.status === 'invited' ? <button className="btn ghost" disabled={busy === 'ri' + u.id} onClick={() => resendInvite(u)}>Resend Invite</button> : null}
                          {u.status === 'invited' ? <button className="btn ghost" disabled={busy === 'ci' + u.id} onClick={() => cancelInvite(u)}>Cancel Invite</button> : null}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* pagination */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--line)', flexWrap: 'wrap', background: '#FFFDF8' }}>
            <button className="btn ghost" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label="Previous page" style={{ minHeight: 30, padding: '0 10px' }}>‹ Prev</button>
            {Array.from({ length: Math.min(5, pageCount) }, (_, i) => i + 1).map((n) => (
              <button key={n} className={'btn ' + (n === page ? '' : 'ghost')} onClick={() => setPage(n)} aria-current={n === page ? 'page' : undefined} style={{ minWidth: 32, minHeight: 30, padding: '0 6px' }}>{n}</button>
            ))}
            {pageCount > 5 ? <span className="muted">… {pageCount}</span> : null}
            <button className="btn ghost" disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))} aria-label="Next page" style={{ minHeight: 30, padding: '0 10px' }}>Next ›</button>
            <span className="muted" style={{ marginLeft: 'auto', fontSize: 11.5 }}>{total === 0 ? '0 users' : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}</span>
            <select aria-label="Rows per page" value={pageSize} onChange={(e) => { setPage(1); setPageSize(Number(e.target.value)); }} style={{ height: 30, padding: '0 6px', fontSize: 12, borderRadius: 6, border: '1px solid var(--line)', background: '#fff' }}>
              {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
            </select>
          </div>
        </section>

        {/* Right rail */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 14, boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 15 }}>Role Health &amp; Alerts</h2>
              <button className="linkbtn" style={{ marginLeft: 'auto' }} onClick={() => nav('/audit-logs')}>View All</button>
            </div>
            <div style={{ marginTop: 8 }}>
              {(dash?.roleHealth || []).map((h: any) => (
                <button key={h.key} onClick={() => h.key === 'accessRequestsPending' ? setArOpen(true) : (h.available && nav(h.to))} title={h.available ? '' : 'Not connected'} style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid var(--line,#eee)', background: 'none', border: 'none', borderBottomStyle: 'solid', cursor: (h.available || h.key === 'accessRequestsPending') ? 'pointer' : 'default', font: 'inherit' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 999, flex: 'none', background: h.severity === 'critical' ? 'var(--danger,#B85B4D)' : h.severity === 'warn' ? 'var(--warn,#D09A36)' : 'var(--info,#3C7FB6)' }} />
                  <span style={{ fontSize: 12 }}>{h.label}</span>
                  <span style={{ marginLeft: 'auto', fontWeight: 800, color: h.available ? 'var(--text)' : 'var(--danger,#B85B4D)' }}>{h.available ? h.count : '—'}</span>
                </button>
              ))}
              {!dash ? <div className="state" style={{ fontSize: 12 }}>Loading…</div> : null}
            </div>
          </section>

          <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 14, boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
            <h2 style={{ fontFamily: 'Playfair Display, serif', fontSize: 15, margin: '0 0 4px 0' }}>Role Distribution</h2>
            <div className="muted" style={{ fontSize: 11.5, marginBottom: 6 }}>Total Roles (in use): <b>{dash?.kpiCards?.find((c: any) => c.key === 'totalRoles')?.value ?? '—'}</b></div>
            <Donut centerTop={Number(dash?.kpis?.totalUsers || 0).toLocaleString()} centerBottom="Total Users" items={(dash?.rolesDistribution || []).map((x: any) => ({ label: x.label, count: x.count }))} />
          </section>

          <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 14, boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
            <h2 style={{ fontFamily: 'Playfair Display, serif', fontSize: 15, margin: '0 0 8px 0' }}>Permissions Overview</h2>
            {(dash?.permissionLevels || []).length === 0 ? <div className="state" style={{ fontSize: 12 }}>Loading…</div> : (dash.permissionLevels).map((p: any) => (
              <div key={p.level} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', fontSize: 12, marginBottom: 3 }}><span>{p.level}</span><span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>{p.count} ({p.pct}%)</span></div>
                <div style={{ height: 8, background: 'var(--cream2,#F3E7D2)', borderRadius: 999 }}><div style={{ width: `${p.pct}%`, height: '100%', background: PERM_COLOR[p.level] || 'var(--g7)', borderRadius: 999 }} /></div>
              </div>
            ))}
            <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Levels map from role (documented): Owner/Super Admin → Full · Manager → Branch Admin · Technician → Limited · Reception/Front Desk → Basic.</div>
          </section>
        </div>
      </div>

      {/* Bottom analytics row — FIXED HEIGHTS & INTERNAL SCROLLING */}
      <div className=" grid  grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2.5 mt-3">
        {/* Card 1: Growth Trend */}
        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 14, height: 285, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
          <h2 style={{ margin: '0 0 4px 0', fontFamily: 'Playfair Display, serif', fontSize: 15 }}>User Growth Trend</h2>
          {dash?.growthDaily?.series?.length ? (() => {
            const s = dash.growthDaily.series as any[]; const maxV = Math.max(1, ...s.map((d) => Math.max(d.newUsers, d.activeUsers)));
            const W = 220, H = 85, n = s.length; const x = (i: number) => (i / Math.max(1, n - 1)) * W; const y = (v: number) => H - (v / maxV) * H;
            const path = (key: string) => s.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(d[key]).toFixed(1)}`).join(' ');
            return (
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'space-between' }}>
                <svg viewBox={`0 0 ${W} ${H + 6}`} style={{ width: '100%', height: 90 }} role="img" aria-label="User growth: new vs active per day, last 30 days">
                  <path d={path('newUsers')} fill="none" stroke="#3C7FB6" strokeWidth="2" />
                  <path d={path('activeUsers')} fill="none" stroke="#3E8F57" strokeWidth="2" />
                </svg>
                <div style={{ display: 'flex', gap: 12, fontSize: 11, marginTop: 2 }}>
                  <span><span style={{ color: '#3C7FB6' }}>●</span> New</span>
                  <span><span style={{ color: '#3E8F57' }}>●</span> Active</span>
                </div>
                <div className="muted" style={{ fontSize: 10.5, marginTop: 4, lineHeight: 1.3 }}>
                  +{dash.growthDaily.newUsersThisMonth} new users this month · 30-day activity.
                </div>
              </div>
            );
          })() : <div className="state" style={{ fontSize: 12 }}>Loading…</div>}
        </section>

        {/* Card 2: Pending Invitations — Fixed Height & Scrollable */}
        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 14, height: 285, display: 'flex', flexDirection: 'column', boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <h2 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 15 }}>Pending Invitations</h2>
            <button className="linkbtn" style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: 10.5 }} onClick={() => setInvOpen(true)}>Manage</button>
            <button className="linkbtn" style={{ padding: '2px 8px', fontSize: 10.5 }} onClick={() => setAddOpen(true)}>Invite</button>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
            {(dash?.pendingInvitations?.rows || []).length === 0 ? (
              <div className="state" style={{ fontSize: 12, padding: '20px 0' }}>No pending invitations.</div>
            ) : (dash.pendingInvitations.rows).map((r: any, i: number) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0', fontSize: 12, borderBottom: '1px solid var(--line,#eee)' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, fontWeight: 500 }}>
                  {r.tenant}{r.branch ? ` · ${r.branch}` : ''}
                </span>
                <span className="muted" style={{ flex: 'none', fontSize: 11 }}>
                  {r.count > 1 ? `${r.count} invites` : ago(r.lastInvitedAt)}
                </span>
              </div>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 'auto', paddingTop: 6, borderTop: '1px solid var(--line,#eee)' }}>
            Total Pending: <b>{dash?.pendingInvitations?.total ?? '—'}</b>
          </div>
        </section>

        {/* Card 3: Recent User Activity — Fixed Height & Scrollable */}
        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 14, height: 285, display: 'flex', flexDirection: 'column', boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <h2 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 15 }}>Recent User Activity</h2>
            <button className="linkbtn" style={{ padding: '2px 8px', fontSize: 10.5 }} onClick={() => nav('/audit-logs')}>View All</button>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
            {(dash?.recentActivity || []).length === 0 ? (
              <div className="state" style={{ fontSize: 12, padding: '20px 0' }}>No recent activity.</div>
            ) : (dash.recentActivity).map((a: any, i: number) => (
              <div key={i} style={{ padding: '6px 0', fontSize: 12, borderBottom: '1px solid var(--line,#eee)' }}>
                <div style={{ fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <b>{a.actorName || a.actorRole || 'system'}</b> · <span style={{ textTransform: 'capitalize' }}>{String(a.action || '').replace(/_/g, ' ')}</span>
                </div>
                <div className="muted" style={{ fontSize: 10.5, marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span>{a.entityType || 'Action'}</span>
                  {a.at ? <span>· {ago(a.at)}</span> : null}
                </div>
              </div>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 'auto', paddingTop: 6, borderTop: '1px solid var(--line,#eee)' }}>
            Live Audit Stream
          </div>
        </section>

        {/* Card 4: Top Tenants by User Count — Fixed Height & Scrollable */}
        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 14, height: 285, display: 'flex', flexDirection: 'column', boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
          <h2 style={{ margin: '0 0 8px 0', fontFamily: 'Playfair Display, serif', fontSize: 15 }}>Top Tenants by Users</h2>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
            {(dash?.topTenants?.rows || []).length === 0 ? (
              <div className="state" style={{ fontSize: 12, padding: '20px 0' }}>No tenant users yet.</div>
            ) : (dash.topTenants.rows).map((t: any, i: number) => (
              <button
                key={t.tenantId}
                onClick={() => setFilter('tenantId', t.tenantId)}
                style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontSize: 12, borderBottom: '1px solid var(--line,#eee)', background: 'none', border: 'none', borderBottomStyle: 'solid', cursor: 'pointer', font: 'inherit' }}
              >
                <span className="muted" style={{ width: 16, fontWeight: 700 }}>{i + 1}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, fontWeight: 500 }}>{t.tenantName}</span>
                <span style={{ fontWeight: 700, color: 'var(--text)' }}>{t.users}</span>
              </button>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 'auto', paddingTop: 6, borderTop: '1px solid var(--line,#eee)' }}>
            Total Users: <b>{dash?.topTenants?.totalUsers ?? '—'}</b>
          </div>
        </section>

        {/* Card 5: Branch Access Overview — Fixed Height */}
        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 14, height: 285, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
          <h2 style={{ margin: '0 0 4px 0', fontFamily: 'Playfair Display, serif', fontSize: 15 }}>Branch Access Overview</h2>
          {dash?.branchAccess ? (
            <>
              <Donut centerTop={String(dash.branchAccess.totalBranches || 0)} centerBottom="Branches" items={(dash.branchAccess.byLevel || []).map((b: any) => ({ label: b.level, count: b.count }))} />
              <div style={{ fontSize: 11, color: dash.branchAccess.branchesWithoutAdmin ? 'var(--danger,#B85B4D)' : 'var(--muted)', marginTop: 4 }}>
                {dash.branchAccess.branchesWithoutAdmin} branch(es) have no active admin
              </div>
              <div className="muted" style={{ fontSize: 10.5, lineHeight: 1.25 }}>
                Access mix from <code>user_branch_access</code>.
              </div>
            </>
          ) : <div className="state" style={{ fontSize: 12 }}>Loading…</div>}
        </section>
      </div>

      {/* Quick Actions */}
      <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, marginTop: 14, boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
        <h2 style={{ margin: '0 0 10px 0', fontFamily: 'Playfair Display, serif', fontSize: 16 }}>Quick Actions</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
          <button className="btn ghost" onClick={() => { setAddOpen(true); setCreateOpen(false); }}>Add User</button>
          <button className="btn ghost" onClick={() => setPermOpen(true)} title="The system uses a fixed role enum + code permission catalog">Create Role</button>
          <button className="btn ghost" onClick={() => { setAddOpen(true); setCreateOpen(false); }}>Send Invite</button>
          <button className="btn ghost" onClick={exportCsv}>Export Users</button>
          <button className="btn ghost" onClick={() => setSchedOpen(true)}>Scheduled Reports</button>
          <button className="btn ghost" onClick={() => nav('/audit-logs')}>View Audit Logs</button>
          <button className="btn ghost" onClick={() => setOneTime('Reset Access: open a user’s ⋯ menu in the directory, then Reset Password / Clear 2FA / Revoke sessions — each permission-checked and audited.')}>Reset Access</button>
          <button className="btn ghost" onClick={() => setPermOpen(true)}>Permission Matrix</button>
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 10 }}><b>Create Role</b> has no backend yet (the role set is a fixed enum); the Permission Matrix shows the live role→permission catalog from RBAC. <b>Access Requests</b> are live (§26) — open the “Access Requests Pending” health row or the “Open Access Requests” KPI to review and approve. <span style={{ color: 'var(--danger,#B85B4D)' }}>Custom roles: not connected.</span></div>
      </section>

      {branchOpen ? <BranchAccessModal onClose={() => setBranchOpen(false)} onDone={(msg) => { setBranchOpen(false); setOneTime(msg); }} /> : null}
      {sessionsFor ? <SessionsModal user={sessionsFor} onClose={() => setSessionsFor(null)} onDone={(msg) => { setSessionsFor(null); setOneTime(msg); }} /> : null}
      {permOpen ? <PermissionMatrixModal roles={roles} onClose={() => setPermOpen(false)} /> : null}
      {arOpen ? <AccessRequestsModal onClose={() => { setArOpen(false); if (mayDash) superAdminApi.usersDashboard().then((d: any) => setDash(d)).catch(() => {}); }} onDone={(msg) => setOneTime(msg)} /> : null}
      {invOpen ? <InvitationsModal onClose={() => { setInvOpen(false); if (mayDash) superAdminApi.usersDashboard().then((d: any) => setDash(d)).catch(() => {}); }} onDone={(msg) => setOneTime(msg)} /> : null}
      {schedOpen ? <ScheduledReportsModal onClose={() => setSchedOpen(false)} onDone={(msg) => setOneTime(msg)} /> : null}
    </div>
  );
}

// ── Permission Matrix — live role→permission catalog from RBAC (real; read-only). Custom role creation has no backend.
function PermissionMatrixModal({ roles, onClose }: { roles: Record<string, string[]> | null; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,0.4)', zIndex: 70, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 12px' }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Permission matrix" style={{ width: 'min(720px, 96vw)', maxHeight: '84vh', overflow: 'auto', background: 'var(--card,#fff)', borderRadius: 10, boxShadow: '0 18px 48px rgba(0,0,0,0.26)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
          <div><div style={{ fontWeight: 800, fontSize: 14 }}>Permission Matrix</div><div className="muted" style={{ fontSize: 11 }}>Live role → permission catalog (RBAC) · read-only</div></div>
          <button className="btn ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div style={{ padding: '14px 18px' }}>
          {!roles ? <div className="state">Loading…</div> : Object.entries(roles).map(([role, perms]) => (
            <div key={role} style={{ padding: '7px 0', borderBottom: '1px solid var(--line,#eee)' }}>
              <div style={{ fontWeight: 800, fontSize: 12.5 }}>{role} <span className="muted" style={{ fontWeight: 400 }}>· {Array.isArray(perms) ? perms.length : 0} permissions</span></div>
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{Array.isArray(perms) && perms.length ? perms.join(', ') : '—'}</div>
            </div>
          ))}
          <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>Roles are a fixed system enum; permissions are deny-by-default. <span style={{ color: 'var(--danger,#B85B4D)' }}>Custom-role creation and an editable matrix need a roles/permissions backend — not connected.</span></div>
        </div>
      </div>
    </div>
  );
}

// ── Access-request review (§26) — list open requests; approve/reject. Approvals never exceed the approver's authority
//    (enforced server-side); high-risk (privileged) grants require an explicit confirm. Real, audited.
export function AccessRequestsModal({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => superAdminApi.listAccessRequests().then((r: any) => setRows(r.rows || [])).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  const open = (rows || []).filter((r) => r.status === 'submitted' || r.status === 'under_review');
  const decided = (rows || []).filter((r) => r.status !== 'submitted' && r.status !== 'under_review').slice(0, 6);
  const { confirm: askConfirm, confirmUi } = useInlineConfirm();
  const act = (r: any, kind: 'approve' | 'reject') => {
    // A high-risk (privileged) approval keeps its extra confirmation step — now in-app rather than an OS dialog.
    if (kind === 'approve' && r.highRisk) { askConfirm('This is a high-risk (privileged) grant. Confirm approval?', () => { void doAct(r, kind); }, { confirmLabel: 'Approve high-risk grant' }); return; }
    void doAct(r, kind);
  };
  const doAct = async (r: any, kind: 'approve' | 'reject') => {
    setBusy(r.id + kind);
    try {
      if (kind === 'approve') await superAdminApi.approveAccessRequest(r.id, r.highRisk ? { confirmHighRisk: true } : {});
      else await superAdminApi.rejectAccessRequest(r.id, {});
      onDone(`Access request ${kind === 'approve' ? 'approved' : 'rejected'} for ${r.requesterName || r.requesterEmail || 'user'}.`);
      await load();
    } catch (e: any) { onDone(e?.message || 'Action failed.'); } finally { setBusy(null); }
  };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,0.4)', zIndex: 70, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 12px' }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Access requests" style={{ width: 'min(760px, 96vw)', maxHeight: '84vh', overflow: 'auto', background: 'var(--card,#fff)', borderRadius: 10, boxShadow: '0 18px 48px rgba(0,0,0,0.26)' }}>
        {confirmUi}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
          <div><div style={{ fontWeight: 800, fontSize: 14 }}>Access Requests</div><div className="muted" style={{ fontSize: 11 }}>Approve or reject role-elevation requests · approvals never exceed your authority · high-risk grants require confirmation</div></div>
          <button className="btn ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div style={{ padding: '14px 18px' }}>
          {rows === null ? <div className="state">Loading…</div> : open.length === 0 ? <div className="state" style={{ fontSize: 12.5 }}>No pending access requests.</div> : open.map((r) => (
            <div key={r.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line,#eee)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ fontWeight: 800, fontSize: 13 }}>{r.requesterName || r.requesterEmail || 'Unknown user'}</div>
                {r.highRisk ? <span className="pill warn" style={{ fontSize: 10 }}>High-risk</span> : null}
                <span className="muted" style={{ fontSize: 11 }}>{r.tenantName || 'Platform'}</span>
                <span style={{ marginLeft: 'auto', fontSize: 12 }}><span className="muted">{r.currentRole || '—'}</span> → <b>{r.requestedRole}</b>{r.requestedDurationDays ? <span className="muted"> · {r.requestedDurationDays}d</span> : <span className="muted"> · permanent</span>}</span>
              </div>
              <div className="muted" style={{ fontSize: 11.5, margin: '3px 0 7px' }}>{r.reason}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" disabled={busy === r.id + 'approve'} onClick={() => act(r, 'approve')}>{busy === r.id + 'approve' ? 'Approving…' : 'Approve'}</button>
                <button className="btn ghost" disabled={busy === r.id + 'reject'} onClick={() => act(r, 'reject')}>{busy === r.id + 'reject' ? 'Rejecting…' : 'Reject'}</button>
              </div>
            </div>
          ))}
          {decided.length ? (
            <div style={{ marginTop: 12 }}>
              <div className="muted" style={{ fontSize: 11, fontWeight: 800, marginBottom: 4 }}>Recently decided</div>
              {decided.map((r) => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, padding: '3px 0' }}>
                  <span>{r.requesterName || r.requesterEmail || 'User'}</span>
                  <span className="muted">{r.currentRole || '—'} → {r.requestedRole}</span>
                  <span className="pill" style={{ marginLeft: 'auto', fontSize: 10 }}>{r.status}</span>
                </div>
              ))}
            </div>
          ) : null}
          <div className="muted" style={{ fontSize: 11, marginTop: 10 }}>Approving applies the role grant immediately; temporary grants expire and revert automatically. Every decision is audited.</div>
        </div>
      </div>
    </div>
  );
}

// ── Invitation management (§23) — list outstanding/secure token invitations and resend (rotates the token) or cancel.
//    Surfaces delivery status honestly; when delivery isn't connected, resend returns the one-time link for manual hand-off.
export function InvitationsModal({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const load = () => superAdminApi.listInvitations().then((r: any) => setRows(r?.rows || [])).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  const sorted = (rows || []).slice().sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1));
  const resend = async (r: any) => {
    setBusy(r.id + 'resend'); setLink(null);
    try {
      const res: any = await superAdminApi.resendInvitationToken(r.id);
      if (res.manualAcceptToken) setLink(`${window.location.origin}/accept-invite?token=${res.manualAcceptToken}`);
      onDone(`Invitation re-sent to ${r.email} (token rotated · delivery: ${res.deliveryStatus}).`);
      await load();
    } catch (e: any) { onDone(e?.message || 'Resend failed.'); } finally { setBusy(null); }
  };
  const cancel = async (r: any) => {
    setBusy(r.id + 'cancel');
    try { await superAdminApi.cancelInvitationToken(r.id); onDone(`Invitation to ${r.email} cancelled.`); await load(); } catch (e: any) { onDone(e?.message || 'Cancel failed.'); } finally { setBusy(null); }
  };
  const tone: Record<string, string> = { pending: 'warn', accepted: 'ok', expired: '', cancelled: '' };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,0.4)', zIndex: 70, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 12px' }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Invitations" style={{ width: 'min(820px, 96vw)', maxHeight: '84vh', overflow: 'auto', background: 'var(--card,#fff)', borderRadius: 10, boxShadow: '0 18px 48px rgba(0,0,0,0.26)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
          <div><div style={{ fontWeight: 800, fontSize: 14 }}>Invitations</div><div className="muted" style={{ fontSize: 11 }}>Secure single-use token invitations · resend rotates the token · only the hash is stored</div></div>
          <button className="btn ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div style={{ padding: '14px 18px' }}>
          {link ? <div className="err" style={{ marginBottom: 10, wordBreak: 'break-all' }}>Delivery not connected — share this one-time link manually: {link}</div> : null}
          {rows === null ? <div className="state">Loading…</div> : rows.length === 0 ? <div className="state" style={{ fontSize: 12.5 }}>No invitations yet.</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--muted)' }}>{['Email', 'Role', 'Tenant', 'Status', 'Delivery', 'Expires', 'Sent', ''].map((h) => <th key={h} style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>{h}</th>)}</tr></thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--line,#eee)' }}>
                    <td style={{ padding: '6px 8px' }}>{r.email}</td>
                    <td style={{ padding: '6px 8px' }}>{r.role}</td>
                    <td style={{ padding: '6px 8px' }}>{r.tenantName || '—'}</td>
                    <td style={{ padding: '6px 8px' }}><span className={'pill ' + (tone[r.status] || '')}>{r.status}</span></td>
                    <td style={{ padding: '6px 8px' }} className={r.deliveryStatus === 'not_connected' || r.deliveryStatus === 'failed' ? '' : 'muted'}>{r.deliveryStatus === 'not_connected' ? <span style={{ color: 'var(--danger,#B85B4D)' }}>not connected</span> : r.deliveryStatus}</td>
                    <td style={{ padding: '6px 8px' }} className="muted">{r.expiresAt ? new Date(r.expiresAt).toLocaleDateString() : '—'}</td>
                    <td style={{ padding: '6px 8px' }} className="muted">{r.sendCount}</td>
                    <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                      {r.status === 'pending' ? <>
                        <button className="btn ghost" style={{ fontSize: 11, padding: '3px 8px' }} disabled={busy === r.id + 'resend'} onClick={() => resend(r)}>{busy === r.id + 'resend' ? '…' : 'Resend'}</button>
                        <button className="btn ghost" style={{ fontSize: 11, padding: '3px 8px', marginLeft: 4 }} disabled={busy === r.id + 'cancel'} onClick={() => cancel(r)}>{busy === r.id + 'cancel' ? '…' : 'Cancel'}</button>
                      </> : <span className="muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="muted" style={{ fontSize: 11, marginTop: 10 }}>Resending rotates the token and invalidates the previous link. Cancelling blocks the link from being used.</div>
        </div>
      </div>
    </div>
  );
}

// ── Scheduled reports — define a recurring report (currently the users export), toggle/run/delete. Generation +
//    delivery run server-side (cron hits the internal run-due endpoint); delivery is honest about not-connected.
export function ScheduledReportsModal({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [name, setName] = useState('');
  const [cadence, setCadence] = useState('weekly');
  const [recipient, setRecipient] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => superAdminApi.listScheduledReports().then((r: any) => setRows(r?.rows || [])).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  const create = async () => {
    if (name.trim().length < 2) return;
    setBusy('create');
    try { await superAdminApi.createScheduledReport({ name: name.trim(), reportKey: 'users', cadence, recipientEmail: recipient.trim() || null }); setName(''); setRecipient(''); onDone('Scheduled report created.'); await load(); }
    catch (e: any) { onDone(e?.message || 'Could not create the report.'); } finally { setBusy(null); }
  };
  const act = async (id: string, kind: 'toggle' | 'run' | 'delete', cur?: any) => {
    setBusy(id + kind);
    try {
      if (kind === 'toggle') { await superAdminApi.toggleScheduledReport(id, !cur.enabled); onDone(`Report ${cur.enabled ? 'disabled' : 'enabled'}.`); }
      else if (kind === 'run') { const r: any = await superAdminApi.runScheduledReportNow(id); onDone(`Ran now · delivery: ${r.status}.`); }
      else { await superAdminApi.deleteScheduledReport(id); onDone('Report deleted.'); }
      await load();
    } catch (e: any) { onDone(e?.message || 'Action failed.'); } finally { setBusy(null); }
  };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,0.4)', zIndex: 70, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 12px' }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Scheduled reports" style={{ width: 'min(780px, 96vw)', maxHeight: '84vh', overflow: 'auto', background: 'var(--card,#fff)', borderRadius: 10, boxShadow: '0 18px 48px rgba(0,0,0,0.26)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
          <div><div style={{ fontWeight: 800, fontSize: 14 }}>Scheduled Reports</div><div className="muted" style={{ fontSize: 11 }}>Recurring users export · generated + delivered server-side by the scheduler</div></div>
          <button className="btn ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div style={{ padding: '14px 18px' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <input aria-label="Report name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Report name" style={{ flex: 1, minWidth: 140, padding: '7px 9px' }} />
            <select aria-label="Cadence" value={cadence} onChange={(e) => setCadence(e.target.value)} style={{ padding: '7px 9px' }}>
              <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
            </select>
            <input aria-label="Recipient email" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="Recipient email (optional)" style={{ padding: '7px 9px' }} />
            <button className="btn" disabled={busy === 'create' || name.trim().length < 2} onClick={create}>{busy === 'create' ? 'Creating…' : 'Add report'}</button>
          </div>
          {rows === null ? <div className="state">Loading…</div> : rows.length === 0 ? <div className="state" style={{ fontSize: 12.5 }}>No scheduled reports yet.</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--muted)' }}>{['Name', 'Cadence', 'Recipient', 'Next run', 'Last status', ''].map((h) => <th key={h} style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--line,#eee)', opacity: r.enabled ? 1 : 0.55 }}>
                    <td style={{ padding: '6px 8px' }}>{r.name}</td>
                    <td style={{ padding: '6px 8px' }}>{r.cadence}</td>
                    <td style={{ padding: '6px 8px' }} className="muted">{r.recipientEmail || '—'}</td>
                    <td style={{ padding: '6px 8px' }} className="muted">{r.nextRunAt ? new Date(r.nextRunAt).toLocaleDateString() : '—'}</td>
                    <td style={{ padding: '6px 8px' }} className="muted">{r.lastStatus === 'not_connected' ? <span style={{ color: 'var(--danger,#B85B4D)' }}>not connected</span> : (r.lastStatus || '—')}</td>
                    <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                      <button className="btn ghost" style={{ fontSize: 11, padding: '3px 8px' }} disabled={busy === r.id + 'toggle'} onClick={() => act(r.id, 'toggle', r)}>{r.enabled ? 'Disable' : 'Enable'}</button>
                      <button className="btn ghost" style={{ fontSize: 11, padding: '3px 8px', marginLeft: 4 }} disabled={busy === r.id + 'run'} onClick={() => act(r.id, 'run', r)}>Run now</button>
                      <button className="btn ghost" style={{ fontSize: 11, padding: '3px 8px', marginLeft: 4 }} disabled={busy === r.id + 'delete'} onClick={() => act(r.id, 'delete', r)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="muted" style={{ fontSize: 11, marginTop: 10 }}>An external scheduler hits the internal run-due endpoint (shared secret) to generate + deliver due reports. Delivery uses the configured notifier; when none is set, runs are recorded <span style={{ color: 'var(--danger,#B85B4D)' }}>not connected</span>.</div>
        </div>
      </div>
    </div>
  );
}

// ── Same-tenant branch-access assign/revoke (mutation tier, gated on an active support session, audited). Reused verbatim.
function BranchAccessModal({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const [sessions, setSessions] = useState<any[] | null>(null);
  const [sessionId, setSessionId] = useState('');
  const [tenantName, setTenantName] = useState<string | null>(null);
  const [data, setData] = useState<{ users: any[]; branches: any[] } | null>(null);
  const [userId, setUserId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [accessLevel, setAccessLevel] = useState('manager');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (superAdminApi.supportSessions(true) as Promise<any>)
      .then((d) => { if (alive) setSessions(Array.isArray(d) ? d : []); })
      .catch((e: any) => { if (alive) setError(e?.message || 'Couldn’t load support sessions.'); });
    return () => { alive = false; };
  }, []);

  const session = (sessions || []).find((s: any) => String(s.id) === sessionId);
  const tenantId = session ? String(session.tenant_id) : '';

  useEffect(() => {
    if (!tenantId) { setData(null); setTenantName(null); setUserId(''); setBranchId(''); return; }
    let alive = true; setData(null);
    (superAdminApi.tenantUsersAndBranches(tenantId) as Promise<any>)
      .then((d) => { if (alive) { setTenantName(d?.tenantName || null); setData({ users: Array.isArray(d?.users) ? d.users : [], branches: Array.isArray(d?.branches) ? d.branches : [] }); } })
      .catch((e: any) => { if (alive) setError(e?.message || 'Couldn’t load tenant users/branches.'); });
    return () => { alive = false; };
  }, [tenantId]);

  const ready = !!sessionId && !!userId && !!branchId && reason.trim().length >= 5 && !busy;
  const run = (kind: 'assign' | 'revoke') => {
    if (!sessionId || !userId || !branchId || reason.trim().length < 5) return;
    setBusy(true); setError(null);
    const body = { sessionId, tenantId, userId, branchId, reason: reason.trim(), ...(kind === 'assign' ? { accessLevel } : {}) };
    const call = kind === 'assign' ? superAdminApi.assignUserBranch(body) : superAdminApi.revokeUserBranch(body);
    (call as Promise<any>)
      .then((r: any) => onDone(kind === 'assign' ? `Branch access granted (${accessLevel}) and audited.` : `Branch access revoked (${r?.removed ?? 0} removed) and audited.`))
      .catch((e: any) => { setError(e?.message || `${kind} failed.`); setBusy(false); });
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,0.4)', zIndex: 70, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 12px' }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Branch access" style={{ width: 'min(560px, 96vw)', maxHeight: '88vh', overflow: 'auto', background: 'var(--card,#fff)', borderRadius: 10, boxShadow: '0 18px 48px rgba(0,0,0,0.26)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
          <div><div style={{ fontWeight: 800, fontSize: 14 }}>Branch Access</div><div className="muted" style={{ fontSize: 11 }}>Assign / revoke · within an active support session</div></div>
          <button className="btn ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {error && <div className="err">{error}</div>}
          <label style={{ fontSize: 12 }}>
            <div className="muted" style={{ marginBottom: 4 }}>Tenant (from active support sessions)</div>
            {sessions === null ? <div className="state" style={{ fontSize: 12 }}>Loading sessions…</div> : sessions.length === 0 ? (
              <div className="state" style={{ fontSize: 12 }}>No active support session. Open tenant support access first — branch changes are only permitted inside one.</div>
            ) : (
              <select value={sessionId} onChange={(e) => { setSessionId(e.target.value); setUserId(''); setBranchId(''); }} style={{ width: '100%', padding: '7px 9px', fontSize: 12 }}>
                <option value="">Select a support session…</option>
                {sessions.map((s: any) => <option key={s.id} value={s.id}>{`tenant ${String(s.tenant_id).slice(0, 8)}… · ${s.reason || 'support'}`}</option>)}
              </select>
            )}
          </label>
          {sessionId && (
            <>
              {tenantName && <div className="muted" style={{ fontSize: 12 }}>Tenant: <b>{tenantName}</b></div>}
              {data === null ? <div className="state" style={{ fontSize: 12 }}>Loading users &amp; branches…</div> : (data.users.length === 0 || data.branches.length === 0) ? (
                <div className="state" style={{ fontSize: 12 }}>This tenant needs at least one user and one branch.</div>
              ) : (
                <>
                  <label style={{ fontSize: 12 }}><div className="muted" style={{ marginBottom: 4 }}>User</div>
                    <select value={userId} onChange={(e) => setUserId(e.target.value)} style={{ width: '100%', padding: '7px 9px', fontSize: 12 }}>
                      <option value="">Select user…</option>
                      {data.users.map((u) => <option key={u.id} value={u.id}>{`${u.fullName} · ${u.role}`}</option>)}
                    </select>
                  </label>
                  <label style={{ fontSize: 12 }}><div className="muted" style={{ marginBottom: 4 }}>Branch</div>
                    <select value={branchId} onChange={(e) => setBranchId(e.target.value)} style={{ width: '100%', padding: '7px 9px', fontSize: 12 }}>
                      <option value="">Select branch…</option>
                      {data.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </label>
                  <label style={{ fontSize: 12 }}><div className="muted" style={{ marginBottom: 4 }}>Access level (for assign)</div>
                    <select value={accessLevel} onChange={(e) => setAccessLevel(e.target.value)} style={{ width: '100%', padding: '7px 9px', fontSize: 12 }}>
                      <option value="owner">owner</option><option value="manager">manager</option><option value="viewer">viewer</option><option value="report_only">report_only</option>
                    </select>
                  </label>
                  <label style={{ fontSize: 12 }}><div className="muted" style={{ marginBottom: 4 }}>Reason (required, ≥5 chars · audited)</div>
                    <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. granting Westside branch access for support" style={{ width: '100%', padding: '7px 9px', fontSize: 12 }} />
                  </label>
                </>
              )}
            </>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn ghost" disabled={!ready} style={!ready ? { opacity: 0.5 } : undefined} onClick={() => run('revoke')}>{busy ? '…' : 'Revoke'}</button>
            <button className="btn" disabled={!ready} style={!ready ? { opacity: 0.5 } : undefined} onClick={() => run('assign')}>{busy ? '…' : 'Assign'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Active-session oversight + revocation. Reads the real sessions table; revokes one/all (kills refresh tokens). Reused.
function SessionsModal({ user, onClose, onDone }: { user: any; onClose: () => void; onDone: (msg: string) => void }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    setRows(null); setError(null);
    (superAdminApi.userSessions(user.id) as Promise<any>)
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch((e: any) => { setError(e?.message || 'Couldn’t load sessions.'); setRows([]); });
  };
  useEffect(load, [user.id]);

  const revokeOne = (s: any) => { setBusy(s.id); setError(null);
    (superAdminApi.revokeSession(s.id) as Promise<any>)
      .then(() => { setBusy(null); load(); })
      .catch((e: any) => { setError(e?.message || 'Revoke failed.'); setBusy(null); });
  };
  const revokeAll = () => { setBusy('all'); setError(null);
    (superAdminApi.revokeAllUserSessions(user.id) as Promise<any>)
      .then((r: any) => onDone(`${user.fullName || user.email}: ${r?.revoked ?? 0} session(s) revoked (audited)`))
      .catch((e: any) => { setError(e?.message || 'Revoke-all failed.'); setBusy(null); });
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,0.4)', zIndex: 70, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 12px' }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Active sessions" style={{ width: 'min(620px, 96vw)', maxHeight: '88vh', overflow: 'auto', background: 'var(--card,#fff)', borderRadius: 10, boxShadow: '0 18px 48px rgba(0,0,0,0.26)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
          <div><div style={{ fontWeight: 800, fontSize: 14 }}>Active Sessions</div><div className="muted" style={{ fontSize: 11 }}>{user.fullName || user.email} · revoking kills the session + its refresh tokens</div></div>
          <button className="btn ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {error && <div className="err">{error}</div>}
          {rows === null ? <div className="state" style={{ fontSize: 12 }}>Loading sessions…</div> : rows.length === 0 ? (
            <div className="state" style={{ fontSize: 12 }}>No active sessions for this user.</div>
          ) : rows.map((s) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--line,#eee)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{s.deviceId || 'Unknown device'} <span className="muted" style={{ fontWeight: 400 }}>· {s.ipAddress || 'no ip'}</span></div>
                <div className="muted" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.userAgent || '—'}</div>
                <div className="muted" style={{ fontSize: 11 }}>since {s.createdAt ? new Date(s.createdAt).toLocaleString() : '—'} · expires {s.expiresAt ? new Date(s.expiresAt).toLocaleString() : '—'}</div>
              </div>
              <button className="btn ghost" disabled={busy === s.id} onClick={() => revokeOne(s)}>{busy === s.id ? '…' : 'Revoke'}</button>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
            <span className="muted" style={{ fontSize: 11 }}>{rows && rows.length ? `${rows.length} active` : ''}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn ghost" onClick={onClose}>Close</button>
              <button className="btn" disabled={busy === 'all' || !rows || rows.length === 0} style={(busy === 'all' || !rows || rows.length === 0) ? { opacity: 0.5 } : undefined} onClick={revokeAll}>{busy === 'all' ? 'Revoking…' : 'Revoke all sessions'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
