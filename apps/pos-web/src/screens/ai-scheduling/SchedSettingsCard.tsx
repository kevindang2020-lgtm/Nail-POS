// SchedSettingsCard.tsx — the ONE settings source for the optimizer (tri-state platform → salon → location; a disabled /
// killed layer wins downward). Shows the effective values and each layer's own overrides (blank = inherits), and lets a
// user with ai_scheduling.configure edit the salon or location layer: on/off, emergency stop, automation + its safe-action
// allowlist, confidence threshold, scoring weights, gap / interval / lead-time / horizon rules, recommendation and
// proposal lifetimes. Saves are conditional on the layer's version (409 VERSION_CONFLICT → reload). Read-only otherwise.
// Human review stays required for every material change — that switch is not offered.
import { useEffect, useState } from 'react';
import type { SchedConfig, SchedRuleVersion, SchedSafeAutoAction, SchedScoringWeights, SchedSettingsLayer, SchedSettingsUpdate, SchedSettingsView } from '@aipowersalon/api-contracts/tenant';
import { posAiSchedulingOptimizerApi as api } from '../../api/posAiSchedulingOptimizerApi';
import { P, type Can, card, cardHead, btnGold, btnGhost, input, muted, errText, okText, pill, when, pretty, row, schedErrorText, isRefetchConflict } from './schedUi';
import { t as tx, useLanguage } from '@aipowersalon/mobile-sdk/i18n';

// WP-C1: [code, label KEY] — every label is read with tx() at render (never at import)
export const SAFE_ACTIONS: [SchedSafeAutoAction, string][] = (['open_empty_slot', 'close_unavailable_tech', 'recalc_estimated_end', 'add_internal_warning', 'update_internal_capacity', 'apply_preapproved_gap_rule'] as SchedSafeAutoAction[])
  .map((k) => [k, `ops.sched.safe.${k}`]);
const NUMBERS: [Exclude<keyof SchedConfig, 'automationEnabled' | 'allowedAutoActions' | 'weights' | 'humanReviewRequired'>, string][] = ([
  'confidenceThreshold', 'gapMinServiceMin', 'largeBlockMin', 'utilizationTargetPct', 'bookingIntervalMin', 'minLeadTimeMin', 'maxHorizonDays', 'recommendationTtlMin', 'proposalTtlHours',
] as const).map((k) => [k, `ops.sched.num.${k}`]);
const WEIGHTS: [keyof SchedScoringWeights, string][] = ([
  'preferredTimeProximity', 'waitReduction', 'gapFit', 'preferencePreservation', 'utilization', 'fragmentation', 'overtimeAvoidance', 'workloadBalance', 'idleReduction',
] as const).map((k) => [k, `ops.sched.weight.${k}`]);
type Tri = '' | 'on' | 'off';
const tri = (v: boolean | null | undefined): Tri => (v == null ? '' : v ? 'on' : 'off');
const unTri = (t: Tri): boolean | null => (t === '' ? null : t === 'on');

