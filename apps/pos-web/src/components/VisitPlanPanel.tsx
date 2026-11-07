// VisitPlanPanel.tsx — "Best Match" for a guest with several services: the engine's VISIT PLAN (one technician, or the
// services split across technicians), decided in one step (multi-technician routing contract §7).
//
// AI mode (POST pos/ai-queue-assignment/entries/:id/plan): every line shows the service, the technician, whether it runs
// together with the others or after another service, and when it should start / finish. Staff accept the WHOLE plan
// (`accepted`), or change a line's technician from that line's alternates — or take the offered "keep one technician" —
// and assign the changed plan (`adjusted`, the full line list; needs `ai_queue_assignment.override`, otherwise the button
// is disabled with a plain note). Reject (reason + what was wrong) and Keep unassigned are recorded decisions.
// Manual mode (no AI entitlement / no recommend permission): one technician select per service → POST
// pos/queue/plans/assign with the technicians and queue version this panel read (source staff).
// Both paths go through the queue's ONE plan writer — all services or none. A 409 (VERSION_CONFLICT / ASSIGNMENT_LOCKED)
// is said in plain words naming who has the guest (or the service) now, and the plan is reloaded. A failed read is an
// honest error with a retry — never an empty "nothing to do".
import React, { useCallback, useEffect, useState } from 'react';
import { useInlineAsk } from '@aipowersalon/ui';
import type { PlanRecommendationView, VisitPlan, VisitPlanLine, AssignPlanRequest, QueueServiceAssignmentView } from '@aipowersalon/api-contracts/tenant';
import { posAIQueueAssignmentApi as aq, newIdempotencyKey } from '../api/posAIQueueAssignmentApi';
import { posQueueApi } from '../api/posQueueApi';
import { isQueueConflict, planConflictMessage } from '../lib/queueConflict';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { TechnicianPickerButton } from './TechnicianPickerButton';

export type PlanRosterTech = { technicianId: string; displayName: string };
type ItemDetail = {
  queueItemId: string; customerName?: string; version?: number; assignedTechnicianId?: string | null;
  serviceAssignments?: QueueServiceAssignmentView[]; requestedServices?: { serviceId?: string; serviceName?: string; name?: string }[];
};
type ManualLine = { serviceId: string; serviceName: string; technicianId: string | null };

