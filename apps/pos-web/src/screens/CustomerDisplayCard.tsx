// CustomerDisplayCard.tsx — POS Checkout → the customer display this POS uses (23-inch dual-screen spec §81–§83,
// §122–§124):
//
//   Customer Display  ● Connected   Front Display #1          ● Active   Showing Sophia's checkout
//   ● Offline — Continue checkout on the POS (a display never stops a checkout)    ● Maintenance
//
// and the receptionist's actions (§82): Send to Display, Refresh Display, Cancel Display Session, Switch Display — plus,
// on a desktop with a second monitor, opening the display there. Which register this POS is (§9–§10) is chosen here and
// remembered on this workstation; its DEDICATED display is used first, else the branch's SHARED one. Every state shown is
// the server's (the display's own heartbeat), refreshed by realtime events and the 15-second safety sync.
// useCustomerDisplays is the one source the card AND the workspace's "To Display" / "Clear Display" buttons share.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useRealtime } from '../realtime/useRealtime';
import {
  customerDisplayUrl, getThisRegister, myDisplay, openCustomerDisplayWindow, posCustomerDisplaysApi, setThisRegister,
  type PosCustomerDisplaysState, type PosDisplayDeviceView,
} from '../api/posCustomerDisplaysApi';
import { posCheckoutApi } from '../api/posCheckoutApi';
import { t } from '@aipowersalon/mobile-sdk/i18n';

const O = 'var(--aps-orange)';
const card: CSSProperties = { background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, padding: 12 };
const h2: CSSProperties = { font: '700 13.5px/1.2 "Hanken Grotesk",sans-serif', margin: 0, color: 'var(--text)' };
const ghostBtn: CSSProperties = { background: 'var(--card)', border: `1px solid ${O}`, color: O, borderRadius: 9, padding: '4px 9px', fontSize: 11, fontWeight: 700, cursor: 'pointer', minHeight: 38 };   // §77 touch: compact control ≥ 38 px
const orangeBtn: CSSProperties = { background: O, border: `1px solid ${O}`, color: '#fff', borderRadius: 9, padding: '5px 11px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', minHeight: 40 };
const select: CSSProperties = { border: '1px solid var(--line)', borderRadius: 8, padding: '3px 6px', fontSize: 11.5, background: 'var(--card)', color: 'var(--text)' };

/** §81, §83, §85: the line the receptionist reads. */
export function displayStatus(d: PosDisplayDeviceView | null): { dot: string; label: string; detail: string } {
  if (!d) return { dot: '#9B8B78', label: t('pos.no_display'), detail: t('pos.no_customer_display_is_paired_for_1s0s') };
  if (d.awaitingPickup) return { dot: '#C9971B', label: t('pos.pairing'), detail: t('pos.name_is_finishing_pairing_waiting_for_1fqr', { name: String(d.name) }) };
  if (d.state === 'MAINTENANCE') return { dot: '#7A5AA8', label: t('pos.maintenance_3'), detail: t('pos.name_is_in_maintenance_continue_checkout_v6ar', { name: String(d.name) }) };
  if (!d.online) return { dot: '#C0392B', label: t('pos.offline_4'), detail: t('pos.name_is_offline_continue_checkout_on_q3br', { name: String(d.name) }) };
  if (d.session) {
    const who = d.session.customerFirstName ? `${d.session.customerFirstName}’s` : `ticket ${d.session.ticketNumber || ''}’s`.replace(' ’s', '’s');
    return { dot: O, label: t('pos.active_3'), detail: t('pos.showing_who_checkout_on_name', { who: String(who), name: String(d.name) }) };
  }
  return { dot: '#2E9E54', label: t('pos.connected_2'), detail: d.name };
}

/** §83: what the display is doing right now, while it can be reached (offline / maintenance have their own status). */
export function displayModeLabel(d: PosDisplayDeviceView | null): string | null {
  if (!d || d.awaitingPickup || !d.online || d.maintenance) return null;
  switch (d.state) {
    case 'CHECKOUT': return 'Checkout';
    case 'CHECK_IN': return 'Check-in';
    case 'ADVERTISEMENT': return 'Advertising';
    case 'ONLINE': return 'Idle';
    default: return null;
  }
}

export interface CustomerDisplaysModel {
  state: PosCustomerDisplaysState | null;
  error: string | null;
  register: string | null;
  chooseRegister: (stationId: string | null) => void;
  /** the display this POS uses for the open ticket (§10, §81) */
  mine: PosDisplayDeviceView | null;
  /** the display session the open ticket is on, wherever it is */
  ticketSession: NonNullable<PosDisplayDeviceView['session']> | null;
  reload: () => Promise<PosCustomerDisplaysState | null>;
  /** §84 Reconnect: ask the server again for the display's status (after a network blip, or a display restarted) */
  reconnect: () => Promise<string>;
  /** §82 Send to Display (deviceId: Switch Display) — resolves to a message for the receptionist */
  send: (ticketId: string, deviceId?: string) => Promise<string>;
  cancel: () => Promise<string>;
  /** Oct 21 2026: the terminal is prompting for a card and the guest walked away / chose cash — call the prompt off */
  cancelTerminal: () => Promise<string>;
  refresh: () => Promise<string>;
}

