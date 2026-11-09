// POSCustomerDisplaysScreen.tsx — Devices → Customer Displays (23-inch dual-screen spec §8–§12, §81–§86).
//
//   Pair a display    the display shows an 8-digit code; the owner types it here with a name and (optionally) the register
//                     it serves. The display is bound to THIS branch of THIS salon — it never chooses them (§8).
//   the table (§86)   name · branch · paired POS (a register, or shared by the branch) · display size/profile · resolution
//                     · connection · current mode · current customer session · app version · last seen
//   actions           refresh (the front desk, §82) · rename · register · maintenance · revoke (the owner)
//   registers (§9–§10) the POS stations a display can be dedicated to
//
// Every state is the server's — derived from the display's own heartbeat (online is "heard from in the last 75 s",
// never a stored flag) — refreshed by realtime events and the 15-second safety sync.
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useInlineConfirm } from '@aipowersalon/ui';
import { DISPLAY_PAIRING_CODE_DIGITS, formatPairingCode, normalizePairingCode, type DisplayDeviceState } from '@aipowersalon/api-contracts';
import { posCustomerDisplaysApi, type PosCustomerDisplaysState, type PosDisplayDeviceView } from '../api/posCustomerDisplaysApi';
import { useRealtime } from '../realtime/useRealtime';
import { DisplaySettingsCard } from './display-settings/DisplaySettingsCard';
import { FleetHistory } from './POSDeviceFleetScreen';
import { reportError } from './reportsCommon';
import { posDeviceFleetApi } from '../api/posDeviceFleetApi';
import type { DfCheckResponse } from '@aipowersalon/api-contracts/tenant';
import { FitDialog } from '../components/FitKit';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { codeLabel } from '../components/codeLabel';
import { fmtDate } from '../i18n/format';

