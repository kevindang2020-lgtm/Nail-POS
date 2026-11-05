// POSMessagingSetupScreen.tsx — a salon configures ITS OWN Twilio account (self-service). The tenant is taken from the
// session server-side, so this only ever edits this salon's credentials. Secrets are write-only (masked last-4 after
// save). Requires settings.edit on the server.
//
// BUILD_PLAN Phase 4: the Verify Service booking codes are sent through (and an optional API key to sign it), a real
// "Test Verify" whose result booking verification waits for, disconnect, and a branch's own Twilio beside the salon's.
import { useCallback, useEffect, useState } from 'react';
import { useInlineConfirm } from '@aipowersalon/ui';
import type { TenantTwilioCredentialsView as Creds } from '@aipowersalon/api-contracts';
import { api } from '../api/client';
import { authApi, type BranchOption } from '../api/authApi';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { useStepUp, isStepUpCancelled } from './access/accessUi';

const GOLD = 'var(--aps-gold,#A96F22)';
const LINE = 'var(--line,#E7DBC6)';
const CARD: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 16, maxWidth: 520 };
const INPUT: React.CSSProperties = { width: '100%', height: 38, border: `1px solid ${LINE}`, borderRadius: 9, padding: '0 10px', fontSize: 13, boxSizing: 'border-box' };
const LABEL: React.CSSProperties = { fontSize: 12, color: '#7A6C57', margin: '10px 0 4px', fontWeight: 600 };

