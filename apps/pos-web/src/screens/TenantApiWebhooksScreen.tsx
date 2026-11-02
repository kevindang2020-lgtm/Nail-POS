import { useEffect, useState } from 'react';
import { useInlineConfirm } from '@aipowersalon/ui';
import { posApiKeysApi, posWebhooksApi, type ApiKeyView, type WebhookView } from '../api/posApiWebhooksApi';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { codeLabel } from '../components/codeLabel';
import { useStepUp, isStepUpCancelled } from './access/accessUi';

// TenantApiWebhooksScreen.tsx — Devices & Integrations › APIs & Webhooks (spec §53), wired to /pos/api-keys and
// /pos/webhooks. Raw secrets are shown exactly ONCE in a reveal banner after create/rotate (the server never returns
// them again); lists are masked. Webhook URLs are SSRF-validated server-side — those errors surface honestly here.
const fieldStyle: React.CSSProperties = { height: 32, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px', background: '#FFFDF8', fontFamily: 'inherit', fontSize: 12.5, color: 'var(--text)' };
const head: React.CSSProperties = { fontWeight: 800, fontSize: 14, fontFamily: 'var(--aps-font-head, Playfair Display)' };
const dash = '—';
const splitCsv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : dash);

export function TenantApiWebhooksScreen() {
  const [keys, setKeys] = useState<ApiKeyView[] | null>(null);
  const [hooks, setHooks] = useState<WebhookView[] | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [reveal, setReveal] = useState<{ label: string; secret: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [kForm, setKForm] = useState<{ open: boolean; name: string; env: string; scopes: string }>({ open: false, name: '', env: 'live', scopes: '' });
  const [wForm, setWForm] = useState<{ open: boolean; name: string; url: string; events: string }>({ open: false, name: '', url: '', events: '' });

  const loadKeys = () => posApiKeysApi.list().then((d) => setKeys(d || [])).catch((e: any) => { setKeys([]); if (e?.status !== 403) setMsg({ tone: 'err', text: e?.message || t('pos.could_not_load_api_keys') }); });
  const loadHooks = () => posWebhooksApi.list().then((d) => setHooks(d || [])).catch((e: any) => { setHooks([]); if (e?.status !== 403) setMsg({ tone: 'err', text: e?.message || t('pos.could_not_load_webhooks') }); });
  useEffect(() => { loadKeys(); loadHooks(); }, []);

  const { confirm: askConfirm, confirmUi } = useInlineConfirm();
  // Security Deep Scan C7: issuing / rotating an API key and creating a webhook / rotating its signing secret are step-up
  // routes — password prompt, one retry; Cancel mints nothing and shows nothing.
  const stepUp = useStepUp(t('pos.stepup_api_keys_needs_password'));
  const copy = (s: string) => { try { navigator?.clipboard?.writeText?.(s); setMsg({ tone: 'ok', text: t('pos.copied_to_clipboard') }); } catch { /* clipboard unavailable */ } };

  const createKey = async () => {
    if (!kForm.name.trim()) { setMsg({ tone: 'err', text: t('pos.key_name_is_required') }); return; }
    setBusy('kcreate'); setMsg(null);
    try { const r = await stepUp.run(() => posApiKeysApi.create({ name: kForm.name.trim(), environment: kForm.env, scopes: splitCsv(kForm.scopes) })); setReveal({ label: t('pos.api_key_name', { name: String(r.name) }), secret: r.secret }); setKForm({ open: false, name: '', env: 'live', scopes: '' }); loadKeys(); }
    catch (e: any) { if (!isStepUpCancelled(e)) setMsg({ tone: 'err', text: e?.message || t('pos.create_failed') }); } finally { setBusy(null); }
  };
  const rotateKey = (id: string, name: string) => askConfirm(t('admin.api.confirm.rotateKey', { name }), () => { void doRotateKey(id, name); }, { confirmLabel: t('pos.rotate_key') });
  const doRotateKey = async (id: string, _name: string) => {
    setBusy('kr' + id); setMsg(null);
    try { const r = await stepUp.run(() => posApiKeysApi.rotate(id)); setReveal({ label: t('pos.rotated_api_key_name', { name: String(r.name) }), secret: r.secret }); loadKeys(); }
    catch (e: any) { if (!isStepUpCancelled(e)) setMsg({ tone: 'err', text: e?.message || t('pos.rotate_failed') }); } finally { setBusy(null); }
  };
  const revokeKey = (id: string, name: string) => askConfirm(t('admin.api.confirm.revokeKey', { name }), () => { void doRevokeKey(id, name); }, { confirmLabel: t('pos.revoke_key') });
  const doRevokeKey = async (id: string, name: string) => {
    setBusy('kv' + id); setMsg(null);
    try { await posApiKeysApi.revoke(id); setMsg({ tone: 'ok', text: t('pos.name_revoked', { name: String(name) }) }); loadKeys(); }
    catch (e: any) { setMsg({ tone: 'err', text: e?.message || t('pos.revoke_failed') }); } finally { setBusy(null); }
  };

  const createWebhook = async () => {
    if (!wForm.name.trim() || !wForm.url.trim()) { setMsg({ tone: 'err', text: t('pos.webhook_name_and_url_are_required') }); return; }
    setBusy('wcreate'); setMsg(null);
    try { const r = await stepUp.run(() => posWebhooksApi.create({ name: wForm.name.trim(), url: wForm.url.trim(), events: splitCsv(wForm.events) })); setReveal({ label: t('pos.signing_secret_for_name', { name: String(r.name) }), secret: r.signingSecret }); setWForm({ open: false, name: '', url: '', events: '' }); loadHooks(); }
    catch (e: any) { if (!isStepUpCancelled(e)) setMsg({ tone: 'err', text: e?.message || t('pos.create_failed') }); } finally { setBusy(null); }
  };
  const setHookStatus = (id: string, action: 'pause' | 'resume' | 'disable', name: string) => {
    if (action === 'disable') { askConfirm(t('admin.api.confirm.disableHook', { name }), () => { void doSetHookStatus(id, action); }, { confirmLabel: t('pos.disable_webhook') }); return; }
    void doSetHookStatus(id, action);
  };
  const doSetHookStatus = async (id: string, action: 'pause' | 'resume' | 'disable') => {
    setBusy('w' + action + id); setMsg(null);
    try { await posWebhooksApi[action](id); loadHooks(); }
    catch (e: any) { setMsg({ tone: 'err', text: e?.message || t('pos.update_failed') }); } finally { setBusy(null); }
  };
  const rotateHookSecret = (id: string, name: string) => askConfirm(t('admin.api.confirm.rotateSecret', { name }), () => { void doRotateHookSecret(id, name); }, { confirmLabel: t('pos.rotate_secret') });
  const doRotateHookSecret = async (id: string, name: string) => {
    setBusy('wrs' + id); setMsg(null);
    try { const r = await stepUp.run(() => posWebhooksApi.rotateSecret(id)); setReveal({ label: t('pos.new_signing_secret_for_name', { name: String(name) }), secret: r.signingSecret }); }
    catch (e: any) { if (!isStepUpCancelled(e)) setMsg({ tone: 'err', text: e?.message || t('pos.rotate_failed') }); } finally { setBusy(null); }
  };
  const testHook = async (id: string, name: string) => {
    setBusy('wt' + id); setMsg(null);
    try { const r = await posWebhooksApi.test(id); setMsg({ tone: r.delivered ? 'ok' : 'err', text: `${name}: ${r.detail}` }); }
    catch (e: any) { setMsg({ tone: 'err', text: e?.message || t('pos.test_failed_2') }); } finally { setBusy(null); }
  };

  const keyStatusPill = (s: string) => (s === 'active' ? 'ok' : s === 'expired' ? 'warn' : '');
  const hookStatusPill = (s: string) => (s === 'active' ? 'ok' : s === 'paused' ? 'warn' : '');

  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {confirmUi}{stepUp.prompt}
      <div className="vh "><h1>{t('pos.apis_webhooks')}</h1><div className="sub mb-3">{t('pos.issue_and_rotate_tenant_api_keys_1ox4')}</div></div>

      {reveal ? (
        <div style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #C9971B', background: '#FBF4E2' }}>
          <div className="s" style={{ fontWeight: 800, marginBottom: 4 }}>{reveal.label} {t('pos.copy_it_now_it_won_t_1p3l')}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <code style={{ flex: 1, fontSize: 12.5, wordBreak: 'break-all', background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 8, padding: '6px 8px' }}>{reveal.secret}</code>
            <button className="btn" onClick={() => copy(reveal.secret)}>{t('pos.copy')}</button>
            <button className="btn ghost whitespace-nowrap w-fit" onClick={() => setReveal(null)}>{t('pos.done')}</button>
          </div>
        </div>
      ) : null}

      {msg ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10, fontSize: 12.5, border: '1px solid var(--line)', background: msg.tone === 'err' ? '#FBEDE7' : '#EAF5EE', color: msg.tone === 'err' ? '#B4673B' : 'var(--text)' }}>
          <span style={{ flex: 1 }}>{msg.text}</span><button className="btn ghost whitespace-nowrap w-fit" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setMsg(null)}>{t('pos.dismiss')}</button>
        </div>
      ) : null}

      {/* API Keys */}
      <section className="panel">
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}><span style={head}>{t('pos.api_keys')}</span><span className="s" style={{ marginLeft: 8, color: '#8A7A66' }}>{keys ? keys.length : ''}</span><button className="btn" style={{ marginLeft: 'auto' }} onClick={() => setKForm({ ...kForm, open: !kForm.open })}>{t('pos.create_api_key')}</button></div>
        {kForm.open ? (
          <div style={{ padding: 10, border: '1px dashed var(--line)', borderRadius: 10, marginBottom: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.8fr 2fr', gap: 8 }}>
              <input value={kForm.name} onChange={(e) => setKForm({ ...kForm, name: e.target.value })} placeholder={t('pos.key_name')} style={fieldStyle} />
              <select value={kForm.env} onChange={(e) => setKForm({ ...kForm, env: e.target.value })} style={fieldStyle}><option value="live">{t('pos.live_3')}</option><option value="test">{t('pos.test')}</option></select>
              <input value={kForm.scopes} onChange={(e) => setKForm({ ...kForm, scopes: e.target.value })} placeholder={t('pos.scopes_comma_separated_e_g_services_1w34')} style={fieldStyle} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}><button className="btn" disabled={busy === 'kcreate'} onClick={createKey}>{busy === 'kcreate' ? t('pos.creating') : t('pos.create_2')}</button><button className="btn ghost whitespace-nowrap w-fit" onClick={() => setKForm({ open: false, name: '', env: 'live', scopes: '' })}>{t('pos.cancel')}</button></div>
          </div>
        ) : null}
        {!keys ? <div className="state">{t('pos.loading')}</div> : keys.length === 0 ? <div className="muted">{t('pos.no_api_keys_create_one_to_14ei')}</div> : (
          <div className="overflow-x-auto w-full">
            <div className="list w-full min-w-max" style={{ maxHeight: 260 }}>
              <div className="row" style={{ fontSize: 10.5, color: '#8A7A66', fontWeight: 700, textTransform: 'uppercase' }}><div style={{ flex: 1 }}>{t('pos.name')}</div><div style={{ width: 160 }}>{t('pos.key')}</div><div style={{ width: 60 }}>{t('pos.env_2')}</div><div style={{ width: 70 }}>{t('pos.status')}</div><div style={{ width: 90 }}>{t('pos.last_used')}</div><div style={{ width: 130 }}>{t('pos.actions')}</div></div>
            {keys.map((kk) => (
              <div className="row" key={kk.id}>
                <div style={{ flex: 1, minWidth: 120 }}><div className="t">{kk.name}</div><div className="s">{kk.scopes.length ? kk.scopes.join(', ') : t('pos.no_scopes')}</div></div>
                <code className="s" style={{ width: 160, wordBreak: 'break-all' }}>{kk.masked}</code>
                <div className="s" style={{ width: 60 }}>{codeLabel('admin.api.env', kk.environment)}</div>
                <div style={{ width: 70 }}><span className={'pill ' + keyStatusPill(kk.status)}>{codeLabel('admin.api.keyStatus', kk.status)}</span></div>
                <div className="s" style={{ width: 90 }}>{fmtDate(kk.lastUsedIso)}</div>
                <div style={{ width: 130, display: 'flex', gap: 4 }}>
                  <button className="btn ghost whitespace-nowrap w-fit" style={{ padding: '2px 6px', fontSize: 11 }} disabled={busy === 'kr' + kk.id} onClick={() => rotateKey(kk.id, kk.name)}>{t('pos.rotate')}</button>
                  <button className="btn ghost whitespace-nowrap w-fit" style={{ padding: '2px 6px', fontSize: 11 }} disabled={busy === 'kv' + kk.id} onClick={() => revokeKey(kk.id, kk.name)}>{t('pos.revoke')}</button>
                </div>
              </div>
            ))}
            </div>
          </div>
        )}
      </section>

      {/* Webhooks */}
      <section className="panel">
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}><span style={head}>{t('pos.webhooks')}</span><span className="s" style={{ marginLeft: 8, color: '#8A7A66' }}>{hooks ? hooks.length : ''}</span><button className="btn" style={{ marginLeft: 'auto' }} onClick={() => setWForm({ ...wForm, open: !wForm.open })}>{t('pos.add_webhook')}</button></div>
        {wForm.open ? (
          <div style={{ padding: 10, border: '1px dashed var(--line)', borderRadius: 10, marginBottom: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 8 }}>
              <input value={wForm.name} onChange={(e) => setWForm({ ...wForm, name: e.target.value })} placeholder={t('pos.webhook_name')} style={fieldStyle} />
              <input value={wForm.url} onChange={(e) => setWForm({ ...wForm, url: e.target.value })} placeholder="https://your-endpoint.example.com/hook" style={fieldStyle} />
              <input value={wForm.events} onChange={(e) => setWForm({ ...wForm, events: e.target.value })} placeholder={t('pos.events_comma_separated_e_g_appointment_139n')} style={{ ...fieldStyle, gridColumn: '1 / span 2' }} />
            </div>
            <div className="s" style={{ color: '#8A7A66', marginTop: 6 }}>{t('pos.urls_must_be_public_https_loopback_1rjh')}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}><button className="btn" disabled={busy === 'wcreate'} onClick={createWebhook}>{busy === 'wcreate' ? t('pos.creating') : t('pos.create_2')}</button><button className="btn ghost whitespace-nowrap w-fit" onClick={() => setWForm({ open: false, name: '', url: '', events: '' })}>{t('pos.cancel')}</button></div>
          </div>
        ) : null}
        {!hooks ? <div className="state">{t('pos.loading')}</div> : hooks.length === 0 ? <div className="muted">{t('pos.no_webhooks_add_one_to_receive_1sh5')}</div> : (
          <div className="overflow-x-auto w-full">
            <div className="list w-full min-w-max" style={{ maxHeight: 280 }}>
              <div className="row" style={{ fontSize: 10.5, color: '#8A7A66', fontWeight: 700, textTransform: 'uppercase' }}><div style={{ flex: 1 }}>{t('pos.endpoint')}</div><div style={{ width: 70 }}>{t('pos.status')}</div><div style={{ width: 70 }}>{t('pos.failures')}</div><div style={{ width: 90 }}>{t('pos.last')}</div><div style={{ width: 220 }}>{t('pos.actions')}</div></div>
            {hooks.map((w) => (
              <div className="row" key={w.id}>
                <div style={{ flex: 1, minWidth: 160 }}><div className="t">{w.name}</div><div className="s" style={{ wordBreak: 'break-all' }}>{w.url}</div><div className="s">{w.events.length ? w.events.join(', ') : t('pos.all_events')}</div></div>
                <div style={{ width: 70 }}><span className={'pill ' + hookStatusPill(w.status)}>{codeLabel('admin.api.hookStatus', w.status)}</span></div>
                <div className="s" style={{ width: 70, color: w.failureCount > 0 ? 'var(--danger, #B4673B)' : undefined }}>{w.failureCount}</div>
                <div className="s" style={{ width: 90 }}>{fmtDate(w.lastDeliveryIso)}</div>
                <div style={{ width: 220, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  <button className="btn ghost whitespace-nowrap w-fit" style={{ padding: '2px 6px', fontSize: 11 }} disabled={busy === 'wt' + w.id} onClick={() => testHook(w.id, w.name)}>{t('pos.test_2')}</button>
                  {w.status === 'active'
                    ? <button className="btn ghost whitespace-nowrap w-fit" style={{ padding: '2px 6px', fontSize: 11 }} disabled={busy === 'wpause' + w.id} onClick={() => setHookStatus(w.id, 'pause', w.name)}>{t('pos.pause')}</button>
                    : w.status === 'paused' ? <button className="btn ghost whitespace-nowrap w-fit" style={{ padding: '2px 6px', fontSize: 11 }} disabled={busy === 'wresume' + w.id} onClick={() => setHookStatus(w.id, 'resume', w.name)}>{t('pos.resume')}</button> : null}
                  <button className="btn ghost whitespace-nowrap w-fit" style={{ padding: '2px 6px', fontSize: 11 }} disabled={busy === 'wrs' + w.id} onClick={() => rotateHookSecret(w.id, w.name)}>{t('pos.rotate_secret')}</button>
                  {w.status !== 'disabled' ? <button className="btn ghost whitespace-nowrap w-fit" style={{ padding: '2px 6px', fontSize: 11 }} disabled={busy === 'wdisable' + w.id} onClick={() => setHookStatus(w.id, 'disable', w.name)}>{t('pos.disable')}</button> : null}
                </div>
              </div>
            ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
