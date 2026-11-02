// AIQueueSettingsCard.tsx — the ONE AI queue settings source on the POS (BUILD_PLAN Phase 6, contract §C).
//
// Salon-wide defaults and this location's own values. A location field either INHERITS the salon value (stored as
// null) or OVERRIDES it; the card shows which. Every save carries the version this card loaded (`expectedVersion`), so
// two managers editing at once cannot silently overwrite each other — the second gets a plain "someone else changed
// these" message and a reload. Versions are listed (who changed what, when, why). The salon-wide auto-assign kill
// switch lives here too and always asks for a reason.
//
// Round 2 (real backend, ai-queue-assignment-ops.service putSettings): a location field goes back to inheriting with
// `clear: [keys]` — never a null in the patch; GET settings says `canEditSalon` (OWNER / ADMIN) and the salon tab is
// read-only otherwise; the PUT answers `{ effective, scope }`, so the card reloads the full view after a save. The salon
// kill switch is B's POST auto/kill | auto/unkill { scope: 'salon', reason } — turning it back off is the OWNER's call.
//
// This replaces the retired Settings toggles (queueWorkflow.autoAssign / assignBy, autoAssignTechnicianEnabled — audit
// "parallel implementations" 3); the POS Settings screen points here.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useInlineAsk } from '@aipowersalon/ui';
import { posAIQueueAssignmentApi as api, ApiError, type AqSettingsView, type AqScopeName, type AqSettingsVersion, type AqSettingsValues } from '../../api/posAIQueueAssignmentApi';
import { useAuth } from '../../auth/AuthContext';
import { card, cardHead, input, btnGold, btnGhost, btnDanger, muted, errText, okText, pill, errMsg, when, pretty } from './aiQueueUi';
import { t } from '@aipowersalon/mobile-sdk/i18n';

type FieldKey = 'waitApproachingMin' | 'waitExceededMin' | 'waitSevereMin' | 'waitCriticalMin' | 'stuckMinutes' | 'longServiceFactor' | 'congestionWaitingPerTech' | 'lateGraceMin';
const FIELDS: { key: FieldKey; label: string; unit: string; decimal?: boolean; min: number; max: number }[] = [
  { key: 'waitApproachingMin', get label() { return t('pos.wait_approaching'); }, unit: 'min', min: 0, max: 600 },
  { key: 'waitExceededMin', get label() { return t('pos.wait_exceeded'); }, unit: 'min', min: 0, max: 600 },
  { key: 'waitSevereMin', get label() { return t('pos.wait_severe'); }, unit: 'min', min: 0, max: 600 },
  { key: 'waitCriticalMin', get label() { return t('pos.wait_critical'); }, unit: 'min', min: 0, max: 600 },
  { key: 'stuckMinutes', get label() { return t('pos.stuck_after_no_change_for'); }, unit: 'min', min: 5, max: 600 },
  { key: 'longServiceFactor', get label() { return t('pos.long_service_at_expected_time'); }, unit: '×', decimal: true, min: 1, max: 10 },
  { key: 'congestionWaitingPerTech', get label() { return t('pos.congested_at_waiting_guests_per_technician'); }, unit: '', decimal: true, min: 0.1, max: 50 },
  { key: 'lateGraceMin', get label() { return t('pos.appointment_grace_before_late'); }, unit: 'min', min: 0, max: 240 },
];
type Draft = Record<FieldKey, { inherit: boolean; value: string }>;

export const settingsConflictMessage = (): string => t('pos.someone_else_changed_these_settings_since_9szn');

function draftFrom(s: AqSettingsView, scope: AqScopeName): Draft {
  const d = {} as Draft;
  for (const f of FIELDS) {
    if (scope === 'salon') d[f.key] = { inherit: false, value: String(s.salon[f.key] ?? '') };
    else {
      const own = s.branch ? s.branch[f.key] : null;
      d[f.key] = own === null || own === undefined ? { inherit: true, value: String(s.salon[f.key] ?? '') } : { inherit: false, value: String(own) };
    }
  }
  return d;
}

