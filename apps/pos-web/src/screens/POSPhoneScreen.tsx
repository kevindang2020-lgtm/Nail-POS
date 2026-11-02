// POSPhoneScreen.tsx — Communications → Phone & Caller ID (/tenant/communications/phone): the Phone & Messaging Center
// dashboard (owner guide, Oct 30 2026). Read-mostly and honest: every card is one INDEPENDENT status from the shared
// server readiness (GET /tenant/messaging/readiness — the same configuration Text Messaging Setup edits; there is no
// second store), each with its last-checked time, a reason in plain words and a link to where it is fixed:
//   header: salon / branch, last refreshed, Refresh, Run health check (settings.edit), Open Messaging Setup
//   four cards: Assigned Number · Twilio Connection · Carrier Registration · Messaging Readiness
//   Guided Setup 1–5 (deep links into the setup page sections) · Booking Verify readiness · AI Receptionist / Voice
//   (read-only, its own page) · Recent diagnostics · Helpful next action
// "Connected" needs an authenticated provider check of the current configuration; a stale check is never green; a
// test text is "Delivered" only after Twilio's signed callback.
// Round 2 (Oct 30 2026): Carrier Registration is what TWILIO confirmed (PM-03 snapshots — a Super Admin submission alone
// is "Unknown — not verified", with the last successful read after an outage); a toll-free sender shows its toll-free
// verification instead of 10DLC (PM-04); the account is shown masked (AC…1234, PM-02).
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posPhoneApi, type MessagingReadiness } from '../api/posPhoneApi';
import { posAiApi, type ReceptionistOverview } from '../api/posAiApi';
import { authApi, type BranchOption } from '../api/authApi';
import { FitPanel, KpiCard } from '../components/FitKit';
import { useLoad, StateBlock, isForbidden } from '../components/FinanceKit';
import { Pill, CapsLine, Checklist, TestRows, CheckRows, reasonText, stateLabel, toneOf, when, splitLink, type StatusTone } from './phoneMessagingParts';

const kpiTone = (t: StatusTone): 'ok' | 'warn' | 'bad' | undefined => (t === 'muted' ? undefined : t);

