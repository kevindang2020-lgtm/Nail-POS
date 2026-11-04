// AIQueueCustomerPanel.tsx — the per-customer AI assignment panel (BUILD_PLAN Phase 6, contract §B `GET entries/:id/panel`).
//
// Staff pick a guest from the LIVE queue (the old screen asked for a raw queue-entry ID, which nobody at a front desk
// has), see what the engine knows about them (requested / previous technician, VIP, appointment, late, party, lock),
// ask for a recommendation and decide: accept, reject (a reason AND a feedback code are required — that is what the
// engine learns from), override to another technician, or keep unassigned. Accept / override ASSIGN through the queue
// with the technician and queue version this panel showed; if another device moved the guest first the server answers
// 409 and the panel says so in plain words. Managers can lock a guest to a technician (or to "nobody").
// Round 2: shapes are the contract's (QueueAssignmentPanel — `candidates` at the top level with eligibility and the plain
// reasons a hard rule removed someone; decision response `{ decision, applied, queueItem, replayed? }`; 409
// `{ code: 'VERSION_CONFLICT', currentTechnicianId }`). Lock / unlock go through the queue (A) and answer the item.
// Multi-technician routing (contract §7): a guest whose best match is a split plan (or whose visit is already split) is
// decided on the VISIT PLAN (VisitPlanPanel — accept / adjust / reject / keep unassigned for every service at once) instead
// of the one-technician recommendation; any multi-service guest can open the plan with "Plan by service…".
import { useCallback, useEffect, useState } from 'react';
import { useInlineAsk } from '@aipowersalon/ui';
import type { QueueAssignmentPanel, QueueAssignmentDecisionRecord, QueueAssignmentRecommendation, QueueAssignmentDecisionRequest } from '@aipowersalon/api-contracts/tenant';
import { posAIQueueAssignmentApi as api, newIdempotencyKey } from '../../api/posAIQueueAssignmentApi';
import { posQueueApi } from '../../api/posQueueApi';
import { isQueueConflict, queueConflictMessage } from '../../lib/queueConflict';
import { VisitPlanPanel } from '../../components/VisitPlanPanel';
import { card, cardHead, input, btnGold, btnGhost, btnDanger, muted, errText, okText, pill, pct, mins, pretty, errMsg, when, FEEDBACK_CODES, DECISION_LABEL } from './aiQueueUi';
import { t as tx, getLanguage } from '@aipowersalon/mobile-sdk/i18n';

type LiveItem = { queueItemId: string; customerName: string; status: string; assignedTechnicianId?: string | null; assignedTechnicianName?: string | null; actualWaitMinutes?: number; checkedInAt?: string; isVip?: boolean; priority?: string; lock?: { technicianId: string | null } | null; version?: number;
  bestMatchMode?: 'single' | 'split'; bestMatchTechnicianNames?: string[]; sharedVisit?: boolean };
type Roster = { technicianId: string; name: string }[];
const ACTIVE = ['waiting', 'called', 'assigned', 'ready_for_tech'];