export function AIQueueSettingsCard({ tick, can, onChanged }: { tick: number; can: (p: string) => boolean; onChanged: () => void }) {
  const [s, setS] = useState<AqSettingsView | null>(null);
  const [scope, setScope] = useState<AqScopeName>('branch');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [reason, setReason] = useState('');
  const [versions, setVersions] = useState<AqSettingsVersion[] | null>(null);
  const [conflict, setConflict] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { ask, askUi } = useInlineAsk();
  // The background safety sync bumps `tick` every ~15 s; it must never wipe a half-typed change (or move the version
  // this save will claim). An edited draft holds until it is saved, reloaded or the scope changes.
  const dirty = useRef(false);
  const edit = (d: Draft) => { dirty.current = true; setDraft(d); };

  const load = useCallback(async (force = false) => {
    if (dirty.current && !force) return;
    try { const r = await api.getSettings(); dirty.current = false; setS(r); setConflict(false); setErr(null); }
    catch (e) { setErr(errMsg(e, t('growth.aiQueue.err.settings'))); }
  }, []);
  useEffect(() => { void load(); }, [load, tick]);
  useEffect(() => { if (s) { dirty.current = false; setDraft(draftFrom(s, scope)); } }, [s, scope]);

  const role = String(useAuth().principal?.role || '').toUpperCase();
  // the salon tab is editable only for OWNER / ADMIN (server: canEditSalon); a location manager edits their location
  const canEdit = can('ai_queue_assignment.manage_rules') && (scope === 'branch' || s?.canEditSalon !== false);
  const baseVersion = scope === 'salon' ? s?.salon.version : s?.branch?.version ?? 0;

  const save = async () => {
    if (!s || !draft) return;
    const patch: Partial<AqSettingsValues> = {};
    const clear: (keyof AqSettingsValues)[] = [];
    for (const f of FIELDS) {
      const d = draft[f.key];
      if (scope === 'branch' && d.inherit) { if (s.branch && s.branch[f.key] != null) clear.push(f.key); continue; }
      const v = Number(d.value);
      if (d.value.trim() === '' || !Number.isFinite(v) || (!f.decimal && !Number.isInteger(v)) || v < f.min || v > f.max) { setErr(t('pos.label_must_be_v1_from_min_kdbd', { label: String(f.label), v1: String(f.decimal ? t('pos.a_number') : t('pos.a_whole_number')), min: String(f.min), max: String(f.max) })); return; }
      const before = scope === 'salon' ? s.salon[f.key] : s.branch?.[f.key];
      if (before !== v) patch[f.key] = v;
    }
    const eff = (k: FieldKey) => { const d = draft[k]; return d.inherit ? Number(s.salon[k]) : Number(d.value); };
    if (!(eff('waitApproachingMin') <= eff('waitExceededMin') && eff('waitExceededMin') <= eff('waitSevereMin') && eff('waitSevereMin') <= eff('waitCriticalMin'))) { setErr(t('pos.wait_levels_must_rise_approaching_exceeded_1gkf')); return; }
    if (Object.keys(patch).length === 0 && clear.length === 0) { setMsg(t('pos.nothing_changed')); return; }
    setBusy(true); setErr(null); setMsg(null);
    try {
      await api.saveSettings({ scope, ...(Object.keys(patch).length ? { patch } : {}), ...(clear.length ? { clear } : {}), expectedVersion: baseVersion, reason: reason.trim() || null });
      dirty.current = false;
      await load(true);   // the PUT answers { effective, scope } — reload the salon / location / versions view
      setReason(''); setMsg(scope === 'salon' ? t('pos.salon_defaults_saved') : t('pos.saved_for_this_location')); onChanged();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) { setConflict(true); setErr(settingsConflictMessage()); }
      else setErr(errMsg(e, t('growth.aiQueue.err.save')));
    } finally { setBusy(false); }
  };
  const killed = !!(s?.salon.autoKilled ?? s?.effective.salonAutoKilled);
  // turning the salon-wide switch back OFF is the owner's (B: unkill at salon scope is OWNER only); unknown role → let
  // the server decide and say so
  const canUnkillSalon = !role || role === 'OWNER';
  const killReason = s?.salon.autoKilledReason ?? s?.effective.salonAutoKilledReason ?? null;
  const toggleSalonKill = () => ask(killed ? t('pos.why_allow_auto_assign_again_across_af5x') : t('pos.why_stop_auto_assign_at_every_tduj'), (why) => {
    void (async () => {
      setBusy(true); setErr(null); setMsg(null);
      try { if (killed) await api.unkillAuto('salon', why); else await api.killAuto('salon', why); setMsg(killed ? t('pos.auto_assign_may_run_again_where_h33x') : t('pos.auto_assign_is_stopped_at_every_ac6y')); await load(true); onChanged(); }
      catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
    })();
  }, { confirmLabel: killed ? t('pos.allow_again') : t('pos.stop_auto_assign'), minLength: 5 });
  const loadVersions = async () => { try { setVersions(await api.settingsVersions()); } catch (e) { setErr(errMsg(e, t('growth.aiQueue.err.versions'))); } };
  const shownVersions = versions || s?.versions || [];

  return (
    <div style={card}>
      {askUi}
      <div style={cardHead}>
        <span>{t('pos.assignment_rules')}</span>
        {s?.effective.configVersion ? <span style={pill('#F3ECE1', '#6C6965')}>{t('pos.version_2')}{' '}{s.effective.configVersion}</span> : null}
        <div role="tablist" style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {(['branch', 'salon'] as AqScopeName[]).map((sc) => (
            <button key={sc} role="tab" aria-selected={scope === sc} style={{ ...btnGhost, height: 28, ...(scope === sc ? { borderColor: '#A96F22', color: '#A96F22' } : {}) }} onClick={() => { dirty.current = false; setScope(sc); setErr(null); setMsg(null); }}>{sc === 'branch' ? t('pos.this_location') : t('pos.salon_default')}</button>
          ))}
        </div>
      </div>
      {err ? <div role="alert" style={{ ...errText, marginBottom: 8 }}>{err} {conflict ? <button style={{ ...btnGhost, height: 26 }} onClick={() => { setErr(null); void load(true); }}>{t('pos.reload')}</button> : null}</div> : null}
      {msg ? <div role="status" style={{ ...okText, marginBottom: 8 }}>{msg}</div> : null}
      {!s || !draft ? <div style={muted}>{err ? '' : t('pos.loading')}</div> : (
        <div style={{ display: 'grid', gap: 8 }}>
          {scope === 'branch' ? <div style={muted}>{t('pos.a_field_set_to_same_as_s8uq')}</div> : null}
          {FIELDS.map((f) => {
            const d = draft[f.key];
            return (
              <div key={f.key} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, flex: '1 1 220px' }}>{f.label}</span>
                {scope === 'branch' ? (
                  <label style={{ ...muted, display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                    <input type="checkbox" aria-label={t('pos.label_same_as_salon', { label: String(f.label) })} checked={d.inherit} disabled={!canEdit} onChange={(e) => edit({ ...draft, [f.key]: { inherit: e.target.checked, value: e.target.checked ? String(s.salon[f.key]) : d.value } })} /> {t('pos.same_as_salon')}
                  </label>
                ) : null}
                <input aria-label={f.label} inputMode={f.decimal ? 'decimal' : 'numeric'} style={{ ...input, width: 80 }} value={d.value} disabled={!canEdit || d.inherit} onChange={(e) => edit({ ...draft, [f.key]: { ...d, value: e.target.value } })} />
                <span style={{ ...muted, width: 24 }}>{f.unit}</span>
              </div>
            );
          })}
          {canEdit ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input aria-label={t('pos.reason_for_change')} style={{ ...input, flex: '1 1 200px' }} placeholder={t('pos.reason_for_the_change_optional')} value={reason} onChange={(e) => setReason(e.target.value)} />
              <button style={btnGold} disabled={busy} onClick={save}>{scope === 'salon' ? t('pos.save_salon_defaults') : t('pos.save_for_this_location')}</button>
            </div>
          ) : <div style={muted}>{scope === 'salon' && can('ai_queue_assignment.manage_rules') ? t('pos.only_the_salon_owner_changes_the_1e4q') : t('pos.only_managers_can_change_these_rules')}</div>}

          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: 12.5 }}>{t('pos.salon_kill_switch')}</span>
            <span style={killed ? pill('#F4CFC4', '#8F2F13') : pill('#EAF5EE', '#3E8F57')}>{killed ? t('pos.auto_assign_stopped_salon_wide') : t('pos.not_engaged')}</span>
            {killed && killReason ? <span style={muted}>“{killReason}”</span> : null}
            {killed && !canUnkillSalon ? <span style={muted}>{t('pos.only_the_salon_owner_can_turn_ungk')}</span> : null}
            {can('ai_queue_assignment.manage_auto') && (!killed || canUnkillSalon) ? <button style={killed ? btnGhost : btnDanger} disabled={busy} onClick={toggleSalonKill}>{killed ? t('pos.allow_auto_assign_again') : t('pos.stop_auto_assign_everywhere')}</button> : null}
          </div>

          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontWeight: 700, fontSize: 12.5 }}>{t('pos.change_history_2')}</span>
              {!versions ? <button style={{ ...btnGhost, height: 26 }} onClick={loadVersions}>{t('pos.show_all')}</button> : null}
            </div>
            {shownVersions.length === 0 ? <div style={muted}>{t('pos.no_changes_yet_the_defaults_apply')}</div> : (
              <div style={{ display: 'grid', gap: 4 }}>
                {shownVersions.map((v) => (
                  <div key={`${v.branchId || 'salon'}-${v.version}-${v.createdAt}`} style={{ fontSize: 12.5 }}>
                    <b>v{v.version}</b> · {v.branchId ? t('pos.this_location_2') : t('growth.aiQueue.salon')} · {pretty(v.change)}{v.reason ? <span style={muted}> · “{v.reason}”</span> : null}<span style={muted}> · {when(v.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