export function POSMessagingSetupScreen() {
  // Security Deep Scan §59 (Oct 28 2026): saving / disconnecting the Twilio credentials is a step-up route — 403
  // STEP_UP_REQUIRED opens the password prompt and the action is retried once; Cancel changes nothing
  const stepUp = useStepUp(t('comms.messaging.stepUpNeedsPassword'));
  const [creds, setCreds] = useState<Creds | null>(null);
  const [accountSid, setAccountSid] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [fromNumber, setFromNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [num, setNum] = useState<{ configured: boolean; usingOwnAccount: boolean; registeredNumber: string | null } | null>(null);
  const [areaCode, setAreaCode] = useState('');
  const [avail, setAvail] = useState<{ phoneNumber: string; friendlyName: string; locality: string | null; region: string | null }[]>([]);
  const [numBusy, setNumBusy] = useState('');
  const [numMsg, setNumMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { api.get<any>('/tenant/messaging/number').then(setNum).catch(() => setNum(null)); }, [creds?.status]);
  const searchNumbers = async () => {
    setNumBusy('search'); setNumMsg(null); setAvail([]);
    try { const r = await api.get<any>('/tenant/messaging/number/search', areaCode.trim() ? { areaCode: areaCode.trim() } : undefined); if (!r.configured) setNumMsg({ ok: false, text: t('pos.connect_your_twilio_account_first_or_q4fb') }); setAvail(r.available || []); }
    catch (e: any) { setNumMsg({ ok: false, text: e?.message || t('pos.search_failed') }); } finally { setNumBusy(''); }
  };
  const buyNumber = async (pn: string) => {
    setNumBusy(pn); setNumMsg(null);
    try { const r = await api.post<any>('/tenant/messaging/number/buy', { phoneNumber: pn }); if (r.ok) { setNumMsg({ ok: true, text: t('pos.bought_number_your_texts_now_send_1lhx', { number: String(r.number) }) }); setAvail([]); api.get<any>('/tenant/messaging/number').then(setNum); } else setNumMsg({ ok: false, text: r.reason === 'not_configured' ? t('pos.connect_your_twilio_account_first_2') : (r.error || t('pos.purchase_failed')) }); }
    catch (e: any) { setNumMsg({ ok: false, text: e?.message || t('pos.purchase_failed') }); } finally { setNumBusy(''); }
  };

  // Phase 4: '' = the salon default every branch inherits; a branch id = that branch's own Twilio.
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [branchId, setBranchId] = useState('');
  const [verifySid, setVerifySid] = useState('');
  const [apiKeySid, setApiKeySid] = useState('');
  const [apiKeySecret, setApiKeySecret] = useState('');
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const { confirm, confirmUi } = useInlineConfirm();
  useEffect(() => { authApi.branches().then((r) => setBranches(r.branches ?? [])).catch(() => setBranches([])); }, []);
  const b = encodeURIComponent(branchId);

  useEffect(() => { setMsg(null); setVerifyMsg(null); }, [branchId]);
  const load = useCallback(() => {
    (branchId ? api.get<Creds>(`/tenant/messaging/credentials/branches/${b}`) : api.get<Creds>('/tenant/messaging/credentials')).then((c) => {
      setCreds(c);
      // A branch that inherits starts from blank fields (saving creates its OWN row); its own row fills them.
      const own = !branchId || c.branchOverride;
      setAccountSid(own ? c.accountSid || '' : ''); setFromNumber(own ? c.fromNumber || '' : '');
      setVerifySid(own ? c.verifyServiceSid || '' : ''); setApiKeySid(own ? c.apiKeySid || '' : ''); setApiKeySecret(''); setAuthToken('');
    }).catch(() => setCreds(null));
  }, [branchId]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load]);

  const runTest = async () => {
    setTesting(true); setTestMsg(null);
    try {
      const r = await api.post<{ ok: boolean; sid?: string; error?: string; reason?: string }>('/tenant/messaging/credentials/test', { to: testTo.trim() });
      if (r.ok) setTestMsg({ ok: true, text: t('pos.sent_message_sid_check_that_phone', { sid: String(r.sid) }) });
      else if (r.reason === 'not_configured') setTestMsg({ ok: false, text: t('pos.save_your_credentials_first_then_test') });
      else setTestMsg({ ok: false, text: r.error || t('pos.send_failed') });
    } catch (e: any) {
      setTestMsg({ ok: false, text: e?.message || t('pos.could_not_run_test') });
    } finally { setTesting(false); }
  };

  const runTestVerify = async () => {
    setVerifyBusy(true); setVerifyMsg(null);
    try {
      const r = await (branchId ? api.post<{ ok: boolean; friendlyName?: string | null; error?: string; reason?: string }>(`/tenant/messaging/credentials/branches/${b}/test-verify`, {})
        : api.post<{ ok: boolean; friendlyName?: string | null; error?: string; reason?: string }>('/tenant/messaging/credentials/test-verify', {}));
      if (r.ok) setVerifyMsg({ ok: true, text: t('pos.verify_works_v0_booking_verification_can_j59d', { v0: String(r.friendlyName ? ` — "${r.friendlyName}"` : '') }) });
      else if (r.reason === 'not_configured') setVerifyMsg({ ok: false, text: t('pos.save_your_credentials_first_then_test') });
      else setVerifyMsg({ ok: false, text: r.error || t('pos.the_test_failed') });
      load();
    } catch (e: any) { setVerifyMsg({ ok: false, text: e?.message || t('pos.could_not_run_the_test') }); }
    finally { setVerifyBusy(false); }
  };

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      const body = { accountSid: accountSid.trim(), authToken: authToken.trim() || undefined, fromNumber: fromNumber.trim() || undefined,
        verifyServiceSid: verifySid.trim(), apiKeySid: apiKeySid.trim(), apiKeySecret: apiKeySecret.trim() || undefined };
      const updated = await stepUp.run(() => (branchId ? api.put<Creds>(`/tenant/messaging/credentials/branches/${b}`, body) : api.put<Creds>('/tenant/messaging/credentials', body)));
      setCreds(updated); setAuthToken(''); setApiKeySecret('');
      setMsg({ ok: true, text: updated.verifyServiceSid ? t('pos.saved_now_run_test_verify_booking_dvnw') : t('pos.saved_your_texts_now_send_from_4xzn') });
    } catch (e: any) {
      if (isStepUpCancelled(e)) return;
      setMsg({ ok: false, text: e?.message || t('pos.could_not_save_you_may_not_1wm7') });
    } finally { setSaving(false); }
  };

  const disconnect = () => confirm(branchId ? t('pos.disconnect_this_branch_s_own_twilio_165d') : t('pos.disconnect_your_twilio_account_texts_fall_1q6k'), async () => {
    try { await stepUp.run(() => (branchId ? api.del<{ ok: boolean }>(`/tenant/messaging/credentials/branches/${b}`) : api.del<{ ok: boolean }>('/tenant/messaging/credentials'))); setMsg({ ok: true, text: t('pos.disconnected') }); load(); }
    catch (e: any) { if (!isStepUpCancelled(e)) setMsg({ ok: false, text: e?.message || t('pos.could_not_disconnect') }); }
  }, { confirmLabel: t('pos.disconnect') });

  const configured = creds?.status === 'configured';
  return (
    <div style={{ padding: 20 }}>
      <h1 style={{ fontFamily: 'var(--aps-font-head, "Playfair Display", serif)', fontSize: 22, color: GOLD, margin: '0 0 4px' }}>{t('pos.text_messaging_setup')}</h1>
      <p style={{ fontSize: 13, color: '#7A6C57', margin: '0 0 16px', maxWidth: 520 }}>{t('pos.connect_your_own_twilio_account_so_1vsa')}</p>
      {confirmUi}
      {stepUp.prompt}
      <div style={CARD}>
        {branches.length > 1 ? (
          <div style={{ marginBottom: 8 }}>
            <div style={LABEL}>{t('pos.settings_for')}</div>
            <select aria-label={t('pos.branch')} style={INPUT} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">{t('pos.the_whole_salon_every_branch_inherits')}</option>
              {branches.map((br) => <option key={br.id} value={br.id}>{br.name || t('pos.branch')} {t('pos.its_own_twilio')}</option>)}
            </select>
          </div>
        ) : null}
        <div data-testid="twilio-status" style={{ fontSize: 12.5, color: configured ? '#2E7D5B' : '#9B8B78', fontWeight: 700, marginBottom: 4 }}>
          {!configured ? (branchId ? t('pos.this_branch_has_no_twilio_of_17ru') : t('pos.not_connected_using_the_shared_number_1fvi'))
            : branchId && !creds?.branchOverride ? t('pos.this_branch_uses_the_salon_s_fqwh')
            : t('pos.connected_token_v0', { v0: String(creds?.authTokenLast4 ?? '') })}
        </div>
        {configured && creds?.verifyServiceSid && (!branchId || creds.branchOverride) ? (
          <div data-testid="verify-status" style={{ fontSize: 12, marginBottom: 4, color: creds.lastValidatedAt ? '#2E7D5B' : '#B85B4D' }}>
            {creds.lastValidatedAt ? t('pos.verify_tested_ok_v0', { v0: String(new Date(creds.lastValidatedAt).toLocaleString()) }) : creds.lastValidationError ? t('pos.verify_test_failed_lastvalidationerror', { lastValidationError: String(creds.lastValidationError) }) : t('pos.verify_not_tested_yet_booking_verification_ydpe')}
          </div>
        ) : null}
        <div style={LABEL}>{t('pos.account_sid')}</div>
        <input style={INPUT} value={accountSid} onChange={(e) => setAccountSid(e.target.value)} placeholder={t('pos.ac')} disabled={saving} aria-label={t('pos.account_sid')} />
        <div style={LABEL}>{t('pos.auth_token')}{' '}{configured && (!branchId || creds?.branchOverride) ? t('pos.leave_blank_to_keep_current') : ''}</div>
        <input style={INPUT} type="password" value={authToken} onChange={(e) => setAuthToken(e.target.value)} placeholder={configured ? '••••••••' : t('pos.twilio_auth_token')} disabled={saving} aria-label={t('pos.auth_token')} />
        <div style={LABEL}>{t('pos.from_number_e_164_for_texts')}</div>
        <input style={INPUT} value={fromNumber} onChange={(e) => setFromNumber(e.target.value)} placeholder="+18565551234" disabled={saving} aria-label={t('pos.from_number')} />
        <div style={LABEL}>{t('pos.verify_service_sid_for_booking_verification_10hi')}</div>
        <input style={INPUT} value={verifySid} onChange={(e) => setVerifySid(e.target.value)} placeholder={t('pos.va')} disabled={saving} aria-label={t('pos.verify_service_sid')} />
        <div style={LABEL}>{t('pos.api_key_sid_optional_signs_verify_1v9k')}</div>
        <input style={INPUT} value={apiKeySid} onChange={(e) => setApiKeySid(e.target.value)} placeholder={t('pos.sk')} disabled={saving} aria-label={t('pos.api_key_sid')} />
        {apiKeySid.trim() ? (<>
          <div style={LABEL}>{t('pos.api_key_secret')}{' '}{creds?.hasApiKeySecret ? t('pos.leave_blank_to_keep_current') : ''}</div>
          <input style={INPUT} type="password" value={apiKeySecret} onChange={(e) => setApiKeySecret(e.target.value)} disabled={saving} aria-label={t('pos.api_key_secret')} />
        </>) : null}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
          <button onClick={save} disabled={saving || !accountSid.trim() || (!fromNumber.trim() && !verifySid.trim())} style={{ height: 38, padding: '0 18px', borderRadius: 9, border: 'none', background: GOLD, color: '#fff', fontWeight: 700, cursor: 'pointer', opacity: saving || !accountSid.trim() || (!fromNumber.trim() && !verifySid.trim()) ? 0.6 : 1 }}>
            {saving ? t('pos.saving_2') : t('pos.save_credentials')}
          </button>
          {configured && (!branchId || creds?.branchOverride) && creds?.verifyServiceSid ? (
            <button onClick={() => void runTestVerify()} disabled={verifyBusy} style={{ height: 38, padding: '0 16px', borderRadius: 9, border: `1px solid ${GOLD}`, background: 'transparent', color: GOLD, fontWeight: 700, cursor: 'pointer' }}>{verifyBusy ? t('pos.testing') : t('pos.test_verify')}</button>
          ) : null}
          {configured && (!branchId || creds?.branchOverride) ? (
            <button onClick={disconnect} style={{ height: 38, padding: '0 14px', borderRadius: 9, border: '1px solid #E2B8B0', background: 'transparent', color: '#B85B4D', fontWeight: 600, cursor: 'pointer' }}>{t('pos.disconnect')}</button>
          ) : null}
        </div>
        {msg && <div style={{ fontSize: 12.5, marginTop: 10, color: msg.ok ? '#2E7D5B' : '#B85B4D' }}>{msg.text}</div>}
        {verifyMsg && <div data-testid="verify-msg" style={{ fontSize: 12.5, marginTop: 6, color: verifyMsg.ok ? '#2E7D5B' : '#B85B4D' }}>{verifyMsg.text}</div>}
      </div>

      <div style={{ ...CARD, marginTop: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#5A4B37', marginBottom: 4 }}>{t('pos.your_text_number')}</div>
        <div style={{ fontSize: 12.5, color: '#7A6C57', marginBottom: 8 }}>
          {num?.registeredNumber ? <>{t('pos.current')}{' '}<b>{num.registeredNumber}</b></> : t('pos.no_number_yet_buy_one_and_1339')}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}><div style={LABEL}>{t('pos.area_code_optional')}</div><input style={INPUT} value={areaCode} onChange={(e) => setAreaCode(e.target.value)} placeholder="856" /></div>
          <button style={{ ...INPUT, width: 'auto', padding: '0 14px', cursor: 'pointer', fontWeight: 700, color: GOLD, borderColor: GOLD, height: 38 }} disabled={!!numBusy} onClick={searchNumbers}>{numBusy === 'search' ? t('pos.searching_2') : t('pos.search')}</button>
        </div>
        {avail.map((a) => (
          <div key={a.phoneNumber} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${LINE}` }}>
            <div style={{ flex: 1, fontSize: 13 }}><b>{a.phoneNumber}</b> <span style={{ color: '#9B8B78', fontSize: 12 }}>{a.locality || ''}{a.region ? `, ${a.region}` : ''}</span></div>
            <button style={{ height: 30, padding: '0 12px', borderRadius: 8, border: 'none', background: GOLD, color: '#fff', fontWeight: 700, cursor: 'pointer' }} disabled={!!numBusy} onClick={() => buyNumber(a.phoneNumber)}>{numBusy === a.phoneNumber ? t('pos.buying') : t('pos.buy')}</button>
          </div>
        ))}
        {numMsg && <div style={{ fontSize: 12.5, marginTop: 10, color: numMsg.ok ? '#2E7D5B' : '#B85B4D' }}>{numMsg.text}</div>}
      </div>
      {configured && !branchId && (
        <div style={{ ...CARD, marginTop: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#5A4B37', marginBottom: 6 }}>{t('pos.send_a_test_message')}</div>
          <div style={LABEL}>{t('pos.send_to_e_164')}</div>
          <input style={INPUT} value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="+18565550000" disabled={testing} />
          <button onClick={runTest} disabled={testing || !testTo.trim()} style={{ marginTop: 12, height: 36, padding: '0 16px', borderRadius: 9, border: `1px solid ${GOLD}`, background: 'transparent', color: GOLD, fontWeight: 700, cursor: 'pointer', opacity: testing || !testTo.trim() ? 0.6 : 1 }}>
            {testing ? t('pos.sending') : t('pos.send_test_sms')}
          </button>
          {testMsg && <div style={{ fontSize: 12.5, marginTop: 10, color: testMsg.ok ? '#2E7D5B' : '#B85B4D' }}>{testMsg.text}</div>}
        </div>
      )}
    </div>
  );
}
