// POSMemberAccessScreen.tsx — /tenant/team/permissions/:userId — one person's access (BUILD_PLAN Phase 9, Constitution 2).
//   • Role: pick a template (only those built on the person's base role), PREVIEW what changes (added / removed / high-risk),
//     then save with a reason — step-up; the server refuses self-assignment and anything above the actor's own ceiling.
//   • Effective permissions: every key they hold and WHY (role, template, individual grant, temporary until …), and the
//     keys blocked for them with the reason code.
//   • Branch access: which branches they may enter, and at what level (none = their home branch only).
//   • Individual grants: ALLOW / DENY one permission, optionally for one branch, optionally TEMPORARY (expires) — preview
//     first; revoke with a reason. A DENY always beats the role.
//   • Audit: every authorization change to this person (who, what, before → after, why).
// Routes: /pos/access/members/:id(+/effective, /role, /branches, /overrides), /pos/access/overrides/:id/revoke,
// /pos/access/preview, /pos/access/audit, /pos/access/roles, /pos/access/catalog; branches from /tenant/locations.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type {
  AuthzAuditEventView, PermissionDefinition, TeamEffectivePermissions, TeamMemberView, TeamOverrideRequest, TeamOverrideView,
  TeamPreviewResult, TeamRoleView,
} from '@aipowersalon/api-contracts/tenant';
import { posAccessApi, OVERRIDE_BRANCH_FIELD } from '../../api/posAccessApi';
import { posLocationsApi } from '../../api/posLocationsApi';
import { useCan } from '../../components/usePermissions';
import { useAuth } from '../../auth/AuthContext';
import { useRealtime } from '../../realtime/useRealtime';
import { reportError } from '../reportsCommon';
import { SensitivityPill, accessError, fmtWhen, groupByDomain, reasonLabel, roleLabel, useDefinitions, useStepUp } from './accessUi';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { viIncludes } from '@aipowersalon/api-contracts';
import { ImeSafeInput } from '../../components/ImeSafeInput';

import { statusLabel } from '../../i18n/status-label';
type Level = 'manager' | 'staff' | 'viewer' | 'report_only';
const LEVELS = (): [Level, string][] => [['manager', t('status.role.manager')], ['staff', t('pos.staff')], ['viewer', t('admin.access.level.viewer')], ['report_only', t('admin.access.level.reportOnly')]];

