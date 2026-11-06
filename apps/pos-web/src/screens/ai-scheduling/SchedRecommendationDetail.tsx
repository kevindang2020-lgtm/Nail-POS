// SchedRecommendationDetail.tsx — one recommendation, everything staff need to decide (BUILD_PLAN Phase 7 §4.1):
// current → proposed, the server's before/after simulation, hard-constraint result, benefit / downside, confidence, the
// explanation (LLM or template — labelled) with "Explain", the customer proposal, versions and expiry. Actions follow the
// status and the role: review (accept / reject / return, reason required to reject or return), apply / retry / rollback.
// Every action sends `expectedVersion`; a 409 VERSION_CONFLICT or STALE_SCHEDULE reloads the row and says why.
import { useCallback, useEffect, useState } from 'react';
import type { SchedRecommendation } from '@aipowersalon/api-contracts/tenant';
import { posAiSchedulingOptimizerApi as api } from '../../api/posAiSchedulingOptimizerApi';
import {
  P, type Can, card, cardHead, btnGold, btnGhost, btnDanger, input, muted, errText, okText, pill, when, hm, pretty,
  STATUS_LABEL, TYPE_LABEL, REVIEWABLE, APPLYABLE, METRIC_ROWS, statusTone, schedErrorText, isRefetchConflict, table, th, td, row,
} from './schedUi';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { codedText } from '../../i18n/coded-text';
import { schedViolationCoded, schedBenefitsCoded, schedExplanationCoded } from '@aipowersalon/api-contracts/tenant';
import { getLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { SchedDayPreview } from './SchedDayPreview';

export function SchedRecommendationDetail({ id, can, techName, onChanged, onClose, tick }: {
  id: string; can: Can; techName: (id: string | null | undefined) => string; onChanged: () => void; onClose: () => void; tick: number;
}) {
  const [rec, setRec] = useState<SchedRecommendation | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(() => api.recommendation(id).then((r) => { setRec(r); setLoadErr(null); }).catch((e) => setLoadErr(schedErrorText(e, 'ops.sched.err.recommendation'))), [id]);
  useEffect(() => { void load(); }, [load, tick]);

  const run = async (key: string, fn: (r: SchedRecommendation) => Promise<unknown>, done: string) => {
    if (!rec) return;
    setBusy(key); setMsg(null);
    try {
      const out = await fn(rec) as { recommendation?: SchedRecommendation; application?: { status: string; errorCode: string | null } } | undefined;
      if (out?.recommendation) setRec(out.recommendation);
      if (out?.application && out.application.status !== 'applied') setMsg({ ok: false, text: out.application.status === 'stale' ? schedErrorText({ code: 'STALE_SCHEDULE' }) : t('pos.apply_failed_v0_you_can_retry', { v0: String(out.application.errorCode ? ` (${pretty(out.application.errorCode)})` : '') }) });
      else setMsg({ ok: true, text: done });
      setReason('');
      onChanged();
      if (!out?.recommendation) await load();
    } catch (e) {
      setMsg({ ok: false, text: schedErrorText(e) });
      if (isRefetchConflict(e)) { await load(); onChanged(); }
    } finally { setBusy(null); }
  };
  const needReason = (fn: () => void) => { if (!reason.trim()) { setMsg({ ok: false, text: t('pos.add_a_short_reason_first') }); return; } fn(); };

  if (loadErr && !rec) return <section style={card} aria-label={t('pos.recommendation_detail')}><div style={errText}>{loadErr}</div><button style={btnGhost} onClick={onClose}>{t('pos.close')}</button></section>;
  if (!rec) return <section style={card} aria-label={t('pos.recommendation_detail')}><div style={muted}>{t('pos.loading')}</div></section>;

  const tone = statusTone(rec.status);
  const cur = rec.currentState; const prop = rec.proposedState;
  const sim = rec.simulation;
  const canReview = can(P.review) && REVIEWABLE.includes(rec.status);
  const canApply = can(P.apply) && APPLYABLE.includes(rec.status);
  const canRetry = can(P.apply) && rec.status === 'application_failed';
  const canRollback = can(P.apply) && rec.status === 'applied';
  const waitingCustomer = rec.status === 'customer_approval_required';

  return (
    <section style={{ ...card, display: 'grid', gap: 12 }} aria-label={t('pos.recommendation_detail')} data-testid="sched-rec-detail">
      <div style={cardHead}>
        <span>{TYPE_LABEL[rec.type] ?? pretty(rec.type)}</span>
        <span style={pill(tone.bg, tone.fg)} data-testid="sched-rec-status">{STATUS_LABEL[rec.status] ?? pretty(rec.status)}</span>
        {rec.automated ? <span style={pill('#EEF0F7', '#4B5A8A')}>{t('pos.automated')}</span> : null}
        {rec.requiresCustomerApproval ? <span style={pill('#FBEEDD', '#9B6B1E')}>{t('pos.customer_approval_required')}</span> : null}
        <span style={pill('#F3ECE1', '#6C6965')}>{t('pos.confidence')}{' '}{Math.round((rec.confidence ?? 0) * 100)}%</span>
        {rec.dataQuality !== 'good' ? <span style={pill('#F3ECE1', '#6C6965')}>{rec.dataQuality} {t('pos.data')}</span> : null}
        <button style={{ ...btnGhost, marginLeft: 'auto' }} onClick={onClose}>{t('pos.close')}</button>
      </div>

      {(cur || prop) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, fontSize: 13 }}>
          <div><div style={muted}>{t('pos.now')}</div>{cur ? <div data-testid="sched-current">{cur.date} · {hm(cur.startTime)}–{hm(cur.endTime)} · {techName(cur.technicianId)}</div> : '—'}</div>
          <div><div style={muted}>{t('pos.proposed')}</div>{prop ? <div data-testid="sched-proposed"><strong>{prop.date} · {hm(prop.startTime)}–{hm(prop.endTime)} · {techName(prop.technicianId)}</strong></div> : '—'}</div>
        </div>
      )}

      {sim ? (
        <table style={table} aria-label={t('pos.simulation_before_and_after')}>
          <thead><tr><th style={th}>{t('pos.measure')}</th><th style={th}>{t('pos.before')}</th><th style={th}>{t('pos.after')}</th></tr></thead>
          <tbody>{METRIC_ROWS.map(([k, label, f]) => (
            <tr key={k}><td style={td}>{t(label)}</td><td style={td}>{f(sim.before[k])}</td><td style={{ ...td, fontWeight: 700 }}>{f(sim.after[k])}</td></tr>
          ))}</tbody>
        </table>
      ) : <div style={muted}>{t('pos.no_simulation_stored_for_this_recommendation')}</div>}
      {sim && !sim.improved ? <div style={errText}>{t('pos.the_simulation_shows_no_overall_improvement')}</div> : null}
      {prop ? <SchedDayPreview id={rec.id} tick={tick ?? 0} /> : null}

      <div style={{ fontSize: 13 }}>
        {rec.hardConstraintsChecked
          ? (rec.violations.length === 0 ? <div style={okText}>{t('pos.all_hard_rules_checked_none_broken')}</div>
            : <ul style={{ margin: 0, paddingLeft: 18, color: '#B4451E' }} aria-label={t('pos.rule_violations')}>{rec.violations.map((v, i) => <li key={i}>{codedText(schedViolationCoded(v), v.message)} <span style={muted}>({pretty(v.code)})</span></li>)}</ul>)
          : <div style={errText}>{t('pos.hard_rules_were_not_checked_for_womq')}</div>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, fontSize: 12.5 }}>
        <div><div style={muted}>{t('pos.expected_benefit')}</div>{rec.expectedBenefit.length ? benefitWords(rec).benefits.map((b, i) => <div key={i} style={{ color: '#3B6B47' }}>+ {b}</div>) : '—'}</div>
        <div><div style={muted}>{t('pos.possible_downside')}</div>{rec.possibleDownside.length ? benefitWords(rec).downsides.map((b, i) => <div key={i} style={{ color: '#B4451E' }}>− {b}</div>) : t('pos.none_computed')}</div>
      </div>

      <div style={{ fontSize: 13 }}>
        <div style={row}><span style={muted}>{t('pos.why')}</span>{rec.explanationSource ? <span style={pill('#F3ECE1', '#6C6965')}>{rec.explanationSource === 'llm' ? t('pos.ai_written') : t('ops.sched.explain.template')}</span> : null}
          {can(P.view) ? <button style={btnGhost} disabled={busy === 'explain'} onClick={() => run('explain', (r) => api.explain(r.id), t('ops.sched.ok.explained'))}>{busy === 'explain' ? t('pos.explaining') : t('pos.explain')}</button> : null}
        </div>
        <div data-testid="sched-explanation" style={{ marginTop: 4 }}>{rec.explanation ? <ExplanationText rec={rec} /> : <span style={muted}>{t('pos.no_explanation_yet')}</span>}</div>
      </div>

      {rec.proposal ? (
        <div style={{ fontSize: 12.5 }} data-testid="sched-proposal">
          <span style={muted}>{t('pos.customer_proposal')}{' '}</span>{pretty(rec.proposal.status)}
          {rec.proposal.notifiedAt ? t('pos.notified_notifiedat_2', { notifiedAt: String(when(rec.proposal.notifiedAt)) }) : t('pos.not_notified_yet_2')}
          {rec.proposal.decidedAt ? t('pos.decided_decidedat_v1', { decidedAt: String(when(rec.proposal.decidedAt)), v1: String(rec.proposal.decisionChannel ? ` (${pretty(rec.proposal.decisionChannel)})` : '') }) : ''}
          {rec.proposal.expiresAt ? t('pos.expires_expiresat', { expiresAt: String(when(rec.proposal.expiresAt)) }) : ''}
          <div style={muted}>{t('pos.the_original_appointment_stays_exactly_as_fnqq')}</div>
        </div>
      ) : null}

      {msg ? <div role={msg.ok ? 'status' : 'alert'} style={msg.ok ? okText : errText}>{msg.text}</div> : null}

      {(canReview || (waitingCustomer && can(P.review))) && (
        <input aria-label={t('pos.reason_2')} placeholder={t('pos.reason_required_to_reject_or_return')} value={reason} onChange={(e) => setReason(e.target.value)} style={{ ...input, width: '100%' }} />
      )}
      <div style={row}>
        {canReview && <>
          <button style={btnGold} disabled={!!busy} onClick={() => run('accept', (r) => api.accept(r.id, { expectedVersion: r.version, reason: reason.trim() || null }), rec.requiresCustomerApproval ? t('pos.accepted_the_customer_has_been_asked_jpa2') : t('pos.accepted_ready_to_apply'))}>{t('pos.accept')}</button>
          <button style={btnGhost} disabled={!!busy} onClick={() => needReason(() => run('return', (r) => api.returnForRevision(r.id, { expectedVersion: r.version, reason: reason.trim() }), t('ops.sched.ok.returned')))}>{t('pos.return_for_revision')}</button>
          <button style={btnDanger} disabled={!!busy} onClick={() => needReason(() => run('reject', (r) => api.reject(r.id, { expectedVersion: r.version, reason: reason.trim() }), t('ops.sched.ok.rejected')))}>{t('pos.reject')}</button>
        </>}
        {canApply && <button style={btnGold} disabled={!!busy} onClick={() => run('apply', (r) => api.apply(r.id, r.version), t('ops.sched.ok.appliedCalendar'))}>{busy === 'apply' ? t('pos.applying') : t('pos.apply_2')}</button>}
        {canRetry && <button style={btnGold} disabled={!!busy} onClick={() => run('retry', (r) => api.retry(r.id, r.version), t('ops.sched.ok.appliedRetry'))}>{t('pos.retry_apply')}</button>}
        {canRollback && <button style={btnDanger} disabled={!!busy} onClick={() => run('rollback', (r) => api.rollback(r.id, r.version), t('ops.sched.ok.rolledBack'))}>{t('pos.roll_back')}</button>}
        {waitingCustomer && can(P.review) && <>
          <button style={btnGhost} disabled={!!busy} onClick={() => run('resend', (r) => api.resendProposal(r.id), t('ops.sched.ok.resent'))}>{t('pos.resend_to_customer')}</button>
          <button style={btnGhost} disabled={!!busy} onClick={() => run('cust-yes', (r) => api.customerDecision(r.id, true, r.version), t('ops.sched.ok.customerApproved'))}>{t('pos.customer_approved_phone')}</button>
          <button style={btnGhost} disabled={!!busy} onClick={() => run('cust-no', (r) => api.customerDecision(r.id, false, r.version), t('ops.sched.ok.customerDeclined'))}>{t('pos.customer_declined_phone')}</button>
        </>}
      </div>
      {rec.status === 'application_failed' && !can(P.apply) ? <div style={muted}>{t('pos.applying_failed_a_manager_can_retry')}</div> : null}

      <div style={{ ...muted, fontSize: 11.5 }} data-testid="sched-versions">
        {t('pos.engine')}{' '}{rec.versions.engineVersion} {t('pos.rules_2')}{' '}{rec.versions.ruleVersion} {t('pos.settings_v')}{rec.versions.configVersion}{rec.versions.forecastVersion ? t('pos.forecast_forecastversion', { forecastVersion: String(rec.versions.forecastVersion) }) : t('pos.no_forecast')}
        {' '}{t('pos.version_3')}{' '}{rec.version}{rec.applyAttempt ? t('pos.apply_attempt_applyattempt', { applyAttempt: String(rec.applyAttempt) }) : ''}{rec.expiresAt ? t('pos.expires_expiresat', { expiresAt: String(when(rec.expiresAt)) }) : ''}
        {rec.decidedAt ? t('pos.decided_decidedat', { decidedAt: String(when(rec.decidedAt)) }) : ''}{rec.appliedAt ? t('pos.applied_appliedat', { appliedAt: String(when(rec.appliedAt)) }) : ''}
      </div>
    </section>
  );
}

