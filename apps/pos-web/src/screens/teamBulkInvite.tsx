// teamBulkInvite.tsx — extras 200-Technician Large Salon 08 (round 11, Nov 13 2026): "Invite selected" in Team Management's
// Quick Bulk Staff Actions bar. A MECHANISM that is OFF until the salon turns it on (Kevin decides message volume and consent):
// while off the button is disabled and says why (the salon switch is off, or the platform paused it); a settings editor may
// turn the salon switch on after a confirm. When on: the server's preview first (who gets what by which channel, who is
// skipped and why — nothing written), then Send — at most 200 people, one run key per preview (a retry never sends twice),
// step-up like every staff invitation, and the per-person outcome from the server. The one-by-one invite is unchanged.
import { useState } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posTeamBulkInviteApi, type BulkInvitePlan, type BulkInviteResult } from '../api/posTeamStaffApi';
import { FitDialog, requestId } from '../components/FitKit';
import { useLoad, StateBlock, isForbidden } from '../components/FinanceKit';
import { useCan } from '../components/usePermissions';
import { useStepUp, isStepUpCancelled } from './access/accessUi';

export function BulkInviteAction({ ids }: { ids: string[] }) {
  const can = useCan();
  const st = useLoad(() => posTeamBulkInviteApi.settings(), []);
  const [open, setOpen] = useState(false); const [ask, setAsk] = useState(false); const [saving, setSaving] = useState(false); const [err, setErr] = useState<unknown>(null);
  if (st.error) return isForbidden(st.error) ? null : <span className="fk-hint" data-testid="bulk-invite-error">{tx('tmm.binv.loadError')}</span>;
  const s = st.data;
  if (!s) return null;
  const turnOn = async () => {
    setSaving(true); setErr(null);
    try { await posTeamBulkInviteApi.saveSettings(true); setAsk(false); st.reload(); } catch (e) { setErr(e); } finally { setSaving(false); }
  };
  if (!s.available) {
    return (
      <span data-testid="bulk-invite-off">
        <button type="button" className="fk-btn ghost sm" disabled data-testid="bulk-invite">{tx('tmm.binv.invite')}</button>{' '}
        <span className="fk-hint" data-testid="bulk-invite-why">{tx(s.offReason === 'platform_paused' ? 'tmm.binv.off.platform_paused' : 'tmm.binv.off.salon_setting_off')}</span>
        {s.offReason === 'salon_setting_off' && can('settings.edit') ? (ask
          ? <span data-testid="bulk-invite-enable-confirm"> {tx('tmm.binv.enableConfirm')} <button type="button" className="fk-btn sm" disabled={saving} onClick={() => void turnOn()} data-testid="bulk-invite-enable-yes">{tx('tmm.binv.enableYes')}</button> <button type="button" className="fk-btn ghost sm" onClick={() => setAsk(false)}>{tx('pos.cancel')}</button></span>
          : <> <button type="button" className="fk-link" onClick={() => setAsk(true)} data-testid="bulk-invite-enable">{tx('tmm.binv.enable')}</button></>) : null}
        {err ? <StateBlock error={err} onRetry={() => void turnOn()} /> : null}
      </span>
    );
  }
  return (
    <>
      <button type="button" className="fk-btn ghost sm" onClick={() => setOpen(true)} disabled={!ids.length} data-testid="bulk-invite">{tx('tmm.binv.invite')}</button>
      {open ? <BulkInviteDialog ids={ids} max={s.maxPerRun} hours={s.recentHours} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function BulkInviteDialog({ ids, max, hours, onClose }: { ids: string[]; max: number; hours: number; onClose: () => void }) {
  const plan = useLoad<BulkInvitePlan>(() => posTeamBulkInviteApi.preview(ids), [ids.join(',')]);
  const [runKey] = useState(() => requestId());   // one key for this preview: a retried Send returns the first run's answer
  const { run, prompt } = useStepUp(tx('tmm.binv.stepUp'));
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null); const [res, setRes] = useState<BulkInviteResult | null>(null);
  const p = plan.data;
  const send = async () => {
    setBusy(true); setErr(null);
    try { setRes(await run(() => posTeamBulkInviteApi.run(ids, runKey))); } catch (e) { if (!isStepUpCancelled(e)) setErr(e); } finally { setBusy(false); }
  };
  const nameOf = (id: string) => p?.items.find((i) => i.memberId === id)?.name ?? '—';
  return (
    <FitDialog title={tx('tmm.binv.title')} subtitle={tx('tmm.binv.rule', { max: String(max), hours: String(hours) })} onClose={onClose} busy={busy} wide testId="dlg-bulk-invite"
      footer={res ? <button type="button" className="fk-btn primary" onClick={onClose}>{tx('pos.close')}</button>
        : <><button type="button" className="fk-btn ghost" onClick={onClose}>{tx('pos.cancel')}</button>
          <button type="button" className="fk-btn primary" disabled={!p || busy || p.willInvite === 0 || !p.availability.available} aria-busy={busy} onClick={() => void send()} data-testid="bulk-invite-send">{busy ? tx('pos.saving_2') : tx('tmm.binv.send', { n: String(p?.willInvite ?? 0) })}</button></>}>
      {prompt}
      {plan.error ? <StateBlock error={plan.error} onRetry={plan.reload} /> : !p ? <div className="fk-loading">{tx('pos.loading')}</div> : res ? (
        <div data-testid="bulk-invite-result">
          <div className="fk-note ok" role="status"><span>{tx('tmm.binv.done', { sent: String(res.sent), notDelivered: String(res.notDelivered), skipped: String(res.skipped), failed: String(res.failed) })}</span>{res.replayed ? <span className="fk-li-s"> {tx('tmm.binv.replayed')}</span> : null}</div>
          <ul className="fk-list dense">{res.outcomes.map((o) => (
            <li key={o.memberId} className="fk-li" data-testid="bulk-invite-outcome"><span className="fk-li-t">{nameOf(o.memberId)}</span>
              <span className="fk-li-s">{tx('tmm.binv.out.' + o.outcome)}{o.outcome === 'skipped' && o.reason ? ' · ' + tx('tmm.binv.reason.' + o.reason) : o.outcome === 'not_delivered' && o.reason ? ' · ' + tx(o.reason === 'not_connected' ? 'tmm.binv.nd.not_connected' : 'tmm.binv.nd.failed') : ''}{o.channel ? ' · ' + tx('tmm.binv.ch.' + o.channel) : ''}</span></li>))}</ul>
        </div>
      ) : (
        <div data-testid="bulk-invite-preview">
          <p data-testid="bulk-invite-summary">{tx('tmm.binv.summary', { invite: String(p.willInvite), skip: String(p.skipped), n: String(p.selected) })}</p>
          <p className="fk-hint">{tx('tmm.binv.nothingYet')}</p>
          <ul className="fk-list dense">{p.items.map((i) => (
            <li key={i.memberId} className="fk-li" data-testid={i.action === 'invite' ? 'bulk-invite-will' : 'bulk-invite-skip'}><span className="fk-li-t">{i.name}</span>
              <span className="fk-li-s">{i.action === 'invite' ? tx('tmm.binv.will', { ch: tx('tmm.binv.ch.' + (i.channel ?? 'email')), to: i.contactHint ?? '—' }) : tx('tmm.binv.reason.' + (i.reason ?? 'not_found'))}</span></li>))}</ul>
          {err ? <StateBlock error={err} onRetry={() => void send()} /> : null}
        </div>
      )}
    </FitDialog>
  );
}
