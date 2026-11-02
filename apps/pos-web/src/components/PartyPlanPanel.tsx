// PartyPlanPanel.tsx — a party's plan (multi-technician routing contract §4/§7): every member × every service, the
// technician and timing per line, whether the party is served together (one shared start, no technician shared between
// members) or in any order, and when it should start / finish. "Accept all" assigns every member in ONE call through the
// queue's plan writer (all or none); a stale member answers 409 and nothing is assigned. "Start party" sends every member
// to the technicians' queue (each member's own idempotent move). Parties are never auto-assigned (D5).
import { useCallback, useEffect, useState } from 'react';
import { useInlineAsk } from '@aipowersalon/ui';
import type { PlanRecommendationView, PartyPlan, QueueGroupView } from '@aipowersalon/api-contracts/tenant';
import { posAIQueueAssignmentApi as aq, newIdempotencyKey } from '../api/posAIQueueAssignmentApi';
import { posQueueApi } from '../api/posQueueApi';
import { isQueueConflict, planConflictMessage } from '../lib/queueConflict';
import { planUi, timingLabel, etaLabel, minsLabel, type PlanRosterTech } from './VisitPlanPanel';
import { t } from '@aipowersalon/mobile-sdk/i18n';

export function PartyPlanPanel({ groupId, label, group, roster, can, onChanged, onClose }: {
  groupId: string; label: string; group?: QueueGroupView | null; roster: PlanRosterTech[]; can: (permission: string) => boolean;
  onChanged: (message: string | null) => void; onClose?: () => void;
}) {
  const [reco, setReco] = useState<PlanRecommendationView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { ask, askUi } = useInlineAsk();
  const canRead = can('ai_queue_assignment.recommend');

  const load = useCallback(async () => {
    if (!canRead) { setLoading(false); return; }
    setLoading(true);
    try {
      const r = await aq.planParty(groupId);
      if (!r || !r.party) throw new Error(t('pos.the_server_sent_no_plan_for_pwv2'));
      setReco(r); setLoadErr(null);
    } catch (e: any) {
      setReco(null);
      setLoadErr(e?.status === 402 ? t('pos.ai_plans_are_not_enabled_for_wyqc') : t('pos.could_not_work_out_a_plan_zd25', { label: String(label), v1: String(e?.message || t('pos.please_retry')) }));
    } finally { setLoading(false); }
  }, [groupId, label, canRead]);
  useEffect(() => { void load(); }, [load]);

  const party: PartyPlan | null = reco?.party ?? null;
  const nameOf = (tid: string | null | undefined) => {
    if (!tid) return null;
    const r = roster.find((x) => x.technicianId === tid)?.displayName; if (r) return r;
    for (const m of party?.members || []) for (const l of m.lines) if (l.technicianId === tid && l.technicianName) return l.technicianName;
    return null;
  };
  const serviceNameOf = (sid: string) => { for (const m of party?.members || []) { const l = m.lines.find((x) => x.serviceId === sid); if (l) return l.serviceName; } return null; };
  const guestOf = (qid?: string) => party?.members.find((m) => m.queueItemId === qid)?.customerName || null;
  const uncovered = (party?.members || []).some((m) => m.lines.some((l) => !l.technicianId));

  async function guard(fn: () => Promise<void>) {
    setBusy(true); setErr(null); setMsg(null);
    try { await fn(); }
    catch (e: any) {
      if (isQueueConflict(e)) { setErr(planConflictMessage(e, guestOf(e?.body?.queueItemId) || label, nameOf, serviceNameOf)); onChanged(null); await load(); }
      else setErr(e?.message || t('pos.action_failed_nothing_was_assigned'));
    } finally { setBusy(false); }
  }
  const acceptAll = () => guard(async () => {
    if (!reco) return;
    const r = await aq.decidePlan(reco.recommendationId, { decision: 'accepted', idempotencyKey: newIdempotencyKey() });
    const text = r?.replayed ? t('pos.already_recorded_label_is_assigned', { label: String(label) }) : r?.applied ? t('pos.label_every_guest_is_assigned', { label: String(label) }) : t('pos.recorded_label_was_not_moved', { label: String(label) });
    setMsg(text); onChanged(text);
  });
  const keepUnassigned = () => ask(t('admin.visitPlan.askKeepUnassigned', { name: label }), (why) => guard(async () => {
    if (!reco) return;
    await aq.decidePlan(reco.recommendationId, { decision: 'kept_unassigned', reason: why || null, idempotencyKey: newIdempotencyKey() });
    const text = t('pos.label_stays_unassigned', { label: String(label) }); setMsg(text); onChanged(text);
  }), { optional: true, confirmLabel: t('pos.keep_unassigned') });
  const members = group?.members || [];
  const allAssigned = members.length > 0 && members.every((m) => !!m.assignedTechnicianId);
  const startParty = () => guard(async () => {
    const r = await posQueueApi.moveGroupToTechQueue(groupId);
    const n = r?.moved?.length ?? 0;
    const text = t('pos.label_n_guest_plural_sent_to_jedr', { label: String(label), n: String(n), plural: String(n === 1 ? '' : 's') }); setMsg(text); onChanged(text);
  });

  return (
    <div style={planUi.box} aria-label={t('pos.party_plan_for_label', { label: String(label) })}>
      {askUi}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 800, fontSize: 14 }}>{t('pos.party')}{' '}{label}</div>
        {party ? <span style={planUi.chip('#F3EEFB', '#6E59C7')}>{party.together ? t('pos.served_together') : t('pos.any_order')}</span> : null}
        {onClose ? <button type="button" style={{ ...planUi.ghost, marginLeft: 'auto', minHeight: 36 }} onClick={onClose}>{t('pos.close')}</button> : null}
      </div>
      {err ? <div role="alert" style={planUi.err}>{err}</div> : null}
      {msg ? <div role="status" style={planUi.ok}>{msg}</div> : null}
      {!canRead ? <div style={planUi.muted}>{t('pos.party_plans_need_the_ai_recommendation_1n87')}</div>
        : loading && !party ? <div style={planUi.muted}>{t('pos.working_out_the_party_plan')}</div>
          : loadErr ? (
            <div style={{ display: 'grid', gap: 8 }}><div role="alert" style={planUi.err}>{loadErr}</div><div><button type="button" style={planUi.btn} onClick={() => { void load(); }}>{t('pos.try_again')}</button></div></div>
          ) : party ? (
            <>
              <div style={planUi.muted}>
                {party.together
                  ? (party.sharedStartInMinutes != null ? t('pos.everyone_starts_sharedstartinminutes', { sharedStartInMinutes: String(minsLabel(party.sharedStartInMinutes)) }) : t('pos.shared_start_time_unknown'))
                  : t('pos.each_guest_starts_as_soon_as_1rap')}
                {party.estimatedFinishInMinutes != null ? t('pos.all_done_estimatedfinishinminutes', { estimatedFinishInMinutes: String(minsLabel(party.estimatedFinishInMinutes)) }) : t('pos.finish_time_unknown')}
                {party.together && party.anyOrderFinishInMinutes != null ? t('pos.in_any_order_done_anyorderfinishinminutes', { anyOrderFinishInMinutes: String(minsLabel(party.anyOrderFinishInMinutes)) }) : ''}
                {t('pos.v0_confidence', { v0: String(Math.round((party.confidence || 0) * 100)) })}
              </div>
              {party.conflicts.length ? <div style={planUi.err}>{party.conflicts.join(' · ')}</div> : null}
              {party.warnings.length ? <div style={planUi.warn}>{party.warnings.join(' · ')}</div> : null}
              <div style={{ display: 'grid', gap: 6 }} aria-label={t('pos.party_members')}>
                {party.members.map((m) => (
                  <div key={m.queueItemId} data-testid={`party-member-${m.queueItemId}`} style={{ border: '1px solid var(--line, #E5D8C3)', borderRadius: 10, padding: 8, display: 'grid', gap: 4 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{m.customerName} <span style={planUi.muted}>· {etaLabel(m.estimatedStartInMinutes, m.estimatedFinishInMinutes)}</span></div>
                    {m.lines.map((l) => (
                      <div key={l.serviceId} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5 }}>
                        <span style={{ flex: '1 1 120px' }}>{l.serviceName}</span>
                        <b>{l.technicianName || nameOf(l.technicianId) || t('pos.no_technician')}</b>
                        <span style={planUi.chip(l.timing === 'after' ? '#FBF1E6' : '#E9F1FA', l.timing === 'after' ? '#9B6B1E' : '#3C7FB6')}>{timingLabel(l, m.lines)}</span>
                        <span style={planUi.muted}>{etaLabel(l.estimatedStartInMinutes, l.estimatedEndInMinutes)}</span>
                      </div>
                    ))}
                    {m.warnings.length ? <div style={planUi.warn}>{m.warnings.join(' · ')}</div> : null}
                  </div>
                ))}
              </div>
              {can('ai_queue_assignment.assign') ? (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" style={planUi.btn} disabled={busy || uncovered} onClick={() => { void acceptAll(); }}>{t('pos.accept_all')}</button>
                  <button type="button" style={planUi.ghost} disabled={busy} onClick={keepUnassigned}>{t('pos.keep_unassigned')}</button>
                </div>
              ) : <div role="note" style={planUi.muted}>{t('pos.assigning_the_party_needs_the_ai_11gs')}</div>}
              {uncovered ? <div style={planUi.muted}>{t('pos.some_services_have_no_technician_the_1c1i')}</div> : null}
            </>
          ) : null}
      {can('pos.queue.move_to_tech_queue') ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" style={planUi.ghost} disabled={busy || !allAssigned} onClick={() => { void startParty(); }}>{t('pos.start_party')}</button>
          {!allAssigned ? <span style={planUi.muted}>{t('pos.every_guest_needs_a_technician_before_kba7')}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