/** Vietnamese POS §21 / §120: benefits / downsides in the cashier's language, re-coded from the simulation deltas they were
 *  built from; the stored English when the counts disagree (an older engine wrote something else). */
function benefitWords(rec: SchedRecommendation): { benefits: string[]; downsides: string[] } {
  const c = schedBenefitsCoded(rec.simulation);
  return {
    benefits: c.benefits.length === rec.expectedBenefit.length ? c.benefits.map((x, i) => codedText(x, rec.expectedBenefit[i])) : rec.expectedBenefit,
    downsides: c.downsides.length === rec.possibleDownside.length ? c.downsides.map((x, i) => codedText(x, rec.possibleDownside[i])) : rec.possibleDownside,
  };
}
/** The explanation. The deterministic template: English shows the stored text exactly, Vietnamese words it from the
 *  recommendation's facts (schedExplanationCoded). An AI-written explanation (Vietnamese POS §120) is in the language the
 *  gateway asked for — the reader's POS language, or the salon default for a job — stored as `explanationLanguage`:
 *  shown as is when it matches the screen; otherwise below the worded facts, labelled with its language
 *  ("Explain" asks again in this reader's language). */
function ExplanationText({ rec }: { rec: SchedRecommendation }) {
  const lang = getLanguage();
  if (rec.explanationSource !== 'llm') return lang === 'en' ? <>{rec.explanation}</> : <>{schedExplanationCoded(rec).map((c) => codedText(c)).join(' ')}</>;
  const prose = rec.explanationLanguage ?? 'en';
  if (prose === lang) return <span lang={prose} data-testid="sched-explanation-ai">{rec.explanation}</span>;
  const worded = schedExplanationCoded(rec).map((c) => codedText(c)).join(' ');
  return (<>
    <div>{worded}</div>
    <div lang={prose} data-testid={prose === 'en' ? 'sched-explanation-ai-english' : 'sched-explanation-ai-vietnamese'} style={{ marginTop: 4, fontSize: 12, color: '#6C6965' }}><b>{t(prose === 'en' ? 'ops.sched.explain.aiEnglish' : 'ops.sched.explain.aiVietnamese')}</b> {rec.explanation}</div>
  </>);
}
