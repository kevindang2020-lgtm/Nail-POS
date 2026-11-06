// RetentionWinBack.tsx — Customer Retention & Win-Back Complete Build Guide (Oct 30 2026), the owner's recommendations 1 and 3,
// opened from the Customer Retention header:
//   HealthDialog     "Check Retention Data" — READ-ONLY server check (nine checks: Ready / Attention required / Failed /
//                    Unknown, the affected count, sample customers of this salon, the cause and the fix, last Ready time).
//   AssistantDialog  the Win-Back Assistant — a goal → factual audience criteria, eligible / excluded counts with reasons,
//                    never-visited only as a separately labelled count, a SUGGESTED message, active offers, the send window
//                    and a cost only when a rate exists. "Save audience" stores an UNSENT, consent-checked audience; "Create
//                    campaign" makes a Campaign Center DRAFT with it — approval and launch happen in Campaign Center. Nothing
//                    here sends a message.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posRetentionApi } from '../api/posRetentionApi';
import { posCampaignCenterApi } from '../api/posCampaignCenterApi';
import { posSegmentsApi } from '../api/posSegmentsApi';
import { errorTextOf } from '../i18n/error-text';
import { fmtMoney, fmtNumber, fmtInZone } from '../i18n/format';
import { FitDialog, requestId } from '../components/FitKit';

const TONE: Record<string, string> = { ready: 'ok', attention_required: 'warn', failed: 'bad', unknown: 'mut' };
const when = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) || '—' : '—');
const reason = (r: string) => { const k = 'wb.reason.' + r; const s = tx(k); return s === k ? r : s; };
const GOALS = ['inactive_risk', 'inactive_90', 'repeat_visits', 'slow_weekdays', 'promote_service'] as const;