export function AIQueueCustomerPanel({ tick, roster, techName, can, onChanged, selectRequest, onDetails }: { tick: number; roster: Roster; techName: (id: string | null | undefined) => string; can: (p: string) => boolean; onChanged: () => void;
  /** A6 (Nov 4 2026): the guest overlay's "Assign Technician" hands the guest here (assignment goes through this panel's checks) */
  selectRequest?: { id: string; n: number } | null; onDetails?: (queueEntryId: string) => void }) {
  const [live, setLive] = useState<LiveItem[] | null>(null);
  const [liveErr, setLiveErr] = useState<string | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [panel, setPanel] = useState<QueueAssignmentPanel | null>(null);
  // §120: the model writes in the reader's POS language; the deterministic fallback is English — `language` says which
  const [explanation, setExplanation] = useState<{ text: string; language: 'en' | 'vi' } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<null | 'reject' | 'override' | 'lock'>(null);
  const [reason, setReason] = useState('');
  const [feedback, setFeedback] = useState('');
  const [chosen, setChosen] = useState('');
  const [lockTech, setLockTech] = useState('__nobody__');
  const [lockMinutes, setLockMinutes] = useState('');
  const [fullHistory, setFullHistory] = useState<QueueAssignmentDecisionRecord[] | null>(null);
  const [pastReco, setPastReco] = useState<{ id: string; reco: QueueAssignmentRecommendation | null; err?: string } | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const { ask, askUi } = useInlineAsk();

  const loadLive = useCallback(async () => {
    try {
      const r: any = await posQueueApi.items({ pageSize: 100 } as any);
      const rows: LiveItem[] = (Array.isArray(r) ? r : r?.items || []).filter((x: LiveItem) => ACTIVE.includes(x.status));
      setLive(rows); setLiveErr(null);
    } catch (e) { setLive([]); setLiveErr(errMsg(e, tx('growth.aiQueue.err.liveQueue'))); }
  }, []);
  // never clears `err`: a 409 message set just before this reload must stay on screen
  const loadPanel = useCallback(async (qid: string) => {
    try {
      const p = await api.panel(qid);
      setPanel(p);
      const rid = p.recommendation?.recommendationId;
      setExplanation(null);
      if (rid) { try { const ex = await api.explain(rid); setExplanation({ text: ex.explanation, language: ex.language === 'vi' ? 'vi' : 'en' }); } catch { /* the explanation is optional */ } }
    } catch (e) { setPanel(null); setErr(errMsg(e, tx('growth.aiQueue.err.guest'))); }
  }, []);

  useEffect(() => { void loadLive(); }, [loadLive, tick]);
  useEffect(() => { if (selId) void loadPanel(selId); }, [selId, loadPanel, tick]);

  useEffect(() => { if (selectRequest?.id) { setSelId(selectRequest.id); setPlanOpen(false); setMode(null); setMsg(null); setErr(null); setFullHistory(null); setPastReco(null); } }, [selectRequest?.id, selectRequest?.n]);
  const pick = (qid: string) => { setSelId(qid); setPlanOpen(false); setMode(null); setMsg(null); setErr(null); setFullHistory(null); setPastReco(null); };
  const selected = live?.find((x) => x.queueItemId === selId) || null;
  const guestName = selected?.customerName || tx('pos.this_guest_2');
  const reco = panel?.recommendation || null;
  const entry = panel?.entry;
  const lock = panel?.lock ?? entry?.lock ?? null;
  // the engine's live candidate list (eligible first); an ineligible one says why, so an override is an informed choice
  const cands = [...(panel?.candidates || [])].sort((a, b) => Number(b.eligible) - Number(a.eligible));
  const candidates = cands.map((c) => ({ technicianId: c.technicianId, name: c.eligible ? c.name : `${c.name} — ${c.reasons.join(', ') || tx('pos.not_eligible_2')}` }));
  const pickList: Roster = [...candidates, ...roster.filter((r) => !candidates.some((c) => c.technicianId === r.technicianId))];

  async function guard(fn: () => Promise<void>) {
    setBusy(true); setErr(null); setMsg(null);
    try { await fn(); }
    catch (e: any) {
      if (isQueueConflict(e)) { setErr(queueConflictMessage(e, guestName, (t) => techName(t))); await loadLive(); if (selId) await loadPanel(selId); }
      else setErr(errMsg(e));
    } finally { setBusy(false); }
  }
  const recommend = () => guard(async () => { if (!selId) return; await api.recommend(selId); await loadPanel(selId); });
  const decide = (body: QueueAssignmentDecisionRequest, done: string) => guard(async () => {
    if (!reco?.recommendationId || !selId) return;
    const r = await api.decide(reco.recommendationId, { ...body, idempotencyKey: newIdempotencyKey() });
    const chosenName = techName(body.chosenTechnicianId || r?.decision?.chosenTechnicianId || null);
    setMsg(r?.applied ? tx('pos.done_guestname_is_now_with_chosenname', { done: String(done), guestName: String(guestName), chosenName: String(chosenName) }) : tx('pos.done_recorded_the_guest_was_not_ryjg', { done: String(done) }));
    if (r?.replayed) setMsg(tx('pos.already_recorded_v0', { v0: String(r.applied ? tx('pos.guestname_is_with_chosenname', { guestName: String(guestName), chosenName: String(chosenName) }) : tx('pos.the_guest_was_not_moved')) }));
    setMode(null); setReason(''); setFeedback(''); setChosen('');
    await loadLive(); await loadPanel(selId); onChanged();
  });
  const accept = () => reco?.recommended && decide({ decision: 'accepted', chosenTechnicianId: reco.recommended.technicianId }, tx('growth.aiQueue.done.accepted'));
  const submitReject = () => {
    if (!reason.trim()) { setErr(tx('pos.say_why_you_are_rejecting_this_3maf')); return; }
    if (!feedback) { setErr(tx('pos.pick_what_was_wrong_with_it_lg6i')); return; }
    decide({ decision: 'rejected', reason: reason.trim(), feedbackCode: feedback }, tx('growth.aiQueue.done.rejected'));
  };
  const submitOverride = () => {
    if (!chosen) { setErr(tx('pos.choose_the_technician_this_guest_should_q5bf')); return; }
    if (!reason.trim()) { setErr(tx('pos.say_why_you_are_choosing_a_mvk3')); return; }
    decide({ decision: 'overridden', chosenTechnicianId: chosen, reason: reason.trim(), feedbackCode: feedback || null }, tx('growth.aiQueue.done.overridden'));
  };
  const keepUnassigned = () => ask(tx('growth.aiQueue.ask.keepUnassigned'), (why) => decide({ decision: 'kept_unassigned', reason: why || null }, tx('growth.aiQueue.done.keptUnassigned')), { optional: true, confirmLabel: tx('pos.keep_unassigned') });
  const submitLock = () => guard(async () => {
    if (!selId) return;
    if (!reason.trim()) { setErr(tx('pos.a_lock_needs_a_reason_staff_54w5')); return; }
    const m = parseInt(lockMinutes, 10);
    await posQueueApi.lock(selId, { technicianId: lockTech === '__nobody__' || !lockTech ? null : lockTech, reason: reason.trim(), ...(Number.isFinite(m) && m > 0 ? { expiresInMinutes: m } : {}) });
    setMsg(lockTech && lockTech !== '__nobody__' ? tx('pos.guestname_is_locked_to_locktech', { guestName: String(guestName), lockTech: String(techName(lockTech)) }) : tx('pos.guestname_is_locked_as_unassigned', { guestName: String(guestName) }));
    setMode(null); setReason(''); setLockTech('__nobody__'); setLockMinutes('');
    await loadLive(); await loadPanel(selId); onChanged();
  });
  const unlock = () => ask(tx('growth.aiQueue.ask.unlock', { name: String(guestName) }), (why) => guard(async () => { if (!selId) return; await posQueueApi.unlock(selId, { reason: why }); setMsg(tx('pos.guestname_is_unlocked', { guestName: String(guestName) })); await loadLive(); await loadPanel(selId); onChanged(); }), { confirmLabel: tx('pos.unlock') });
  const loadFullHistory = () => guard(async () => { if (selId) setFullHistory(await api.entryDecisions(selId)); });
  const showPastReco = (rid: string) => guard(async () => {
    if (pastReco?.id === rid) { setPastReco(null); return; }
    try { setPastReco({ id: rid, reco: await api.getRecommendation(rid) }); }
    catch (e) { setPastReco({ id: rid, reco: null, err: errMsg(e, tx('growth.aiQueue.err.recommendation')) }); }
  });
  const decisions = fullHistory || panel?.decisions || [];
  const canOverride = can('ai_queue_assignment.override');
  const canAssign = can('ai_queue_assignment.assign');
  const split = !!selected && (selected.bestMatchMode === 'split' || !!selected.sharedVisit);
  const showPlan = split || planOpen;

  return (
    <div style={card}>
      {askUi}
      <div style={cardHead}>{tx('pos.guest_assignment')}</div>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'minmax(0, 260px) minmax(0, 1fr)' }} className="aq-panel-grid">
        {/* the live queue — pick a guest; no raw ID box */}
        <div style={{ display: 'grid', gap: 6, alignContent: 'start', maxHeight: 420, overflow: 'auto' }} aria-label={tx('pos.live_queue')}>
          {live == null ? <div style={muted}>{tx('pos.loading_the_queue')}</div>
            : live.length === 0 ? <div style={muted}>{liveErr || tx('pos.nobody_is_waiting_right_now')}</div>
              : live.map((g) => (
                <button key={g.queueItemId} type="button" onClick={() => pick(g.queueItemId)} aria-pressed={g.queueItemId === selId}
                  style={{ textAlign: 'left', border: g.queueItemId === selId ? '1.5px solid #A96F22' : '1px solid var(--line)', borderRadius: 10, padding: '8px 10px', background: g.queueItemId === selId ? '#FCF3E4' : '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{g.customerName}</span>
                    {g.isVip || g.priority === 'vip' ? <span style={pill('#EFEAFA', '#6E59C7')}>VIP</span> : null}
                    {g.lock ? <span style={pill('#F4E6D0', '#8A5A12')}>{tx('pos.locked_2')}</span> : null}
                  </div>
                  <div style={muted}>{pretty(g.status)} · {g.assignedTechnicianName || tx('growth.aiQueue.unassigned')}{g.actualWaitMinutes != null ? tx('pos.actualwaitminutes_min_2', { actualWaitMinutes: String(g.actualWaitMinutes) }) : ''}</div>
                </button>
              ))}
        </div>

        <div style={{ display: 'grid', gap: 10, alignContent: 'start', minWidth: 0 }}>
          {!selId ? <div style={muted}>{tx('pos.pick_a_guest_from_the_live_na6j')}</div> : (
            <>
              {err ? <div role="alert" style={errText}>{err}</div> : null}
              {msg ? <div role="status" style={okText}>{msg}</div> : null}
              {onDetails ? <div><button type="button" style={btnGhost} onClick={() => onDetails(selId)} data-testid="aq-guest-details">{tx('growth.aiQueue.ov.open')}</button></div> : null}
              {entry ? (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} aria-label={tx('pos.what_the_engine_knows')}>
                  {entry.requestedTechnicianId ? <span style={pill('#E9F1FA', '#3C7FB6')}>{tx('pos.asked_for')}{' '}{techName(entry.requestedTechnicianId)}</span> : null}
                  {entry.previousTechnicianId ? <span style={pill('#F3ECE1', '#6C6965')}>{tx('pos.last_time')}{' '}{techName(entry.previousTechnicianId)}</span> : null}
                  {entry.isVip ? <span style={pill('#EFEAFA', '#6E59C7')}>VIP</span> : null}
                  {entry.isAppointment ? <span style={pill('#E9F6EC', '#2E9E54')}>{tx('pos.appointment_3')}{entry.appointmentStartAt ? ` ${when(entry.appointmentStartAt)}` : ''}</span> : null}
                  {entry.lateMinutes ? <span style={pill('#FBEEDD', '#9B6B1E')}>{entry.lateMinutes} {tx('pos.min_late')}</span> : null}
                  {entry.groupId ? <span style={pill('#F3EEFB', '#6E59C7')}>{tx('pos.party_of')}{' '}{entry.groupSize || 2}</span> : null}
                  {entry.serviceDurationMinutes ? <span style={pill('#F3ECE1', '#6C6965')}>{entry.serviceDurationMinutes} {tx('pos.min_of_services')}</span> : null}
                </div>
              ) : null}
              {lock ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', background: '#FBF4E8', borderRadius: 10, padding: '8px 10px' }}>
                  <span style={pill('#F4E6D0', '#8A5A12')}>{tx('pos.locked_2')}</span>
                  <span style={{ fontSize: 13 }}>{lock.technicianId ? tx('pos.to_technicianid', { technicianId: String(techName(lock.technicianId)) }) : tx('pos.to_stay_unassigned')}{lock.reason ? ` — ${lock.reason}` : ''}</span>
                  {canOverride ? <button style={btnGhost} disabled={busy} onClick={unlock}>{tx('pos.unlock')}</button> : null}
                </div>
              ) : null}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button style={btnGold} disabled={busy || !can('ai_queue_assignment.recommend')} onClick={recommend}>{reco ? tx('pos.recommend_again') : tx('pos.recommend')}</button>
                {!lock && canOverride ? <button style={btnGhost} disabled={busy} onClick={() => { setMode(mode === 'lock' ? null : 'lock'); setReason(''); setErr(null); }}>{tx('pos.lock_2')}</button> : null}
                {!showPlan ? <button style={btnGhost} disabled={busy} onClick={() => setPlanOpen(true)}>{tx('pos.plan_by_service')}</button> : null}
              </div>

              {showPlan && selId ? (
                <VisitPlanPanel key={selId} queueItemId={selId} customerName={guestName} roster={roster.map((r) => ({ technicianId: r.technicianId, displayName: r.name }))} can={can}
                  onChanged={() => { void loadLive(); void loadPanel(selId); onChanged(); }} onClose={split ? undefined : () => setPlanOpen(false)} />
              ) : reco ? (
                <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 10, display: 'grid', gap: 6 }}>
                  {reco.recommended ? (
                    <>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{tx('pos.suggested')}{' '}{reco.recommended.name} <span style={muted}>· {pct(reco.confidence)} {tx('pos.confidence')}{reco.recommended.estimatedStartInMinutes != null ? tx('pos.could_start_in_estimatedstartinminutes', { estimatedStartInMinutes: String(mins(reco.recommended.estimatedStartInMinutes)) }) : ''}</span></div>
                      {reco.recommended.reasons.length ? <div style={muted}>{reco.recommended.reasons.join(' · ')}</div> : null}
                      {reco.recommended.warnings.length ? <div style={{ color: '#9B6B1E', fontSize: 12 }}>{reco.recommended.warnings.join(' · ')}</div> : null}
                    </>
                  ) : <div style={errText}>{reco.conflicts.join('; ') || tx('pos.no_technician_can_take_this_guest_aoe3')}</div>}
                  {explanation ? <div style={{ ...muted, fontStyle: 'italic' }} lang={explanation.language} data-testid="aiq-explanation">{explanation.language !== getLanguage() ? <b style={{ fontStyle: 'normal' }}>{tx(explanation.language === 'en' ? 'growth.aiQueue.explanationEnglish' : 'growth.aiQueue.explanationVietnamese')}{' '}</b> : null}{explanation.text}</div> : null}
                  {reco.alternates.length ? <div style={muted}>{tx('pos.also_possible')}{' '}{reco.alternates.map((a) => a.name).join(', ')}</div> : null}
                  <div style={{ ...muted, fontSize: 11 }}>{tx('pos.settings_version')}{' '}{reco.configVersion || reco.ruleVersion}{reco.queueVersion != null ? tx('pos.queue_version_queueversion', { queueVersion: String(reco.queueVersion) }) : ''} · {when(reco.generatedAt)}</div>
                  {canAssign ? (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button style={btnGold} disabled={busy || !reco.recommended || !reco.recommendationId} onClick={accept}>{tx('pos.accept')}</button>
                      <button style={btnGhost} disabled={busy || !reco.recommendationId} onClick={() => { setMode(mode === 'reject' ? null : 'reject'); setReason(''); setFeedback(''); setErr(null); }}>{tx('pos.reject_2')}</button>
                      {canOverride ? <button style={btnGhost} disabled={busy || !reco.recommendationId} onClick={() => { setMode(mode === 'override' ? null : 'override'); setReason(''); setChosen(''); setErr(null); }}>{tx('pos.choose_someone_else')}</button> : null}
                      <button style={btnGhost} disabled={busy || !reco.recommendationId} onClick={keepUnassigned}>{tx('pos.keep_unassigned')}</button>
                    </div>
                  ) : null}
                </div>
              ) : <div style={muted}>{tx('pos.no_recommendation_yet_for_this_guest')}</div>}

              {mode === 'reject' ? (
                <div style={{ display: 'grid', gap: 6, background: '#FBF7EF', borderRadius: 10, padding: 10 }}>
                  <label style={{ display: 'grid', gap: 2 }}><span style={muted}>{tx('pos.what_was_wrong_with_it')}</span>
                    <select aria-label={tx('pos.feedback')} style={input} value={feedback} onChange={(e) => setFeedback(e.target.value)}><option value="">{tx('pos.choose')}</option>{FEEDBACK_CODES().map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                  </label>
                  <label style={{ display: 'grid', gap: 2 }}><span style={muted}>{tx('pos.reason_2')}</span><input aria-label={tx('pos.reject_reason')} style={input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tx('pos.e_g_guest_asked_for_mia')} /></label>
                  <div style={{ display: 'flex', gap: 8 }}><button style={btnDanger} disabled={busy} onClick={submitReject}>{tx('pos.reject_recommendation')}</button><button style={btnGhost} onClick={() => setMode(null)}>{tx('pos.cancel')}</button></div>
                </div>
              ) : null}
              {mode === 'override' ? (
                <div style={{ display: 'grid', gap: 6, background: '#FBF7EF', borderRadius: 10, padding: 10 }}>
                  <label style={{ display: 'grid', gap: 2 }}><span style={muted}>{tx('pos.technician')}</span>
                    <select aria-label={tx('pos.override_technician')} style={input} value={chosen} onChange={(e) => setChosen(e.target.value)}><option value="">{tx('pos.choose')}</option>{pickList.map((t) => <option key={t.technicianId} value={t.technicianId}>{t.name}</option>)}</select>
                  </label>
                  <label style={{ display: 'grid', gap: 2 }}><span style={muted}>{tx('pos.why_optional_feedback')}</span>
                    <select aria-label={tx('pos.override_feedback')} style={input} value={feedback} onChange={(e) => setFeedback(e.target.value)}><option value="">—</option>{FEEDBACK_CODES().map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                  </label>
                  <label style={{ display: 'grid', gap: 2 }}><span style={muted}>{tx('pos.reason_2')}</span><input aria-label={tx('pos.override_reason_2')} style={input} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
                  <div style={{ display: 'flex', gap: 8 }}><button style={btnGold} disabled={busy} onClick={submitOverride}>{tx('pos.assign_to_this_technician')}</button><button style={btnGhost} onClick={() => setMode(null)}>{tx('pos.cancel')}</button></div>
                </div>
              ) : null}
              {mode === 'lock' ? (
                <div style={{ display: 'grid', gap: 6, background: '#FBF7EF', borderRadius: 10, padding: 10 }}>
                  <label style={{ display: 'grid', gap: 2 }}><span style={muted}>{tx('pos.lock_to')}</span>
                    <select aria-label={tx('pos.lock_technician')} style={input} value={lockTech} onChange={(e) => setLockTech(e.target.value)}><option value="__nobody__">{tx('pos.nobody_keep_unassigned')}</option>{pickList.map((t) => <option key={t.technicianId} value={t.technicianId}>{t.name}</option>)}</select>
                  </label>
                  <label style={{ display: 'grid', gap: 2 }}><span style={muted}>{tx('pos.reason_2')}</span><input aria-label={tx('pos.lock_reason')} style={input} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
                  <label style={{ display: 'grid', gap: 2 }}><span style={muted}>{tx('pos.expires_after_minutes_optional')}</span><input aria-label={tx('pos.lock_minutes')} inputMode="numeric" style={input} value={lockMinutes} onChange={(e) => setLockMinutes(e.target.value)} /></label>
                  <div style={{ display: 'flex', gap: 8 }}><button style={btnGold} disabled={busy} onClick={submitLock}>{tx('pos.lock')}</button><button style={btnGhost} onClick={() => setMode(null)}>{tx('pos.cancel')}</button></div>
                </div>
              ) : null}

              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 12.5 }}>{tx('pos.decisions_for_this_guest')}</span>
                  {!fullHistory ? <button style={{ ...btnGhost, height: 26 }} disabled={busy} onClick={loadFullHistory}>{tx('pos.full_history')}</button> : null}
                </div>
                {decisions.length === 0 ? <div style={muted}>{tx('pos.none_yet')}</div> : (
                  <div style={{ display: 'grid', gap: 4 }}>
                    {decisions.map((d) => (
                      <div key={d.id} style={{ fontSize: 12.5, borderBottom: '1px solid var(--line)', paddingBottom: 4 }}>
                        <b>{DECISION_LABEL[d.decision] || pretty(d.decision)}</b>{d.chosenTechnicianId ? ` → ${techName(d.chosenTechnicianId)}` : ''}{d.applied === false && (d.decision === 'accepted' || d.decision === 'overridden') ? tx('pos.not_applied_2') : ''}
                        {d.reason ? <span style={muted}> · {d.reason}</span> : null}{d.feedbackCode ? <span style={muted}> · {pretty(d.feedbackCode)}</span> : null}
                        <span style={muted}> · {when(d.createdAt)}</span>
                        {d.recommendationId ? <button style={{ ...btnGhost, height: 22, fontSize: 11, marginLeft: 6 }} onClick={() => showPastReco(d.recommendationId!)}>{tx('pos.what_was_suggested')}</button> : null}
                        {pastReco && pastReco.id === d.recommendationId ? (
                          <div style={{ ...muted, marginTop: 2 }}>{pastReco.err || (pastReco.reco?.recommended ? tx('pos.suggested_name_at_confidence_confidence_v2', { name: String(pastReco.reco.recommended.name), confidence: String(pct(pastReco.reco.confidence)), v2: String(pastReco.reco.alternates?.length ? `; also ${pastReco.reco.alternates.map((a) => a.name).join(', ')}` : '') }) : tx('pos.no_technician_was_suggested'))}</div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