export function SchedSettingsCard({ tick, can, onChanged, view, reload }: { tick: number; can: Can; onChanged: () => void; view: SchedSettingsView | null; reload: () => void }) {
  const canEdit = can(P.configure);
  const [level, setLevel] = useState<'tenant' | 'branch'>('branch');
  const layer: SchedSettingsLayer | null = view ? (level === 'tenant' ? view.tenant : view.branch) : null;
  const [enabled, setEnabled] = useState<Tri>('');
  const [kill, setKill] = useState<Tri>('');
  const [auto, setAuto] = useState<Tri>('');
  const [actions, setActions] = useState<SchedSafeAutoAction[] | null>(null);
  const [nums, setNums] = useState<Record<string, string>>({});
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [versions, setVersions] = useState<SchedRuleVersion[] | null>(null);

  // (re)seed the form from the chosen layer whenever the server view or the level changes
  useEffect(() => {
    const c = layer?.config ?? {};
    setEnabled(tri(layer?.enabled)); setKill(tri(layer?.killSwitch)); setAuto(tri(c.automationEnabled));
    setActions(c.allowedAutoActions ?? null);
    setNums(Object.fromEntries(NUMBERS.map(([k]) => [k, c[k] != null ? String(c[k]) : ''])));
    setWeights(Object.fromEntries(WEIGHTS.map(([k]) => [k, c.weights?.[k] != null ? String(c.weights[k]) : ''])));
  }, [layer, level]);
  useEffect(() => { api.settingsVersions().then(setVersions).catch(() => setVersions([])); }, [tick]);

  const eff = view?.effective;
  const effCfg = eff?.config;
  const save = async () => {
    if (!view) return;
    const config: Partial<Omit<SchedConfig, 'humanReviewRequired'>> = {};
    if (auto !== '') config.automationEnabled = auto === 'on';
    if (actions) config.allowedAutoActions = actions;
    for (const [k] of NUMBERS) { const v = nums[k]; if (v !== '' && v != null) { const n = Number(v); if (!Number.isFinite(n)) { setMsg({ ok: false, text: tx('pos.numbers_only_please') }); return; } (config as Record<string, number>)[k] = n; } }
    if (WEIGHTS.some(([k]) => weights[k] !== '')) {
      const w = { ...(effCfg?.weights ?? {}) } as SchedScoringWeights;
      for (const [k] of WEIGHTS) if (weights[k] !== '') w[k] = Number(weights[k]);
      config.weights = w;
    }
    const body: SchedSettingsUpdate = { level, expectedVersion: layer?.version ?? 0, enabled: unTri(enabled), killSwitch: unTri(kill), config };
    setBusy(true); setMsg(null);
    try { await api.saveSettings(body); setMsg({ ok: true, text: tx('pos.saved_the_server_applied_its_limits_vzkq') }); onChanged(); reload(); }
    catch (e) { setMsg({ ok: false, text: isRefetchConflict(e) ? tx('pos.someone_else_saved_these_settings_a_m5dz') : schedErrorText(e, 'ops.sched.err.save') }); if (isRefetchConflict(e)) reload(); }
    finally { setBusy(false); }
  };
  // Vietnamese POS WP-C4: computed every render (a memo on [eff] held the old language's text after an instant switch;
  // the card subscribes to the language so a switch re-renders it)
  useLanguage();
  const effLine = (eff ? [
    eff.platformKilled ? tx('pos.paused_platform_wide') : null, eff.killed ? tx('pos.emergency_stop_on') : null, eff.enabled ? tx('pos.enabled').toLowerCase() : tx('pos.disabled').toLowerCase(),
    eff.automationAllowed ? tx('pos.automation_allowed_safe_actions_only') : tx('pos.automation_off'),
  ].filter(Boolean).join(' · ') : '');

  if (!view) return <section style={card} aria-label={tx('pos.settings')}><div style={cardHead}>{tx('pos.settings')}</div><div style={muted}>{tx('pos.loading')}</div></section>;
  const ro = !canEdit;
  return (
    <section style={{ ...card, display: 'grid', gap: 10 }} aria-label={tx('pos.settings')}>
      <div style={cardHead}>{tx('pos.settings')}{' '}{ro ? <span style={pill('#F3ECE1', '#6C6965')} data-testid="sched-settings-ro">{tx('pos.view_only')}</span> : null}</div>
      <div style={{ fontSize: 13 }} data-testid="sched-effective">{tx('pos.right_now_2')}{' '}{effLine}</div>
      <div style={row}>
        <span style={muted}>{tx('pos.edit_layer')}</span>
        <select aria-label={tx('pos.settings_layer')} value={level} onChange={(e) => setLevel(e.target.value as 'tenant' | 'branch')} style={input}>
          <option value="branch">{tx('pos.this_location')}</option><option value="tenant">{tx('pos.whole_salon')}</option>
        </select>
        <span style={muted}>{layer ? `v${layer.version}${layer.updatedAt ? tx('pos.saved_updatedat', { updatedAt: String(when(layer.updatedAt)) }) : ''}` : tx('pos.nothing_saved_at_this_layer_yet_1on0')}</span>
      </div>
      <div style={row}>
        <label style={muted}>{tx('pos.optimizer')}{' '}<select aria-label={tx('pos.optimizer_on_off')} disabled={ro} value={enabled} onChange={(e) => setEnabled(e.target.value as Tri)} style={input}><option value="">{tx('pos.inherit')}</option><option value="on">{tx('pos.on_2')}</option><option value="off">{tx('pos.off_2')}</option></select></label>
        <label style={muted}>{tx('pos.emergency_stop')}{' '}<select aria-label={tx('pos.emergency_stop')} disabled={ro} value={kill} onChange={(e) => setKill(e.target.value as Tri)} style={input}><option value="">{tx('pos.inherit')}</option><option value="on">{tx('pos.on_2')}</option><option value="off">{tx('pos.off_2')}</option></select></label>
        <label style={muted}>{tx('pos.automation')}{' '}<select aria-label={tx('pos.automation_on_off')} disabled={ro} value={auto} onChange={(e) => setAuto(e.target.value as Tri)} style={input}><option value="">{tx('ops.sched.inheritOnOff', { value: effCfg?.automationEnabled ? tx('pos.on_2') : tx('pos.off_2') })}</option><option value="on">{tx('pos.on_2')}</option><option value="off">{tx('pos.off_2')}</option></select></label>
      </div>
      <fieldset style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 8 }} aria-label={tx('pos.safe_automatic_actions')}>
        <legend style={muted}>{tx('pos.safe_actions_automation_may_take')}{' '}{actions ? '' : tx('ops.sched.inheritsLayer')}</legend>
        {SAFE_ACTIONS.map(([k, l]) => {
          const on = (actions ?? effCfg?.allowedAutoActions ?? []).includes(k);
          return <label key={k} style={{ display: 'block', fontSize: 12.5 }}><input type="checkbox" disabled={ro} checked={on} onChange={() => setActions((cur) => { const base = cur ?? effCfg?.allowedAutoActions ?? []; return on ? base.filter((x) => x !== k) : [...base, k]; })} /> {tx(l)}</label>;
        })}
        <div style={muted}>{tx('pos.automation_never_moves_a_confirmed_appointment_1ltb')}</div>
      </fieldset>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 6 }}>
        {NUMBERS.map(([k, l]) => (
          <label key={k} style={{ fontSize: 12, display: 'grid', gap: 2 }}><span style={muted}>{tx(l)}</span>
            <input aria-label={tx(l)} disabled={ro} inputMode="decimal" value={nums[k] ?? ''} placeholder={effCfg ? tx('pos.inherits_v0', { v0: String(effCfg[k]) }) : ''} onChange={(e) => setNums({ ...nums, [k]: e.target.value })} style={input} /></label>
        ))}
      </div>
      <details>
        <summary style={{ fontSize: 12.5, cursor: 'pointer' }}>{tx('pos.scoring_weights')}</summary>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 6, marginTop: 6 }}>
          {WEIGHTS.map(([k, l]) => (
            <label key={k} style={{ fontSize: 12, display: 'grid', gap: 2 }}><span style={muted}>{tx(l)}</span>
              <input aria-label={tx('pos.weight_l', { l: tx(l) })} disabled={ro} inputMode="decimal" value={weights[k] ?? ''} placeholder={effCfg ? tx('pos.inherits_v0', { v0: String(effCfg.weights[k]) }) : ''} onChange={(e) => setWeights({ ...weights, [k]: e.target.value })} style={input} /></label>
          ))}
        </div>
      </details>
      <div style={muted}>{tx('pos.human_review_is_always_required_for_1i5a')}</div>
      {msg ? <div role={msg.ok ? 'status' : 'alert'} style={msg.ok ? okText : errText}>{msg.text}</div> : null}
      {canEdit ? <div style={row}><button style={btnGold} disabled={busy} onClick={save}>{busy ? tx('pos.saving_2') : tx('pos.save_settings')}</button><button style={btnGhost} onClick={reload}>{tx('pos.discard')}</button></div> : null}
      <div>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{tx('pos.change_history_2')}</div>
        {!versions ? <div style={muted}>{tx('pos.loading')}</div> : versions.length === 0 ? <div style={muted}>{tx('pos.no_changes_saved_yet')}</div> : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>{versions.slice(0, 15).map((v) => (
            <li key={`${v.level}-${v.branchId ?? 's'}-${v.version}`} data-testid="sched-settings-version">v{v.version} · {tx(v.level === 'tenant' ? 'ops.sched.layer.salon' : 'ops.sched.layer.location')}{v.killSwitch ? tx('pos.emergency_stop_2') : ''}{v.enabled === false ? tx('pos.disabled_2') : ''}{v.config ? ` · ${Object.keys(v.config).map(pretty).join(', ')}` : ''} · {when(v.createdAt)}</li>
          ))}</ul>
        )}
      </div>
    </section>
  );
}