export function POSMemberAccessScreen() {
  const { userId = '' } = useParams();
  const nav = useNavigate();
  const can = useCan();
  const { principal } = useAuth();
  const { run, prompt } = useStepUp();
  const [m, setM] = useState<TeamMemberView | null>(null);
  const [eff, setEff] = useState<TeamEffectivePermissions | null>(null);
  const [roles, setRoles] = useState<TeamRoleView[]>([]);
  const [catalog, setCatalog] = useState<PermissionDefinition[] | null>(null);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  const { def, label } = useDefinitions(catalog);
  const self = !!principal?.userId && principal.userId === userId;

  const load = useCallback(async () => {
    try {
      const [mm, ee] = await Promise.all([posAccessApi.member(userId), posAccessApi.effective(userId)]);
      setM(mm); setEff(ee); setError(null); setRev((n) => n + 1);
    } catch (e: any) { setError(reportError(e, t('admin.access.noun.personAccess'))); }
  }, [userId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    posAccessApi.roles().then(setRoles).catch(() => setRoles([]));
    posAccessApi.catalog().then(setCatalog).catch(() => setCatalog([]));
    posLocationsApi.list().then((d) => setBranches((d?.locations ?? []).map((l: any) => ({ id: String(l.id), name: String(l.name ?? t('pos.branch')) })))).catch(() => setBranches([]));
  }, []);
  useRealtime('team-permissions', () => load());

  if (error) return <div className="work"><div className="err" role="alert" style={{ marginTop: 12 }}>{error}</div><button className="btn ghost" onClick={() => nav('/tenant/team/permissions')}>{t('pos.back_to_the_team')}</button></div>;
  if (!m || !eff) return <div className="work"><div className="state">{t('pos.loading_access')}</div></div>;
  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {prompt}
      <div className="vh flex flex-col md:flex-row items-start md:items-end justify-between gap-3">
        <div>
          <h1>{m.name}</h1>
          <div className="sub">{m.email || '—'} · {roleLabel(m.role)}{m.templateName ? ` · ${m.templateName}` : ''} {t('pos.last_sign_in_2')}{' '}{fmtWhen(m.lastLoginAt)}
            {m.isPrimaryOwner ? <span className="pill ok" style={{ marginLeft: 6 }}>{t('pos.primary_owner')}</span> : m.isOwner ? <span className="pill ok" style={{ marginLeft: 6 }}>{t('pos.owner')}</span> : null}
            <span className={'pill ' + (m.status === 'active' ? 'ok' : 'mut')} style={{ marginLeft: 6 }}>{roleLabel(m.status)}</span>
            {m.dormant ? <span className="pill warn" data-testid="dormant-badge" style={{ marginLeft: 6 }}>{t('pos.dormant')}</span> : null}
          </div>
        </div>
        <button className="btn ghost" onClick={() => nav('/tenant/team/permissions')}>{t('pos.back_to_the_team')}</button>
      </div>
      {self && <div className="sub" role="note" data-testid="self-note">{t('pos.this_is_you_nobody_can_change_vi4u')}</div>}
      <RoleSection m={m} roles={roles} disabled={self || !can('roles.manage')} run={run} label={label} onSaved={load} />
      <EffectiveSection eff={eff} def={def} label={label} />
      <BranchSection m={m} branches={branches} disabled={self || !can('branch_access.manage')} run={run} onSaved={load} />
      <OverrideSection m={m} catalog={catalog ?? []} branches={branches} disabled={self || !can('permissions.override')} run={run} def={def} label={label} onSaved={load} held={principal?.permissions} />
      {!self && m.role !== 'TECHNICIAN' && m.status === 'active' && can('roles.manage') && <EndEmploymentSection m={m} run={run} onEnded={load} />}
      <AuditSection userId={userId} rev={rev} />
    </div>
  );
}

type Run = <T>(a: () => Promise<T>) => Promise<T>;

function PreviewBox({ p, label }: { p: TeamPreviewResult; label: (k: string) => string }) {
  return (
    <div data-testid="access-preview" style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 8, fontSize: 12.5 }}>
      <div><strong>{p.added.length}</strong> {t('pos.added_2')}{' '}<strong>{p.removed.length}</strong> {t('pos.removed')}{' '}{p.granted.length} {t('pos.in_total')}</div>
      {p.added.length > 0 && <div>{t('pos.adds')}{' '}{p.added.map(label).join(', ')}</div>}
      {p.removed.length > 0 && <div>{t('pos.removes')}{' '}{p.removed.map(label).join(', ')}</div>}
      {p.highRisk.length > 0 && <div style={{ color: '#a32626' }}>{t('pos.high_risk_2')}{' '}{p.highRisk.map(label).join(', ')}</div>}
    </div>
  );
}

