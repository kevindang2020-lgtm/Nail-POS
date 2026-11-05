// AIQueueAlertsCard.tsx — live queue alerts (BUILD_PLAN Phase 6, contract §C).
//
// Audit bug 9: resolved alerts were still listed with a live "Resolve" button. Now the list asks for OPEN alerts by
// default (`?status=open`) and also drops any closed one the server might still send; "Show resolved" asks for all.
// An alert the background scan closed because the condition cleared reads "Auto-resolved — the condition cleared",
// never a plain "resolved" that would look like a person handled it. Closed alerts offer no actions.
// Repair REALLY changes the queue now (through QueueService) — so the action is chosen explicitly, and only the actions the
// server allows for the alert's type are offered (REPAIRS_BY_TYPE). "Reassign" asks for the technician; on an
// "overloaded technician" alert it also asks which of their guests to move; "Remove from queue" needs a reason.
// Round 2: closed alerts are status 'resolved' + `autoResolved` / resolution (condition_cleared, repaired:<action>,
// dismissed, resolved_by_staff) — as the ops alerts repository writes them.
import { useCallback, useEffect, useState } from 'react';
import { useInlineAsk } from '@aipowersalon/ui';
import { posAIQueueAssignmentApi as api, type AqAlert, type AqWaitLevels, type AqRepairAction } from '../../api/posAIQueueAssignmentApi';
import { posQueueApi } from '../../api/posQueueApi';
import { isQueueConflict, queueConflictMessage } from '../../lib/queueConflict';
import { card, cardHead, input, btnGold, btnGhost, muted, errText, okText, pill, pretty, errMsg, SEV_TONE, isClosedAlert, isAutoResolved, alertStatusLabel, severityLabel, repairsFor, REPAIR_LABEL } from './aiQueueUi';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { codedText } from '../../i18n/coded-text';
import { queueAlertReasonCoded } from '@aipowersalon/api-contracts/tenant';

type WaitKey = 'approachingMin' | 'exceededMin' | 'severeMin' | 'criticalMin';

