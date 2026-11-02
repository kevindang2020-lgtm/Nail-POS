// POSSecurityScreen.tsx — /tenant/account/security. The security hub linked from the Account screen
// ("Manage Security", "Change Password", "Manage Active Sessions"). Everything here is real:
//   • 2FA      — GET /auth/mfa/status, POST /auth/mfa/enroll + /confirm (authenticator TOTP)
//   • Password — POST /auth/change-password (step-up code required when 2FA is on)
//   • Sessions — GET /pos/me/sessions, POST /pos/me/sessions/:id/revoke + /revoke-all
//   • Activity — GET /pos/audit/events, filtered to security/auth/account events
import { RecoveryCodesCard, DevicesCard, SignInActivityCard, SignInPolicyCard, ConnectedAppsCard } from '../components/AuthSecurityPanels';
import { displayLocale } from '../i18n/format';
import { useCan } from '../components/usePermissions';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { posSessionsApi, type SignInSession } from '../api/posSessionsApi';
import { posSecurityApi, type MfaStatus, type MfaEnroll } from '../api/posSecurityApi';
import { posAuditApi, type AuditEventRow } from '../api/posAuditApi';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { auditActionLabel, auditModuleLabel } from '../components/codeLabel';
import { errorTextOf } from '../i18n/error-text';

const G = '#A96F22';
const OK = '#2E7D32';
const BAD = '#C0392B';
const cardBox: React.CSSProperties = { background: 'var(--card,#FFFDF8)', border: '1px solid var(--line)', borderRadius: 16, padding: 16 };
const grid2: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 14 };
const input: React.CSSProperties = { width: '100%', height: 36, border: '1px solid var(--line)', borderRadius: 10, padding: '0 11px', fontFamily: 'inherit', fontSize: 13, background: '#FFFDF8', outline: 'none', boxSizing: 'border-box' };

const humanize = (a: string) => auditActionLabel(a);
const cap = (s?: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '—');
const fmtWhen = (iso: string) => { const d = new Date(iso); if (isNaN(d.getTime())) return iso; return `${d.toLocaleDateString(displayLocale(), { month: 'short', day: '2-digit', year: 'numeric' })} — ${d.toLocaleTimeString(displayLocale(), { hour: 'numeric', minute: '2-digit' })}`; };
const fmtDate = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleDateString(displayLocale(), { month: 'short', day: '2-digit', year: 'numeric' }); };
const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
const statusPill = (s: string) => (({ success: 'ok', warning: 'warn', failed: 'mut' } as Record<string, string>)[s] || 'mut');
const headRow = (title: string, right?: React.ReactNode) => (<div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}><div style={{ fontWeight: 800, fontSize: 14 }}>{title}</div>{right ? <div style={{ marginLeft: 'auto' }}>{right}</div> : null}</div>);
const Msg = ({ m }: { m: { ok: boolean; text: string } | null }) => (m ? <div style={{ fontSize: 11.5, color: m.ok ? OK : BAD, marginTop: 8, fontWeight: 600 }}>{m.text}</div> : null);

type Me = { passwordChangedAt: string | null; lastLoginAt: string | null };

