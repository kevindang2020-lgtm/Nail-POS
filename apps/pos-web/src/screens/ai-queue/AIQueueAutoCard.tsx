// AIQueueAutoCard.tsx — auto-assignment for this location (BUILD_PLAN Phase 6, contract §B auto-config).
//
// Off by default. When on, only high-confidence, fully eligible matches for unassigned WAITING guests older than the
// delay are assigned; locked guests, the exclusions below and a requested technician other than the pick are never
// touched (audit bugs 5, 6). Every switch above this one (the platform's AI pause, the salon kill switch) is shown as
// ONE plain line — "Auto-assign is off because …" — so nobody wonders why "on" does nothing.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useInlineAsk } from '@aipowersalon/ui';
import type { QueueAutoConfigView, QueueAutoExclusions } from '@aipowersalon/api-contracts/tenant';
import { posAIQueueAssignmentApi as api } from '../../api/posAIQueueAssignmentApi';
import { card, cardHead, input, btnGold, btnGhost, btnDanger, muted, errText, okText, pill, errMsg, autoOffReason } from './aiQueueUi';
import { t } from '@aipowersalon/mobile-sdk/i18n';

const EXCL = (): [keyof QueueAutoExclusions, string][] => [['vip', t('growth.aiQueue.exclude.vip')], ['appointments', t('growth.aiQueue.exclude.appointments')], ['requested', t('growth.aiQueue.exclude.requested')], ['groups', t('growth.aiQueue.exclude.groups')]];