function RoleSection({ m, roles, disabled, run, label, onSaved }: { m: TeamMemberView; roles: TeamRoleView[]; disabled: boolean; run: Run; label: (k: string) => string; onSaved: () => unknown }) {
  const [templateKey, setTemplateKey] = useState<string>(m.templateKey ?? '');
  useEffect(() => { setTemplateKey(m.templateKey ?? ''); }, [m.templateKey]);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<TeamPreviewResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // every role, grouped by its base role: a role on ANOTHER base role promotes / demotes the person (the server checks the
  // ceiling, self-assignment and that the salon keeps an owner)
  const bases = [...new Set(roles.map((r) => r.baseRole))].sort((a, b) => (a === m.role ? -1 : b === m.role ? 1 : a.localeCompare(b)));
  const changed = (templateKey || null) !== (m.templateKey ?? null);
  const doPreview = async () => {
    setBusy(true); setNote(null);
    try { setPreview(await posAccessApi.preview({ userId: m.userId, templateKey: templateKey || null })); } catch (e: any) { setNote(accessError(e, t('admin.access.error.preview'))); }
    finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true); setNote(null);
    try { await run(() => posAccessApi.assignRole(m.userId, { templateKey: templateKey || null, reason: reason.trim() })); setNote(t('pos.role_saved_it_applies_to_their_1r47')); setPreview(null); setReason(''); await onSaved(); }
    catch (e: any) { setNote(accessError(e, t('admin.access.error.changeRole'))); }
    finally { setBusy(false); }
  };
  return (
    <section className="panel" aria-label={t('pos.role_2')} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h2 style={{ margin: 0 }}>{t('pos.role_2')}</h2>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select aria-label={t('pos.role_template')} value={templateKey} disabled={disabled} onChange={(e) => { setTemplateKey(e.target.value); setPreview(null); }}>
          <option value="">{t('pos.default_3')}{roleLabel(m.role)})</option>
          {bases.map((b) => (
            <optgroup key={b} label={b === m.role ? t('pos.b_roles', { b: String(roleLabel(b)) }) : t('pos.b_roles_changes_their_base_role', { b: String(roleLabel(b)) })}>
              {roles.filter((r) => r.baseRole === b).map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
            </optgroup>
          ))}
        </select>
        <input aria-label={t('pos.reason_for_the_role_change')} placeholder={t('pos.reason_kept_in_the_audit')} value={reason} disabled={disabled} onChange={(e) => setReason(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
      </div>
      {preview && <PreviewBox p={preview} label={label} />}
      {!disabled && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" disabled={!changed || busy} onClick={() => void doPreview()}>{t('pos.preview_change')}</button>
          <button className="btn primary" disabled={!changed || !preview || busy || reason.trim().length < 3} onClick={() => void save()}>{t('pos.save_role')}</button>
        </div>
      )}
      {note && <div className="sub" role="status">{note}</div>}
    </section>
  );
}

function EffectiveSection({ eff, def, label }: { eff: TeamEffectivePermissions; def: (k: string) => PermissionDefinition | null; label: (k: string) => string }) {
  const [q, setQ] = useState('');
  const needle = q.trim();
  const granted = eff.permissions.filter((p) => !needle || p.key.includes(needle.toLowerCase()) || viIncludes(label(p.key), needle));
  return (
    <section className="panel" aria-label={t('pos.effective_permissions')}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, flex: 1 }}>{t('pos.what_they_can_do')}{' '}<span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· {eff.permissions.length} {t('pos.permissions_3')}{' '}{eff.branchIds === null ? t('pos.every_branch_2') : t('pos.length_branch_plural', { length: String(eff.branchIds.length), plural: String(eff.branchIds.length === 1 ? '' : 'es') })}</span></h2>
        <ImeSafeInput aria-label={t('pos.search_permissions')} placeholder={t('pos.search_2')} value={q} onValue={setQ} />
      </div>
      {groupByDomain(granted, def).map((g) => (
        <div key={g.domain} style={{ marginTop: 8 }}>
          <div style={{ fontWeight: 800, fontSize: 12, textTransform: 'capitalize' }}>{statusLabel('permissionDomain', g.domain)}</div>
          {g.items.map((p) => (
            <div key={p.key} data-testid="effective-row" style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, padding: '2px 0', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600 }}>{label(p.key)}</span><SensitivityPill s={def(p.key)?.sensitivity} />
              <span className="muted" data-testid={`reason-${p.key}`}>{reasonLabel(p.reason)}{p.expiresAt ? t('pos.until_expiresat', { expiresAt: String(fmtWhen(p.expiresAt)) }) : ''}</span>
            </div>
          ))}
        </div>
      ))}
      {eff.denied.length > 0 && (
        <div style={{ marginTop: 10 }} aria-label={t('pos.blocked_permissions')}>
          <div style={{ fontWeight: 800, fontSize: 12 }}>{t('pos.blocked_2')}</div>
          {eff.denied.map((d) => <div key={d.key} data-testid="denied-row" style={{ fontSize: 12.5 }}><span style={{ fontWeight: 600 }}>{label(d.key)}</span> <span className="muted">— {reasonLabel(d.reason)}</span></div>)}
        </div>
      )}
    </section>
  );
}

