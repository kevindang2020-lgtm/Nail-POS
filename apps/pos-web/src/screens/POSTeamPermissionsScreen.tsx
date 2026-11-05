// POSTeamPermissionsScreen.tsx — Team › Roles & Permissions: THE salon's one roster for access (BUILD_PLAN Phase 9,
// Constitution 2). It replaces two screens — this one (assign a template, raw-checkbox custom roles, a read-only matrix)
// and Account › Users & Roles (a read-only roster) — which now redirects here.
//   • Team: everyone with their role, template, branches, overrides, 2FA, last sign-in, and a DORMANT badge → the per-person
//     page (/tenant/team/permissions/:userId) where effective permissions, branch access, overrides and the audit live.
//   • Roles: the salon's templates + custom roles; the custom-role builder offers the registry's keys grouped by domain with
//     descriptions and sensitivity — only keys the base role AND the person building it hold (the server's ceiling) — and
//     a preview of what the role would grant (incl. high-risk keys) must be looked at before it is created.
//   • Role matrix: the permission-by-role reference (unchanged data, /pos/team/permissions/state).
//   • Ownership (owners): transfer the salon to another person — step-up, and the salon always keeps an owner.
// Routes: /pos/access/* (contract §2.6), /pos/staff-roles (create / archive a custom role), /pos/team (2FA + "you").
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PermissionDefinition, TeamMemberView, TeamPreviewResult, TeamRoleView, AccessScope } from '@aipowersalon/api-contracts/tenant';
import { posAccessApi, type StaffInviteRequest, type StaffInviteResult } from '../api/posAccessApi';
import { posTeamApi, type TeamUser } from '../api/posTeamApi';
import { posTeamPermissionsApi } from '../api/posTeamPermissionsApi';
import { posStaffRolesApi } from '../api/posStaffRolesApi';
import { useCan } from '../components/usePermissions';
import { useAuth } from '../auth/AuthContext';
import { useRealtime } from '../realtime/useRealtime';
import { reportError } from './reportsCommon';
import { Tabs, SensitivityPill, accessError, fmtWhen, groupByDomain, roleLabel, useDefinitions, useStepUp } from './access/accessUi';
import { t, enPlural } from '@aipowersalon/mobile-sdk/i18n';
import { ImeSafeInput } from '../components/ImeSafeInput';
import { viIncludes } from '@aipowersalon/api-contracts';

import { statusLabel } from '../i18n/status-label';
type Tab = 'team' | 'roles' | 'matrix' | 'ownership';
type PermRow = { key: string; roles: string[] };
type Matrix = { roles: string[]; roleSummaries: { role: string; count: number }[]; totalPermissions: number; groups: { domain: string; permissions: PermRow[] }[] };
const BASE_ROLES = ['MANAGER', 'FRONT_DESK', 'RECEPTION', 'TECHNICIAN', 'OWNER'];
// label tables are functions: they translate when read (a language switch re-labels in place)
const SCOPES = (): [AccessScope, string][] => [['OWN', t('people.team.scope.own')], ['BRANCH', t('pos.one_branch')], ['SELECTED_BRANCHES', t('pos.selected_branches')], ['TENANT', t('pos.every_branch')]];

export function POSTeamPermissionsScreen() {
  const can = useCan();
  const [tab, setTab] = useState<Tab>('team');
  const tabs: { id: Tab; label: string }[] = [
    { id: 'team', label: t('pos.team') }, { id: 'roles', label: t('pos.roles') }, { id: 'matrix', label: t('pos.role_matrix') },
    ...(can('ownership.transfer') ? [{ id: 'ownership' as Tab, label: t('pos.ownership') }] : []),
  ];
  return (
    <div className="work">
      <div className="vh" style={{ marginBottom: 6 }}><h1>{t('pos.roles_permissions')}</h1><div className="sub">{t('pos.who_can_do_what_in_your_10s6')}</div></div>
      <Tabs label={t('pos.roles_and_permissions')} tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'team' && <TeamTab />}
      {tab === 'roles' && <RolesTab />}
      {tab === 'matrix' && <MatrixTab />}
      {tab === 'ownership' && <OwnershipTab />}
    </div>
  );
}