export function useCustomerDisplays(ticketId: string | null): CustomerDisplaysModel {
  const [state, setState] = useState<PosCustomerDisplaysState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [register, setRegister] = useState<string | null>(null);
  const registerLoaded = useRef(false);

  const reload = useCallback(async (): Promise<PosCustomerDisplaysState | null> => {
    try {
      const s = await posCustomerDisplaysApi.state();
      setState(s); setError(null);
      if (!registerLoaded.current) { registerLoaded.current = true; setRegister(getThisRegister(s.branchId)); }   // this workstation's choice
      return s;
    } catch (e: any) {
      if (e?.status === 403) { setState(null); setError(null); }   // this user does not operate displays: no card
      else setError(e?.message || t('pos.could_not_load_the_customer_display'));
      return null;
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  // display paired / changed / online / offline, a checkout started or ended — and the 15 s safety sync catches a display
  // that simply went quiet (a dead display sends nothing; its last heartbeat ages out)
  useRealtime(['checkout', 'devices'], reload);

  const stations = state?.stations ?? [];
  const devices = useMemo(() => state?.devices ?? [], [state]);
  const registerOk = register && stations.some((s) => s.id === register) ? register : null;
  const mine = useMemo(() => myDisplay(devices, registerOk, ticketId), [devices, registerOk, ticketId]);
  const ticketSession = devices.find((d) => ticketId && d.session?.ticketId === ticketId)?.session ?? null;

  const chooseRegister = useCallback((stationId: string | null) => {
    setRegister(stationId);
    if (state) setThisRegister(state.branchId, stationId);
  }, [state]);

  const send = useCallback(async (tid: string, deviceId?: string) => {
    try {
      await posCheckoutApi.sendToCustomerDisplay(tid, { stationId: registerOk, ...(deviceId ? { deviceId } : {}) });
      return deviceId ? t('pos.moved_to_the_other_customer_display') : t('pos.sent_to_the_customer_display');
    } finally { await reload(); }
  }, [registerOk, reload]);
  const cancel = useCallback(async () => {
    if (!ticketSession) return t('pos.nothing_is_on_the_customer_display');
    try { await posCheckoutApi.display.closeSession(ticketSession.sessionId); return t('pos.customer_display_cleared'); }
    finally { await reload(); }
  }, [ticketSession, reload]);
  const cancelTerminal = useCallback(async () => {
    if (!ticketSession) return t('pos.nothing_is_on_the_customer_display');
    try {
      const r = await posCheckoutApi.display.cancelTerminal(ticketSession.sessionId);
      if (r.cancelled) return t('pos.terminal_prompt_cancelled_the_guest_can_6ewm');
      return r.reason === 'NOTHING_IN_PROGRESS' ? t('pos.the_terminal_is_not_prompting_right_1sku') : r.reason === 'TERMINAL_UNREACHABLE' ? t('pos.the_terminal_did_not_answer_it_dfna') : t('pos.this_terminal_cannot_be_cancelled_from_17es');
    } finally { await reload(); }
  }, [ticketSession, reload]);
  const refresh = useCallback(async () => {
    if (!mine) return t('pos.no_customer_display_to_refresh');
    const r = await posCustomerDisplaysApi.refresh(mine.deviceId);
    return r.online ? t('pos.name_is_refreshing', { name: String(mine.name) }) : t('pos.name_is_offline_it_loads_fresh_1eyo', { name: String(mine.name) });
  }, [mine]);

  const reconnect = useCallback(async () => {
    const s = await reload();
    if (!s) throw new Error(t('pos.still_cannot_reach_the_server_checkout_10yk'));
    const okReg = registerOk && s.stations.some((x) => x.id === registerOk) ? registerOk : null;
    const d = myDisplay(s.devices, okReg, ticketId);
    if (!d) return t('pos.no_customer_display_is_paired_for_wqli');
    return d.online ? t('pos.name_is_connected', { name: String(d.name) }) : t('pos.name_is_still_offline_check_its_bvgf', { name: String(d.name) });
  }, [reload, registerOk, ticketId]);

  return { state, error, register: registerOk, chooseRegister, mine, ticketSession, reload, reconnect, send, cancel, cancelTerminal, refresh };
}

export function CustomerDisplayCard({ m, ticketId, ticketPaid, onChanged }: {
  m: CustomerDisplaysModel;
  /** the ticket open in the Checkout Workspace */
  ticketId: string | null;
  ticketPaid: boolean;
  /** the checkout board refetches (a sent ticket changes status) */
  onChanged: () => void;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (!m.state && !m.error) return null;   // no permission to operate displays (or still loading): no card

  const stations = m.state?.stations ?? [];
  const devices = m.state?.devices ?? [];
  const mine = m.mine;
  const status = displayStatus(mine);
  const modeLabel = displayModeLabel(mine);
  const canReconnect = !!m.error || !!(mine && !mine.awaitingPickup && !mine.online);
  const others = devices.filter((d) => d.deviceId !== mine?.deviceId && !d.awaitingPickup && d.online && !d.maintenance);
  const ticketOnMine = !!(mine?.session && ticketId && mine.session.ticketId === ticketId);
  const sendOff = busy === 'send' || !mine || !mine.online || !!mine.maintenance;   // §83: off, and it looks off
  const url = customerDisplayUrl();

  const act = async (key: string, fn: () => Promise<string>) => {
    setBusy(key); setNote(null);
    try { setNote(await fn()); onChanged(); }
    catch (e: any) { setNote(e?.message || t('pos.that_did_not_work')); }
    finally { setBusy(null); }
  };
  const openHere = async () => {
    if (!url) return;
    const r = await openCustomerDisplayWindow(url, () => setNote(t('pos.customer_display_moved_to_the_second_d31a')));
    setNote(r === 'second-screen' ? t('pos.customer_display_opened_on_the_second_13k6')
      : r === 'window' ? t('pos.customer_display_opened_drag_it_to_mcmj')
      : t('pos.the_browser_blocked_the_window_allow_7hlm'));
  };

  return (
    <section style={card} data-testid="customer-display-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <h2 style={h2}>{t('pos.customer_display')}</h2>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, color: status.dot }} data-testid="customer-display-status">
          <span style={{ width: 8, height: 8, borderRadius: 99, background: status.dot }} />{status.label}
        </span>
      </div>
      {m.error ? <div style={{ fontSize: 11.5, color: '#C0392B' }}>{m.error}</div> : null}
      <div style={{ fontSize: 12, color: 'var(--text)', marginBottom: modeLabel ? 2 : 8 }} data-testid="customer-display-detail">{status.detail}</div>
      {modeLabel ? <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }} data-testid="customer-display-mode">{t('pos.current_mode')}{' '}{modeLabel}</div> : null}
      {stations.length ? (
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
          {t('pos.this_pos_is')}
          <select aria-label={t('pos.this_pos_s_register')} value={m.register ?? ''} onChange={(e) => m.chooseRegister(e.target.value || null)} style={select}>
            <option value="">{t('pos.no_register_use_a_shared_display')}</option>
            {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      ) : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {ticketId && !ticketOnMine ? (
          <button style={sendOff ? { ...orangeBtn, opacity: 0.45, cursor: 'not-allowed' } : orangeBtn} disabled={sendOff} onClick={() => act('send', () => m.send(ticketId))}>{busy === 'send' ? t('pos.sending') : t('pos.send_to_display')}</button>
        ) : null}
        {m.ticketSession ? <button style={ghostBtn} disabled={busy === 'cancel'} onClick={() => act('cancel', m.cancel)}>{t('pos.cancel_display_session')}</button> : null}
        {m.ticketSession && m.ticketSession.state === 'payment_processing' ? <button style={ghostBtn} disabled={busy === 'cancelTerminal'} onClick={() => act('cancelTerminal', m.cancelTerminal)} data-testid="cancel-terminal">{busy === 'cancelTerminal' ? t('pos.cancelling') : t('pos.cancel_terminal_prompt')}</button> : null}
        {mine && !mine.awaitingPickup ? <button style={ghostBtn} disabled={busy === 'refresh'} onClick={() => act('refresh', m.refresh)}>{t('pos.refresh_display')}</button> : null}
        {ticketId && !ticketPaid && others.length ? (
          <select aria-label={t('pos.switch_display')} value="" disabled={busy === 'send'} onChange={(e) => { const d = e.target.value; if (d) void act('send', () => m.send(ticketId, d)); }} style={select}>
            <option value="">{t('pos.switch_display_2')}</option>
            {others.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.name}{d.session ? t('pos.in_use') : ''}</option>)}
          </select>
        ) : null}
        {canReconnect ? <button style={ghostBtn} disabled={busy === 'reconnect'} onClick={() => act('reconnect', m.reconnect)}>{busy === 'reconnect' ? t('pos.reconnecting') : t('pos.reconnect')}</button> : null}
        {url && (!mine || !mine.online) ? <button style={ghostBtn} onClick={() => { void openHere(); }}>{t('pos.open_on_second_screen')}</button> : null}
      </div>
      {note ? <div style={{ fontSize: 11.5, color: 'var(--text)', marginTop: 8 }} data-testid="customer-display-note">{note}</div> : null}
    </section>
  );
}