function BranchSection({ m, branches, disabled, run, onSaved }: { m: TeamMemberView; branches: { id: string; name: string }[]; disabled: boolean; run: Run; onSaved: () => unknown }) {
  const [sel, setSel] = useState<Set<string>>(new Set(m.branchAccess.map((b) => b.branchId)));
  const first = m.branchAccess.find((b) => b.accessLevel !== 'owner')?.accessLevel as Level | undefined;
  const [level, setLevel] = useState<Level>(first ?? 'staff');
  useEffect(() => { setSel(new Set(m.branchAccess.map((b) => b.branchId))); }, [m.branchAccess]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const names = new Map([...branches.map((b) => [b.id, b.name] as const), ...m.branchAccess.map((b) => [b.branchId, b.branchName] as const)]);
  const all = [...names.keys()];
  const save = async () => {
    setBusy(true); setNote(null);
    try { await run(() => posAccessApi.setBranches(m.userId, { branchIds: [...sel], accessLevel: level, reason: reason.trim() })); setNote(t('pos.branch_access_saved')); setReason(''); await onSaved(); }
    catch (e: any) { setNote(accessError(e, t('admin.access.error.saveBranches'))); }
    finally { setBusy(false); }
  };
  return (
    <section className="panel" aria-label={t('pos.branch_access_2')} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h2 style={{ margin: 0 }}>{t('pos.branch_access_2')}</h2>
      <div className="sub" style={{ fontSize: 12 }}>{m.branchAccess.length === 0 ? (m.homeBranchId ? t('pos.no_extra_branches_they_work_at_1q37', { v0: String(names.get(m.homeBranchId) ?? t('pos.home_branch_2')) }) : t('pos.no_branch_set_today_they_may_1hn2')) : t('pos.granted_v0', { v0: String(m.branchAccess.map((b) => `${b.branchName} (${roleLabel(b.accessLevel)})`).join(', ')) })}</div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {all.map((id) => (
          <label key={id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5 }}>
            <input type="checkbox" aria-label={t('pos.branch_id', { id: String(names.get(id)) })} disabled={disabled} checked={sel.has(id)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(id); else n.delete(id); setSel(n); }} />{names.get(id)}
          </label>
        ))}
      </div>
      {!disabled && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select aria-label={t('pos.access_level')} value={level} onChange={(e) => setLevel(e.target.value as Level)}>{LEVELS().map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <input aria-label={t('pos.reason_for_the_branch_change')} placeholder={t('pos.reason_kept_in_the_audit')} value={reason} onChange={(e) => setReason(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
          <button className="btn primary" disabled={busy || reason.trim().length < 3} onClick={() => void save()}>{t('pos.save_branches')}</button>
        </div>
      )}
      {note && <div className="sub" role="status">{note}</div>}
    </section>
  );
}

function OverrideSection({ m, catalog, branches, disabled, run, def, label, onSaved, held }: {
  m: TeamMemberView; catalog: PermissionDefinition[]; branches: { id: string; name: string }[]; disabled: boolean; run: Run;
  def: (k: string) => PermissionDefinition | null; label: (k: string) => string; onSaved: () => unknown; held: string[] | undefined;
}) {
  const [effect, setEffect] = useState<'ALLOW' | 'DENY'>('ALLOW');
  const [permission, setPermission] = useState('');
  const [branchId, setBranchId] = useState('');
  const [temporary, setTemporary] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<TeamPreviewResult | null>(null);
  const [revoking, setRevoking] = useState<{ id: string; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // an ALLOW can only hand out what the granter holds (the server's ceiling); never a platform key
  const choices = useMemo(() => catalog.filter((d) => d.realm !== 'platform' && !d.key.startsWith('super_admin.') && (effect === 'DENY' || !Array.isArray(held) || held.includes(d.key))).map((d) => ({ key: d.key })), [catalog, effect, held]);
  const live = m.overrides.filter((o) => o.active);
  const past = m.overrides.filter((o) => !o.active);
  const req = (): TeamOverrideRequest => ({ permission, effect, scopeBranchId: branchId || null, reason: reason.trim(), expiresAt: temporary && expiresAt ? new Date(expiresAt).toISOString() : null });
  const reset = () => { setPreview(null); };
  const doPreview = async () => {
    setBusy(true); setNote(null);
    try { setPreview(await posAccessApi.preview({ userId: m.userId, overrides: [req()] })); } catch (e: any) { setNote(accessError(e, t('admin.access.error.preview'))); }
    finally { setBusy(false); }
  };
  const grant = async () => {
    setBusy(true); setNote(null);
    try { await run(() => posAccessApi.grantOverride(m.userId, req())); setNote(effect === 'DENY' ? t('admin.access.grant.blocked') : temporary ? t('pos.temporary_access_granted') : t('admin.access.grant.granted')); setPermission(''); setReason(''); setExpiresAt(''); setTemporary(false); setPreview(null); await onSaved(); }
    catch (e: any) { setNote(accessError(e, t('admin.access.error.saveGrant'))); }
    finally { setBusy(false); }
  };
  const revoke = async () => {
    if (!revoking) return; setBusy(true); setNote(null);
    try { await run(() => posAccessApi.revokeOverride(revoking.id, { reason: revoking.reason.trim() })); setRevoking(null); setNote(t('pos.revoked_2')); await onSaved(); }
    catch (e: any) { setNote(accessError(e, t('admin.access.error.revoke'))); }
    finally { setBusy(false); }
  };
  const row = (o: TeamOverrideView) => (
    <tr key={o.id} data-testid="override-row">
      <td style={{ fontWeight: 600 }}>{label(o.permission)} <SensitivityPill s={def(o.permission)?.sensitivity} /></td>
      <td><span className={'pill ' + (o.effect === 'DENY' ? 'bad' : 'ok')}>{o.effect === 'DENY' ? t('pos.blocked_2') : t('pos.allowed')}</span></td>
      <td>{o.branchId ? (branches.find((b) => b.id === o.branchId)?.name ?? t('pos.one_branch')) : t('pos.all_their_branches')}</td>
      <td>{o.temporary ? t('pos.until_expiresat_2', { expiresAt: String(fmtWhen(o.expiresAt)) }) : t('pos.until_revoked')}</td>
      <td>{o.reason}<div className="muted" style={{ fontSize: 11 }}>{o.grantedByName ?? '—'} · {fmtWhen(o.startsAt)}</div></td>
      <td>{o.active && !disabled ? (revoking?.id === o.id
        ? <span style={{ display: 'flex', gap: 4 }}><input aria-label={t('pos.reason_for_revoking')} placeholder={t('pos.reason_2')} value={revoking.reason} onChange={(e) => setRevoking({ id: o.id, reason: e.target.value })} /><button className="btn" disabled={busy || revoking.reason.trim().length < 3} onClick={() => void revoke()}>{t('pos.revoke')}</button><button className="btn ghost" onClick={() => setRevoking(null)}>{t('pos.cancel')}</button></span>
        : <button className="btn ghost" onClick={() => setRevoking({ id: o.id, reason: '' })}>{t('pos.revoke_2')}</button>) : null}</td>
    </tr>
  );
  return (
    <section className="panel" aria-label={t('pos.individual_grants')} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h2 style={{ margin: 0 }}>{t('pos.individual_grants')}</h2>
      <div className="sub" style={{ fontSize: 12 }}>{t('pos.allow_or_block_one_permission_for_1vwq')}</div>
      {live.length === 0 ? <div className="muted">{t('pos.no_individual_grants')}</div> : (
        <div className="w-full overflow-x-auto"><table className="tbl min-w-[640px]"><thead><tr><th>{t('pos.permission_2')}</th><th>{t('pos.effect')}</th><th>{t('pos.where')}</th><th>{t('pos.how_long')}</th><th>{t('pos.why')}</th><th /></tr></thead><tbody>{live.map(row)}</tbody></table></div>
      )}
      {past.length > 0 && <details><summary className="muted">{t('pos.ended_or_revoked')}{past.length})</summary><table className="tbl"><tbody>{past.map(row)}</tbody></table></details>}
      {!disabled && (
        <div aria-label={t('pos.new_grant')} role="group" style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select aria-label={t('pos.allow_or_block')} value={effect} onChange={(e) => { setEffect(e.target.value as 'ALLOW' | 'DENY'); setPermission(''); reset(); }}>
              <option value="ALLOW">{t('pos.allow')}</option><option value="DENY">{t('pos.block')}</option>
            </select>
            <select aria-label={t('pos.permission_2')} value={permission} onChange={(e) => { setPermission(e.target.value); reset(); }} style={{ minWidth: 220 }}>
              <option value="">{t('pos.choose_a_permission')}</option>
              {groupByDomain(choices, def).map((g) => (
                <optgroup key={g.domain} label={statusLabel('permissionDomain', g.domain)}>{g.items.map(({ key }) => <option key={key} value={key}>{label(key)}{def(key)?.sensitivity === 'high' || def(key)?.sensitivity === 'critical' ? ` (${def(key)!.sensitivity})` : ''}</option>)}</optgroup>
              ))}
            </select>
            {OVERRIDE_BRANCH_FIELD ? (
              <select aria-label={t('pos.grant_branch')} value={branchId} onChange={(e) => { setBranchId(e.target.value); reset(); }}>
                <option value="">{t('pos.all_their_branches')}</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            ) : <span className="muted" style={{ fontSize: 11.5, alignSelf: 'center' }}>{t('pos.applies_in_every_branch_they_may_isln')}</span>}
          </div>
          {permission && def(permission)?.description ? <div className="muted" style={{ fontSize: 11.5 }}>{def(permission)!.description}</div> : null}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5 }}><input type="checkbox" aria-label={t('pos.temporary')} checked={temporary} onChange={(e) => { setTemporary(e.target.checked); reset(); }} />{t('pos.temporary')}</label>
            {temporary && <input type="datetime-local" aria-label={t('pos.expires_at')} value={expiresAt} onChange={(e) => { setExpiresAt(e.target.value); reset(); }} />}
            <input aria-label={t('pos.reason_for_the_grant')} placeholder={t('pos.reason_kept_in_the_audit')} value={reason} onChange={(e) => setReason(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
          </div>
          {preview && <PreviewBox p={preview} label={label} />}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" disabled={!permission || busy || (temporary && !expiresAt)} onClick={() => void doPreview()}>{t('pos.preview')}</button>
            <button className="btn primary" disabled={!permission || !preview || busy || reason.trim().length < 3 || (temporary && !expiresAt)} onClick={() => void grant()}>{effect === 'DENY' ? t('pos.block') : t('pos.grant')}</button>
          </div>
        </div>
      )}
      {note && <div className="sub" role="status">{note}</div>}
    </section>
  );
}

function AuditSection({ userId, rev }: { userId: string; rev: number }) {
  const [items, setItems] = useState<AuthzAuditEventView[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchPage = useCallback(async (p: number) => {
    try { const r = await posAccessApi.audit({ userId, page: p, pageSize: 20 }); setItems((prev) => (p === 1 ? r.items : [...prev, ...r.items])); setHasMore(r.hasMore); setPage(p); setError(null); }
    catch (e: any) { setError(reportError(e, t('admin.access.noun.history'))); }
  }, [userId]);
  useEffect(() => { void fetchPage(1); }, [fetchPage, rev]);
  const summary = (v: unknown) => (v == null ? '—' : typeof v === 'string' ? v : JSON.stringify(v).slice(0, 120));
  return (
    <section className="panel" aria-label={t('pos.access_history')}>
      <h2 style={{ margin: '0 0 6px' }}>{t('pos.access_history')}</h2>
      {error ? <div className="err">{error}</div> : items.length === 0 ? <div className="muted">{t('pos.no_changes_recorded_yet')}</div> : (
        <div className="w-full overflow-x-auto"><table className="tbl min-w-[640px]">
          <thead><tr><th>{t('pos.when')}</th><th>{t('pos.change')}</th><th>{t('pos.by_2')}</th><th>{t('pos.before_after')}</th><th>{t('pos.why')}</th></tr></thead>
          <tbody>{items.map((a) => (
            <tr key={a.id} data-testid="audit-row"><td>{fmtWhen(a.createdAt)}</td><td>{a.action.replace(/[._]/g, ' ')}</td><td>{a.actorName ?? '—'}</td><td className="muted" style={{ fontSize: 11 }}>{summary(a.before)} → {summary(a.after)}</td><td>{a.reason ?? '—'}</td></tr>
          ))}</tbody>
        </table></div>
      )}
      {hasMore && <button className="btn ghost" style={{ marginTop: 6 }} onClick={() => void fetchPage(page + 1)}>{t('pos.load_more')}</button>}
    </section>
  );
}

/** B-13 (Oct 20 2026): end a non-technician staff member's employment. One action, one transaction on the server: the login
 *  becomes inactive, every session is signed out, branch grants and the role assignment are removed, the reason is audited.
 *  Technicians have their own action on the profile (it also removes the roster row and the Clock PIN), so this is not shown
 *  for them; never for yourself; owners only by an owner and never the last one (the server says LAST_OWNER). */
function EndEmploymentSection({ m, run, onEnded }: { m: TeamMemberView; run: <T>(fn: () => Promise<T>) => Promise<T>; onEnded: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const end = async () => {
    setBusy(true); setNote(null);
    try {
      const r = await run(() => posAccessApi.endEmployment(m.userId, { reason: reason.trim() }));
      setNote(t('admin.access.employmentEnded', { sessions: String(r.sessionsRevoked), grants: String(r.branchGrantsRemoved) }));
      setOpen(false); setReason(''); await onEnded();
    } catch (e: any) { setNote(accessError(e, t('admin.access.error.endEmployment'))); }
    finally { setBusy(false); }
  };
  return (
    <section className="panel" aria-label={t('pos.end_employment')} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h2 style={{ margin: 0 }}>{t('pos.end_employment')}</h2>
      <div className="sub">{t('pos.signs')}{' '}{m.name} {t('pos.out_everywhere_removes_their_branch_access_3jkr')}</div>
      {!open
        ? <div><button className="btn ghost danger" disabled={busy} onClick={() => setOpen(true)}>{t('pos.end_employment_2')}</button></div>
        : <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input aria-label={t('pos.reason_for_ending_employment')} placeholder={t('pos.reason_kept_in_the_audit_trail')} value={reason} onChange={(e) => setReason(e.target.value)} style={{ minWidth: 280 }} />
            <button className="btn primary danger" disabled={busy || reason.trim().length < 3} onClick={() => void end()}>{t('pos.end_employment_now')}</button>
            <button className="btn ghost" disabled={busy} onClick={() => { setOpen(false); setReason(''); }}>{t('pos.cancel')}</button>
          </div>}
      {note && <div className="sub" role="status">{note}</div>}
    </section>
  );
}
