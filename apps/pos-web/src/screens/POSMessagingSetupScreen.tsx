// POSMessagingSetupScreen.tsx — a salon configures ITS OWN Twilio account (self-service). The tenant is taken from the
// session server-side, so this only ever edits this salon's credentials. Secrets are write-only (masked last-4 after
// save). Requires settings.edit on the server.
//
// BUILD_PLAN Phase 4: the Verify Service booking codes are sent through (and an optional API key to sign it), a real
// "Test Verify" whose result booking verification waits for, disconnect, and a branch's own Twilio beside the salon's.
//
// Phone & Messaging guide (Oct 30 2026): the single authoritative place to configure, test and troubleshoot — two
// responsive columns (left: Account Credentials incl. the API key SID + secret PAIR, Number Assignment, Verify
// Configuration; right: Registration & Messaging Service, Inbound / Status webhooks, Number Search, Test SMS & latest
// result), then Diagnostics, related Communications pages and Audit / last changed. Every original field, the scope
// selector, Save, Disconnect and the step-up flows are kept. Saving is validated with Twilio on the server first (a
// wrong token never overwrites a working setup); buying a number needs a reviewed, server-issued confirmation; a test
// SMS needs a confirmation and reports Accepted until Twilio's signed callback says Delivered.
//
// Round 2 (Four-Module Completion Guide §6–§7, Oct 30 2026):
//   PM-01 the Test SMS follows the scope selector: a branch sends with ITS effective configuration (its own Twilio, else
//         the salon default it inherits) — shown before sending (branch, source, masked account, sender, capabilities,
//         readiness); only the branches this user may act for can be chosen (the server refuses any other: 403);
//   PM-02 the Account SID / API key SID arrive masked (AC…1234); "Show full SID" is the privileged, audited reveal;
//         saving with the masked value keeps the stored SID;
//   PM-03 Registration shows each item as Twilio confirmed it (or "not verified"), the last successful read after an
//         outage, and a "Refresh Status" that reads Twilio now (rate-limited);
//   PM-04 a toll-free sender shows its toll-free verification (status, submitted, last checked, rejection reason, next
//         step) — never 10DLC — and nothing is submitted from here;
//   OPS-01 the webhook section shows the two URL settings' validation and each number's own inbound webhook.
//
// Text Messaging Setup & SMS Readiness guide (Oct 31 2026) — the owner's three priorities, ADDED around every original
// card (messagingSetupCenter.tsx): "Check SMS System" with the six independent parts (Account · Sender · Registration ·
// Inbound · Delivery · Booking Verify), the guided Setup Wizard (resumes at the first unfinished step; opens these cards),
// Branch senders (the sender each branch would actually use) and the searchable Setup history (calendar, basis, 10/20/50).
// The test text can be edited (≤ 160 plain characters); its cost is shown as unavailable (no per-message rate exists).
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { TenantTwilioCredentialsView as Creds } from '@aipowersalon/api-contracts';
import { posPhoneApi, type MessagingReadiness, type AvailableNumber, type NumberQuote, type TestSendResult, type CredsBody } from '../api/posPhoneApi';
import { authApi, type BranchOption } from '../api/authApi';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { useStepUp, isStepUpCancelled } from './access/accessUi';
import { FitDialog, FitPanel, requestId } from '../components/FitKit';
import { isForbidden } from '../components/FinanceKit';
import { Pill, CapsLine, TestRows, CheckRows, RegRow, reasonText, outcomeText, when, splitLink } from './phoneMessagingParts';
import { SmsReadinessPanel, SetupWizard, BranchSenders, SetupActivity } from './messagingSetupCenter';
import { posMessagingSetupApi, type SetupOverview } from '../api/posMessagingSetupApi';

const E164 = /^\+[1-9][0-9]{6,15}$/;
/** a registration refresh run's outcome in words (literal keys — read at render) */
const OUTCOME: Record<string, () => string> = {
  ok: () => t('pm.reg.outcome.ok'), partial: () => t('pm.reg.outcome.partial'), provider_unreachable: () => t('pm.reg.outcome.provider_unreachable'),
  not_configured: () => t('pm.reg.outcome.not_configured'), error: () => t('pm.reg.outcome.error'), running: () => t('pm.reg.outcome.running'),
};
const outcomeLabel = (o: string) => (OUTCOME[o]?.() ?? o);
type Msg = { ok: boolean; text: string } | null;
const codeOf = (e: unknown) => String((e as { code?: unknown } | null)?.code ?? '');

const RELATED: { route: string; label: () => string }[] = [
  { route: '/tenant/communications/phone', label: () => t('pm.title') },
  { route: '/tenant/communications/sms', label: () => t('pos.sms_inbox') },
  { route: '/messages', label: () => t('pos.messages_2') },
  { route: '/tenant/communications/reminders', label: () => t('pos.appointment_reminders') },
  { route: '/tenant/communications/notifications', label: () => t('pos.customer_notifications') },
  { route: '/tenant/communications/templates', label: () => t('pos.message_templates') },
  { route: '/tenant/communications/phone-verification', label: () => t('pos.booking_phone_verification') },
  { route: '/tenant/communications/ai-receptionist', label: () => t('pos.ai_receptionist') },
];