// ── Team: the one roster ───────────────────────────────────────────────────────────────────────────────────────────
function TeamTab() {
  const nav = useNavigate();
  const can = useCan();
  const [members, setMembers] = useState<TeamMemberView[] | null>(null);
  const [extra, setExtra] = useState<Record<string, TeamUser>>({});
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const load = useCallback(async () => {
    try { setMembers(await posAccessApi.members()); setError(null); }
    catch (e: any) { setError(reportError(e, t('people.team.accessNoun'))); setMembers([]); }
    // 2FA and "you" come from the team roster; best-effort — the access roster stands on its own
    posTeamApi.list().then((r) => { const m: Record<string, TeamUser> = {}; for (const u of r?.users ?? []) m[u.id] = u; setExtra(m); }).catch(() => {});
  }, []);
  useEffect(() => { void load(); }, [load]);
  useRealtime('team-permissions', () => load());

  const rows = useMemo(() => {
    const needle = q.trim();   // accent-insensitive (WP-E foldVi)
    return (members ?? []).filter((m) => (!roleFilter || m.role === roleFilter) && (!needle || viIncludes(m.name, needle) || viIncludes(m.email, needle)));
  }, [members, q, roleFilter]);
  const roles = [...new Set((members ?? []).map((m) => m.role))];
  const dormant = (members ?? []).filter((m) => m.dormant).length;
  const withOverrides = (members ?? []).filter((m) => m.overrides.some((o) => o.active)).length;

  if (members === null) return <div className="state">{t('pos.loading_team')}</div>;
  if (error) return <div className="err" role="alert">{error}</div>;
  return (
    <>
      {can('roles.manage') ? <InviteStaff onInvited={load} /> : null}
      <div className="kpis">
        <div className="kpi"><div className="l">{t('pos.team_members')}</div><div className="v">{members.length}</div><div className="d">{members.filter((m) => m.status === 'active').length} {t('pos.active')}</div></div>
        <div className="kpi"><div className="l">{t('pos.owners')}</div><div className="v">{members.filter((m) => m.isOwner).length}</div><div className="d">{t('pos.the_salon_keeps_at_least_one')}</div></div>
        <div className="kpi"><div className="l">{t('pos.individual_grants')}</div><div className="v">{withOverrides}</div><div className="d">{t('pos.people_with_an_override')}</div></div>
        <div className="kpi"><div className="l">{t('pos.dormant')}</div><div className="v">{dormant}</div><div className="d">{t('pos.no_sign_in_for_60_days')}</div></div>
      </div>
      <section className="panel" style={{ padding: 0, marginTop: 12 }} aria-label={t('pos.team_access')}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: 12, borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 800, flex: 1 }}>{t('pos.team')}</div>
          <ImeSafeInput value={q} onValue={setQ} placeholder={t('pos.search_name_or_email')} aria-label={t('pos.search_team')} />
          <select aria-label={t('pos.filter_by_role')} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="">{t('pos.all_roles')}</option>
            {roles.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
          </select>
        </div>
        <div className="w-full overflow-x-auto"><table className="tbl min-w-[760px]">
          <thead><tr><th>{t('pos.person')}</th><th>{t('pos.role_2')}</th><th>{t('pos.branches')}</th><th>{t('pos.grants')}</th><th>2FA</th><th>{t('pos.last_sign_in')}</th><th>{t('pos.status')}</th></tr></thead>
          <tbody>{rows.length === 0 ? <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 20 }}>{members.length === 0 ? t('pos.no_team_members_yet') : t('pos.no_one_matches_your_search')}</td></tr> : rows.map((m) => {
            const live = m.overrides.filter((o) => o.active);
            const x = extra[m.userId];
            return (
              <tr key={m.userId} data-testid="access-member-row" style={{ cursor: 'pointer' }} onClick={() => nav(`/tenant/team/permissions/${encodeURIComponent(m.userId)}`)}>
                <td><div style={{ fontWeight: 700, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <a href={`/tenant/team/permissions/${encodeURIComponent(m.userId)}`} onClick={(e) => { e.preventDefault(); nav(`/tenant/team/permissions/${encodeURIComponent(m.userId)}`); }}>{m.name}</a>
                  {x?.isYou ? <span className="pill">{t('pos.you_2')}</span> : null}
                  {m.isPrimaryOwner ? <span className="pill ok">{t('pos.primary_owner')}</span> : m.isOwner ? <span className="pill ok">{t('pos.owner')}</span> : null}
                </div><div className="muted" style={{ fontSize: 11 }}>{m.email || '—'}</div></td>
                <td>{roleLabel(m.role)}{m.templateName ? <div className="muted" style={{ fontSize: 11 }}>{m.templateName}</div> : null}</td>
                <td>{m.branchAccess.length ? m.branchAccess.map((b) => b.branchName).join(', ') : m.homeBranchId ? t('pos.home_branch') : t('pos.every_branch')}</td>
                <td>{live.length ? t('pos.length_length2_blocked_v2', { length: String(live.length), length2: String(live.filter((o) => o.effect === 'DENY').length), v2: String(live.some((o) => o.temporary) ? t('pos.temporary_2') : '') }) : '—'}</td>
                <td>{x ? (x.mfaEnabled ? '✓' : '—') : ''}</td>
                <td>{fmtWhen(m.lastLoginAt)}</td>
                <td><span className={'pill ' + (m.status === 'active' ? 'ok' : 'mut')}>{roleLabel(m.status)}</span>{m.dormant ? <span className="pill warn" data-testid="dormant-badge" style={{ marginLeft: 4 }}>{t('pos.dormant')}</span> : null}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      </section>
    </>
  );
}

// ── Invite staff (wave 4 pilot): the salon invites its own receptionist / front desk / manager ─────────────────────
const INVITE_ROLES = (): [StaffInviteRequest['role'], string][] => [['RECEPTION', statusLabel('role', 'receptionist')], ['FRONT_DESK', t('pos.front_desk')], ['MANAGER', statusLabel('role', 'manager')]];
function InviteStaff({ onInvited }: { onInvited: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<{ fullName: string; email: string; phone: string; role: StaffInviteRequest['role'] }>({ fullName: '', email: '', phone: '', role: 'RECEPTION' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<StaffInviteResult | null>(null);
  // w4: inviting a MANAGER needs step-up — the API answers 403 STEP_UP_REQUIRED; the same inline prompt as role changes
  // asks for the password (and code), then retries once. Cancelling is not an error.
  const { run, prompt } = useStepUp(t('people.team.inviteStepUp'));
  const submit = async () => {
    setBusy(true); setErr(null); setDone(null);
    try {
      const body = { fullName: f.fullName.trim(), role: f.role, ...(f.email.trim() ? { email: f.email.trim() } : {}), ...(f.phone.trim() ? { phone: f.phone.trim() } : {}) };
      const r = await run(() => posAccessApi.inviteStaff(body));
      setDone(r); onInvited();
    } catch (e: any) { if (e?.code !== 'STEP_UP_CANCELLED') setErr(e?.message || t('pos.the_invitation_could_not_be_created')); }
    finally { setBusy(false); }
  };
  if (!open) return <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}><button type="button" className="btn" onClick={() => setOpen(true)}>{t('pos.invite_staff')}</button></div>;
  return (
    <section className="panel" aria-label={t('pos.invite_staff')} style={{ marginBottom: 12 }}>
      <h2 style={{ margin: '0 0 8px' }}>{t('pos.invite_staff')}</h2>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{t('pos.they_get_an_invitation_to_set_1cvu')}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label>{t('pos.full_name')}<br /><input aria-label={t('pos.full_name')} value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></label>
        <label>{t('pos.email')}<br /><input aria-label={t('pos.email')} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label>{t('pos.phone')}<br /><input aria-label={t('pos.phone')} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
        <label>{t('pos.role_2')}<br /><select aria-label={t('pos.role_2')} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as StaffInviteRequest['role'] })}>
          {INVITE_ROLES().map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select></label>
        <button type="button" className="btn primary" disabled={busy || f.fullName.trim().length < 2 || (!f.email.trim() && !f.phone.trim())} onClick={() => void submit()}>{busy ? t('pos.sending') : t('pos.send_invitation')}</button>
        <button type="button" className="btn" onClick={() => { setOpen(false); setDone(null); setErr(null); }}>{t('pos.close')}</button>
      </div>
      {prompt}
      {err ? <div className="err" role="alert" style={{ marginTop: 8 }}>{err}</div> : null}
      {done ? <div role="status" style={{ marginTop: 8 }}>
        {done.reused ? t('pos.an_invitation_is_already_waiting_for_x8ez') : done.deliveryStatus === 'sent' ? t('pos.invitation_sent') : t('pos.invitation_created_it_could_not_be_12fb')}
        {done.acceptUrl ? <div style={{ marginTop: 4 }}>{t('pos.give_them_this_one_time_link')}{' '}<code style={{ wordBreak: 'break-all' }}>{done.acceptUrl}</code></div> : null}
      </div> : null}
    </section>
  );
}

// ── Roles: templates + the custom-role builder ─────────────────────────────────────────────────────────────────────
function RolesTab() {
  const can = useCan();
  const { principal } = useAuth();
  const { run, prompt } = useStepUp();
  const [roles, setRoles] = useState<TeamRoleView[] | null>(null);
  const [catalog, setCatalog] = useState<PermissionDefinition[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; baseRole: string; scope: AccessScope; permissions: Set<string> } | null>(null);
  const [preview, setPreview] = useState<TeamPreviewResult | null>(null);
  const { def, label } = useDefinitions(catalog);
  const load = useCallback(async () => {
    try { setRoles(await posAccessApi.roles()); setError(null); } catch (e: any) { setError(reportError(e, 'the roles')); setRoles([]); }
    posAccessApi.catalog().then(setCatalog).catch(() => setCatalog([]));
  }, []);
  useEffect(() => { void load(); }, [load]);
  const mine = principal?.permissions;
  // the builder offers what the base role holds AND what the builder holds (the server enforces the same ceiling)
  const offer = useMemo(() => {
    if (!draft || !roles) return [];
    const base = roles.find((r) => !r.custom && r.key === draft.baseRole)?.permissions ?? [];
    const held = (k: string) => !Array.isArray(mine) || mine.includes(k);
    return base.filter((k) => held(k) && !k.startsWith('super_admin.')).map((key) => ({ key }));
  }, [draft, roles, mine]);
  const change = (d: typeof draft) => { setDraft(d); setPreview(null); };
  const doPreview = async () => {
    if (!draft) return; setBusy('preview'); setNote(null);
    try { setPreview(await posAccessApi.preview({ customRole: { baseRole: draft.baseRole, scope: draft.scope, permissions: [...draft.permissions] } })); }
    catch (e: any) { setNote(accessError(e, t('people.team.err.preview'))); }
    finally { setBusy(null); }
  };
  const create = async () => {
    if (!draft || !preview) return; setBusy('create'); setNote(null);
    try { await run(() => posStaffRolesApi.createRole({ name: draft.name.trim(), baseRole: draft.baseRole, scope: draft.scope, permissions: [...draft.permissions] })); setDraft(null); setPreview(null); setNote(t('pos.role_created')); await load(); }
    catch (e: any) { setNote(accessError(e, t('people.team.err.create'))); }
    finally { setBusy(null); }
  };
  const archive = async (r: TeamRoleView) => {
    setBusy(r.key); setNote(null);
    try { await run(() => posStaffRolesApi.archiveRole(r.key.replace(/^custom:/, ''))); setNote(t('pos.name_archived', { name: String(r.name) })); await load(); }
    catch (e: any) { setNote(accessError(e, t('people.team.err.archive'))); }
    finally { setBusy(null); }
  };
  if (roles === null) return <div className="state">{t('pos.loading_roles')}</div>;
  if (error) return <div className="err" role="alert">{error}</div>;
  return (
    <>
      {prompt}
      <section className="panel" aria-label={t('pos.role_templates')}>
        <h2 style={{ margin: '0 0 6px' }}>{t('pos.roles')}</h2>
        <div className="w-full overflow-x-auto"><table className="tbl min-w-[640px]">
          <thead><tr><th>{t('pos.role_2')}</th><th>{t('pos.built_on')}</th><th>{t('pos.reach')}</th><th>{t('pos.permissions_2')}</th><th>{t('pos.people')}</th><th /></tr></thead>
          <tbody>{roles.map((r) => (
            <tr key={r.key} data-testid="role-row">
              <td><div style={{ fontWeight: 700 }}>{r.name}{r.custom ? <span className="pill" style={{ marginLeft: 6 }}>{t('pos.custom_2')}</span> : null}</div>{r.description ? <div className="muted" style={{ fontSize: 11 }}>{r.description}</div> : null}</td>
              <td>{roleLabel(r.baseRole)}</td><td>{SCOPES().find(([v]) => v === r.scope)?.[1] ?? r.scope}</td><td>{r.permissions.length}</td><td>{r.memberCount}</td>
              <td>{r.custom && can('roles.manage') ? <button className="btn ghost" disabled={busy === r.key} onClick={() => void archive(r)}>{t('pos.archive')}</button> : null}</td>
            </tr>
          ))}</tbody>
        </table></div>
        {can('roles.manage') && !draft && <button className="btn" style={{ marginTop: 8 }} onClick={() => change({ name: '', baseRole: 'FRONT_DESK', scope: 'BRANCH', permissions: new Set(['pos.login']) })}>{t('pos.new_custom_role')}</button>}
        {note && <div className="sub" role="status" style={{ marginTop: 8 }}>{note}</div>}
      </section>
      {draft && (
        <section className="panel" aria-label={t('pos.new_role')} style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 style={{ margin: 0 }}>{t('pos.new_custom_role')}</h2>
          <input placeholder={t('pos.role_name_e_g_front_desk_3jjf')} aria-label={t('pos.role_name')} value={draft.name} onChange={(e) => change({ ...draft, name: e.target.value })} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select aria-label={t('pos.built_on')} value={draft.baseRole} onChange={(e) => change({ ...draft, baseRole: e.target.value, permissions: new Set(['pos.login']) })}>
              {BASE_ROLES.map((b) => <option key={b} value={b}>{roleLabel(b)}</option>)}
            </select>
            <select aria-label={t('pos.reach')} value={draft.scope} onChange={(e) => change({ ...draft, scope: e.target.value as AccessScope })}>
              {SCOPES().map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="sub" style={{ fontSize: 12 }}>{t('pos.only_permissions_the_base_role_has_1gqb')}</div>
          <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8, padding: 8 }}>
            {offer.length === 0 ? <div className="muted">{t('pos.nothing_to_choose_from_for_this_136i')}</div> : groupByDomain(offer, def).map((g) => (
              <fieldset key={g.domain} style={{ border: 'none', margin: '0 0 8px', padding: 0 }}>
                <legend style={{ fontWeight: 800, fontSize: 12, textTransform: 'capitalize' }}>{statusLabel('permissionDomain', g.domain)}</legend>
                {g.items.map(({ key }) => { const d = def(key); return (
                  <label key={key} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 12.5, padding: '2px 0' }}>
                    <input type="checkbox" aria-label={label(key)} checked={draft.permissions.has(key)} onChange={(e) => { const n = new Set(draft.permissions); if (e.target.checked) n.add(key); else n.delete(key); change({ ...draft, permissions: n }); }} />
                    <span><span style={{ fontWeight: 600 }}>{label(key)}</span> <SensitivityPill s={d?.sensitivity} />{d?.stepUp ? <span className="muted" style={{ fontSize: 10.5 }}> {t('pos.needs_password_confirmation')}</span> : null}
                      {d?.description ? <div className="muted" style={{ fontSize: 11 }}>{d.description}</div> : null}</span>
                  </label>
                ); })}
              </fieldset>
            ))}
          </div>
          {preview && (
            <div data-testid="role-preview" style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 8, fontSize: 12.5 }}>
              <div style={{ fontWeight: 700 }}>{t('pos.this_role_would_grant')}{' '}{preview.granted.length} {t('pos.permission')}{enPlural(preview.granted.length === 1 ? '' : 's')}.</div>
              {preview.highRisk.length > 0 && <div style={{ color: '#a32626' }}>{t('pos.high_risk_2')}{' '}{preview.highRisk.map(label).join(', ')}</div>}
              {preview.removed.length > 0 && <div className="muted">{t('pos.not_included_from_the_base_role')}{' '}{preview.removed.length}</div>}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" disabled={busy === 'preview'} onClick={() => void doPreview()}>{t('pos.preview')}</button>
            <button className="btn primary" disabled={!preview || busy === 'create' || draft.name.trim().length < 2} onClick={() => void create()}>{t('pos.create_role')}</button>
            <button className="btn ghost" onClick={() => { setDraft(null); setPreview(null); }}>{t('pos.cancel')}</button>
          </div>
        </section>
      )}
    </>
  );
}