export function HealthDialog({ onClose, openCustomer }: { onClose: () => void; openCustomer: (id: string) => void }) {
  const [run, setRun] = useState<any | null | undefined>(undefined);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { let alive = true; posRetentionApi.health().then((r) => alive && setRun(r?.run ?? null)).catch((e) => alive && setErr(errorTextOf(e, tx('people.retention.loadFailed')))); return () => { alive = false; }; }, []);
  const go = async () => {
    setBusy(true); setErr(null);
    try { setRun(await posRetentionApi.healthCheck()); } catch (e) { setErr(errorTextOf(e, tx('people.retention.loadFailed'))); } finally { setBusy(false); }
  };
  return (
    <FitDialog wide title={tx('wb.health.title')} subtitle={tx('wb.health.sub')} onClose={onClose} busy={busy} testId="dlg-health"
      footer={<><button type="button" className="fk-btn primary" onClick={go} disabled={busy} data-testid="health-run">{busy ? tx('wb.health.running') : tx('wb.health.run')}</button>
        <button type="button" className="fk-btn ghost" onClick={onClose}>{tx('pos.close')}</button></>}>
      {err ? <div className="fk-err" role="alert">{err}</div> : null}
      {run === undefined ? <div className="fk-loading">{tx('pos.loading')}</div> : run === null ? <div className="fk-hint" data-testid="health-none">{tx('wb.health.none')}</div> : (
        <div data-testid="health-result">
          <div className="wb-overall"><b>{tx('wb.health.overall')}:</b> <span className={'fk-chip ' + TONE[run.overall]} data-testid="health-overall">{tx('wb.health.status.' + run.overall)}</span>
            <span className="fk-hint"> {tx('wb.health.checkedAt', { t: when(run.checkedAt), r: String(run.rulesetVersion) })}</span></div>
          <ul className="wb-checks">{run.checks.map((c: any) => (
            <li key={c.key} className={'wb-check ' + TONE[c.status]} data-testid={'health-' + c.key}>
              <div className="wb-check-head"><span className={'fk-chip ' + TONE[c.status]}>{tx('wb.health.status.' + c.status)}</span> <b>{tx('wb.health.check.' + c.key)}</b>
                {c.affected != null && c.affected > 0 ? <span className="fk-hint"> · {tx('wb.health.affected', { n: fmtNumber(c.affected) })}</span> : null}</div>
              <div className="wb-cause">{c.cause}</div>
              {c.fix ? <div className="fk-hint"><b>{tx('wb.health.fix')}:</b> {c.fix}</div> : null}
              {c.sampleCustomerIds?.length ? <div className="fk-hint">{tx('wb.health.samples')}: {c.sampleCustomerIds.map((id: string) =>
                <button key={id} type="button" className="fk-link" onClick={() => openCustomer(id)}>#{id.slice(0, 8)}</button>)}</div> : null}
              <div className="fk-hint">{c.lastReadyAt ? tx('wb.health.lastReady', { t: when(c.lastReadyAt) }) : tx('wb.health.neverReady')}</div>
            </li>))}</ul>
        </div>
      )}
    </FitDialog>
  );
}

export function AssistantDialog({ onClose, canManage }: { onClose: () => void; canManage: boolean }) {
  const nav = useNavigate();
  const [goal, setGoal] = useState<(typeof GOALS)[number]>('inactive_risk');
  const [channel, setChannel] = useState<'sms' | 'email'>('sms');
  const [service, setService] = useState('');
  const [plan, setPlan] = useState<any | null>(null); const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<'' | 'plan' | 'save' | 'campaign'>(''); const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<any | null>(null); const [campaignId, setCampaignId] = useState<string | null>(null);
  const [key, setKey] = useState(() => requestId());
  const reset = () => { setPlan(null); setSaved(null); setCampaignId(null); setKey(requestId()); };
  const suggest = async () => {
    setBusy('plan'); setErr(null); reset();
    try { const p = await posRetentionApi.winbackPlan({ goal, channel, ...(goal === 'promote_service' ? { service } : {}) }); setPlan(p); setMessage(p.message.body); }
    catch (e) { setErr(errorTextOf(e, tx('people.retention.loadFailed'))); } finally { setBusy(''); }
  };
  const save = async () => {
    setBusy('save'); setErr(null);
    try { setSaved(await posRetentionApi.winbackAudience({ goal, channel, message, idempotencyKey: key, ...(goal === 'promote_service' ? { service } : {}) })); }
    catch (e) { setErr(errorTextOf(e, tx('people.retention.loadFailed'))); } finally { setBusy(''); }
  };
  const toCampaign = async () => {
    if (!saved?.draftId) return;
    setBusy('campaign'); setErr(null);
    try {
      const c = await posCampaignCenterApi.create({ name: plan.message.name, channel, goal: `Win-back: ${goal}`, description: plan.audience.criteria, messageBody: message,
        ...(channel === 'email' && plan.message.subject ? { emailSubject: plan.message.subject } : {}) });
      await posCampaignCenterApi.setAudience(c.id, saved.draftId);
      await posSegmentsApi.linkCampaign(saved.draftId, c.id);
      setCampaignId(c.id);
    } catch (e) { setErr(errorTextOf(e, tx('people.retention.loadFailed'))); } finally { setBusy(''); }
  };
  const p = plan;
  return (
    <FitDialog wide title={tx('wb.ai.title')} subtitle={tx('wb.ai.sub')} onClose={onClose} busy={!!busy} testId="dlg-assistant"
      footer={<>
        {p && !saved ? <button type="button" className="fk-btn primary" onClick={save} disabled={!!busy || !canManage || p.audience.eligible === 0} title={!canManage ? tx('wb.ai.noManage') : undefined} data-testid="ai-save">{busy === 'save' ? tx('wb.ai.saving') : tx('wb.ai.save')}</button> : null}
        {saved && !campaignId ? <button type="button" className="fk-btn primary" onClick={toCampaign} disabled={!!busy} data-testid="ai-campaign">{busy === 'campaign' ? tx('wb.ai.creating') : tx('wb.ai.toCampaign')}</button> : null}
        {campaignId ? <button type="button" className="fk-btn primary" onClick={() => nav('/tenant/marketing/campaigns')} data-testid="ai-open-cc">{tx('wb.ai.openCC')}</button> : null}
        <button type="button" className="fk-btn ghost" onClick={onClose}>{tx('pos.close')}</button></>}>
      <div className="wb-form">
        <label>{tx('wb.ai.goal')}<select className="fk-select" value={goal} onChange={(e) => { setGoal(e.target.value as (typeof GOALS)[number]); reset(); }} data-testid="ai-goal">
          {GOALS.map((g) => <option key={g} value={g}>{tx('wb.ai.goal.' + g)}</option>)}</select></label>
        <label>{tx('wb.ai.channel')}<select className="fk-select" value={channel} onChange={(e) => { setChannel(e.target.value === 'email' ? 'email' : 'sms'); reset(); }} data-testid="ai-channel">
          <option value="sms">{tx('px.ch.sms')}</option><option value="email">{tx('pos.email')}</option></select></label>
        {goal === 'promote_service' ? <label>{tx('wb.ai.service')}<input className="fk-input" value={service} maxLength={60} placeholder={tx('wb.ai.servicePh')} onChange={(e) => { setService(e.target.value); reset(); }} data-testid="ai-service" /></label> : null}
        <button type="button" className="fk-btn" onClick={suggest} disabled={!!busy || (goal === 'promote_service' && service.trim().length < 3)} data-testid="ai-plan">{busy === 'plan' ? tx('wb.ai.planning') : tx('wb.ai.plan')}</button>
      </div>
      {err ? <div className="fk-err" role="alert">{err}</div> : null}
      {p ? (
        <div className="wb-plan" data-testid="ai-result">
          <div className="fk-chip warn">{tx('wb.ai.suggestion')}</div>
          <h3>{tx('wb.ai.criteria')}</h3><p data-testid="ai-criteria">{p.audience.criteria}</p>
          <div className="wb-counts"><span data-testid="ai-selected">{tx('wb.ai.selected', { n: fmtNumber(p.audience.selected) })}</span> · <b data-testid="ai-eligible">{tx('wb.ai.eligible', { n: fmtNumber(p.audience.eligible) })}</b> · <span>{tx('wb.ai.excluded', { n: fmtNumber(p.audience.excludedTotal) })}</span></div>
          {Object.keys(p.audience.excluded).length ? <ul className="fk-list dense" data-testid="ai-excluded">{Object.entries(p.audience.excluded).map(([r, n]) => <li key={r}>{reason(r)}: {fmtNumber(Number(n))}</li>)}</ul> : null}
          <p className="fk-hint" data-testid="ai-never">{tx('wb.ai.never', { n: fmtNumber(p.audience.neverVisited.count) })}</p>
          <h3>{tx('wb.ai.message')}</h3>
          <textarea className="fk-input wb-msg" value={message} maxLength={1000} rows={3} onChange={(e) => setMessage(e.target.value)} disabled={!!saved} data-testid="ai-message" />
          <div className="fk-hint">{p.message.label}{p.message.smsSegments ? ' · ' + tx('wb.ai.segments', { n: String(p.message.smsSegments) }) : ''}</div>
          <h3>{tx('wb.ai.offers')}</h3>
          {p.offers.length ? <ul className="fk-list dense">{p.offers.map((o: any) => <li key={o.dealId}>{o.title}</li>)}</ul> : <div className="fk-hint">{tx('wb.ai.noOffers')}</div>}
          <h3>{tx('wb.ai.window')}</h3><p>{p.sendWindow.text}</p>
          <p className="fk-hint" data-testid="ai-cost">{p.estimatedCostCents != null ? tx('wb.ai.cost', { c: fmtMoney(p.estimatedCostCents) }) : p.costNote}</p>
          {saved ? <div className="fk-note ok" role="status" data-testid="ai-saved">{tx('wb.ai.saved', { n: fmtNumber(saved.counts?.eligible ?? saved.eligible ?? 0) })}</div> : null}
          {campaignId ? <div className="fk-note ok" role="status" data-testid="ai-created">{tx('wb.ai.created')}</div> : null}
          <p className="fk-hint">{p.next}</p>
        </div>
      ) : null}
    </FitDialog>
  );
}