export function POSMessagingSetupScreen() {
  const nav = useNavigate();
  const loc = useLocation();
  // Security Deep Scan §59 (Oct 28 2026): saving / disconnecting the Twilio credentials (and buying a number) is a
  // step-up route — 403 STEP_UP_REQUIRED opens the password prompt and the action is retried once; Cancel changes nothing
  const stepUp = useStepUp(t('comms.messaging.stepUpNeedsPassword'));
  const [creds, setCreds] = useState<Creds | null>(null);
  const [accountSid, setAccountSid] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [fromNumber, setFromNumber] = useState('');
  const [verifySid, setVerifySid] = useState('');
  const [apiKeySid, setApiKeySid] = useState('');
  const [apiKeySecret, setApiKeySecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [askUnverified, setAskUnverified] = useState(false);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<Msg>(null);

  // '' = the salon default every branch inherits; a branch id = that branch's own Twilio.
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [branchId, setBranchId] = useState<string>(() => String((loc.state as { branchId?: unknown } | null)?.branchId ?? ''));
  useEffect(() => { authApi.branches().then((r) => setBranches(r.branches ?? [])).catch(() => setBranches([])); }, []);

  // the shared readiness (the same read the Phone & Messaging page shows)
  const [rd, setRd] = useState<MessagingReadiness | null>(null);
  const [rdErr, setRdErr] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkMsg, setCheckMsg] = useState<Msg>(null);
  const loadReadiness = useCallback(() => {
    posPhoneApi.readiness(branchId).then((r) => { setRd(r); setRdErr(null); }).catch((e) => { setRd(null); setRdErr(isForbidden(e) ? t('pm.check.forbidden') : (e as Error)?.message || t('pm.loadFailed')); });
  }, [branchId]);
  useEffect(loadReadiness, [loadReadiness]);
  // guide §11–§16: the six-part readiness + wizard (the same evidence, judged part by part) and the history's refresh key
  const [ov, setOv] = useState<SetupOverview | null>(null);
  const [ovErr, setOvErr] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [actKey, setActKey] = useState(0);
  const loadOverview = useCallback(() => {
    posMessagingSetupApi.overview(branchId).then((o) => { setOv(o); setOvErr(null); }).catch((e) => { setOv(null); setOvErr(isForbidden(e) ? t('pm.check.forbidden') : (e as Error)?.message || t('pm.loadFailed')); });
  }, [branchId]);
  useEffect(() => { loadOverview(); setActKey((k) => k + 1); }, [rd, loadOverview]);   // every readiness change (check, save, test) refreshes the panel + history
  const openLink = (link: string) => {
    const { path, hash } = splitLink(link);
    if (path && path !== loc.pathname) { nav(path + (hash ? '#' + hash : '')); return; }
    const id = hash.replace(/^#/, '');
    const el = typeof document !== 'undefined' ? (document.getElementById(`pm-${id}`) ?? document.getElementById(id) ?? document.querySelector<HTMLElement>(`[data-testid="${id}"]`)) : null;
    el?.scrollIntoView?.({ block: 'start' });
    el?.querySelector<HTMLElement>('input, select, button')?.focus?.();
  };
  const runCheck = async () => {
    setChecking(true); setCheckMsg(null);
    try { setRd(await posPhoneApi.healthCheck(branchId)); setCheckMsg({ ok: true, text: t('pm.check.done') }); }
    catch (e) { setCheckMsg({ ok: false, text: isForbidden(e) ? t('pm.check.forbidden') : (e as Error)?.message || t('pm.check.failed') }); }
    finally { setChecking(false); }
  };

  useEffect(() => { setMsg(null); setVerifyMsg(null); setAskUnverified(false); }, [branchId]);
  const own = !branchId || !!creds?.branchOverride;
  const load = useCallback(() => {
    posPhoneApi.credentials(branchId).then((c) => {
      setCreds(c);
      // A branch that inherits starts from blank fields (saving creates its OWN row); its own row fills them.
      const mine = !branchId || c.branchOverride;
      setAccountSid(mine ? c.accountSid || '' : ''); setFromNumber(mine ? c.fromNumber || '' : '');
      setVerifySid(mine ? c.verifyServiceSid || '' : ''); setApiKeySid(mine ? c.apiKeySid || '' : ''); setApiKeySecret(''); setAuthToken('');
    }).catch(() => setCreds(null));
  }, [branchId]);
  useEffect(load, [load]);

  // deep links from the dashboard (#credentials, #number, #verify, #registration, #webhooks, #search, #test)
  const scrolled = useRef('');
  useEffect(() => {
    const id = (loc.hash || '').replace(/^#/, '');
    if (!id || scrolled.current === id || !rd) return;
    scrolled.current = id;
    const el = typeof document !== 'undefined' ? document.getElementById(`pm-${id}`) : null;
    el?.scrollIntoView?.({ block: 'start' });
    el?.querySelector<HTMLElement>('input, button')?.focus?.();
  }, [loc.hash, rd]);

  const base = useMemo(() => ({ accountSid: own ? creds?.accountSid || '' : '', fromNumber: own ? creds?.fromNumber || '' : '', verifySid: own ? creds?.verifyServiceSid || '' : '', apiKeySid: own ? creds?.apiKeySid || '' : '' }), [creds, own]);
  const dirty = accountSid !== base.accountSid || fromNumber !== base.fromNumber || verifySid !== base.verifySid || apiKeySid !== base.apiKeySid || !!authToken || !!apiKeySecret;
  const keyChanged = apiKeySid.trim() !== (creds?.apiKeySid ?? '') || accountSid.trim() !== (creds?.accountSid ?? '');
  const keyNeedsSecret = !!apiKeySid.trim() && !apiKeySecret.trim() && (keyChanged || !creds?.hasApiKeySecret || !own);
  const fromInvalid = !!fromNumber.trim() && !E164.test(fromNumber.trim());
  const canSave = !saving && !!accountSid.trim() && (!!fromNumber.trim() || !!verifySid.trim()) && !keyNeedsSecret && !fromInvalid && !(apiKeySecret.trim() && !apiKeySid.trim());

  const save = async (confirmUnverified = false) => {
    setSaving(true); setMsg(null); setAskUnverified(false);
    try {
      const body: CredsBody = { accountSid: accountSid.trim(), authToken: authToken.trim() || undefined, fromNumber: fromNumber.trim() || undefined,
        verifyServiceSid: verifySid.trim(), apiKeySid: apiKeySid.trim(), apiKeySecret: apiKeySecret.trim() || undefined, ...(confirmUnverified ? { confirmUnverified: true } : {}) };
      const updated = await stepUp.run(() => posPhoneApi.saveCredentials(branchId, body));
      setCreds(updated); setAuthToken(''); setApiKeySecret('');
      setMsg({ ok: true, text: updated.verifyServiceSid ? t('pos.saved_now_run_test_verify_booking_dvnw') : t('pos.saved_your_texts_now_send_from_4xzn') });
      loadReadiness();
    } catch (e: any) {
      if (isStepUpCancelled(e)) return;
      if (codeOf(e) === 'MESSAGING_PROVIDER_UNREACHABLE') setAskUnverified(true);
      setMsg({ ok: false, text: e?.message || t('pos.could_not_save_you_may_not_1wm7') });
    } finally { setSaving(false); }
  };

  // PM-02: the full Account SID only on an explicit, audited reveal (step-up) — it then fills the field unchanged
  const [revealing, setRevealing] = useState(false);
  const revealSid = async () => {
    setRevealing(true); setMsg(null);
    try {
      const r = await stepUp.run(() => posPhoneApi.revealSid(own ? branchId : ''));
      if (r.accountSid && accountSid === (creds?.accountSid ?? '')) { setAccountSid(r.accountSid); setCreds((c) => (c ? { ...c, accountSid: r.accountSid } : c)); }
    } catch (e: any) { if (!isStepUpCancelled(e)) setMsg({ ok: false, text: e?.message || t('pm.sid.revealFailed') }); }
    finally { setRevealing(false); }
  };

  // PM-03 / PM-04: read the registration / toll-free verification from Twilio now
  const [refreshing, setRefreshing] = useState(false);
  const [regMsg, setRegMsg] = useState<Msg>(null);
  const refreshRegistration = async () => {
    setRefreshing(true); setRegMsg(null);
    try {
      const r = await posPhoneApi.refreshRegistration(requestId());
      if (!branchId) setRd(r.readiness); else loadReadiness();
      setRegMsg({ ok: r.run.outcome === 'ok', text: r.run.outcome === 'ok' ? t('pm.reg.refreshed') : t('pm.reg.refreshOutcome', { outcome: outcomeLabel(r.run.outcome) }) });
    } catch (e: any) { setRegMsg({ ok: false, text: isForbidden(e) ? t('pm.check.forbidden') : e?.message || t('pm.reg.refreshFailed') }); }
    finally { setRefreshing(false); }
  };

  const runTestVerify = async () => {
    setVerifyBusy(true); setVerifyMsg(null);
    try {
      const r = await posPhoneApi.testVerify(branchId);
      if (r.ok) setVerifyMsg({ ok: true, text: t('pos.verify_works_v0_booking_verification_can_j59d', { v0: String(r.friendlyName ? ` — "${r.friendlyName}"` : '') }) });
      else if (r.reason === 'not_configured') setVerifyMsg({ ok: false, text: t('pos.save_your_credentials_first_then_test') });
      else setVerifyMsg({ ok: false, text: r.error || t('pos.the_test_failed') });
      load(); loadReadiness();
    } catch (e: any) { setVerifyMsg({ ok: false, text: e?.message || t('pos.could_not_run_the_test') }); }
    finally { setVerifyBusy(false); }
  };

  // ── disconnect: the impact first, then a typed confirmation ──
  const [dropOpen, setDropOpen] = useState(false);
  const [dropTyped, setDropTyped] = useState('');
  const [dropBusy, setDropBusy] = useState(false);
  const word = t('pm.disconnect.word');
  const disconnect = async () => {
    setDropBusy(true);
    try { await stepUp.run(() => posPhoneApi.disconnect(branchId)); setMsg({ ok: true, text: t('pos.disconnected') }); setDropOpen(false); setDropTyped(''); load(); loadReadiness(); }
    catch (e: any) { if (!isStepUpCancelled(e)) setMsg({ ok: false, text: e?.message || t('pos.could_not_disconnect') }); }
    finally { setDropBusy(false); }
  };

  // ── number search + the deliberate two-step purchase ──
  const [areaCode, setAreaCode] = useState('');
  const [avail, setAvail] = useState<AvailableNumber[] | null>(null);
  const [numBusy, setNumBusy] = useState('');
  const [numMsg, setNumMsg] = useState<Msg>(null);
  const [quote, setQuote] = useState<NumberQuote | null>(null);
  const searchNumbers = async () => {
    setNumBusy('search'); setNumMsg(null); setAvail(null);
    try { const r = await posPhoneApi.searchNumbers(areaCode.trim()); if (!r.configured) setNumMsg({ ok: false, text: t('pos.connect_your_twilio_account_first_or_q4fb') }); setAvail(r.available || []); }
    catch (e: any) { setNumMsg({ ok: false, text: e?.message || t('pos.search_failed') }); } finally { setNumBusy(''); }
  };
  const review = async (pn: string) => {
    setNumBusy(pn); setNumMsg(null);
    try { const q = await posPhoneApi.quoteNumber(pn); if (q.ok) setQuote(q); else setNumMsg({ ok: false, text: t('pos.connect_your_twilio_account_first_2') }); }
    catch (e: any) { setNumMsg({ ok: false, text: e?.message || t('pos.purchase_failed') }); } finally { setNumBusy(''); }
  };
  const confirmBuy = async () => {
    if (!quote) return;
    setNumBusy('buy');
    try {
      const r = await stepUp.run(() => posPhoneApi.buyNumber(quote.phoneNumber, quote.confirmationToken));
      if (r.ok) { setNumMsg({ ok: true, text: t('pos.bought_number_your_texts_now_send_1lhx', { number: String(r.number) }) }); setAvail(null); setQuote(null); load(); loadReadiness(); }
      else { setNumMsg({ ok: false, text: r.reason === 'not_configured' ? t('pos.connect_your_twilio_account_first_2') : (r.error || t('pos.purchase_failed')) }); setQuote(null); }
    } catch (e: any) { if (!isStepUpCancelled(e)) { setNumMsg({ ok: false, text: e?.message || t('pos.purchase_failed') }); setQuote(null); } }
    finally { setNumBusy(''); }
  };

  // ── test SMS: confirm (with the key fixed when the dialog opens — a double tap never sends twice) ──
  const [testTo, setTestTo] = useState('');
  const [testText, setTestText] = useState('');
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<Msg>(null);
  const [testConfirm, setTestConfirm] = useState<{ key: string } | null>(null);
  const [lastSend, setLastSend] = useState<TestSendResult | null>(null);
  const testInvalid = !!testTo.trim() && !E164.test(testTo.trim());
  // PM-01: the branch this test is sent for (the scope selector), only if this user may act for it
  const authorized = rd?.scope.authorizedBranches ?? null;
  const testBranch = branchId ? (authorized ?? []).find((b) => b.branchId === branchId) ?? null : null;
  const branchAllowed = !branchId || !!testBranch;
  const effectiveConfigured = !branchId ? creds?.status === 'configured' : rd ? rd.account.state !== 'not_configured' && !!rd.sender.number : false;
  const sendTest = async () => {
    if (!testConfirm) return;
    setTesting(true); setTestMsg(null);
    try {
      const r = await posPhoneApi.testSms(testTo.trim(), testConfirm.key, branchId, testText.trim() || undefined);
      setLastSend(r);
      if (r.ok) setTestMsg({ ok: true, text: t('pm.test.accepted', { sid: String(r.sid ?? '').slice(-6) }) });
      else if (r.reason === 'not_configured') setTestMsg({ ok: false, text: t('pos.save_your_credentials_first_then_test') });
      else setTestMsg({ ok: false, text: r.errorCode ? reasonText(r.errorCode) : (r.error || t('pos.send_failed')) });
      setTestConfirm(null); loadReadiness();
    } catch (e: any) { setTestMsg({ ok: false, text: e?.message || t('pos.could_not_run_test') }); setTestConfirm(null); }
    finally { setTesting(false); }
  };

  const configured = creds?.status === 'configured';
  // PM-01: the scope selector offers only the branches the SERVER says this user may act for (authorizedBranches);
  // before the readiness has loaded, the session's branch list
  const scopeBranches: BranchOption[] = rd?.scope.authorizedBranches ? rd.scope.authorizedBranches.map((b) => ({ id: b.branchId, name: b.name ?? '', isActive: true })) : branches;
  const affected = rd ? (!branchId ? rd.scope.branchesInheriting : []) : [];
  const testsHere = (rd?.diagnostics.tests ?? []);

  return (
    <div className="work mos pmc" data-testid="pm-setup">
      {stepUp.prompt}
      <header className="fk-head pmc-head">
        <div className="vh" style={{ minWidth: 0 }}>
          <h1>{t('pos.text_messaging_setup')}</h1>
          <div className="sub">{t('pos.connect_your_own_twilio_account_so_1vsa')}</div>
        </div>
        <div className="fk-head-actions">
          <button type="button" className="fk-btn" onClick={() => { load(); loadReadiness(); loadOverview(); }}>{t('pm.refresh')}</button>
          <button type="button" className="fk-btn" onClick={() => setWizardOpen(true)} disabled={!ov} data-testid="ms-open-wizard">{t('ms.wizard')}</button>
          <button type="button" className="fk-btn primary" onClick={() => void runCheck()} disabled={checking || !configured} data-testid="pm-run-check">{checking ? t('pm.state.checking') : t('ms.check')}</button>
        </div>
      </header>

      <div className="pmc-summary" data-testid="pm-summary">
        {scopeBranches.length > 1 || (branchId && scopeBranches.length) ? (
          <label className="pmc-scope">
            <span>{t('pos.settings_for')}</span>
            <select aria-label={t('pos.branch')} className="fk-select" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">{t('pos.the_whole_salon_every_branch_inherits')}</option>
              {scopeBranches.map((br) => <option key={br.id} value={br.id}>{br.name || t('pos.branch')} {t('pos.its_own_twilio')}</option>)}
            </select>
          </label>
        ) : null}
        <span className="pmc-src" data-testid="pm-source">{!rd ? '' : rd.source === 'branch_override' ? t('pm.source.branch') : rd.source === 'tenant_default' ? (rd.scope.inheritsFromDefault ? t('pm.source.inherited') : t('pm.source.salon')) : t('pm.source.none')}</span>
        {rd ? (<>
          <span className="pmc-sum-i">{t('pm.card.twilio')} <Pill state={rd.account.state} testId="pm-sum-account" /></span>
          <span className="pmc-sum-i">{t('pm.card.number')} <Pill state={rd.sender.state} /></span>
          <span className="pmc-sum-i">{t('pm.card.registration')} <Pill state={rd.a2p.state} /></span>
          <span className="pmc-sum-i">{t('pm.card.readiness')} <Pill state={rd.outbound.state} /></span>
          <span className="pmc-muted">{t('pm.checked', { when: when(rd.account.lastCheckedAt) })}</span>
        </>) : rdErr ? <span className="pmc-muted">{rdErr}</span> : null}
      </div>
      {checkMsg ? <div className={'fk-note ' + (checkMsg.ok ? 'ok' : 'bad')} role="status">{checkMsg.text}</div> : null}
      <SmsReadinessPanel ov={ov} error={ovErr} onOpen={openLink} />
      {wizardOpen && ov ? <SetupWizard ov={ov} onClose={() => setWizardOpen(false)} onOpen={openLink} /> : null}

      <div className="pmc-cols">
        {/* ───────── left: what is configured ───────── */}
        <div className="pmc-col">
          <section id="pm-credentials" className="fk-panel pmc-card" data-testid="pm-credentials">
            <div className="fk-panel-head"><h2>{t('pm.sec.credentials')}</h2>{dirty ? <span className="pmc-dirty" data-testid="pm-dirty">{t('pm.unsaved')}</span> : null}</div>
            <div className="fk-panel-body pmc-form">
              <div data-testid="twilio-status" className={'pmc-status ' + (configured ? 'ok' : 'muted')}>
                {!configured ? (branchId ? t('pos.this_branch_has_no_twilio_of_17ru') : t('pos.not_connected_using_the_shared_number_1fvi'))
                  : branchId && !creds?.branchOverride ? t('pos.this_branch_uses_the_salon_s_fqwh')
                  : t('pos.connected_token_v0', { v0: String(creds?.authTokenLast4 ?? '') })}
                {configured ? <span className="pmc-r">{t('pm.savedNotProof')}</span> : null}
              </div>
              {branchId && !creds?.branchOverride && configured ? <div className="pmc-hint">{t('pm.branch.inheritWarn')}</div> : null}
              {!branchId && rd && rd.scope.branchOverrides.length ? <div className="pmc-hint">{t('pm.branch.overridesKept', { n: String(rd.scope.branchOverrides.length) })}</div> : null}
              <div className="pmc-inline">
                <label className="fk-field" style={{ flex: 1 }}>{t('pos.account_sid')}
                  <input value={accountSid} onChange={(e) => setAccountSid(e.target.value)} placeholder={t('pos.ac')} disabled={saving} aria-label={t('pos.account_sid')} autoComplete="off" data-testid="pm-account-sid" />
                </label>
                {configured && own && creds?.accountSid?.includes('…') && accountSid === creds.accountSid ? (
                  <button type="button" className="fk-btn" onClick={() => void revealSid()} disabled={revealing || saving} data-testid="pm-reveal-sid">{revealing ? t('pm.sid.revealing') : t('pm.sid.reveal')}</button>
                ) : null}
              </div>
              {configured && own && creds?.accountSid?.includes('…') ? <div className="pmc-hint">{t('pm.sid.maskedHint')}</div> : null}
              <label className="fk-field">{t('pos.auth_token')}{' '}{configured && own ? t('pos.leave_blank_to_keep_current') : ''}
                <input type="password" value={authToken} onChange={(e) => setAuthToken(e.target.value)} placeholder={configured ? '••••••••' : t('pos.twilio_auth_token')} disabled={saving} aria-label={t('pos.auth_token')} autoComplete="new-password" />
              </label>
              <div className="pmc-pair">
                <label className="fk-field">{t('pos.api_key_sid_optional_signs_verify_1v9k')}
                  <input value={apiKeySid} onChange={(e) => setApiKeySid(e.target.value)} placeholder={t('pos.sk')} disabled={saving} aria-label={t('pos.api_key_sid')} autoComplete="off" />
                </label>
                <label className="fk-field">{t('pos.api_key_secret')}{' '}{creds?.hasApiKeySecret && own && !keyChanged ? t('pos.leave_blank_to_keep_current') : ''}
                  <input type="password" value={apiKeySecret} onChange={(e) => setApiKeySecret(e.target.value)} disabled={saving || !apiKeySid.trim()} aria-label={t('pos.api_key_secret')} autoComplete="new-password" />
                </label>
              </div>
              {keyNeedsSecret ? <div className="pmc-warn" data-testid="pm-key-needs-secret">{t('pm.key.needsSecret')}</div> : <div className="pmc-hint">{t('pm.key.pairHint')}</div>}
              {rd?.account.apiKey.scope === 'insufficient' ? <div className="pmc-warn" data-testid="pm-key-scope">{reasonText('API_KEY_SCOPE_INSUFFICIENT')}</div> : null}
            </div>
          </section>

          <section id="pm-number" className="fk-panel pmc-card" data-testid="pm-number">
            <div className="fk-panel-head"><h2>{t('pm.sec.number')}</h2>{rd ? <Pill state={rd.sender.state} /> : null}</div>
            <div className="fk-panel-body pmc-form">
              <label className="fk-field">{t('pos.from_number_e_164_for_texts')}
                <input value={fromNumber} onChange={(e) => setFromNumber(e.target.value)} placeholder="+18565551234" disabled={saving} aria-label={t('pos.from_number')} inputMode="tel" />
              </label>
              {fromInvalid ? <div className="pmc-warn">{t('pm.e164')}</div> : null}
              {rd ? (<dl className="pmc-dl">
                <dt>{t('pm.number.capabilities')}</dt><dd><CapsLine caps={rd.sender.capabilities} /></dd>
                <dt>{t('pm.number.ownership')}</dt><dd>{rd.sender.reasonCode ? reasonText(rd.sender.reasonCode) : t('pm.number.onAccount')} · {t('pm.checked', { when: when(rd.sender.lastCheckedAt) })}</dd>
                <dt>{t('pm.number.registered')}</dt><dd>{rd.registeredNumbers.length ? rd.registeredNumbers.map((n) => `${n.number} (${n.status === 'active' ? t('pm.on') : t('pm.off')})`).join(', ') : '—'}</dd>
              </dl>) : null}
              <div className="pmc-hint">{t('pm.number.replaceWarn')}</div>
            </div>
          </section>

          <section id="pm-verify" className="fk-panel pmc-card" data-testid="pm-verify-config">
            <div className="fk-panel-head"><h2>{t('pm.sec.verify')}</h2>{rd ? <Pill state={rd.verify.state} /> : null}</div>
            <div className="fk-panel-body pmc-form">
              {configured && creds?.verifyServiceSid && own ? (
                <div data-testid="verify-status" className={'pmc-status ' + (creds.lastValidatedAt ? 'ok' : 'bad')}>
                  {creds.lastValidatedAt ? t('pos.verify_tested_ok_v0', { v0: String(new Date(creds.lastValidatedAt).toLocaleString()) }) : creds.lastValidationError ? t('pos.verify_test_failed_lastvalidationerror', { lastValidationError: outcomeText(creds.lastValidationError) }) : t('pos.verify_not_tested_yet_booking_verification_ydpe')}
                </div>
              ) : null}
              <label className="fk-field">{t('pos.verify_service_sid_for_booking_verification_10hi')}
                <input value={verifySid} onChange={(e) => setVerifySid(e.target.value)} placeholder={t('pos.va')} disabled={saving} aria-label={t('pos.verify_service_sid')} autoComplete="off" />
              </label>
              {rd?.verify.reasonCode ? <div className="pmc-hint">{reasonText(rd.verify.reasonCode)}{' '}<button type="button" className="fk-link" onClick={() => nav('/tenant/communications/phone-verification')}>{t('pm.verify.open')}</button></div> : null}
              {configured && own && creds?.verifyServiceSid ? (
                <div><button type="button" className="fk-btn" onClick={() => void runTestVerify()} disabled={verifyBusy}>{verifyBusy ? t('pos.testing') : t('pos.test_verify')}</button></div>
              ) : null}
              {verifyMsg && <div data-testid="verify-msg" className={'pmc-msg ' + (verifyMsg.ok ? 'ok' : 'bad')}>{verifyMsg.text}</div>}
            </div>
          </section>

          <div className="pmc-actions" data-testid="pm-save-bar">
            <button type="button" className="fk-btn primary" onClick={() => void save(false)} disabled={!canSave}>{saving ? t('pos.saving_2') : t('pos.save_credentials')}</button>
            {configured && own ? <button type="button" className="fk-btn danger" onClick={() => { setDropTyped(''); setDropOpen(true); }}>{t('pos.disconnect')}</button> : null}
            <span className="pmc-muted">{t('pm.save.validates')}</span>
          </div>
          {askUnverified ? (
            <div className="fk-note bad" role="alert" data-testid="pm-ask-unverified">
              <span>{t('pm.save.unreachableAsk')}</span>
              <button type="button" className="fk-btn" onClick={() => void save(true)} disabled={saving}>{t('pm.save.anyway')}</button>
            </div>
          ) : null}
          {msg && <div className={'pmc-msg ' + (msg.ok ? 'ok' : 'bad')} role="status">{msg.text}</div>}
        </div>

        {/* ───────── right: registration, routing, numbers, tests ───────── */}
        <div className="pmc-col">
          <section id="pm-registration" className="fk-panel pmc-card" data-testid="pm-registration">
            <div className="fk-panel-head"><h2>{t('pm.sec.registration')}</h2>
              {rd ? <Pill state={rd.tollFree?.applicable ? rd.tollFree.state : rd.a2p.state} testId="pm-a2p-state" /> : null}
              <button type="button" className="fk-btn" onClick={() => void refreshRegistration()} disabled={refreshing || !configured} data-testid="pm-reg-refresh">{refreshing ? t('pm.state.checking') : t('pm.reg.refresh')}</button>
            </div>
            <div className="fk-panel-body">
              {rd ? (<>
                <dl className="pmc-dl">
                  <dt>{t('pm.number.type')}</dt><dd data-testid="pm-number-type">{rd.sender.senderType === 'toll_free' ? t('pm.number.tollFree') : rd.sender.senderType === '10dlc' ? t('pm.number.local10dlc') : rd.sender.senderType === 'messaging_service' ? t('pm.number.service') : t('pm.state.unknown')}</dd>
                  {rd.tollFree?.applicable ? (<>
                    <RegRow label={t('pm.tf.verification')} item={rd.tollFree} testId="pm-tf" />
                    <dt>{t('pm.tf.submitted')}</dt><dd>{when(rd.tollFree.submittedAt)}{rd.tollFree.verificationSidLast4 ? <span className="pmc-r">…{rd.tollFree.verificationSidLast4}</span> : null}</dd>
                    {rd.tollFree.rejectionReason || rd.tollFree.rejectionCode ? <><dt>{t('pm.tf.rejection')}</dt><dd data-testid="pm-tf-rejection">{rd.tollFree.rejectionReason ?? ''}{rd.tollFree.rejectionCode ? ` (${t('pm.reason.twilioErrorCode', { code: rd.tollFree.rejectionCode })})` : ''}</dd></> : null}
                    <dt>{t('pm.tf.next')}</dt><dd data-testid="pm-tf-next">{rd.tollFree.nextAction ? reasonText(rd.tollFree.nextAction) : t('pm.tf.nothingToDo')}</dd>
                    <dt>{t('pm.tf.tenDlc')}</dt><dd>{t('pm.tf.tenDlcNotNeeded')}</dd>
                  </>) : (<>
                    <RegRow label={t('pm.a2p.brand')} item={rd.a2p.brand} testId="pm-reg-brand" />
                    <RegRow label={t('pm.a2p.campaign')} item={rd.a2p.campaign} testId="pm-reg-campaign" />
                    <RegRow label={t('pm.a2p.service')} item={rd.a2p.messagingService} testId="pm-reg-service" />
                    <RegRow label={t('pm.reg.numberInService')} item={rd.a2p.numberAssociation} testId="pm-reg-number" />
                  </>)}
                  <dt>{t('pm.reg.lastRead')}</dt><dd data-testid="pm-reg-last">{rd.a2p.lastRun ? `${when(rd.a2p.lastRun.at)} · ${outcomeLabel(rd.a2p.lastRun.outcome)}` : t('pm.reg.neverRead')}{rd.a2p.lastProviderSuccessAt ? ` · ${t('pm.reg.lastSuccess', { when: when(rd.a2p.lastProviderSuccessAt) })}` : ''}</dd>
                </dl>
                {!rd.tollFree?.applicable && rd.a2p.reasonCode ? <div className="pmc-hint">{reasonText(rd.a2p.reasonCode)}</div> : null}
                {regMsg ? <div className={'pmc-msg ' + (regMsg.ok ? 'ok' : 'bad')} role="status" data-testid="pm-reg-msg">{regMsg.text}</div> : null}
                <div className="pmc-hint">{rd.tollFree?.applicable ? t('pm.tf.howTo') : t('pm.a2p.howTo')}</div>
                <div className="pmc-hint">{t('pm.reg.neverSubmits')}</div>
              </>) : <div className="pmc-muted">{rdErr ?? '…'}</div>}
            </div>
          </section>

          <section id="pm-webhooks" className="fk-panel pmc-card" data-testid="pm-webhooks">
            <div className="fk-panel-head"><h2>{t('pm.sec.webhooks')}</h2>{rd ? <Pill state={rd.inbound.state} testId="pm-inbound-state" /> : null}</div>
            <div className="fk-panel-body">
              {rd ? (<dl className="pmc-dl">
                <dt>{t('pm.wh.inbound')}</dt><dd><code className="pmc-code">{rd.inbound.webhookUrl ?? t('pm.wh.noBase')}</code></dd>
                <dt>{t('pm.wh.inboundState')}</dt><dd><Pill state={rd.inbound.state} />{rd.inbound.reasonCode ? <span className="pmc-r">{reasonText(rd.inbound.reasonCode)}</span> : null}</dd>
                <dt>{t('pm.wh.lastInbound')}</dt><dd>{when(rd.inbound.lastVerifiedEventAt)}</dd>
                <dt>{t('pm.wh.status')}</dt><dd><Pill state={rd.inbound.statusCallback.state} />{rd.inbound.statusCallback.reasonCode ? <span className="pmc-r">{reasonText(rd.inbound.statusCallback.reasonCode)}</span> : null}</dd>
                <dt>{t('pm.wh.lastStatus')}</dt><dd>{when(rd.inbound.statusCallback.lastVerifiedEventAt)}</dd>
                {(rd.config?.items ?? []).map((c) => (<Fragment key={c.name}>
                  <dt><code className="pmc-code">{c.name}</code></dt>
                  <dd data-testid={`pm-config-${c.name}`}><Pill state={c.state} />{c.value ? <code className="pmc-code pmc-r">{c.value}</code> : null}{c.reasonCodes.length ? <div className="pmc-step-r">{c.reasonCodes.map(reasonText).join(' · ')}</div> : null}</dd>
                </Fragment>))}
                {rd.inbound.numbers?.length ? (<>
                  <dt>{t('pm.wh.perNumber')}</dt>
                  <dd data-testid="pm-wh-numbers">{rd.inbound.numbers.map((n) => <div key={n.number}>{n.number} <Pill state={n.state} />{n.reasonCode ? <span className="pmc-r">{reasonText(n.reasonCode)}</span> : null}</div>)}</dd>
                </>) : null}
              </dl>) : null}
              <div className="pmc-hint">{t('pm.wh.reachNote')}</div>
              <div className="pmc-hint">{t('pm.wh.signed')}</div>
            </div>
          </section>

          <section id="pm-search" className="fk-panel pmc-card" data-testid="pm-search">
            <div className="fk-panel-head"><h2>{t('pos.your_text_number')}</h2></div>
            <div className="fk-panel-body">
              <div className="pmc-muted" style={{ marginBottom: 6 }}>{rd?.sender.number ? <>{t('pos.current')}{' '}<b>{rd.sender.number}</b></> : t('pos.no_number_yet_buy_one_and_1339')}</div>
              <div className="pmc-inline">
                <label className="fk-field" style={{ flex: 1 }}>{t('pos.area_code_optional')}
                  <input value={areaCode} onChange={(e) => setAreaCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} placeholder="856" inputMode="numeric" aria-label={t('pos.area_code_optional')} />
                </label>
                <button type="button" className="fk-btn" disabled={!!numBusy} onClick={() => void searchNumbers()}>{numBusy === 'search' ? t('pos.searching_2') : t('pos.search')}</button>
              </div>
              {avail && !avail.length ? <div className="pmc-muted" data-testid="pm-no-numbers">{t('pm.search.none')}</div> : null}
              {avail?.length ? (
                <ul className="fk-list" data-testid="pm-available">
                  {avail.map((a) => (
                    <li key={a.phoneNumber} className="fk-li pmc-avail">
                      <div className="fk-li-main"><span className="fk-li-t">{a.phoneNumber}</span><span className="pmc-muted">{a.locality || ''}{a.region ? `, ${a.region}` : ''}</span></div>
                      <CapsLine caps={a.capabilities} />
                      <button type="button" className="fk-btn" disabled={!!numBusy} onClick={() => void review(a.phoneNumber)}>{numBusy === a.phoneNumber ? t('pm.search.checking') : t('pm.search.review')}</button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="pmc-hint">{t('pm.search.neverAuto')}</div>
              {numMsg && <div className={'pmc-msg ' + (numMsg.ok ? 'ok' : 'bad')} role="status">{numMsg.text}</div>}
            </div>
          </section>

          <section id="pm-test" className="fk-panel pmc-card" data-testid="pm-test">
            <div className="fk-panel-head"><h2>{t('pos.send_a_test_message')}</h2>{rd?.lastTest ? <Pill state={rd.lastTest.status} testId="pm-last-test" /> : null}</div>
            <div className="fk-panel-body pmc-form">
              {rd ? (
                <dl className="pmc-dl" data-testid="pm-test-effective">
                  <dt>{t('pm.test.forScope')}</dt><dd data-testid="pm-test-scope">{branchId ? (testBranch?.name ?? rd.scope.branchName ?? t('pos.branch')) : (rd.scope.salonName ?? t('pm.scope.salon'))}{' · '}{rd.source === 'branch_override' ? t('pm.source.branch') : rd.source === 'tenant_default' ? (rd.scope.inheritsFromDefault ? t('pm.source.inherited') : t('pm.source.salon')) : t('pm.source.none')}</dd>
                  <dt>{t('pm.test.account')}</dt><dd data-testid="pm-test-account">{rd.account.accountSidMasked ?? '—'}</dd>
                  <dt>{t('pm.test.from')}</dt><dd data-testid="pm-test-sender">{rd.sender.number ?? '—'}{rd.a2p.messagingService.sidLast4 ? <span className="pmc-r">{t('pm.test.viaService', { last4: rd.a2p.messagingService.sidLast4 })}</span> : null}</dd>
                  <dt>{t('pm.number.capabilities')}</dt><dd><CapsLine caps={rd.sender.capabilities} /></dd>
                  <dt>{t('pm.card.readiness')}</dt><dd><Pill state={rd.outbound.state} testId="pm-test-readiness" />{rd.outbound.reasonCode ? <span className="pmc-r">{reasonText(rd.outbound.reasonCode)}</span> : null}</dd>
                </dl>
              ) : null}
              {!branchAllowed ? <div className="pmc-warn" data-testid="pm-test-not-allowed">{t('pm.test.branchNotAllowed')}</div> : null}
              {effectiveConfigured && branchAllowed ? (<>
                <label className="fk-field">{t('pos.send_to_e_164')}
                  <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="+18565550000" disabled={testing} aria-label={t('pos.send_to_e_164')} inputMode="tel" />
                </label>
                {testInvalid ? <div className="pmc-warn">{t('pm.e164')}</div> : <div className="pmc-hint">{t('pm.test.ownPhoneOnly')}</div>}
                <label className="fk-field">{t('ms.test.text')}
                  <textarea value={testText} onChange={(e) => setTestText(e.target.value)} maxLength={160} rows={2} disabled={testing} aria-label={t('ms.test.text')} data-testid="ms-test-text" />
                </label>
                <div className="pmc-hint">{t('ms.test.textHint')} · {testText.trim().length}/160 · <span data-testid="ms-test-cost">{t('ms.test.cost')}</span></div>
                <div><button type="button" className="fk-btn" onClick={() => setTestConfirm({ key: requestId() })} disabled={testing || !testTo.trim() || testInvalid}>{testing ? t('pos.sending') : t('pos.send_test_sms')}</button></div>
                {testMsg && <div className={'pmc-msg ' + (testMsg.ok ? 'ok' : 'bad')} role="status" data-testid="pm-test-msg">{testMsg.text}</div>}
                {lastSend?.warnings?.length ? <div className="pmc-hint">{lastSend.warnings.map(reasonText).join(' · ')}</div> : null}
              </>) : branchAllowed ? <div className="pmc-muted">{t('pos.save_your_credentials_first_then_test')}</div> : null}
              <div className="pmc-sub">{t('pm.test.latest')}</div>
              <TestRows tests={testsHere} empty={t('pm.test.none')} />
            </div>
          </section>
        </div>
      </div>

      {/* ───────── bottom: diagnostics · related · audit ───────── */}
      <div className="pmc-bottom">
        <BranchSenders onConfigure={(id) => { setBranchId(id); openLink('#pm-summary'); }} />
        <SetupActivity branches={scopeBranches.map((b) => ({ id: b.id, name: b.name || t('pos.branch') }))} refreshKey={actKey} />
        <FitPanel title={t('pm.diag.title')} testId="pm-diag" className="pmc-span2">
          {rd ? <CheckRows checks={rd.diagnostics.checks} /> : <div className="pmc-muted">{rdErr ?? '…'}</div>}
          {rd?.outbound.blockers.length ? <div className="pmc-hint"><b>{t('pm.diag.blockers')}</b>{' '}{rd.outbound.blockers.map(reasonText).join(' · ')}</div> : null}
          {rd?.outbound.warnings.length ? <div className="pmc-hint"><b>{t('pm.diag.warnings')}</b>{' '}{rd.outbound.warnings.map(reasonText).join(' · ')}</div> : null}
        </FitPanel>
        <FitPanel title={t('pm.related')} testId="pm-related">
          <div className="pmc-links">{RELATED.map((l) => <button type="button" key={l.route} className="fk-btn" onClick={() => nav(splitLink(l.route).path)}>{l.label()}</button>)}</div>
        </FitPanel>
        <FitPanel title={t('pm.audit.title')} testId="pm-audit">
          <dl className="pmc-dl">
            <dt>{t('pm.audit.lastChanged')}</dt><dd>{when(rd?.lastChanged.at)}{rd?.lastChanged.byUserLast4 ? ` · ${t('pm.audit.by', { last4: rd.lastChanged.byUserLast4 })}` : ''}</dd>
          </dl>
          <div className="pmc-hint">{t('pm.audit.note')}</div>
        </FitPanel>
      </div>

      {dropOpen ? (
        <FitDialog title={t('pm.disconnect.title')} onClose={() => setDropOpen(false)} busy={dropBusy} testId="pm-disconnect"
          footer={<><button type="button" className="fk-btn" onClick={() => setDropOpen(false)} disabled={dropBusy}>{t('pm.cancel')}</button>
            <button type="button" className="fk-btn danger" disabled={dropBusy || dropTyped.trim().toUpperCase() !== word.toUpperCase()} onClick={() => void disconnect()}>{t('pos.disconnect')}</button></>}>
          <p className="pmc-p">{branchId ? t('pos.disconnect_this_branch_s_own_twilio_165d') : t('pos.disconnect_your_twilio_account_texts_fall_1q6k')}</p>
          <ul className="pmc-impact" data-testid="pm-impact">
            {!branchId ? <li>{affected.length ? t('pm.disconnect.branches', { n: String(affected.length), names: affected.slice(0, 5).map((b) => b.name ?? '—').join(', ') }) : t('pm.disconnect.noBranches')}</li> : <li>{t('pm.disconnect.branchFallsBack')}</li>}
            {rd?.verify.tenantEnabled || rd?.verify.requiredByPlatform ? <li>{t('pm.disconnect.verify')}</li> : null}
            {rd?.sender.number ? <li>{t('pm.disconnect.number', { number: rd.sender.number })}</li> : null}
            <li>{t('pm.disconnect.voice')}</li>
            <li>{t('pm.disconnect.provider')}</li>
          </ul>
          <label className="fk-field">{t('pm.disconnect.type', { word })}
            <input value={dropTyped} onChange={(e) => setDropTyped(e.target.value)} aria-label={t('pm.disconnect.typeLabel')} data-autofocus autoComplete="off" />
          </label>
        </FitDialog>
      ) : null}

      {quote ? (
        <FitDialog title={t('pm.buy.title')} onClose={() => setQuote(null)} busy={numBusy === 'buy'} testId="pm-buy"
          footer={<><button type="button" className="fk-btn" onClick={() => setQuote(null)} disabled={numBusy === 'buy'}>{t('pm.cancel')}</button>
            <button type="button" className="fk-btn primary" onClick={() => void confirmBuy()} disabled={numBusy === 'buy'}>{numBusy === 'buy' ? t('pos.buying') : t('pm.buy.confirm')}</button></>}>
          <dl className="pmc-dl">
            <dt>{t('pm.card.number')}</dt><dd><b>{quote.phoneNumber}</b></dd>
            <dt>{t('pm.number.capabilities')}</dt><dd><CapsLine caps={quote.capabilities} /></dd>
            <dt>{t('pm.buy.price')}</dt><dd data-testid="pm-buy-price">{quote.price ? t('pm.buy.priceMonthly', { amount: quote.price.amount, unit: quote.price.unit }) : t('pm.buy.noPrice')}</dd>
            <dt>{t('pm.buy.billedTo')}</dt><dd>{quote.billedTo === 'salon_account' ? t('pm.buy.salonAccount') : t('pm.buy.platformAccount')}</dd>
            <dt>{t('pm.buy.expires')}</dt><dd>{when(quote.expiresAt)}</dd>
          </dl>
          {quote.replacesNumber ? <div className="pmc-warn">{t('pm.buy.replaces', { number: quote.replacesNumber })}</div> : null}
          <div className="pmc-hint">{t('pm.buy.chargeNote')}</div>
        </FitDialog>
      ) : null}

      {testConfirm ? (
        <FitDialog title={t('pm.test.confirmTitle')} onClose={() => setTestConfirm(null)} busy={testing} testId="pm-test-confirm"
          footer={<><button type="button" className="fk-btn" onClick={() => setTestConfirm(null)} disabled={testing}>{t('pm.cancel')}</button>
            <button type="button" className="fk-btn primary" onClick={() => void sendTest()} disabled={testing}>{testing ? t('pos.sending') : t('pm.test.confirmSend')}</button></>}>
          <dl className="pmc-dl">
            <dt>{t('pm.test.forScope')}</dt><dd>{branchId ? (testBranch?.name ?? t('pos.branch')) : (rd?.scope.salonName ?? t('pm.scope.salon'))}</dd>
            <dt>{t('pm.test.account')}</dt><dd>{rd?.account.accountSidMasked ?? '—'}</dd>
            <dt>{t('pm.test.from')}</dt><dd>{rd?.sender.number ?? creds?.fromNumber ?? '—'}</dd>
            <dt>{t('pm.col.to')}</dt><dd>{testTo.trim()}</dd>
            <dt>{t('pm.test.preview')}</dt><dd className="pmc-quote">{t('pm.test.body')}</dd>
          </dl>
          {rd && rd.a2p.applicable && rd.a2p.state !== 'approved' ? <div className="pmc-warn">{t('pm.reason.A2P_NOT_APPROVED_MAY_BE_FILTERED')}</div> : null}
          {rd?.tollFree?.applicable && rd.tollFree.state !== 'approved' ? <div className="pmc-warn">{t('pm.reason.TOLL_FREE_VERIFICATION_REQUIRED')}</div> : null}
          {rd && !rd.outbound.deliveryTracking ? <div className="pmc-warn">{t('pm.reason.DELIVERY_NOT_TRACKED')}</div> : null}
          <div className="pmc-hint">{t('pm.test.realNote')}</div>
        </FitDialog>
      ) : null}
    </div>
  );
}
