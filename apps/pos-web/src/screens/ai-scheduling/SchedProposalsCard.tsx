// SchedProposalsCard.tsx — "Customer approvals": every accepted change that touches a confirmed appointment waits here
// for the customer (customer web link / staff-recorded phone answer). Original vs proposed time, notified / expiry, and
// the actions: resend the proposal, record the customer's answer taken by phone. Approved ones wait for staff to apply.
// The original appointment is never touched until the customer approves and staff apply.
import { useEffect, useState } from 'react';
import type { SchedRecommendation } from '@aipowersalon/api-contracts/tenant';
import { posAiSchedulingOptimizerApi as api } from '../../api/posAiSchedulingOptimizerApi';
import { P, type SchedCardProps, card, cardHead, btnGhost, btnGold, muted, errText, okText, pill, when, hm, pretty, row, schedErrorText, isRefetchConflict } from './schedUi';
import { t } from '@aipowersalon/mobile-sdk/i18n';

export function SchedProposalsCard({ tick, can, techName, onChanged, onSelect }: SchedCardProps & { onSelect: (id: string) => void }) {
  const [waiting, setWaiting] = useState<SchedRecommendation[] | null>(null);
  const [approved, setApproved] = useState<SchedRecommendation[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    Promise.all([api.recommendations({ status: 'customer_approval_required', limit: 50 }), api.recommendations({ status: 'customer_approved', limit: 50 })])
      .then(([w, a]) => { setWaiting(w?.items ?? []); setApproved(a?.items ?? []); setErr(null); })
      .catch((e) => setErr(schedErrorText(e, 'ops.sched.err.approvals')));
  }, [tick, reload]);

  const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key); setMsg(null);
    try { await fn(); setMsg({ ok: true, text: done }); onChanged(); setReload((x) => x + 1); }
    catch (e) { setMsg({ ok: false, text: schedErrorText(e) }); if (isRefetchConflict(e)) setReload((x) => x + 1); }
    finally { setBusy(null); }
  };

  const line = (r: SchedRecommendation) => {
    const p = r.proposal;
    const from = p ? `${p.originalDate} ${hm(p.originalStartTime)} · ${techName(p.originalTechnicianId)}` : r.currentState ? `${r.currentState.date} ${hm(r.currentState.startTime)} · ${techName(r.currentState.technicianId)}` : '—';
    const to = p ? `${p.proposedDate} ${hm(p.proposedStartTime)} · ${techName(p.proposedTechnicianId)}` : r.proposedState ? `${r.proposedState.date} ${hm(r.proposedState.startTime)} · ${techName(r.proposedState.technicianId)}` : '—';
    return { from, to, p };
  };

  return (
    <section style={card} aria-label={t('pos.customer_approvals')}>
      <div style={cardHead}>{t('pos.customer_approvals')}</div>
      {msg ? <div role={msg.ok ? 'status' : 'alert'} style={{ ...(msg.ok ? okText : errText), marginBottom: 6 }}>{msg.text}</div> : null}
      {err ? <div style={errText}>{err}</div> : !waiting ? <div style={muted}>{t('pos.loading')}</div> : waiting.length === 0 && approved.length === 0 ? (
        <div style={muted}>{t('pos.no_changes_are_waiting_on_a_iizj')}</div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {waiting.map((r) => {
            const { from, to, p } = line(r);
            return (
              <div key={r.id} data-testid="sched-proposal-row" style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 8, background: '#fff', fontSize: 12.5 }}>
                <div style={row}><strong>{from}</strong><span>→</span><strong>{to}</strong>
                  <span style={pill('#FBEEDD', '#9B6B1E')}>{pretty(p ? p.status : 'waiting')}</span></div>
                <div style={muted}>{p?.notifiedAt ? t('pos.notified_notifiedat', { notifiedAt: String(when(p.notifiedAt)) }) : t('pos.not_notified_yet')}{p?.expiresAt ? t('pos.answer_by_expiresat', { expiresAt: String(when(p.expiresAt)) }) : ''}</div>
                <div style={{ ...row, marginTop: 6 }}>
                  <button style={btnGhost} onClick={() => onSelect(r.id)}>{t('pos.details')}</button>
                  {can(P.review) && <>
                    <button style={btnGhost} disabled={!!busy} onClick={() => act(r.id + 'resend', () => api.resendProposal(r.id), t('ops.sched.ok.resentShort'))}>{t('pos.resend')}</button>
                    <button style={btnGhost} disabled={!!busy} onClick={() => act(r.id + 'yes', () => api.customerDecision(r.id, true, r.version), t('ops.sched.ok.customerApproved'))}>{t('pos.approved_by_phone')}</button>
                    <button style={btnGhost} disabled={!!busy} onClick={() => act(r.id + 'no', () => api.customerDecision(r.id, false, r.version), t('ops.sched.ok.customerDeclinedLong'))}>{t('pos.declined_by_phone')}</button>
                  </>}
                </div>
              </div>
            );
          })}
          {approved.length > 0 && <div style={{ fontWeight: 700, fontSize: 13, marginTop: 6 }}>{t('pos.approved_ready_to_apply')}</div>}
          {approved.map((r) => {
            const { from, to } = line(r);
            return (
              <div key={r.id} data-testid="sched-approved-row" style={{ ...row, fontSize: 12.5 }}>
                <span>{from} → <strong>{to}</strong></span>
                {can(P.apply) ? <button style={btnGold} disabled={!!busy} onClick={() => act(r.id + 'apply', async () => {
                  const out = await api.apply(r.id, r.version);
                  if (out?.application && out.application.status !== 'applied') throw Object.assign(new Error(out.application.status === 'stale' ? '' : t('pos.apply_failed_v0_open_details_to_12hn', { v0: String(out.application.errorCode ? ` (${pretty(out.application.errorCode)})` : '') })), { code: out.application.status === 'stale' ? 'STALE_SCHEDULE' : undefined });
                }, t('ops.sched.ok.applied'))}>{t('pos.apply_2')}</button> : <span style={muted}>{t('pos.a_manager_applies_it')}</span>}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