const STATE_LABEL: Record<DisplayDeviceState, { label: string; tone: string }> = {
  ONLINE: { get label() { return t('pos.online'); }, tone: 'ok' }, CHECK_IN: { get label() { return t('pos.check_in_3'); }, tone: 'ok' }, ADVERTISEMENT: { get label() { return t('pos.advertising'); }, tone: 'ok' },
  CHECKOUT: { get label() { return t('pos.checkout'); }, tone: 'warn' }, OFFLINE: { get label() { return t('pos.offline_4'); }, tone: 'bad' }, MAINTENANCE: { get label() { return t('pos.maintenance_3'); }, tone: 'mut' }, REVOKED: { get label() { return t('pos.revoked'); }, tone: 'mut' },
};
// a display's mode / screen profile code → its label, read at render (codes stay the authority)
const modeLabel = (m: string) => codeLabel('admin.displays.mode', m);
const profileLabel = (p: string) => codeLabel('admin.displays.profile', p);
const toneColor: Record<string, string> = { ok: '#2E9E54', warn: '#C2603A', bad: '#C0392B', mut: '#7A5AA8' };
function ago(iso: string | null): string {
  if (!iso) return t('admin.access.never');
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return t('pos.s_s_ago', { s: String(s) });
  if (s < 3600) return t('pos.v0_min_ago', { v0: String(Math.floor(s / 60)) });
  if (s < 86400) return t('pos.v0_h_ago', { v0: String(Math.floor(s / 3600)) });
  return fmtDate(iso);
}
// developer merge (Oct 2026): the redesigned screen — panels, a KPI strip, pill states and a full-screen table view
const headStyle: CSSProperties = { fontWeight: 800, fontSize: 13.5, fontFamily: 'var(--aps-font-head, Playfair Display)' };
const panel: CSSProperties = { background: '#FFFCF6', border: '1px solid var(--line, #E8DFD1)', borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column' };
const field: CSSProperties = { height: 30, border: '1px solid var(--line, #E7DCC9)', borderRadius: 8, padding: '0 8px', background: '#FFFDF8', fontFamily: 'inherit', fontSize: 12, color: 'var(--text, #2A2118)', boxSizing: 'border-box' };
const fieldLabel: CSSProperties = { fontWeight: 700, display: 'block', marginBottom: 4, color: '#6D5F50', fontSize: 11, textTransform: 'uppercase' };
const thStyle: CSSProperties = { padding: '10px 12px', textAlign: 'left', color: '#8A7A66', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--line, #E7DCC9)', whiteSpace: 'nowrap', background: 'transparent' };
const tdStyle: CSSProperties = { padding: '10px 12px', borderBottom: '1px solid var(--line, #E7DCC9)', verticalAlign: 'middle', fontSize: 12.5, color: 'var(--text, #2A2118)' };
const fullScreenPanel: CSSProperties = { position: 'fixed', inset: 0, zIndex: 1000, background: '#FFFCF6', padding: 20, display: 'flex', flexDirection: 'column', overflow: 'hidden' };
const offPill: CSSProperties = { background: '#FCEEEB', color: '#B4673B', borderColor: '#E7C3BB' };

export function POSCustomerDisplaysScreen() {
  const [st, setSt] = useState<PosCustomerDisplaysState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pairing, setPairing] = useState<{ code: string; name: string; stationId: string } | null>(null);
  const [newRegister, setNewRegister] = useState('');
  // inline rename (no native dialogs): a display or a register being renamed in place
  const [editing, setEditing] = useState<{ kind: 'display' | 'register'; id: string; name: string } | null>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [find, setFind] = useState('');   // SUNMI batch 8: find a display in the roster (name · branch · register · type)
  const [health, setHealth] = useState<DfCheckResponse | 'loading' | { error: string } | null>(null);
  const { confirm, confirmUi } = useInlineConfirm();

  useEffect(() => {
    if (!isFullScreen) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsFullScreen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isFullScreen]);

  const load = useCallback(async () => {
    try { setSt(await posCustomerDisplaysApi.state()); setError(null); }
    catch (e: any) { setError(e?.status === 403 ? t('pos.you_do_not_have_access_to_dy3y') : (e?.message || t('pos.could_not_load_customer_displays'))); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useRealtime(['devices', 'checkout'], load);

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key); setNote(null);
    try { await fn(); setNote({ ok: true, msg: ok }); await load(); }
    catch (e: any) { setNote({ ok: false, msg: e?.message || t('pos.that_did_not_work') }); await load(); }
    finally { setBusy(null); }
  };

  if (error && !st) return <div className="work"><div className="state" style={{ color: '#B4453C' }}>{error}</div></div>;
  if (!st) return <div className="work"><div className="state">{t('pos.loading_customer_displays')}</div></div>;
  const manage = st.canManage;
  const registers = st.stations;
  const onlineCount = st.devices.filter((d) => d.online).length;
  const f = find.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const shown = !f ? st.devices : st.devices.filter((d) => [d.name, d.branchName, d.stationName, d.deviceId].some((v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(f)));
  const activeCheckouts = st.devices.filter((d) => d.session != null).length;

  const submitPair = () => {
    if (!pairing) return;
    const code = normalizePairingCode(pairing.code);
    if (!code) { setNote({ ok: false, msg: t('pos.enter_the_display_pairing_code_digits_16wl', { DISPLAY_PAIRING_CODE_DIGITS: String(DISPLAY_PAIRING_CODE_DIGITS) }) }); return; }
    void run('pair', async () => { await posCustomerDisplaysApi.pair({ code, name: pairing.name.trim(), stationId: pairing.stationId || null }); setPairing(null); },
      t('admin.displays.paired', { name: pairing.name.trim() || t('pos.the_display') }));
  };
  const saveRename = () => {
    if (!editing) return;
    const name = editing.name.trim();
    const target = editing;
    if (!name) { setNote({ ok: false, msg: t('pos.enter_a_name') }); return; }
    void run('rn' + target.id, async () => {
      if (target.kind === 'display') await posCustomerDisplaysApi.update(target.id, { name });
      else await posCustomerDisplaysApi.renameStation(target.id, name);
      setEditing(null);
    }, 'Renamed.');
  };
  const renameBox = (kind: 'display' | 'register', id: string) => editing && editing.kind === kind && editing.id === id ? (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <input aria-label={t('pos.new_name')} autoFocus value={editing.name} maxLength={40} onChange={(e) => setEditing({ ...editing, name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setEditing(null); }} style={{ ...field, height: 26, width: 140 }} />
      <button className="btn whitespace-nowrap w-fit" style={{ height: 26, padding: '0 8px', fontSize: 11, fontWeight: 700 }} disabled={busy === 'rn' + id} onClick={saveRename}>{t('pos.save_2')}</button>
      <button className="btn ghost whitespace-nowrap w-fit" style={{ height: 26, padding: '0 8px', fontSize: 11 }} onClick={() => setEditing(null)}>{t('pos.cancel')}</button>
    </span>
  ) : null;
  const setRegister = (d: PosDisplayDeviceView, stationId: string) =>
    run('st' + d.deviceId, () => posCustomerDisplaysApi.update(d.deviceId, { stationId: stationId || null }), stationId ? t('pos.dedicated_to_that_register') : t('pos.shared_by_the_branch_2'));
  const toggleMaintenance = (d: PosDisplayDeviceView) =>
    run('mt' + d.deviceId, () => posCustomerDisplaysApi.update(d.deviceId, { maintenance: !d.maintenance }), d.maintenance ? t('pos.back_in_service') : t('pos.in_maintenance_the_display_shows_a_m88m'));
  const refresh = (d: PosDisplayDeviceView) =>
    run('rf' + d.deviceId, async () => { const r = await posCustomerDisplaysApi.refresh(d.deviceId); if (!r.online) throw new Error(t('pos.name_is_offline_it_loads_fresh_1eyo', { name: String(d.name) })); }, t('admin.displays.refreshing', { name: d.name }));
  const revoke = (d: PosDisplayDeviceView) => confirm(
    d.session ? t('pos.revoke_name_the_checkout_on_it_1iyd', { name: String(d.name) }) : t('pos.revoke_name_it_must_be_paired_1cp8', { name: String(d.name) }),
    () => { void run('rv' + d.deviceId, () => posCustomerDisplaysApi.revoke(d.deviceId), `${d.name} revoked.`); }, { confirmLabel: t('pos.revoke_display') });

  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="customer-displays-screen">
      {confirmUi}
      <div className="vh" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 8px', borderRadius: 999, background: 'var(--cream2, #F3E7D2)', border: '1px solid var(--gline, #E2C686)', color: 'var(--g7, #A96F22)', fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--g7, #A96F22)' }} />
            {t('pos.dual_screen_pos_hardware')}
          </div>
          <h1>{t('pos.customer_displays')}</h1>
          <div className="sub">{t('pos.the_23_inch_customer_display_beside_1m8e')}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'flex-start' }}>
          <button className="btn ghost whitespace-nowrap w-fit" style={{ height: 32, padding: '0 12px', fontSize: 12 }} onClick={() => { void load(); }}>{t('pos.refresh')}</button>
          <button className="btn ghost whitespace-nowrap w-fit" data-testid="cdx-check" style={{ height: 32, padding: '0 12px', fontSize: 12 }} onClick={() => { setHealth('loading'); posDeviceFleetApi.check('display').then(setHealth).catch((e) => setHealth({ error: reportError(e, 'devices') })); }}>{t('cdx.check')}</button>
          {manage ? <button className="btn primary whitespace-nowrap w-fit" style={{ height: 32, padding: '0 14px', fontSize: 12, fontWeight: 800 }} onClick={() => setPairing({ code: '', name: '', stationId: '' })}>{t('pos.pair_a_display')}</button> : null}
        </div>
      </div>

      {/* KPI strip (the Devices screen's) */}
      <div className="kpis cdx-kpis" style={{ margin: '2px 0 6px' }} data-testid="customer-displays-kpis">
        <div className="kpi">
          <div className="l">{t('pos.customer_displays')}</div>
          <div className="v">{st.devices.length}</div>
          <div className="s" style={{ color: '#8A7A66', marginTop: 2 }}>{t('pos.n_registered', { n: String(st.devices.length) })}</div>
        </div>
        <div className="kpi">
          <div className="l">{t('pos.online_displays')}</div>
          <div className="v" style={{ color: onlineCount > 0 ? '#3F8F6B' : '#8A7A66' }}>{onlineCount}</div>
          <div className="s" style={{ color: '#8A7A66', marginTop: 2 }}>{st.devices.length > 0 ? t('pos.pct_online', { pct: String(Math.round((onlineCount / st.devices.length) * 100)) }) : t('pos.no_displays')}</div>
        </div>
        <div className="kpi">
          <div className="l">{t('pos.active_checkouts')}</div>
          <div className="v" style={activeCheckouts > 0 ? { color: '#C2603A' } : undefined}>{activeCheckouts}</div>
          <div className="s" style={{ color: '#8A7A66', marginTop: 2 }}>{activeCheckouts > 0 ? t('pos.live_guest_checkout') : t('pos.idle_lower')}</div>
        </div>
        <div className="kpi">
          <div className="l">{t('pos.registered_stations')}</div>
          <div className="v">{registers.length}</div>
          <div className="s" style={{ color: '#8A7A66', marginTop: 2 }}>{t('pos.n_registers_configured', { n: String(registers.length) })}</div>
        </div>
      </div>

      {note ? (
        <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10, fontSize: 12.5, border: note.ok ? '1px solid #BFE3C6' : '1px solid #F5C6BA', background: note.ok ? '#EAF5EE' : '#FBEDE7', color: note.ok ? '#1E7E34' : '#B4673B' }}>
          <span style={{ flex: 1, fontWeight: 600 }}><span aria-hidden="true">{note.ok ? '✓ ' : '⚠ '}</span>{note.msg}</span>
          <button className="btn ghost whitespace-nowrap w-fit" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setNote(null)}>{t('pos.dismiss')}</button>
        </div>
      ) : null}

      {pairing ? (
        <section style={{ ...panel, border: '1.5px solid var(--gline, #E2C686)' }} data-testid="pair-form">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={headStyle}>{t('pos.pair_a_display_2')}</span>
              <span className="pill warn">{t('pos.n_digit_code', { n: String(DISPLAY_PAIRING_CODE_DIGITS) })}</span>
            </div>
          </div>
          <div className="sub" style={{ fontSize: 12, color: '#8A7A66', marginBottom: 12 }}>{t('pos.open_the_customer_display_it_shows_12n0')}{' '}{DISPLAY_PAIRING_CODE_DIGITS}{t('pos.digit_code_enter_it_here_the_16w3')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            <div>
              <div className="s" style={fieldLabel}>{t('pos.pairing_code')} *</div>
              <input aria-label={t('pos.pairing_code')} value={pairing.code} inputMode="numeric" autoComplete="off" placeholder="1234 5678" onChange={(e) => setPairing({ ...pairing, code: formatPairingCode(e.target.value.replace(/\D/g, '').slice(0, DISPLAY_PAIRING_CODE_DIGITS)) })} style={{ ...field, width: '100%', fontSize: 15, letterSpacing: '.12em', fontWeight: 800, textAlign: 'center', fontFamily: 'monospace', borderColor: '#D8A646' }} />
            </div>
            <div>
              <div className="s" style={fieldLabel}>{t('pos.display_name_2')}</div>
              <input aria-label={t('pos.display_name')} value={pairing.name} maxLength={40} placeholder={t('pos.front_display_1')} onChange={(e) => setPairing({ ...pairing, name: e.target.value })} style={{ ...field, width: '100%' }} />
            </div>
            <div>
              <div className="s" style={fieldLabel}>{t('pos.assigned_station')}</div>
              <select aria-label={t('pos.register')} value={pairing.stationId} onChange={(e) => setPairing({ ...pairing, stationId: e.target.value })} style={{ ...field, width: '100%', cursor: 'pointer' }}>
                <option value="">{t('pos.shared_by_the_branch')}</option>
                {registers.map((r) => <option key={r.id} value={r.id}>{t('pos.dedicated_to')}{' '}{r.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--line, #E8DFD1)' }}>
            <button className="btn primary whitespace-nowrap w-fit" disabled={busy === 'pair' || !pairing.name.trim()} onClick={submitPair} style={{ height: 32, padding: '0 16px', fontSize: 12, fontWeight: 800, cursor: (busy === 'pair' || !pairing.name.trim()) ? 'not-allowed' : 'pointer' }}>{busy === 'pair' ? t('pos.pairing_2') : t('pos.pair_display')}</button>
            <button className="btn ghost whitespace-nowrap w-fit" style={{ padding: '4px 12px', fontSize: 12 }} onClick={() => setPairing(null)}>{t('pos.cancel')}</button>
          </div>
        </section>
      ) : null}

      <section style={isFullScreen ? fullScreenPanel : panel} data-testid="displays-table-panel">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={headStyle}>{t('pos.displays')}</span>
            <span className="pill">{st.devices.length}</span>
            <input type="search" className="rvw-search cdx-find" data-testid="cdx-find" value={find} onChange={(e) => setFind(e.target.value)} placeholder={t('cdx.findPh')} aria-label={t('cdx.findPh')} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: '#8A7A66' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3F8F6B', boxShadow: '0 0 6px rgba(63,143,107,0.4)' }} />
              {t('pos.auto_sync_live')}
            </span>
            <button type="button" className="btn ghost whitespace-nowrap w-fit" data-testid="display-table-fullscreen-btn" onClick={() => setIsFullScreen((v) => !v)} title={isFullScreen ? t('pos.exit_full_screen') : t('pos.view_full_screen')} style={{ padding: '2px 8px', fontSize: 11 }}>
              {isFullScreen ? t('pos.exit_full_screen') : t('pos.full_screen_expand')}
            </button>
          </div>
        </div>
        {st.devices.length === 0 ? (
          <div className="muted" style={{ padding: isFullScreen ? '120px 20px' : '36px 0', textAlign: 'center' }}>{t('pos.no_customer_display_is_paired_in_cs0p')}{manage ? t('pos.choose_pair_a_display_and_enter_albv') : ''}</div>
        ) : (
          <div className="overflow-x-auto w-full" style={{ flex: isFullScreen ? 1 : undefined, minHeight: isFullScreen ? 0 : undefined }}>
            <table className="w-full" style={{ borderCollapse: 'collapse', textAlign: 'left', minWidth: 1050 }}>
              <thead>
                <tr>
                  <th style={thStyle}>{t('pos.display')}</th><th style={thStyle}>{t('pos.branch')}</th><th style={thStyle}>{t('pos.paired_pos')}</th><th style={thStyle}>{t('pos.profile_2')}</th><th style={thStyle}>{t('pos.resolution')}</th><th style={thStyle}>{t('pos.connection')}</th><th style={thStyle}>{t('pos.mode')}</th><th style={thStyle}>{t('pos.customer_session')}</th><th style={thStyle}>{t('pos.app_version')}</th><th style={thStyle}>{t('pos.last_seen')}</th><th style={{ ...thStyle, textAlign: 'right' }}>{t('pos.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((d) => {
                  const s = STATE_LABEL[d.state];
                  return (
                    <tr key={d.deviceId} style={{ height: 46 }} data-testid="display-row">
                      <td style={{ ...tdStyle, fontWeight: 700 }}>
                        {renameBox('display', d.deviceId) ?? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span aria-hidden="true" style={{ fontSize: 14, color: '#A96F22' }}>🖥</span><span>{d.name}</span></span>
                        )}
                      </td>
                      <td style={{ ...tdStyle, color: '#8A7A66' }}>{d.branchName || '—'}</td>
                      <td style={tdStyle}>
                        {manage ? (
                          <select aria-label={t('pos.register_for_name', { name: String(d.name) })} value={d.stationId ?? ''} disabled={busy === 'st' + d.deviceId} onChange={(e) => { void setRegister(d, e.target.value); }} style={{ ...field, height: 26, fontSize: 11.5, padding: '0 6px', fontWeight: 600 }}>
                            <option value="">{t('pos.shared')}</option>
                            {registers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                          </select>
                        ) : <span style={{ fontWeight: 600, color: 'var(--soft)' }}>{d.stationName || t('pos.shared')}</span>}
                      </td>
                      <td style={tdStyle}><span className="pill" style={{ background: '#FAF6EF', borderColor: '#EFE6D6', color: '#6D5F50' }}>{d.profile ? profileLabel(d.profile) : '—'}</span></td>
                      <td style={{ ...tdStyle, fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#8A7A66' }}>{d.screen ? `${d.screen.width}×${d.screen.height}${d.screen.pixelRatio !== 1 ? ` @${d.screen.pixelRatio}x` : ''}` : '—'}</td>
                      <td style={tdStyle}>
                        {d.awaitingPickup ? <span className="pill warn">{t('pos.waiting_for_the_display')}</span>
                          : <span className={'pill ' + (d.online ? 'ok' : '')} style={!d.online ? offPill : undefined}>{d.online ? t('pos.connected_2') : t('pos.offline_4')}</span>}
                      </td>
                      <td style={tdStyle}>
                        <span className="pill" style={d.state === 'CHECKOUT' ? { background: '#FFF6E5', color: '#A96F22', borderColor: '#F0D79A' } : d.state === 'OFFLINE' ? offPill : { color: toneColor[s.tone] }}>{s.label}</span>
                        {d.mode && d.state !== 'OFFLINE' && d.state !== 'MAINTENANCE' && modeLabel(d.mode) !== s.label ? <span style={{ fontSize: 11, color: '#8A7A66', marginLeft: 4 }}> · {modeLabel(d.mode)}</span> : null}
                      </td>
                      <td style={{ ...tdStyle, color: 'var(--soft)' }}>{d.session ? <span style={{ fontWeight: 600, color: 'var(--text)' }}>{`${d.session.customerFirstName || t('pos.guest')} · ${d.session.ticketNumber ? `#${String(d.session.ticketNumber).replace(/^#/, '')}` : t('admin.displays.ticket')}`}</span> : '—'}</td>
                      <td style={{ ...tdStyle, fontSize: 11.5, color: '#8A7A66' }}>{d.appVersion || '—'}</td>
                      <td style={{ ...tdStyle, fontSize: 11.5, color: '#8A7A66', whiteSpace: 'nowrap' }}>{ago(d.lastSeenAt)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                          <button className="btn ghost whitespace-nowrap w-fit" style={{ padding: '2px 8px', fontSize: 11 }} disabled={busy === 'rf' + d.deviceId || d.awaitingPickup} onClick={() => { void refresh(d); }}>{t('pos.refresh')}</button>
                          {manage ? <>
                            <button className="btn ghost whitespace-nowrap w-fit" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setEditing({ kind: 'display', id: d.deviceId, name: d.name })}>{t('pos.rename')}</button>
                            <button className="btn ghost whitespace-nowrap w-fit" style={{ padding: '2px 8px', fontSize: 11 }} disabled={busy === 'mt' + d.deviceId} onClick={() => { void toggleMaintenance(d); }}>{d.maintenance ? t('pos.end_maintenance') : t('pos.maintenance_3')}</button>
                            <button className="btn ghost whitespace-nowrap w-fit" style={{ padding: '2px 8px', fontSize: 11, color: 'var(--danger, #B85B4D)', borderColor: '#F5C6BA' }} disabled={busy === 'rv' + d.deviceId} onClick={() => revoke(d)}>{t('pos.revoke')}</button>
                          </> : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={panel}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={headStyle}>{t('pos.registers')}</span>
          <span className="pill">{registers.length}</span>
        </div>
        <div className="sub" style={{ fontSize: 12, color: '#8A7A66', lineHeight: 1.4, maxWidth: 840, marginBottom: 12 }}>{t('pos.a_display_dedicated_to_a_register_1mhj')}</div>
        {registers.length === 0 ? (
          <div className="muted" style={{ padding: '8px 12px', borderRadius: 8, background: '#FAF8F4', border: '1px dashed var(--line, #E8DFD1)', fontSize: 12, marginBottom: 12 }}>{t('pos.no_registers_yet_every_display_is_1lir')}</div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
            {registers.map((r) => (
              <span key={r.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--line, #E8DFD1)', borderRadius: 999, padding: '4px 10px', fontSize: 12, background: '#FFFDF8' }}>
                {renameBox('register', r.id) ?? <span style={{ fontWeight: 700 }}>{r.name}</span>}
                {manage && !(editing?.kind === 'register' && editing.id === r.id) ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 2 }}>
                    <button className="btn ghost whitespace-nowrap w-fit" style={{ padding: '1px 6px', fontSize: 10.5 }} onClick={() => setEditing({ kind: 'register', id: r.id, name: r.name })}>{t('pos.rename')}</button>
                    <button className="btn ghost whitespace-nowrap w-fit" style={{ padding: '1px 6px', fontSize: 10.5, color: 'var(--danger, #B85B4D)', borderColor: '#F5C6BA' }} onClick={() => confirm(t('admin.displays.confirmRemoveRegister', { name: r.name }), () => { void run('rx' + r.id, () => posCustomerDisplaysApi.retireStation(r.id), t('admin.displays.registerRemoved')); }, { confirmLabel: t('pos.remove_register') })}>{t('pos.remove')}</button>
                  </span>
                ) : null}
              </span>
            ))}
          </div>
        )}
        {manage ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth: 360 }}>
            <input aria-label={t('pos.new_register_name')} value={newRegister} maxLength={40} placeholder={t('pos.register_1')} onChange={(e) => setNewRegister(e.target.value)} style={{ ...field, flex: 1 }} />
            <button className="btn whitespace-nowrap w-fit" disabled={!newRegister.trim() || busy === 'nr'} onClick={() => { void run('nr', async () => { await posCustomerDisplaysApi.createStation(newRegister.trim()); setNewRegister(''); }, t('admin.displays.registerAdded')); }} style={{ height: 30, padding: '0 12px', fontSize: 11.5, fontWeight: 700 }}>{t('pos.add_register')}</button>
          </div>
        ) : null}
      </section>

      {/* Dual-Screen mandate §118: what the displays offer guests, and their languages (the owner) */}
      {manage ? <DisplaySettingsCard /> : null}
      {/* SUNMI batch 8: the displays' history (pairing, renames, removals) from the canonical audit log — newest first, dated, paged */}
      <section data-testid="cdx-history-panel"><div style={{ ...headStyle, margin: '6px 0' }}>{t('cdx.history')}</div><FleetHistory cls="display" /></section>
      {health ? <FitDialog wide testId="cdx-health" title={t('cdx.check')} onClose={() => setHealth(null)} footer={<button className="btn ghost" onClick={() => setHealth(null)}>{t('pos.close')}</button>}>
        {health === 'loading' ? <div className="state">{t('dfx.checking')}</div> : 'error' in health ? <div className="err">{health.error}</div> : <>
          <p className="sub">{t('dfx.readOnly')}</p>
          {health.checks.map((c) => <div key={c.key} className="rvw-check" data-testid={`cdx-chk-${c.key}`}><span className={'chip ' + (c.state === 'READY' ? 'ok' : c.state === 'WARNING' ? 'warn' : c.state === 'FAILED' ? 'bad' : '')}>{t('dfx.hs.' + c.state)}</span> <b>{t('dfx.hk.' + c.key)}</b>{c.count != null ? <span className="sub"> · {c.count}</span> : null}</div>)}
        </>}
      </FitDialog> : null}
    </div>
  );
}
