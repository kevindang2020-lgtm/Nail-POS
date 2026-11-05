// POSPaymentTerminalsScreen.tsx — Devices Management → Payment Terminals (Payments mandate §12 / §50 / §52, wave 3).
// Wired to the terminal REGISTRY (GET /pos/settings/payments-checkout/terminals): the ONE normalized status per terminal
// (ONLINE / OFFLINE / BUSY / PROCESSING / DEGRADED / DISABLED / UNKNOWN — never a raw Clover state), last seen, last
// transaction, the register it serves, and the audited actions: Test connection (a real ping, no charge), Rename,
// Disable / Enable, Unpair, plus (developer merge, Oct 2026) Pair Terminal in place and the register each terminal serves
// picked per row. Actions need the payments edit permission (settings.edit) — the server enforces it; the
// screen hides what the user cannot do. A terminal that never answered is "Not tested yet", not "Online".
import { useCallback, useEffect, useState } from 'react';
import { useInlineAsk, useInlineConfirm } from '@aipowersalon/ui';
import { posDevicesApi, type TerminalRegistryRow } from '../api/posDevicesApi';
import { posCustomerDisplaysApi, type PosStationView } from '../api/posCustomerDisplaysApi';
import { useCan } from '../components/usePermissions';
import { reportError } from './reportsCommon';
import { useStepUp, isStepUpCancelled } from './access/accessUi';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { TapToPayDevicesPanel } from '../components/TapToPayDevicesPanel';

const TONE: Record<string, string> = { ONLINE: 'var(--ok)', PROCESSING: 'var(--gold)', BUSY: 'var(--gold)', DEGRADED: 'var(--warn, #B7791F)', OFFLINE: 'var(--danger, #B42318)', DISABLED: 'var(--muted)', UNKNOWN: 'var(--muted)' };
const TYPE_LABEL: Record<string, string> = { clover_compact: 'Clover Compact', clover_flex: 'Clover Flex', clover_mini: 'Clover Mini', get other() { return tx('payment.terminal.type.other'); } };   // model names stay as the maker writes them
const when = (s?: string | null) => (s ? new Date(s).toLocaleString() : '—');
const input: React.CSSProperties = { width: '100%', height: 32, padding: '0 8px', borderRadius: 8, border: '1px solid var(--line)', background: '#FFFDF8' };
const fieldLabel: React.CSSProperties = { fontWeight: 700, display: 'block', marginBottom: 4 };
const emptyPair = () => ({ code: '', label: tx('pos.front_counter_clover'), station: '', hsn: '', type: 'clover_compact' });