export function AIQueueAlertsCard({ tick, can, techName, roster, onChanged }: { tick: number; can: (p: string) => boolean; techName: (id: string | null | undefined) => string; roster: { technicianId: string; name: string }[]; onChanged: () => void }) {
  const [showAll, setShowAll] = useState(false);
  const [alerts, setAlerts] = useState<AqAlert[] | null>(null);
  const [thr, setThr] = useState<AqWaitLevels | null>(null);
  const [thrEdit, setThrEdit] = useState<Record<WaitKey, string> | null>(null);
  const [repairFor, setRepairFor] = useState<string | null>(null);
  const [repairAction, setRepairAction] = useState<AqRepairAction>('dismiss');
  const [repairTech, setRepairTech] = useState('');
  const [repairGuest, setRepairGuest] = useState('');
  const [repairReason, setRepairReason] = useState('');
  const [techGuests, setTechGuests] = useState<{ queueItemId: string; customerName: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { ask, askUi } = useInlineAsk();

  const load = useCallback(async () => {
    try {
      const list = await api.listAlerts(showAll ? 'all' : 'open');
      // defence in depth for bug 9: an "open" list never shows a closed alert, whatever the server sent
      setAlerts(showAll ? list : list.filter((a) => !isClosedAlert(a)));
    } catch (e) { setAlerts([]); setErr(errMsg(e, tx('growth.aiQueue.err.alerts'))); }
    try { setThr(await api.getWaitThresholds()); } catch { /* thresholds are informative only */ }
  }, [showAll]);
  useEffect(() => { void load(); }, [load, tick]);

  async function guard(fn: () => Promise<void>) { setBusy(true); setErr(null); setMsg(null); try { await fn(); await load(); onChanged(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } }
  const scan = () => guard(async () => { const r = await api.scanAlerts(); setMsg(tx('pos.scan_done_raised_new_alert_plural_1j5o', { raised: String(r.raised), plural: String(r.raised === 1 ? '' : 's'), v2: String(r.autoResolved ? tx('pos.autoresolved_cleared_on_their_own', { autoResolved: String(r.autoResolved) }) : '') })); });
  const ack = (a: AqAlert) => guard(async () => { await api.acknowledgeAlert(a.id); });
  const resolve = (a: AqAlert) => ask(tx('growth.aiQueue.ask.resolveAlert'), (note) => guard(async () => { await api.resolveAlert(a.id, note || undefined); setMsg(tx('pos.alert_resolved')); }), { optional: true, confirmLabel: tx('pos.resolve') });
  const openRepair = (a: AqAlert) => {
    if (repairFor === a.id) { setRepairFor(null); return; }
    setRepairFor(a.id); setRepairAction(repairsFor(a.type)[0]); setRepairTech(''); setRepairGuest(''); setRepairReason(''); setErr(null);
    setTechGuests([]);
    if (a.type === 'overloaded_technician' && a.technicianId) {
      // which of this technician's guests to move — the live queue, filtered to them
      posQueueApi.items({ pageSize: 100 }).then((r: any) => setTechGuests(((Array.isArray(r) ? r : r?.items) || [])
        .filter((x: any) => x.assignedTechnicianId === a.technicianId && ['waiting', 'called', 'assigned', 'ready_for_tech'].includes(x.status))
        .map((x: any) => ({ queueItemId: x.queueItemId, customerName: x.customerName })))).catch(() => setTechGuests([]));
    }
  };
  const repair = async (a: AqAlert) => {
    if (repairAction === 'reassign' && !repairTech) { setErr(tx('pos.choose_the_technician_to_assign')); return; }
    if (repairAction === 'reassign' && a.type === 'overloaded_technician' && !repairGuest) { setErr(tx('pos.choose_which_guest_to_move')); return; }
    if (repairAction === 'cancel' && repairReason.trim().length < 3) { setErr(tx('pos.say_why_the_guest_is_being_1eh4')); return; }
    setBusy(true); setErr(null); setMsg(null);
    try {
      await api.repairAlert(a.id, { action: repairAction, ...(repairAction === 'reassign' ? { technicianId: repairTech } : {}), ...(a.type === 'overloaded_technician' && repairGuest ? { queueItemId: repairGuest } : {}), ...(repairReason.trim() ? { reason: repairReason.trim() } : {}) });
      setRepairFor(null); setMsg(repairAction === 'dismiss' ? tx('pos.alert_dismissed') : tx('pos.repaired_the_queue_was_updated'));
      await load(); onChanged();
    } catch (e: any) {
      setErr(isQueueConflict(e) && e?.body?.code ? queueConflictMessage(e, null, (t) => techName(t)) : errMsg(e));
      await load();
    } finally { setBusy(false); }
  };
  const saveThr = () => guard(async () => {
    if (!thrEdit) return;
    const n = (k: WaitKey) => Number(thrEdit[k]);
    const next = { approachingMin: n('approachingMin'), exceededMin: n('exceededMin'), severeMin: n('severeMin'), criticalMin: n('criticalMin') };
    if (Object.values(next).some((v) => !Number.isInteger(v) || v < 0 || v > 600)) throw new Error(tx('pos.each_wait_level_must_be_a_1143'));
    if (!(next.approachingMin <= next.exceededMin && next.exceededMin <= next.severeMin && next.severeMin <= next.criticalMin)) throw new Error(tx('pos.wait_levels_must_rise_approaching_exceeded_1gkf'));
    setThr(await api.setWaitThresholds(next)); setThrEdit(null); setMsg(tx('pos.wait_alert_levels_saved_for_this_1je0'));
  });

  return (
    <div style={card}>
      {askUi}
      <div style={cardHead}>
        <span>{tx('pos.live_alerts')}</span>
        <label style={{ ...muted, display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'inherit', fontWeight: 400 }}>
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> {tx('pos.show_resolved')}
        </label>
        <button style={{ ...btnGhost, marginLeft: 'auto' }} disabled={busy} onClick={scan}>{tx('pos.scan_queue')}</button>
      </div>
      {thr ? (
        <div style={{ ...muted, marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{tx('pos.wait_alerts_at')}{' '}{thr.approachingMin} / {thr.exceededMin} / {thr.severeMin} / {thr.criticalMin} {tx('pos.min')}</span>
          {can('ai_queue_assignment.manage_rules') && !thrEdit ? <button style={{ ...btnGhost, height: 26 }} onClick={() => setThrEdit({ approachingMin: String(thr.approachingMin), exceededMin: String(thr.exceededMin), severeMin: String(thr.severeMin), criticalMin: String(thr.criticalMin) })}>{tx('pos.adjust')}</button> : null}
        </div>
      ) : null}
      {thrEdit ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'end', marginBottom: 8 }}>
          {(['approachingMin', 'exceededMin', 'severeMin', 'criticalMin'] as WaitKey[]).map((k) => (
            <label key={k} style={{ display: 'grid', gap: 2 }}><span style={muted}>{pretty(k.replace('Min', ''))}</span><input aria-label={tx('pos.wait_level_k', { k: String(k) })} inputMode="numeric" style={{ ...input, width: 70 }} value={thrEdit[k]} onChange={(e) => setThrEdit({ ...thrEdit, [k]: e.target.value })} /></label>
          ))}
          <button style={btnGold} disabled={busy} onClick={saveThr}>{tx('pos.save_levels')}</button>
          <button style={btnGhost} onClick={() => setThrEdit(null)}>{tx('pos.cancel')}</button>
        </div>
      ) : null}
      {err ? <div role="alert" style={{ ...errText, marginBottom: 8 }}>{err}</div> : null}
      {msg ? <div role="status" style={{ ...okText, marginBottom: 8 }}>{msg}</div> : null}
      {alerts == null ? <div style={muted}>{tx('pos.loading')}</div>
        : alerts.length === 0 ? <div style={muted}>{showAll ? tx('pos.no_alerts_yet') : tx('pos.no_open_alerts_use_scan_queue_hu5d')}</div>
          : (
            <div style={{ display: 'grid', gap: 8 }}>
              {alerts.map((a) => {
                const tone = SEV_TONE[a.severity] || SEV_TONE.info;
                const closed = isClosedAlert(a) || isAutoResolved(a);
                return (
                  <div key={a.id} data-testid={`alert-${a.id}`} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 10, display: 'grid', gap: 6, opacity: closed ? 0.75 : 1 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                      <span style={pill(tone.bg, tone.fg)}>{pretty(a.type)}</span>
                      <span style={{ ...muted, textTransform: 'capitalize' }}>{severityLabel(a.severity)}</span>
                      <span style={isAutoResolved(a) ? { ...muted, color: '#3E8F57', fontWeight: 600 } : muted}>{alertStatusLabel(a)}</span>
                      {a.technicianId ? <span style={muted}>· {techName(a.technicianId)}</span> : null}
                    </div>
                    <div style={{ fontSize: 13, color: '#3A3733' }}>{codedText(a.reasonCoded ?? queueAlertReasonCoded(a.reason), a.reason)}</div>
                    {a.reviewNote ? <div style={muted}>{tx('pos.note_2')}{' '}{a.reviewNote}</div> : null}
                    {!closed && can('ai_queue_assignment.resolve_alerts') ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {a.status === 'open' ? <button style={btnGhost} onClick={() => ack(a)} disabled={busy}>{tx('pos.acknowledge')}</button> : null}
                        <button style={btnGhost} onClick={() => resolve(a)} disabled={busy}>{tx('pos.resolve')}</button>
                        <button style={btnGhost} onClick={() => openRepair(a)} disabled={busy}>{tx('pos.repair')}</button>
                      </div>
                    ) : null}
                    {repairFor === a.id ? (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        <select aria-label={tx('pos.repair_action')} style={input} value={repairAction} onChange={(e) => setRepairAction(e.target.value as AqRepairAction)}>{repairsFor(a.type).map((v) => <option key={v} value={v}>{REPAIR_LABEL[v]}</option>)}</select>
                        {repairAction === 'reassign' && a.type === 'overloaded_technician' ? (
                          <select aria-label={tx('pos.guest_to_move')} style={input} value={repairGuest} onChange={(e) => setRepairGuest(e.target.value)}><option value="">{tx('pos.which_guest')}</option>{techGuests.map((g) => <option key={g.queueItemId} value={g.queueItemId}>{g.customerName}</option>)}</select>
                        ) : null}
                        {repairAction === 'reassign' ? (
                          <select aria-label={tx('pos.repair_technician')} style={input} value={repairTech} onChange={(e) => setRepairTech(e.target.value)}><option value="">{tx('pos.to_technician')}</option>{roster.filter((r) => r.technicianId !== a.technicianId).map((r) => <option key={r.technicianId} value={r.technicianId}>{r.name}</option>)}</select>
                        ) : null}
                        <input aria-label={tx('pos.repair_reason')} style={{ ...input, flex: '1 1 160px' }} placeholder={repairAction === 'cancel' ? tx('pos.reason_required') : tx('pos.reason_optional')} value={repairReason} onChange={(e) => setRepairReason(e.target.value)} />
                        <button style={btnGold} disabled={busy} onClick={() => repair(a)}>{repairAction === 'dismiss' ? tx('pos.dismiss') : tx('pos.repair_2')}</button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
    </div>
  );
}