// ── Role matrix (reference) ────────────────────────────────────────────────────────────────────────────────────────
function MatrixTab() {
  const [s, setS] = useState<Matrix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  useEffect(() => { posTeamPermissionsApi.state().then((x) => setS(x as Matrix)).catch((e) => setError(reportError(e, 'the permission matrix'))); }, []);
  if (error) return <div className="err" role="alert">{error}</div>;
  if (!s) return <div className="state">{t('pos.loading_permissions')}</div>;
  const permLabel = (k: string) => k.split('.').slice(1).join(' · ').replace(/_/g, ' ') || k;
  return (
    <>
      <div className="kpis">{s.roleSummaries.map((r) => <div className="kpi" key={r.role}><div className="l">{roleLabel(r.role)}</div><div className="v">{r.count}</div><div className="d">{t('pos.of')}{' '}{s.totalPermissions}</div></div>)}</div>
      {s.groups.map((g) => (
        <section className="panel" key={g.domain} style={{ padding: 0, overflow: 'hidden', marginTop: 10 }}>
          <button onClick={() => setOpen((o) => ({ ...o, [g.domain]: !o[g.domain] }))} style={{ display: 'flex', justifyContent: 'space-between', width: '100%', padding: '12px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
            <span style={{ fontWeight: 700 }}>{roleLabel(g.domain)} <span className="muted" style={{ fontWeight: 400 }}>· {g.permissions.length}</span></span><span className="muted">{open[g.domain] ? '▾' : '▸'}</span>
          </button>
          {open[g.domain] ? (
            <div className="w-full overflow-x-auto"><table className="tbl min-w-[700px]">
              <thead><tr><th>{t('pos.permission_2')}</th>{s.roles.map((r) => <th key={r} style={{ textAlign: 'center', fontSize: 11 }}>{roleLabel(r)}</th>)}</tr></thead>
              <tbody>{g.permissions.map((p) => <tr key={p.key}><td style={{ fontWeight: 600 }}>{permLabel(p.key)}</td>{s.roles.map((r) => <td key={r} style={{ textAlign: 'center', fontWeight: 700, color: p.roles.includes(r) ? '#2E9E54' : 'var(--line)' }}>{p.roles.includes(r) ? '✓' : '·'}</td>)}</tr>)}</tbody>
            </table></div>
          ) : null}
        </section>
      ))}
    </>
  );
}

// ── Ownership transfer (owners) ────────────────────────────────────────────────────────────────────────────────────
function OwnershipTab() {
  const { principal } = useAuth();
  const { run, prompt } = useStepUp();
  const [members, setMembers] = useState<TeamMemberView[] | null>(null);
  const [roles, setRoles] = useState<TeamRoleView[]>([]);
  const [to, setTo] = useState('');
  const [keepAs, setKeepAs] = useState('');
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(() => {
    posAccessApi.members().then(setMembers).catch((e) => { setMembers([]); setNote(reportError(e, 'the team')); });
    posAccessApi.roles().then(setRoles).catch(() => setRoles([]));
  }, []);
  useEffect(() => { load(); }, [load]);
  if (members === null) return <div className="state">{t('pos.loading')}</div>;
  const owner = members.find((m) => m.isPrimaryOwner) ?? null;
  const candidates = members.filter((m) => m.status === 'active' && !m.isPrimaryOwner && m.userId !== principal?.userId);
  const target = members.find((m) => m.userId === to) ?? null;
  const transfer = async () => {
    setBusy(true); setNote(null);
    try {
      const r = await run(() => posAccessApi.transferOwnership({ toUserId: to, reason: reason.trim(), keepPreviousOwnerAs: keepAs || null }));
      setNote(t('pos.ownership_transferred_to_v0', { v0: String(target?.name ?? t('pos.the_new_owner')) })); setConfirming(false); setTo(''); setReason('');
      void r; load();
    } catch (e: any) { setNote(accessError(e, t('people.team.err.transfer'))); setConfirming(false); }
    finally { setBusy(false); }
  };
  return (
    <section className="panel" aria-label={t('pos.ownership_transfer')} style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 560 }}>
      {prompt}
      <h2 style={{ margin: 0 }}>{t('pos.salon_ownership')}</h2>
      <div className="sub">{t('pos.current_primary_owner')}{' '}<strong>{owner?.name ?? '—'}</strong>{t('pos.transferring_makes_the_person_you_choose_nujj')}</div>
      <select aria-label={t('pos.new_owner')} value={to} onChange={(e) => { setTo(e.target.value); setConfirming(false); }}>
        <option value="">{t('pos.choose_a_team_member')}</option>
        {candidates.map((m) => <option key={m.userId} value={m.userId}>{m.name} — {roleLabel(m.role)}</option>)}
      </select>
      <select aria-label={t('pos.your_role_afterwards')} value={keepAs} onChange={(e) => setKeepAs(e.target.value)}>
        <option value="">{t('pos.stay_an_owner_co_owner')}</option>
        {roles.filter((r) => !r.custom && r.baseRole !== 'OWNER').map((r) => <option key={r.key} value={r.key}>{t('pos.become')}{' '}{r.name}</option>)}
      </select>
      <input aria-label={t('pos.reason_for_the_transfer')} placeholder={t('pos.reason_kept_in_the_audit')} value={reason} onChange={(e) => setReason(e.target.value)} />
      {!confirming
        ? <button className="btn" disabled={!to || reason.trim().length < 3} onClick={() => setConfirming(true)}>{t('pos.transfer_ownership')}</button>
        : <div role="group" aria-label={t('pos.confirm_transfer')} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>{t('pos.make')}{' '}<strong>{target?.name}</strong> {t('pos.the_salon_s_owner')}</span>
            <button className="btn primary" disabled={busy} onClick={() => void transfer()}>{t('pos.yes_transfer')}</button>
            <button className="btn ghost" disabled={busy} onClick={() => setConfirming(false)}>{t('pos.cancel')}</button>
          </div>}
      {note && <div className="sub" role="status">{note}</div>}
    </section>
  );
}