/** why a plan was rejected — codes the server stores; labels read at render (admin.visitPlan.feedback.<code>) */
export const FEEDBACK_CODES = ['customer_preference', 'wrong_skill', 'technician_busy', 'appointment_conflict', 'fairness_rotation', 'station_or_equipment', 'other'] as const;
export const FEEDBACK = (): [string, string][] => FEEDBACK_CODES.map((c) => [c, tx(`admin.visitPlan.feedback.${c}`)]);
const O = 'var(--aps-orange, #A96F22)';
export const planUi = {
  box: { background: 'var(--card, #FFFCF6)', border: `1px solid ${O}`, borderRadius: 12, padding: 12, display: 'grid', gap: 8 } as React.CSSProperties,
  btn: { minHeight: 44, padding: '0 16px', borderRadius: 10, border: `1px solid ${O}`, background: O, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' } as React.CSSProperties,
  ghost: { minHeight: 44, padding: '0 14px', borderRadius: 10, border: '1px solid var(--line, #E5D8C3)', background: '#fff', color: '#4A4032', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' } as React.CSSProperties,
  select: { minHeight: 44, borderRadius: 10, border: '1px solid var(--line, #E5D8C3)', padding: '0 10px', background: '#FFFDF8', fontFamily: 'inherit', fontSize: 13, minWidth: 0 } as React.CSSProperties,
  muted: { color: 'var(--muted, #8A7A66)', fontSize: 12 } as React.CSSProperties,
  warn: { color: '#9B6B1E', fontSize: 12 } as React.CSSProperties,
  err: { color: '#B4451E', fontSize: 12.5 } as React.CSSProperties,
  ok: { color: '#2E7D4F', fontSize: 12.5 } as React.CSSProperties,
  chip: (bg: string, fg: string): React.CSSProperties => ({ background: bg, color: fg, borderRadius: 999, padding: '2px 9px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }),
};
export const minsLabel = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? null : n <= 0 ? 'now' : tx('pos.in_n_min', { n: String(Math.round(n)) }));
/** "together" / "after Manicure" — the line's timing in plain words */
export function timingLabel(line: Pick<VisitPlanLine, 'timing' | 'afterServiceId'>, all: Pick<VisitPlanLine, 'serviceId' | 'serviceName'>[]): string {
  if (line.timing !== 'after') return 'together';
  const prev = line.afterServiceId ? all.find((x) => x.serviceId === line.afterServiceId)?.serviceName : null;
  return prev ? tx('pos.after_prev', { prev: String(prev) }) : tx('pos.after_the_previous_service');
}
export function etaLabel(start: number | null | undefined, end: number | null | undefined): string {
  const s = minsLabel(start); const e = end == null || !Number.isFinite(end) ? null : tx('pos.done_end', { end: String(minsLabel(end)) });
  if (!s && !e) return tx('pos.time_unknown');
  return [s ? tx('pos.starts_s', { s: String(s) }) : tx('pos.start_unknown'), e].filter(Boolean).join(' · ');
}

export function VisitPlanPanel({ queueItemId, customerName, roster, can, onChanged, onClose, pickFromServer = false }: {
  queueItemId: string; customerName: string; roster: PlanRosterTech[]; can: (permission: string) => boolean;
  /** 200-technician §2: `roster` is only the names on screen (one page) — pick each service's technician through the
   *  server-paged picker (approved for that service) instead of a <select> over the roster */
  pickFromServer?: boolean;
  /** called after a decision / assign (message) or a conflict (null) — the parent refetches its board */
  onChanged: (message: string | null) => void; onClose?: () => void;
}) {
  const [view, setView] = useState<'loading' | 'ai' | 'manual' | 'error'>('loading');
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [manualWhy, setManualWhy] = useState<string | null>(null);
  const [reco, setReco] = useState<PlanRecommendationView | null>(null);
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [feedback, setFeedback] = useState('');
  const { ask, askUi } = useInlineAsk();
  const canAssign = can('ai_queue_assignment.assign');
  const canOverride = can('ai_queue_assignment.override');
  const canManual = can('pos.queue.assign_technician');

  const loadManual = useCallback(async (why: string | null) => {
    setView('manual'); setManualWhy(why); setDraft({});
    try { setDetail(await posQueueApi.item(queueItemId) as ItemDetail); setLoadErr(null); }
    catch (e: any) { setDetail(null); setLoadErr(tx('admin.visitPlan.loadFailed', { name: customerName, reason: e?.message || tx('pos.please_retry') })); }
  }, [queueItemId, customerName]);
  const loadPlan = useCallback(async () => {
    if (!can('ai_queue_assignment.recommend')) { await loadManual(null); return; }
    setView((v) => (v === 'ai' ? v : 'loading'));
    try {
      const r = await aq.planVisit(queueItemId);
      if (!r || !r.visit) throw new Error(tx('pos.the_server_sent_no_plan_for_ps9f'));
      setReco(r); setDraft({}); setLoadErr(null); setView('ai');
    } catch (e: any) {
      if (e?.status === 402 || e?.status === 403) { await loadManual(e?.status === 402 ? tx('pos.ai_plans_are_not_enabled_for_17cd') : null); return; }
      setReco(null); setLoadErr(tx('admin.visitPlan.planFailed', { name: customerName, reason: e?.message || tx('pos.please_retry') })); setView('error');
    }
    // `can` is a fresh closure each render; the permission set does not change while the panel is open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueItemId, customerName, loadManual]);
  useEffect(() => { void loadPlan(); }, [loadPlan]);

  const plan: VisitPlan | null = reco?.visit ?? null;
  const lines = plan?.lines ?? [];
  const nameOf = (tid: string | null | undefined): string | null => {
    if (!tid) return null;
    const r = roster.find((x) => x.technicianId === tid)?.displayName; if (r) return r;
    for (const l of lines) { if (l.technicianId === tid && l.technicianName) return l.technicianName; const a = l.alternates.find((x) => x.technicianId === tid); if (a) return a.name; }
    if (plan?.singleTechnicianAlternative?.technicianId === tid) return plan.singleTechnicianAlternative.name;
    return null;
  };
  const manualLines: ManualLine[] = detail
    ? (detail.serviceAssignments?.length
      ? detail.serviceAssignments.map((x) => ({ serviceId: x.serviceId, serviceName: x.serviceName || tx('glossary.term.service'), technicianId: x.technicianId }))
      : (detail.requestedServices || []).filter((x) => x.serviceId).map((x) => ({ serviceId: x.serviceId!, serviceName: x.serviceName || x.name || tx('glossary.term.service'), technicianId: null })))
    : [];
  const serviceNameOf = (sid: string) => lines.find((l) => l.serviceId === sid)?.serviceName || manualLines.find((l) => l.serviceId === sid)?.serviceName || null;
  const effective = (l: VisitPlanLine) => draft[l.serviceId] ?? l.technicianId;
  const changed = lines.some((l) => draft[l.serviceId] != null && draft[l.serviceId] !== l.technicianId);
  const uncovered = lines.filter((l) => !effective(l));
  const summary = (pairs: { serviceName: string; technicianId: string | null }[]) => pairs.map((p) => `${p.serviceName} → ${nameOf(p.technicianId) || tx('pos.a_technician')}`).join(', ');

  async function guard(fn: () => Promise<void>, reload: () => Promise<void>) {
    setBusy(true); setErr(null); setMsg(null);
    try { await fn(); }
    catch (e: any) {
      if (isQueueConflict(e)) { setErr(planConflictMessage(e, customerName, nameOf, serviceNameOf)); onChanged(null); await reload(); }
      else setErr(e?.message || tx('pos.action_failed_nothing_was_assigned'));
    } finally { setBusy(false); }
  }
  const finish = (text: string) => { setMsg(text); setRejecting(false); setReason(''); setFeedback(''); setDraft({}); onChanged(text); };

  // ── AI decisions ──
  const accept = () => guard(async () => {
    if (!reco || !plan) return;
    const body = changed
      ? { decision: 'adjusted' as const, lines: lines.map((l) => ({ queueItemId: l.queueItemId, serviceId: l.serviceId, technicianId: effective(l)! })) }
      : { decision: 'accepted' as const };
    const r = await aq.decidePlan(reco.recommendationId, { ...body, idempotencyKey: newIdempotencyKey() });
    const pairs = lines.map((l) => ({ serviceName: l.serviceName, technicianId: effective(l) }));
    finish(r?.replayed ? tx('pos.already_recorded_customername_pairs', { customerName: String(customerName), pairs: String(summary(pairs)) }) : r?.applied ? tx('pos.customername_is_assigned_pairs', { customerName: String(customerName), pairs: String(summary(pairs)) }) : tx('pos.recorded_customername_was_not_moved', { customerName: String(customerName) }));
  }, loadPlan);
  const keepOne = () => { const t = plan?.singleTechnicianAlternative; if (!t) return; setDraft(Object.fromEntries(lines.map((l) => [l.serviceId, t.technicianId]))); };
  const keepUnassigned = () => ask(tx('admin.visitPlan.askKeepUnassigned', { name: customerName }), (why) => guard(async () => {
    if (!reco) return;
    await aq.decidePlan(reco.recommendationId, { decision: 'kept_unassigned', reason: why || null, idempotencyKey: newIdempotencyKey() });
    finish(tx('admin.visitPlan.staysUnassigned', { name: customerName }));
  }, loadPlan), { optional: true, confirmLabel: tx('pos.keep_unassigned') });
  const submitReject = () => {
    if (!reason.trim()) { setErr(tx('pos.say_why_you_are_rejecting_this_16xz')); return; }
    if (!feedback) { setErr(tx('pos.pick_what_was_wrong_with_it_lg6i')); return; }
    void guard(async () => {
      if (!reco) return;
      await aq.decidePlan(reco.recommendationId, { decision: 'rejected', reason: reason.trim(), feedbackCode: feedback, idempotencyKey: newIdempotencyKey() });
      finish(tx('admin.visitPlan.rejected', { name: customerName }));
    }, loadPlan);
  };

  // ── manual (no AI) ──
  const manualTech = (l: ManualLine) => draft[l.serviceId] ?? l.technicianId ?? '';
  const assignManual = () => {
    if (!detail) return;
    if (manualLines.some((l) => !manualTech(l))) { setErr(tx('pos.pick_a_technician_for_every_service_1m4a')); return; }
    if (typeof detail.version !== 'number') { setErr(tx('pos.this_guest_could_not_be_checked_z6s3')); return; }
    void guard(async () => {
      const body: AssignPlanRequest = {
        items: [{ queueItemId, expectedVersion: detail.version!, expectedTechnicianId: detail.assignedTechnicianId ?? null,
          lines: manualLines.map((l) => ({ serviceId: l.serviceId, technicianId: manualTech(l), expectedTechnicianId: l.technicianId ?? null })) }],
        idempotencyKey: newIdempotencyKey(), source: 'staff',
      };
      const r = await posQueueApi.assignPlan(body);
      const pairs = manualLines.map((l) => ({ serviceName: l.serviceName, technicianId: manualTech(l) }));
      finish(r?.replayed ? tx('pos.already_recorded_customername_pairs', { customerName: String(customerName), pairs: String(summary(pairs)) }) : tx('pos.customername_is_assigned_pairs', { customerName: String(customerName), pairs: String(summary(pairs)) }));
      await loadManual(manualWhy);
    }, () => loadManual(manualWhy));
  };

  const head = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <div style={{ fontWeight: 800, fontSize: 14 }}>{tx('pos.best_match_2')}{' '}{customerName}</div>
      {view === 'ai' && plan ? <span style={planUi.chip(plan.mode === 'split' ? '#EFEAFA' : '#E9F6EC', plan.mode === 'split' ? '#6E59C7' : '#2E7D4F')}>{plan.mode === 'split' ? tx('pos.split_across_techniciancount_technicians', { technicianCount: String(plan.technicianCount) }) : tx('pos.one_technician')}</span> : null}
      {view === 'manual' ? <span style={planUi.chip('#F1ECE2', '#8A7A66')}>{tx('pos.pick_by_hand')}</span> : null}
      {onClose ? <button type="button" style={{ ...planUi.ghost, marginLeft: 'auto', minHeight: 36 }} onClick={onClose}>{tx('pos.close')}</button> : null}
    </div>
  );

  return (
    <div className="vpp" style={planUi.box} aria-label={tx('pos.visit_plan_for_customername', { customerName: String(customerName) })}>
      {askUi}
      {head}
      {err ? <div role="alert" style={planUi.err}>{err}</div> : null}
      {msg ? <div role="status" style={planUi.ok}>{msg}</div> : null}

      {view === 'loading' ? <div style={planUi.muted}>{tx('pos.working_out_the_best_technicians')}</div> : null}

      {view === 'error' ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <div role="alert" style={planUi.err}>{loadErr}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" style={planUi.btn} onClick={() => { void loadPlan(); }}>{tx('pos.try_again')}</button>
            {canManual ? <button type="button" style={planUi.ghost} onClick={() => { void loadManual(null); }}>{tx('pos.pick_technicians_by_hand')}</button> : null}
          </div>
        </div>
      ) : null}

      {view === 'ai' && plan ? (
        <>
          <div style={planUi.muted}>
            {plan.estimatedStartInMinutes == null && plan.estimatedFinishInMinutes == null ? tx('pos.time_unknown_a_technician_s_availability_cl45') : etaLabel(plan.estimatedStartInMinutes, plan.estimatedFinishInMinutes)}
            {tx('pos.v0_confidence', { v0: String(Math.round((plan.confidence || 0) * 100)) })}
          </div>
          {plan.conflicts.length ? <div style={planUi.err}>{plan.conflicts.join(' · ')}</div> : null}
          {plan.warnings.length ? <div style={planUi.warn}>{plan.warnings.join(' · ')}</div> : null}
          <div style={{ display: 'grid', gap: 6 }} aria-label={tx('pos.plan_lines')}>
            {lines.map((l) => {
              const opts = [
                ...(l.technicianId ? [{ technicianId: l.technicianId, label: tx('admin.visitPlan.suggested', { name: l.technicianName || nameOf(l.technicianId) || tx('glossary.people.technician') }) }] : []),
                ...l.alternates.filter((a) => a.technicianId !== l.technicianId).map((a) => ({ technicianId: a.technicianId, label: `${a.name}${minsLabel(a.estimatedStartInMinutes) ? tx('pos.starts_estimatedstartinminutes', { estimatedStartInMinutes: String(minsLabel(a.estimatedStartInMinutes)) }) : ''}` })),
              ];
              const cur = effective(l);
              if (cur && !opts.some((o) => o.technicianId === cur)) opts.push({ technicianId: cur, label: nameOf(cur) || tx('glossary.people.technician') });
              return (
                <div key={l.serviceId} data-testid={`plan-line-${l.serviceId}`} style={{ border: '1px solid var(--line, #E5D8C3)', borderRadius: 10, padding: 8, display: 'grid', gap: 4 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 13, flex: '1 1 140px' }}>{l.serviceName} <span style={planUi.muted}>· {l.durationMinutes} {tx('pos.min')}</span></span>
                    <span style={planUi.chip(l.timing === 'after' ? '#FBF1E6' : '#E9F1FA', l.timing === 'after' ? '#9B6B1E' : '#3C7FB6')}>{timingLabel(l, lines)}</span>
                    <span style={planUi.muted}>{etaLabel(l.estimatedStartInMinutes, l.estimatedEndInMinutes)}</span>
                  </div>
                  {opts.length ? (
                    <select aria-label={tx('pos.technician_for_servicename', { serviceName: String(l.serviceName) })} style={planUi.select} value={cur || ''} disabled={busy} onChange={(e) => setDraft({ ...draft, [l.serviceId]: e.target.value })}>
                      {!cur ? <option value="">{tx('pos.no_technician_yet')}</option> : null}
                      {opts.map((o) => <option key={o.technicianId} value={o.technicianId}>{o.label}</option>)}
                    </select>
                  ) : <div style={planUi.err}>{tx('pos.no_technician_can_do')}{' '}{l.serviceName} {tx('pos.right_now')}{l.ineligible.length ? ` (${l.ineligible.map((x) => `${x.name}: ${x.reasons.join(', ')}`).join('; ')})` : ''}.</div>}
                  {l.reasons.length ? <div style={planUi.muted}>{l.reasons.join(' · ')}</div> : null}
                  {l.warnings.length ? <div style={planUi.warn}>{l.warnings.join(' · ')}</div> : null}
                </div>
              );
            })}
          </div>
          {plan.mode === 'split' && plan.singleTechnicianAlternative ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" style={planUi.ghost} disabled={busy} onClick={keepOne}>{tx('pos.keep_one_technician')}{' '}{plan.singleTechnicianAlternative.name}</button>
              <span style={planUi.muted}>{plan.singleTechnicianAlternative.estimatedFinishInMinutes != null ? tx('pos.done_estimatedfinishinminutes', { estimatedFinishInMinutes: String(minsLabel(plan.singleTechnicianAlternative.estimatedFinishInMinutes)) }) : tx('pos.finish_time_unknown_2')}</span>
            </div>
          ) : null}
          {changed && !canOverride ? <div role="note" style={planUi.warn}>{tx('pos.changing_a_technician_needs_a_manager_1i35')}</div> : null}
          {!canAssign ? <div role="note" style={planUi.muted}>{tx('pos.you_can_see_this_plan_assigning_1kht')}</div> : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" style={planUi.btn} disabled={busy || uncovered.length > 0 || (changed && !canOverride)} onClick={() => { void accept(); }}>{changed ? tx('pos.assign_changed_plan') : tx('pos.accept_plan')}</button>
              {changed ? <button type="button" style={planUi.ghost} disabled={busy} onClick={() => setDraft({})}>{tx('pos.undo_changes')}</button> : null}
              <button type="button" style={planUi.ghost} disabled={busy} onClick={() => { setRejecting(!rejecting); setErr(null); }}>{tx('pos.reject_2')}</button>
              <button type="button" style={planUi.ghost} disabled={busy} onClick={keepUnassigned}>{tx('pos.keep_unassigned')}</button>
            </div>
          )}
          {uncovered.length && canAssign ? <div style={planUi.muted}>{tx('pos.every_service_needs_a_technician_before_1a7g')}</div> : null}
          {rejecting ? (
            <div style={{ display: 'grid', gap: 6, background: '#FBF7EF', borderRadius: 10, padding: 8 }}>
              <select aria-label={tx('pos.what_was_wrong')} style={planUi.select} value={feedback} onChange={(e) => setFeedback(e.target.value)}><option value="">{tx('pos.what_was_wrong_with_it')}</option>{FEEDBACK().map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
              <input aria-label={tx('pos.reject_reason')} style={planUi.select} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tx('pos.reason_2')} />
              <div style={{ display: 'flex', gap: 8 }}><button type="button" style={planUi.btn} disabled={busy} onClick={submitReject}>{tx('pos.reject_plan')}</button><button type="button" style={planUi.ghost} onClick={() => setRejecting(false)}>{tx('pos.cancel')}</button></div>
            </div>
          ) : null}
        </>
      ) : null}

      {view === 'manual' ? (
        <>
          {manualWhy ? <div style={planUi.muted}>{manualWhy}</div> : null}
          {loadErr ? (
            <div style={{ display: 'grid', gap: 8 }}><div role="alert" style={planUi.err}>{loadErr}</div><div><button type="button" style={planUi.btn} onClick={() => { void loadManual(manualWhy); }}>{tx('pos.try_again')}</button></div></div>
          ) : !detail ? <div style={planUi.muted}>{tx('pos.loading_services')}</div> : manualLines.length === 0 ? <div style={planUi.muted}>{customerName} {tx('pos.has_no_services_to_assign_yet')}</div> : (
            <>
              <div style={{ display: 'grid', gap: 6 }} aria-label={tx('pos.technician_per_service')}>
                {manualLines.map((l) => (
                  <label key={l.serviceId} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
                    <span style={{ flex: '1 1 140px', fontWeight: 600 }}>{l.serviceName}</span>
                    {pickFromServer ? (
                      <TechnicianPickerButton value={manualTech(l)} valueName={nameOf(manualTech(l)) ?? undefined} emptyLabel={tx('pos.pick_a_technician')}
                        ariaLabel={tx('pos.technician_for_servicename', { serviceName: String(l.serviceName) })} serviceIds={[l.serviceId]}
                        onChange={(id) => setDraft({ ...draft, [l.serviceId]: id })} />
                    ) : (
                    <select aria-label={tx('pos.technician_for_servicename', { serviceName: String(l.serviceName) })} style={planUi.select} value={manualTech(l)} disabled={busy} onChange={(e) => setDraft({ ...draft, [l.serviceId]: e.target.value })}>
                      <option value="">{tx('pos.pick_a_technician')}</option>
                      {roster.map((t) => <option key={t.technicianId} value={t.technicianId}>{t.displayName}</option>)}
                    </select>
                    )}
                  </label>
                ))}
              </div>
              {canManual ? <div><button type="button" style={planUi.btn} disabled={busy} onClick={assignManual}>{tx('pos.assign_technicians')}</button></div>
                : <div role="note" style={planUi.muted}>{tx('pos.assigning_technicians_needs_the_queue_assign_l85f')}</div>}
            </>
          )}
        </>
      ) : null}
    </div>
  );
}