export function AIQueueAutoCard({ tick, can, roster, onChanged }: { tick: number; can: (p: string) => boolean; roster: { technicianId: string; name: string }[]; onChanged: () => void }) {
  const [cfg, setCfg] = useState<QueueAutoConfigView | null>(null);
  const [floor, setFloor] = useState('');
  const [maxRun, setMaxRun] = useState('');
  const [delay, setDelay] = useState('');
  const [excl, setExcl] = useState<QueueAutoExclusions>({});
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { ask, askUi } = useInlineAsk();

  // the 15 s safety sync must not wipe a half-typed floor / delay / exclusion list
  const dirty = useRef(false);
  const touch = <T,>(set: (v: T) => void) => (v: T) => { dirty.current = true; set(v); };
  const apply = (c: QueueAutoConfigView) => {
    dirty.current = false;
    setCfg(c);
    setFloor(String(Math.round((c.confidenceFloor ?? 0.75) * 100)));
    setMaxRun(String(c.maxPerRun ?? 5)); setDelay(String(c.delaySeconds ?? 120)); setExcl(c.exclusions || {});
  };
  const load = useCallback(async (force = false) => {
    if (dirty.current && !force) return;
    try { apply(await api.getAutoConfig()); setErr(null); } catch (e) { setErr(errMsg(e, t('growth.aiQueue.err.auto'))); }
  }, []);
  useEffect(() => { void load(); }, [load, tick]);

  const canEdit = can('ai_queue_assignment.manage_auto');
  async function guard(fn: () => Promise<void>) { setBusy(true); setErr(null); setMsg(null); try { await fn(); onChanged(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } }
  const save = (enabled?: boolean) => guard(async () => {
    const f = Number(floor), m = Number(maxRun), d = Number(delay);
    if (!Number.isInteger(f) || f < 0 || f > 100) throw new Error(t('pos.confidence_floor_must_be_a_whole_1ejd'));
    if (!Number.isInteger(m) || m < 0 || m > 100) throw new Error(t('pos.guests_per_run_must_be_a_va8u'));
    if (!Number.isInteger(d) || d < 0 || d > 3600) throw new Error(t('pos.delay_must_be_a_whole_number_og2p'));
    const next = await api.setAutoConfig({ enabled: enabled ?? !!cfg?.enabled, confidenceFloor: f / 100, maxPerRun: m, delaySeconds: d, exclusions: excl });
    apply(next); setMsg(enabled === undefined ? t('pos.auto_assignment_settings_saved') : enabled ? t('pos.auto_assignment_turned_on_for_this_61gd') : t('pos.auto_assignment_turned_off_for_this_1jlj'));
  });
  const runNow = () => guard(async () => {
    // B's auto-run result: { enabled, allowed, blockedBy, assigned, considered, skipped }
    const r = await api.runAuto();
    const why = r.allowed ? null : autoOffReason(r.blockedBy ?? (r.enabled ? null : 'disabled'));
    setMsg(!r.allowed ? (why || t('pos.auto_assignment_is_off_nothing_was_1t6g')) : t('pos.assigned_assigned_of_considered_waiting_guest_jctw', { assigned: String(r.assigned), considered: String(r.considered), plural: String(r.considered === 1 ? '' : 's'), v3: String(r.skipped?.length ? t('pos.length_left_for_staff', { length: String(r.skipped.length) }) : '') }));
    await load(true);
  });
  const kill = () => ask(t('growth.aiQueue.ask.stopAuto'), (why) => guard(async () => { apply(await api.killAuto('branch', why)); setMsg(t('pos.auto_assignment_stopped_at_this_location')); }), { confirmLabel: t('pos.stop_now'), minLength: 5 });
  const toggleTechExcl = (tid: string) => { const cur = excl.technicianIds || []; touch(setExcl)({ ...excl, technicianIds: cur.includes(tid) ? cur.filter((x) => x !== tid) : [...cur, tid] }); };

  const why = cfg ? autoOffReason(cfg.autoBlockedBy ?? (cfg.enabled ? null : 'disabled'), cfg.salonAutoKilledReason) : null;
  return (
    <div style={card}>
      {askUi}
      <div style={cardHead}>
        <span>{t('pos.auto_assignment')}</span>
        <span style={cfg?.enabled ? pill('#EAF5EE', '#3E8F57') : pill('#F3ECE1', '#6C6965')}>{cfg?.enabled ? t('growth.aiQueue.on') : t('growth.aiQueue.off')}</span>
      </div>
      {why ? <div data-testid="auto-off-reason" style={{ ...muted, color: '#9B6B1E', marginBottom: 8 }}>{why}</div> : null}
      {err ? <div role="alert" style={{ ...errText, marginBottom: 8 }}>{err}</div> : null}
      {msg ? <div role="status" style={{ ...okText, marginBottom: 8 }}>{msg}</div> : null}
      {!cfg ? <div style={muted}>{err ? '' : t('pos.loading')}</div> : (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={muted}>{t('pos.off_by_default_when_on_only_1wem')}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label style={{ display: 'grid', gap: 2 }}><span style={muted}>{t('pos.confidence_floor')}</span><input aria-label={t('pos.confidence_floor_percent')} inputMode="numeric" disabled={!canEdit} style={{ ...input, width: 90 }} value={floor} onChange={(e) => touch(setFloor)(e.target.value)} /></label>
            <label style={{ display: 'grid', gap: 2 }}><span style={muted}>{t('pos.guests_per_run')}</span><input aria-label={t('pos.guests_per_run')} inputMode="numeric" disabled={!canEdit} style={{ ...input, width: 90 }} value={maxRun} onChange={(e) => touch(setMaxRun)(e.target.value)} /></label>
            <label style={{ display: 'grid', gap: 2 }}><span style={muted}>{t('pos.wait_before_auto_sec')}</span><input aria-label={t('pos.delay_seconds')} inputMode="numeric" disabled={!canEdit} style={{ ...input, width: 90 }} value={delay} onChange={(e) => touch(setDelay)(e.target.value)} /></label>
          </div>
          <div style={{ display: 'grid', gap: 4 }}>
            <span style={muted}>{t('pos.never_auto_assign')}</span>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {EXCL().map(([k, l]) => (
                <label key={String(k)} style={{ fontSize: 13, display: 'inline-flex', gap: 4, alignItems: 'center' }}><input type="checkbox" disabled={!canEdit} checked={!!excl[k]} onChange={(e) => touch(setExcl)({ ...excl, [k]: e.target.checked })} /> {l}</label>
              ))}
            </div>
            {roster.length ? (
              <details>
                <summary style={{ ...muted, cursor: 'pointer' }}>{t('pos.technicians_never_auto_assigned_to')}{(excl.technicianIds || []).length})</summary>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
                  {roster.map((r) => <label key={r.technicianId} style={{ fontSize: 13, display: 'inline-flex', gap: 4, alignItems: 'center' }}><input type="checkbox" disabled={!canEdit} checked={(excl.technicianIds || []).includes(r.technicianId)} onChange={() => toggleTechExcl(r.technicianId)} /> {r.name}</label>)}
                </div>
              </details>
            ) : null}
          </div>
          {canEdit ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button style={btnGhost} disabled={busy} onClick={() => save(!cfg.enabled)}>{cfg.enabled ? t('pos.turn_off') : t('pos.turn_on')}</button>
              <button style={btnGhost} disabled={busy} onClick={() => save()}>{t('pos.save_2')}</button>
              <button style={btnGold} disabled={busy || !cfg.enabled} onClick={runNow}>{t('pos.run_now')}</button>
              <button style={btnDanger} disabled={busy || !cfg.enabled} onClick={kill}>{t('pos.kill_switch')}</button>
            </div>
          ) : <div style={muted}>{t('pos.only_managers_can_change_auto_assignment')}</div>}
        </div>
      )}
    </div>
  );
}