export function POSSecurityScreen() {
  const nav = useNavigate();
  // Constitution 3 Step 9: owners set the salon's sign-in policy here (saving needs settings.edit)
  const canSetPolicy = useCan()('settings.edit');
  const [mfa, setMfa] = useState<MfaStatus | null>(null);
  const [sessions, setSessions] = useState<SignInSession[] | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [activity, setActivity] = useState<AuditEventRow[] | null>(null);

  const [enroll, setEnroll] = useState<MfaEnroll | null>(null);
  const [otp, setOtp] = useState('');
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaMsg, setMfaMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Security Deep Scan C1: replacing a CONFIRMED authenticator needs that authenticator's current code (server: 403
  // CURRENT_MFA_REQUIRED without it). `replacing` shows the current-code step; it also opens when the server says so.
  const [replacing, setReplacing] = useState(false);
  const [curCode, setCurCode] = useState('');

  const [cur, setCur] = useState(''); const [nw, setNw] = useState(''); const [cf, setCf] = useState(''); const [pwOtp, setPwOtp] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [allBusy, setAllBusy] = useState(false);

  const loadMfa = () => posSecurityApi.mfaStatus().then(setMfa).catch(() => setMfa(null));
  const loadSessions = () => posSessionsApi.list().then((d) => setSessions(d?.sessions || [])).catch(() => setSessions([]));
  const loadProfile = () => api.get<Me>('/pos/me/profile').then(setMe).catch(() => setMe(null));

  useEffect(() => {
    loadMfa(); loadSessions(); loadProfile();
    posAuditApi.events({ pageSize: 14 }).then((d) => setActivity((d?.items || []).filter((e) => ['security', 'auth', 'account'].includes(e.module)).slice(0, 6))).catch(() => setActivity([]));
  }, []);

  const startEnroll = async (currentCode?: string) => {
    if (currentCode !== undefined && currentCode.length !== 6) { setMfaMsg({ ok: false, text: t('pos.mfa_enter_current_code') }); return; }
    setMfaBusy(true); setMfaMsg(null);
    try { setEnroll(await posSecurityApi.mfaEnroll(currentCode)); setReplacing(false); setCurCode(''); }
    catch (e: any) {
      if (e?.code === 'CURRENT_MFA_REQUIRED') { setReplacing(true); setCurCode(''); setMfaMsg(currentCode ? { ok: false, text: e?.message || t('pos.mfa_current_code_wrong') } : null); }
      else setMfaMsg({ ok: false, text: t('pos.could_not_start_2fa_setup_please_4nyk') });
    } finally { setMfaBusy(false); }
  };
  const cancelReplace = () => { setReplacing(false); setCurCode(''); setMfaMsg(null); };
  const confirmEnroll = async () => {
    if (otp.trim().length < 6) { setMfaMsg({ ok: false, text: t('pos.enter_the_6_digit_code_from_1uxt') }); return; }
    setMfaBusy(true); setMfaMsg(null);
    try { await posSecurityApi.mfaConfirm(otp.trim()); setEnroll(null); setOtp(''); setMfaMsg({ ok: true, text: t('pos.two_factor_authentication_is_now_enabled') }); await loadMfa(); }
    catch { setMfaMsg({ ok: false, text: t('pos.that_code_didn_t_match_check_16fs') }); }
    finally { setMfaBusy(false); }
  };

  const submitPassword = async () => {
    setPwMsg(null);
    if (!cur || !nw || !cf) { setPwMsg({ ok: false, text: t('pos.fill_in_all_password_fields') }); return; }
    if (nw !== cf) { setPwMsg({ ok: false, text: t('pos.new_password_and_confirmation_don_t_7qjp') }); return; }
    if (nw.length < 8) { setPwMsg({ ok: false, text: t('pos.use_at_least_8_characters_for_1ywv') }); return; }
    if (mfa?.confirmed && pwOtp.trim().length < 6) { setPwMsg({ ok: false, text: t('pos.enter_your_authenticator_code_to_confirm_1vmz') }); return; }
    setPwBusy(true);
    try {
      await posSecurityApi.changePassword({ currentPassword: cur, newPassword: nw, confirmPassword: cf, mfaCode: mfa?.confirmed ? pwOtp.trim() : undefined });
      setCur(''); setNw(''); setCf(''); setPwOtp(''); setPwMsg({ ok: true, text: t('pos.password_updated') }); loadProfile();
    } catch (e: any) {
      setPwMsg({ ok: false, text: errorTextOf(e, t('pos.could_not_change_password_check_your_1kdi')) });
    } finally { setPwBusy(false); }
  };

  const revokeOne = async (id: string) => { setBusyId(id); try { await posSessionsApi.revoke(id); await loadSessions(); } catch { /* ignore */ } finally { setBusyId(null); } };
  const revokeAll = async () => { setAllBusy(true); try { await posSessionsApi.revokeAll(); await loadSessions(); } catch { /* ignore */ } finally { setAllBusy(false); } };

  const twoFA = !!mfa?.confirmed;
  const activeCount = sessions ? sessions.filter((s) => s.active).length : null;
  const pwDays = me?.passwordChangedAt ? daysSince(me.passwordChangedAt) : null;
  const lastLogin = (sessions && sessions.length ? sessions[0].signedInAt : me?.lastLoginAt) || null;

  const kpis = [
    { l: t('pos.two_factor_auth'), v: mfa === null ? '…' : twoFA ? t('pos.enabled') : t('pos.disabled'), d: twoFA ? t('pos.authenticator_active') : t('pos.not_configured'), ok: twoFA },
    { l: t('pos.active_sessions'), v: activeCount == null ? '…' : String(activeCount), d: t('pos.devices_signed_in'), ok: true },
    { l: t('pos.password_age'), v: pwDays == null ? '—' : `${pwDays}d`, d: t('pos.since_last_change'), ok: pwDays == null || pwDays < 180 },
    { l: t('pos.last_sign_in_3'), v: lastLogin ? fmtWhen(lastLogin).split(' — ')[0] : '—', d: lastLogin ? fmtWhen(lastLogin).split(' — ')[1] || '' : t('pos.no_sign_ins'), ok: true },
  ];

  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
     <div className="vh flex flex-col md:flex-row items-start md:items-end justify-between gap-3">
        <div><h1>{t('pos.security_access')}</h1><div className="sub">{t('pos.two_factor_authentication_password_active_sessions_onh1')}</div></div>
        <button className="btn ghost" onClick={() => nav('/tenant/account/overview')}>{t('pos.back_to_account')}</button>
      </div>

      <div className="kpis" style={{ margin: 0 }}>
        {kpis.map((k) => (
          <div className="kpi" key={k.l} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div className="l">{k.l}</div>
            <div className="v" style={{ color: k.ok ? G : BAD, fontSize: 20 }}>{k.v}</div>
            <div className="d" style={{ color: k.ok ? G : '#9a6a12' }}>{k.d}</div>
          </div>
        ))}
      </div>

      <div style={grid2}>
        <section style={cardBox}>
          {headRow(t('pos.two_factor_authentication'))}
          {mfa === null ? <div className="muted">{t('pos.checking')}</div> : replacing && !enroll ? (
            <div data-testid="mfa-replace">
              <p style={{ fontSize: 12, marginBottom: 6 }}>{t('pos.mfa_replace_needs_current_code')}</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input aria-label={t('pos.mfa_current_code_label')} value={curCode} onChange={(e) => setCurCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" inputMode="numeric" autoComplete="one-time-code" style={{ ...input, width: 130, letterSpacing: '.3em', textAlign: 'center' }} />
                <button className="btn" onClick={() => void startEnroll(curCode)} disabled={mfaBusy || curCode.length !== 6}>{mfaBusy ? t('pos.starting') : t('pos.mfa_replace_continue')}</button>
                <button className="btn ghost" onClick={cancelReplace} disabled={mfaBusy}>{t('pos.cancel')}</button>
              </div>
            </div>
          ) : twoFA && !enroll ? (
            <div><span className="pill ok">{t('pos.enabled')}</span><p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>{t('pos.your_account_is_protected_with_an_1plc')}</p>
              <button className="btn ghost" onClick={() => { setReplacing(true); setCurCode(''); setMfaMsg(null); }}>{t('pos.mfa_replace_authenticator')}</button></div>
          ) : enroll ? (
            <div>
              <p style={{ fontSize: 12, marginBottom: 6 }}>{t('pos.1_add_this_setup_key_to_1969')}</p>
              <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, fontWeight: 700, background: 'var(--cream2,#F3E7D2)', padding: '8px 10px', borderRadius: 8, wordBreak: 'break-all', letterSpacing: '.06em' }}>{enroll.secret}</div>
              <p style={{ fontSize: 12, margin: '10px 0 6px' }}>{t('pos.2_enter_the_6_digit_code_8645')}</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" inputMode="numeric" style={{ ...input, width: 130, letterSpacing: '.3em', textAlign: 'center' }} />
                <button className="btn" onClick={confirmEnroll} disabled={mfaBusy}>{mfaBusy ? t('pos.verifying') : t('pos.verify_enable')}</button>
                <button className="btn ghost" onClick={() => { setEnroll(null); setOtp(''); setMfaMsg(null); }}>{t('pos.cancel')}</button>
              </div>
            </div>
          ) : (
            <div><span className="pill warn">{t('pos.disabled')}</span><p style={{ fontSize: 12, color: 'var(--muted)', margin: '10px 0' }}>{t('pos.add_an_authenticator_app_to_require_15oe')}</p><button className="btn" onClick={() => void startEnroll()} disabled={mfaBusy}>{mfaBusy ? t('pos.starting') : t('pos.enable_2fa')}</button></div>
          )}
          <Msg m={mfaMsg} />
        </section>

        <section style={cardBox}>
          {headRow(t('pos.change_password'))}
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 10 }}>{t('pos.last_changed')}{' '}{me?.passwordChangedAt ? fmtDate(me.passwordChangedAt) : '—'}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input type="password" value={cur} onChange={(e) => setCur(e.target.value)} placeholder={t('pos.current_password')} style={input} autoComplete="current-password" />
            <input type="password" value={nw} onChange={(e) => setNw(e.target.value)} placeholder={t('pos.new_password')} style={input} autoComplete="new-password" />
            <input type="password" value={cf} onChange={(e) => setCf(e.target.value)} placeholder={t('pos.confirm_new_password')} style={input} autoComplete="new-password" />
            {twoFA ? <input value={pwOtp} onChange={(e) => setPwOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder={t('pos.authenticator_code')} inputMode="numeric" style={input} /> : null}
            <button className="btn" onClick={submitPassword} disabled={pwBusy} style={{ alignSelf: 'flex-start' }}>{pwBusy ? t('pos.updating') : t('pos.update_password')}</button>
          </div>
          <Msg m={pwMsg} />
        </section>
      </div>

      <div style={grid2}>
        <section style={cardBox}>
          {headRow(t('pos.active_sessions'), sessions && sessions.some((s) => s.active) ? <button className="btn ghost" onClick={revokeAll} disabled={allBusy}>{allBusy ? t('pos.signing_out') : t('pos.sign_out_all')}</button> : undefined)}
          {sessions === null ? <div className="muted">{t('pos.loading')}</div> : sessions.length === 0 ? <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{t('pos.no_sessions_found')}</div> : (
            <div className="list" style={{ maxHeight: 300 }}>
              {sessions.map((s) => (
                <div className="row" key={s.id} style={{ alignItems: 'center' }}>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 12 }}>{s.device}</div><div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{(s.ip || t('pos.ip_unavailable'))} · {fmtWhen(s.signedInAt)}</div></div>
                  <span className={'pill ' + (s.active ? 'ok' : 'mut')}>{s.active ? t('pos.active_3') : cap(s.status)}</span>
                  {s.active ? <button className="btn ghost" style={{ padding: '5px 10px', marginLeft: 8 }} onClick={() => revokeOne(s.id)} disabled={busyId === s.id}>{busyId === s.id ? '…' : t('pos.revoke')}</button> : null}
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 8 }}>{t('pos.sign_out_all_ends_every_session_jpwt')}</div>
        </section>

        <section style={cardBox}>
          {headRow(t('pos.recent_security_activity'), <button className="btn ghost" onClick={() => nav('/tenant/account/activity-logs')}>{t('pos.view_full_log')}</button>)}
          {activity === null ? <div className="muted">{t('pos.loading')}</div> : activity.length === 0 ? <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{t('pos.no_recent_security_activity')}</div> : (
            <div className="list" style={{ maxHeight: 300 }}>
              {activity.map((e) => (
                <div className="row" key={e.id}>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 12 }}>{humanize(e.action)}</div><div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{e.summary || auditModuleLabel(e.module)}</div></div>
                  <div style={{ textAlign: 'right' }}><span className={'pill ' + statusPill(e.status)}>{cap(e.status)}</span><div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{fmtWhen(e.occurredAt)}</div></div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Constitution 3 Step 8: recovery codes, devices, sign-in activity */}
      <div style={{ ...grid2, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        <RecoveryCodesCard mfaConfirmed={!!mfa?.confirmed} />
        <DevicesCard />
        <SignInActivityCard />
      </div>
      {canSetPolicy && <div style={{ ...grid2, marginTop: 12 }}><SignInPolicyCard /><ConnectedAppsCard /></div>}
    </div>
  );
}