export function POSPhoneScreen() {
  const nav = useNavigate();
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [branchId, setBranchId] = useState('');
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [fresh, setFresh] = useState<MessagingReadiness | null>(null);
  useEffect(() => { authApi.branches().then((r) => setBranches(r.branches ?? [])).catch(() => setBranches([])); }, []);
  const rd = useLoad(() => posPhoneApi.readiness(branchId), [branchId]);
  const voice = useLoad<ReceptionistOverview | null>(() => posAiApi.receptionistOverview(), []);
  useEffect(() => { setFresh(null); }, [rd.data]);
  const r = fresh ?? rd.data;

  const goTo = (link: string) => { const { path, hash } = splitLink(link); nav(path + (hash ? `#${hash}` : ''), { state: { branchId } }); };
  const runCheck = async () => {
    setChecking(true); setNote(null);
    try { setFresh(await posPhoneApi.healthCheck(branchId)); setNote({ ok: true, text: tx('pm.check.done') }); }
    catch (e) { setNote({ ok: false, text: isForbidden(e) ? tx('pm.check.forbidden') : (e as Error)?.message || tx('pm.check.failed') }); }
    finally { setChecking(false); }
  };

  // the registration card: toll-free verification for a toll-free sender, else 10DLC — as the provider confirmed it
  const regState = r ? (r.tollFree?.applicable ? r.tollFree.state : r.a2p.state) : '';
  const regSub = !r ? '' : r.tollFree?.applicable
    ? [r.tollFree.nextAction ? reasonText(r.tollFree.nextAction) : '', r.tollFree.verified ? tx('pm.reg.confirmed') : tx('pm.reg.notConfirmed'), r.tollFree.errorClass ? tx('pm.reg.lastSuccess', { when: when(r.tollFree.lastSuccessAt) }) : ''].filter(Boolean).join(' · ')
    : r.a2p.applicable
      ? [tx('pm.a2p.brandCampaign', { brand: stateLabel(r.a2p.brand.state), campaign: stateLabel(r.a2p.campaign.state) }), r.a2p.providerVerified ? tx('pm.reg.confirmed') : tx('pm.reg.notConfirmed'),
        r.a2p.state === 'unable_to_verify' && r.a2p.lastProviderSuccessAt ? tx('pm.reg.lastSuccess', { when: when(r.a2p.lastProviderSuccessAt) }) : ''].filter(Boolean).join(' · ')
      : reasonText(r.a2p.reasonCode);
  const next = r?.checklist.find((s) => s.state !== 'done' && s.state !== 'not_applicable') ?? null;
  const scopeName = r ? (r.scope.branchName ? `${r.scope.salonName ?? ''} · ${r.scope.branchName}` : (r.scope.salonName ?? '')) : '';
  const sourceText = !r ? '' : r.source === 'branch_override' ? tx('pm.source.branch') : r.source === 'tenant_default' ? (r.scope.inheritsFromDefault ? tx('pm.source.inherited') : tx('pm.source.salon')) : tx('pm.source.none');

  return (
    <div className="work mos pmc" data-testid="pm-dashboard">
      <header className="fk-head pmc-head">
        <div className="vh" style={{ minWidth: 0 }}>
          <h1>{tx('pm.title')}</h1>
          <div className="sub">{scopeName}{scopeName ? ' · ' : ''}{sourceText}{r ? ` · ${tx('pm.lastRefreshed', { when: when(r.generatedAt) })}` : ''}</div>
        </div>
        <div className="fk-head-actions">
          {branches.length > 1 ? (
            <select className="fk-select" aria-label={tx('pm.scope.label')} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">{tx('pm.scope.salon')}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name || tx('pm.scope.branch')}</option>)}
            </select>
          ) : null}
          <button type="button" className="fk-btn" onClick={() => { setNote(null); rd.reload(); }} disabled={rd.loading}>{tx('pm.refresh')}</button>
          <button type="button" className="fk-btn" onClick={() => void runCheck()} disabled={checking} data-testid="pm-run-check">{checking ? tx('pm.state.checking') : tx('pm.check.run')}</button>
          <button type="button" className="fk-btn primary" onClick={() => goTo('/tenant/communications/messaging-setup')}>{tx('pm.openSetup')}</button>
        </div>
      </header>
      {note ? <div className={'fk-note ' + (note.ok ? 'ok' : 'bad')} role="status">{note.text}</div> : null}
      {rd.error && !r ? <StateBlock error={rd.error} onRetry={rd.reload} /> : null}

      <div className="pmc-cards" data-testid="pm-cards">
        <KpiCard testId="pm-card-number" label={tx('pm.card.number')} loading={!r} tone={r ? kpiTone(toneOf(r.sender.state)) : undefined}
          value={r ? (r.sender.number ?? stateLabel(r.sender.state)) : ''} sub={r ? `${stateLabel(r.sender.state)}${r.sender.reasonCode ? ' · ' + reasonText(r.sender.reasonCode) : ''}` : ''} onClick={() => goTo(r?.sender.fixLink ?? '/tenant/communications/messaging-setup#number')} />
        <KpiCard testId="pm-card-twilio" label={tx('pm.card.twilio')} loading={!r} tone={r ? kpiTone(toneOf(r.account.state)) : undefined}
          value={r ? stateLabel(r.account.state) : ''} sub={r ? `${tx('pm.checked', { when: when(r.account.lastCheckedAt) })}${r.account.reasonCode ? ' · ' + reasonText(r.account.reasonCode) : ''}` : ''} onClick={() => goTo(r?.account.fixLink ?? '/tenant/communications/messaging-setup#credentials')} />
        <KpiCard testId="pm-card-registration" label={r?.tollFree?.applicable ? tx('pm.tf.card') : tx('pm.card.registration')} loading={!r} tone={r ? kpiTone(toneOf(regState)) : undefined}
          value={r ? stateLabel(regState) : ''} sub={r ? regSub : ''} onClick={() => goTo(r?.a2p.fixLink ?? '/tenant/communications/messaging-setup#registration')} />
        <KpiCard testId="pm-card-readiness" label={tx('pm.card.readiness')} loading={!r} tone={r ? kpiTone(toneOf(r.outbound.state)) : undefined}
          value={r ? stateLabel(r.outbound.state) : ''} sub={r ? (r.outbound.reasonCode ? reasonText(r.outbound.reasonCode) : tx('pm.readiness.deliveryNote')) : ''} onClick={() => goTo(r?.outbound.fixLink ?? '/tenant/communications/messaging-setup#test')} />
      </div>

      {r ? (
        <div className="pmc-grid">
          <FitPanel title={tx('pm.setupProgress')} testId="pm-progress" className="pmc-span2">
            <Checklist items={r.checklist} onOpen={goTo} />
            {next ? <div className="pmc-next" data-testid="pm-next"><b>{tx('pm.nextAction')}</b>{' '}{reasonText(next.reasonCode) || stateLabel(next.state)}{' '}<button type="button" className="fk-link" onClick={() => goTo(next.fixLink)}>{tx('pm.fixThis')}</button></div>
              : <div className="pmc-next ok">{tx('pm.allDone')}</div>}
          </FitPanel>

          <FitPanel title={tx('pm.verify.title')} testId="pm-verify" actions={<button type="button" className="fk-btn" aria-label={tx('pm.verify.open')} onClick={() => goTo('/tenant/communications/phone-verification')}>{tx('pm.openShort')}</button>}>
            <dl className="pmc-dl">
              <dt>{tx('pm.verify.effective')}</dt><dd><Pill state={r.verify.state} testId="pm-verify-state" />{r.verify.reasonCode ? <span className="pmc-r">{reasonText(r.verify.reasonCode)}</span> : null}</dd>
              <dt>{tx('pm.verify.tenantToggle')}</dt><dd>{r.verify.tenantEnabled ? tx('pm.on') : tx('pm.off')}{r.verify.requiredByPlatform ? ` · ${tx('pm.verify.requiredByPlatform')}` : ''}{r.verify.platformBlocked ? ` · ${tx('pm.verify.platformBlocked')}` : ''}</dd>
              <dt>{tx('pm.verify.channel')}</dt><dd>{r.verify.channel === 'verify_service' ? tx('pm.verify.viaService', { last4: r.verify.serviceSidLast4 ?? '' }) : r.verify.channel === 'sms_code' ? tx('pm.verify.viaSms') : '—'}</dd>
              <dt>{tx('pm.verify.tested')}</dt><dd>{when(r.verify.lastCheckedAt)}</dd>
            </dl>
            <div className="pmc-hint">{tx('pm.verify.independent')}</div>
          </FitPanel>

          <FitPanel title={tx('pm.voice.title')} testId="pm-voice" actions={<button type="button" className="fk-btn" aria-label={tx('pm.voice.open')} onClick={() => nav('/tenant/communications/ai-receptionist')}>{tx('pm.openShort')}</button>}>
            <dl className="pmc-dl">
              <dt>{tx('pm.voice.status')}</dt>
              <dd>{voice.data ? <Pill state={voice.data.frontDeskStatus === 'live' || voice.data.frontDeskStatus === 'ready' ? 'ready' : voice.data.frontDeskStatus === 'paused' ? 'disabled' : 'action'} testId="pm-voice-state" /> : voice.error ? <span className="pmc-muted">{isForbidden(voice.error) ? tx('pm.voice.noAccess') : tx('pm.state.unknown')}</span> : <span className="pmc-muted">…</span>}
                {voice.data ? <span className="pmc-r">{tx('pm.voice.setup', { pct: String(voice.data.setupProgressPct ?? 0) })}</span> : null}</dd>
              <dt>{tx('pm.voice.numberVoice')}</dt><dd>{r.voice.numberVoiceCapable == null ? tx('pm.state.unknown') : r.voice.numberVoiceCapable ? tx('pm.caps.yes') : tx('pm.caps.no')}</dd>
            </dl>
            <div className="pmc-hint">{tx('pm.voice.independent')}</div>
          </FitPanel>

          <FitPanel title={tx('pm.diag.title')} testId="pm-diagnostics" className="pmc-span2">
            <div className="pmc-sub">{tx('pm.diag.checks')}</div>
            <CheckRows checks={r.diagnostics.checks} />
            <div className="pmc-sub">{tx('pm.diag.tests')}</div>
            <TestRows tests={r.diagnostics.tests} empty={tx('pm.test.none')} />
          </FitPanel>

          <FitPanel title={tx('pm.number.detail')} testId="pm-number-detail">
            <dl className="pmc-dl">
              <dt>{tx('pm.card.number')}</dt><dd>{r.sender.number ?? '—'}</dd>
              <dt>{tx('pm.number.capabilities')}</dt><dd><CapsLine caps={r.sender.capabilities} /></dd>
              <dt>{tx('pm.number.type')}</dt><dd>{r.sender.senderType === 'toll_free' ? tx('pm.number.tollFree') : r.sender.senderType === '10dlc' ? tx('pm.number.local10dlc') : r.sender.senderType === 'messaging_service' ? tx('pm.number.service') : tx('pm.state.unknown')}</dd>
              <dt>{tx('pm.card.twilio')}</dt><dd data-testid="pm-account-masked">{r.account.accountSidMasked ?? (r.account.accountSidLast4 ? tx('pm.account.sidHint', { last4: r.account.accountSidLast4 }) : '—')}{r.account.mode === 'platform_managed' ? ` · ${tx('pm.account.platformManaged')}` : ''}</dd>
            </dl>
          </FitPanel>
        </div>
      ) : null}
    </div>
  );
}