export function POSPaymentTerminalsScreen() {
  const can = useCan();
  const canEdit = can('settings.edit');
  const [rows, setRows] = useState<TerminalRegistryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'warn' | 'err'; text: string } | null>(null);
  // the registers (POS stations) a terminal can serve — the same list Customer Displays manages; unreadable → the row keeps
  // showing the register name read-only
  const [registers, setRegisters] = useState<PosStationView[]>([]);
  const [pairOpen, setPairOpen] = useState(false);
  const [pf, setPf] = useState(emptyPair);
  const { ask, askUi } = useInlineAsk();
  const { confirm: askConfirm, confirmUi } = useInlineConfirm();
  // Security Deep Scan C7: pair / unpair / disable / enable / register are step-up routes — password prompt, one retry;
  // Cancel leaves the terminal as it was and shows nothing.
  const stepUp = useStepUp(tx('pos.stepup_terminals_needs_password'));

  const load = useCallback(async () => {
    setError(null);
    try { setRows(await posDevicesApi.terminals()); }
    catch (e: any) { setError(reportError(e, 'payment terminals')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!canEdit) return;
    let live = true;
    posCustomerDisplaysApi.state().then((st) => { if (live && Array.isArray(st?.stations)) setRegisters(st.stations); }).catch(() => { /* no register list — read-only names */ });
    return () => { live = false; };
  }, [canEdit]);

  const run = async (key: string, label: string, fn: () => Promise<unknown>, okText: string) => {
    setBusy(key); setMsg(null);
    try { await stepUp.run(fn); setMsg({ tone: 'ok', text: okText }); await load(); }
    catch (e: any) { if (!isStepUpCancelled(e)) setMsg({ tone: 'err', text: `${label}: ${e?.message || 'failed'}` }); }
    finally { setBusy(null); }
  };
  const test = async (t: TerminalRegistryRow) => {
    setBusy('test:' + t.id); setMsg(null);
    try {
      const r = await posDevicesApi.testTerminal(t.id);
      setMsg({ tone: r.reachable ? 'ok' : 'warn', text: `${t.label}: ${r.detail}` });
      await load();
    } catch (e: any) { setMsg({ tone: 'err', text: `${t.label}: ${e?.message || tx('pos.test_failed')}` }); }
    finally { setBusy(null); }
  };
  const rename = (t: TerminalRegistryRow) => ask(`New name for ${t.label}`, (value) => { const label = value.trim(); if (label) void run('rename:' + t.id, t.label, () => posDevicesApi.renameTerminal(t.id, { label }), `Renamed to ${label}.`); }, { confirmLabel: tx('pos.rename'), defaultValue: t.label });
  const setType = (t: TerminalRegistryRow, terminalType: string) => run('type:' + t.id, t.label, () => posDevicesApi.renameTerminal(t.id, { terminalType: terminalType || null }), `${t.label}: type saved.`);
  const disable = (t: TerminalRegistryRow) => ask(`Why is ${t.label} being disabled? It will not take card payments until it is enabled again.`, (reason) => { void run('disable:' + t.id, t.label, () => posDevicesApi.disableTerminal(t.id, reason.trim()), `${t.label} disabled.`); }, { confirmLabel: tx('pos.disable_terminal') });
  const enable = (t: TerminalRegistryRow) => run('enable:' + t.id, t.label, () => posDevicesApi.enableTerminal(t.id), `${t.label} enabled.`);
  const setRegister = (t: TerminalRegistryRow, stationId: string) => run('reg:' + t.id, t.label, () => posDevicesApi.setTerminalRegister(t.id, stationId || null), tx('pos.label_register_updated', { label: String(t.label) }));
  const submitPair = async () => {
    const code = pf.code.trim();
    if (!/^\d{6}$/.test(code)) { setMsg({ tone: 'warn', text: tx('pos.pairing_code_must_be_6_digits') }); return; }
    const label = pf.label.trim() || tx('pos.front_counter_clover');
    setBusy('pair'); setMsg(null);
    try {
      const r = await stepUp.run(() => posDevicesApi.pairTerminal({ code, label, stationId: pf.station || undefined, hsn: pf.hsn.trim() || undefined }));
      // the device model is the registry's terminalType — set on the terminal the pair call answered with
      if (r?.id && pf.type) await posDevicesApi.renameTerminal(r.id, { terminalType: pf.type }).catch(() => { /* type stays unset; editable in the row */ });
      setMsg({ tone: 'ok', text: tx('pos.terminal_label_paired', { label }) });
      setPairOpen(false); setPf(emptyPair());
      await load();
    } catch (e: any) { if (!isStepUpCancelled(e)) setMsg({ tone: 'err', text: e?.message || tx('pos.pair_failed') }); }
    finally { setBusy(null); }
  };
  // Fiserv master build §5.2: a terminal paired before a location was chosen takes NO card payments anywhere until it is
  // assigned — the owner gives it to the location they are signed in to.
  const assignHere = (t: TerminalRegistryRow) => run('assign:' + t.id, t.label, () => posDevicesApi.assignTerminalLocation(t.id), tx('payment.terminal.assigned', { label: String(t.label) }));
  const unpair = (t: TerminalRegistryRow) => askConfirm(`Unpair ${t.label}? It must be paired again before it can take payments.`, () => { void run('unpair:' + t.id, t.label, () => posDevicesApi.unpairTerminal(t.id), `${t.label} unpaired.`); }, { confirmLabel: tx('pos.unpair_terminal') });

  if (loading) return <div className="work"><div className="state">{tx('pos.loading_terminals')}</div></div>;
  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  const terminals = rows || [];
  const online = terminals.filter((t) => t.operationalStatus === 'ONLINE').length;
  const attention = terminals.filter((t) => t.operationalStatus === 'OFFLINE' || t.operationalStatus === 'DEGRADED').length;

  return (
    <div className="work">
      {askUi}{confirmUi}{stepUp.prompt}
      <div className="vh" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
        <div><h1>{tx('pos.payment_terminals')}</h1><div className="sub mb-3">{tx('pos.paired_card_terminals_their_live_status_qr48')}</div></div>
        {canEdit ? <button className="btn primary" style={{ height: 34, padding: '0 14px' }} onClick={() => setPairOpen(true)}>{tx('pos.pair_terminal_plus')}</button> : null}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 mb-3.5 mt-2.5">
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{tx('pos.payment_terminals')}</div><div className="v">{terminals.length}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{tx('pos.online')}</div><div className="v" style={{ color: online > 0 ? 'var(--ok)' : 'var(--muted)' }}>{terminals.length === 0 ? '—' : online}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{tx('pos.needs_attention')}</div><div className="v" style={{ color: attention > 0 ? 'var(--danger, #B42318)' : 'var(--muted)' }}>{terminals.length === 0 ? '—' : attention}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{tx('pos.disabled')}</div><div className="v">{terminals.length === 0 ? '—' : terminals.filter((t) => t.operationalStatus === 'DISABLED').length}</div></div>
      </div>
      {msg ? <div className={msg.tone === 'err' ? 'err' : 's'} style={{ marginBottom: 8, color: msg.tone === 'ok' ? 'var(--ok)' : msg.tone === 'warn' ? 'var(--warn, #B7791F)' : undefined }}>{msg.text}</div> : null}
      {pairOpen ? (
        <section className="panel mb-3" style={{ padding: 18, background: '#FFFCF6', border: '1.5px solid var(--gold, #C9971B)', borderRadius: 12 }} data-testid="pair-terminal-form">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15 }}>{tx('pos.pair_a_clover_payment_terminal')}</div>
              <div className="s muted">{tx('pos.enter_the_6_digit_code_hsn_and_register')}</div>
            </div>
            <button className="btn ghost" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => setPairOpen(false)}>{tx('pos.close')}</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            <div>
              <div className="s" style={fieldLabel}>{tx('pos.pairing_code_6_digits')}</div>
              <input aria-label={tx('pos.pairing_code')} value={pf.code} onChange={(e) => setPf({ ...pf, code: e.target.value.replace(/\D/g, '').slice(0, 6) })} placeholder="123456" inputMode="numeric" maxLength={6} style={input} />
            </div>
            <div>
              <div className="s" style={fieldLabel}>{tx('pos.terminal_label')}</div>
              <input aria-label={tx('pos.terminal_label')} value={pf.label} maxLength={80} onChange={(e) => setPf({ ...pf, label: e.target.value })} style={input} />
            </div>
            <div>
              <div className="s" style={fieldLabel}>{tx('pos.device_model')}</div>
              <select aria-label={tx('pos.device_model')} value={pf.type} onChange={(e) => setPf({ ...pf, type: e.target.value })} style={input}>
                {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <div className="s" style={fieldLabel}>{tx('pos.assigned_register')}</div>
              <select aria-label={tx('pos.assigned_register')} value={pf.station} onChange={(e) => setPf({ ...pf, station: e.target.value })} style={input}>
                <option value="">{tx('pos.no_register_shared')}</option>
                {registers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <div className="s" style={fieldLabel}>{tx('pos.hardware_serial_number_hsn')}</div>
              <input aria-label={tx('pos.hardware_serial_number_hsn')} value={pf.hsn} maxLength={64} onChange={(e) => setPf({ ...pf, hsn: e.target.value })} style={input} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button className="btn primary" disabled={busy === 'pair' || !pf.code.trim()} onClick={() => { void submitPair(); }}>{busy === 'pair' ? tx('pos.pairing_2') : tx('pos.pair_terminal')}</button>
            <button className="btn ghost" onClick={() => setPairOpen(false)}>{tx('pos.cancel')}</button>
          </div>
        </section>
      ) : null}
      <section className="panel mb-3" style={{ padding: 0, overflow: 'hidden' }}>
        {terminals.length === 0 ? (
          <div className="state" style={{ padding: 24, textAlign: 'center' }}>
            <div>{tx('pos.no_terminals_paired_yet_pair_a_wcm7')}</div>
            {canEdit ? <button className="btn primary" style={{ marginTop: 12 }} onClick={() => setPairOpen(true)}>{tx('pos.pair_clover_terminal_plus')}</button> : null}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl w-full min-w-max">
              <thead><tr><th>{tx('pos.terminal')}</th><th>{tx('pos.type')}</th><th>{tx('pos.register')}</th><th>{tx('pos.status')}</th><th>{tx('pos.last_seen')}</th><th>{tx('pos.last_transaction')}</th>{canEdit ? <th>{tx('pos.actions')}</th> : null}</tr></thead>
              <tbody>{terminals.map((t) => (
                t.unassigned ? (
                <tr key={t.id} data-testid={'unassigned-' + t.id} style={{ background: '#FFF7E6' }}>
                  <td><div style={{ fontWeight: 600 }}>{t.label || '—'}</div><div className="s muted">{t.hsn ? tx('pos.hsn_hsn', { hsn: String(t.hsn) }) : tx('pos.no_hsn')}</div></td>
                  <td colSpan={canEdit ? 5 : 5} style={{ color: 'var(--warn, #B7791F)', fontWeight: 700 }}>{tx('payment.terminal.unassignedWarning')}</td>
                  {canEdit ? <td><button className="btn primary" style={{ padding: '2px 8px', fontSize: 11 }} disabled={!!busy} onClick={() => { void assignHere(t); }}>{tx('payment.terminal.assignHere')}</button></td> : <td />}
                </tr>
                ) : (
                <tr key={t.id}>
                  <td><div style={{ fontWeight: 600 }}>{t.label || '—'}</div><div className="s muted">{t.hsn ? tx('pos.hsn_hsn', { hsn: String(t.hsn) }) : tx('pos.no_hsn')}{t.serialNumber ? ` · S/N ${t.serialNumber}` : ''}{t.status !== 'paired' ? tx('pos.unpaired') : ''}</div></td>
                  <td>{canEdit ? (
                    <select aria-label={tx('pos.type_of_label', { label: String(t.label) })} value={t.terminalType || ''} disabled={!!busy} onChange={(e) => setType(t, e.target.value)} style={{ height: 26, fontSize: 12 }}>
                      <option value="">—</option>{Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  ) : (t.terminalType ? TYPE_LABEL[t.terminalType] || t.terminalType : '—')}</td>
                  <td>{canEdit && registers.length > 0 ? (
                    <select aria-label={tx('pos.register_for_name', { name: String(t.label) })} disabled={!!busy} value={registers.find((r) => r.id === t.stationId || r.name === t.registerName)?.id ?? ''} onChange={(e) => setRegister(t, e.target.value)} style={{ height: 26, fontSize: 12 }}>
                      <option value="">{t.stationId && !registers.some((r) => r.id === t.stationId) ? tx('pos.stationid_not_a_register', { stationId: String(t.stationId) }) : tx('pos.no_register_shared')}</option>
                      {registers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  ) : (t.registerName || (t.stationId ? tx('pos.stationid_not_a_register', { stationId: String(t.stationId) }) : '—'))}</td>
                  <td style={{ fontWeight: 700, color: TONE[t.operationalStatus || 'UNKNOWN'] }} title={t.disabledReason || undefined}>{t.operationalLabel || tx('pos.not_tested_yet')}{t.operationalStatus === 'DISABLED' && t.disabledReason ? <div className="s muted" style={{ fontWeight: 400 }}>{t.disabledReason}</div> : null}</td>
                  <td>{when(t.lastSeenAt)}</td>
                  <td>{when(t.lastTransactionAt)}</td>
                  {canEdit ? (
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn ghost" style={{ padding: '2px 6px', fontSize: 11 }} disabled={!!busy || t.operationalStatus === 'DISABLED'} onClick={() => test(t)}>{busy === 'test:' + t.id ? '…' : tx('pos.test_connection')}</button>{' '}
                      <button className="btn ghost" style={{ padding: '2px 6px', fontSize: 11 }} disabled={!!busy} onClick={() => rename(t)}>{tx('pos.rename')}</button>{' '}
                      {t.operationalStatus === 'DISABLED'
                        ? <button className="btn ghost" style={{ padding: '2px 6px', fontSize: 11 }} disabled={!!busy} onClick={() => enable(t)}>{tx('pos.enable')}</button>
                        : <button className="btn ghost" style={{ padding: '2px 6px', fontSize: 11 }} disabled={!!busy} onClick={() => disable(t)}>{tx('pos.disable')}</button>}{' '}
                      {t.status === 'paired' ? <button className="btn ghost" style={{ padding: '2px 6px', fontSize: 11 }} disabled={!!busy} onClick={() => unpair(t)}>{tx('pos.unpair')}</button> : null}
                    </td>
                  ) : null}
                </tr>
                )
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
      <div className="s muted mb-3">{tx('pos.status_is_what_the_terminal_last_1c2a')}</div>
      {/* Secure Tap to Pay M6-4: the salon's Tap to Pay phones — add one with a pairing QR, set its locations, suspend / revoke */}
      <TapToPayDevicesPanel canManage={can('pos.devices.manage')} />
    </div>
  );
}
