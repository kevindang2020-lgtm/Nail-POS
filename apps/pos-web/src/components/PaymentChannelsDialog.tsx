// PaymentChannelsDialog.tsx — Checkout → "Three Ways to Pay" (SUNMI guide, Nov 9 2026).
//
// Three equally weighted channel cards — Clover Compact (front desk) · Staff iPhone (Tap to Pay) · Customer App (saved card /
// Pay Now) — each with where the payment happens, the masked merchant / device, the server's readiness, when it was last
// verified, ONE primary action and the next step when it cannot be used. A channel that cannot take money is shown, never
// hidden. Above them, the open ticket from the canonical ledger (server-owned balance in cents, paid / in progress /
// unknown); below, Check Three Payment Channels (read-only, no test charge) and the screen-fit numbers of this display.
//
// SAFETY (guide §1, §7, §10, §11): this dialog never collects card data and never charges by itself.
//   • Clover Compact → "Use Clover Compact" hands back to the workspace's existing card button (same terminal flow, locks,
//     attempt key, verify-on-unknown). • iPhone → "Send to <phone>" is the existing send-to-device push; the phone's native
//     app does the tap. • Customer App → the existing send-app-payment / verify-app-payment.
// Every action is held while the server says a payment is moving, unknown or settled. Resizing or closing the dialog
// starts, retries or cancels nothing.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PcChannel, PcCheckResponse, PcResponse } from '@aipowersalon/api-contracts/tenant';
import { posPaymentChannelsApi } from '../api/posPaymentChannelsApi';
import { posMobilePaymentsApi } from '../api/posMobilePaymentsApi';
import { posSkipLineApi } from '../api/posSkipLineApi';
import { FitDialog, ErrorRetry } from './FitKit';
import { isForbidden } from './FinanceKit';
import { errorTextOf } from '../i18n/error-text';
import { fmtInZone } from '../i18n/format';
import { money } from '../screens/reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';

const tt = (k: string, v?: Record<string, string | number>) => t(k, v as Parameters<typeof t>[1]);
/** a code the dictionary knows → its words; otherwise the generic line for that state (never a raw code alone) */
const reasonText = (c: PcChannel): string => {
  if (!c.reason) return '';
  const k = `ways.reason.${c.reason}`; const w = tt(k);
  return w && w !== k ? w : tt('ways.reason.generic.' + c.state, { code: c.reason });
};
const when = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: '2-digit', hour: 'numeric', minute: '2-digit' }) || '—' : null);
const ICON: Record<string, string> = {
  clover_compact: 'M4 5h12v10H4zM7 15v2h6v-2M7 8h6M7 11h3',
  tap_to_pay_iphone: 'M7 2h6a1 1 0 011 1v14a1 1 0 01-1 1H7a1 1 0 01-1-1V3a1 1 0 011-1zM9 15h2M15.5 7a4 4 0 010 6M17.5 5a7 7 0 010 10',
  customer_app: 'M6 2h8a1 1 0 011 1v14a1 1 0 01-1 1H6a1 1 0 01-1-1V3a1 1 0 011-1zM8 7h4M8 10h4M9 15h2',
};
const STATE_TONE: Record<string, string> = { ready: 'ok', setup_required: 'warn', provider_pending: 'info', blocked: 'bad', unavailable: 'bad' };

export function PaymentChannelsDialog({ ticketId, onClose, onUseClover }: { ticketId: string | null; onClose: () => void; onUseClover: () => void }) {
  const nav = useNavigate();
  const [d, setD] = useState<PcResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [health, setHealth] = useState<PcCheckResponse | 'loading' | { error: string } | null>(null);
  const [fit, setFit] = useState<{ w: number; h: number; vw: number | null; vh: number | null; dpr: number; overflowX: boolean; cardWidths: number[] } | null>(null);
  const cardsRef = useRef<HTMLDivElement | null>(null);
  const seq = useRef(0);

  const load = useCallback(() => {
    const my = ++seq.current; setErr(null);
    posPaymentChannelsApi.channels(ticketId).then((r) => { if (my === seq.current) setD(r); })
      .catch((e) => { if (my === seq.current) setErr(isForbidden(e) ? tt('ways.err.forbidden') : errorTextOf(e, tt('ways.loadFailed'))); });
  }, [ticketId]);
  useEffect(load, [load]);

  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    if (busy) return;   // one tap = one request (no double send)
    setBusy(key); setNote(null);
    try { await fn(); setNote({ tone: 'ok', text: ok }); }
    catch (e) { setNote({ tone: 'bad', text: errorTextOf(e, tt('ways.actionFailed')) }); }
    finally { setBusy(null); load(); }
  };
  const runCheck = () => {
    setHealth('loading');
    // screen fit (guide §12): measured here, on this display — a layout result, never a payment result
    const cards = cardsRef.current ? Array.from(cardsRef.current.querySelectorAll<HTMLElement>('[data-testid="payment-channel-card"]')).map((n) => Math.round(n.getBoundingClientRect().width)) : [];
    setFit({ w: window.innerWidth, h: window.innerHeight, vw: window.visualViewport ? Math.round(window.visualViewport.width) : null, vh: window.visualViewport ? Math.round(window.visualViewport.height) : null,
      dpr: window.devicePixelRatio || 1, overflowX: document.documentElement.scrollWidth > window.innerWidth + 1, cardWidths: cards });
    posPaymentChannelsApi.check().then(setHealth).catch((e) => setHealth({ error: errorTextOf(e, tt('ways.loadFailed')) }));
  };

  const tk = d?.ticket ?? null;
  const ticketTone = !tk ? '' : tk.status === 'paid' ? 'ok' : tk.status === 'unknown' ? 'bad' : tk.status === 'in_progress' ? 'warn' : 'info';
  const held = (c: PcChannel) => (c.actionHeldBy ? tt('ways.held.' + c.actionHeldBy) : '');

  const card = (c: PcChannel) => {
    const f = c.facts as Record<string, any>;
    const canAct = !!ticketId && c.state === 'ready' && c.actionAllowed && !busy;
    let primary: JSX.Element | null = null; const facts: [string, string | null][] = [];
    if (c.key === 'clover_compact') {
      facts.push([tt('ways.f.terminal'), f.terminalLabel ? `${f.terminalLabel}${f.hsnMasked ? ` · ${f.hsnMasked}` : ''}` : null], [tt('ways.f.merchant'), f.merchantMasked ?? null],
        [tt('ways.f.lastPing'), when(f.lastSuccessfulPingAt) ?? tt('ways.never')]);
      primary = <button className="btn primary pcw-primary" data-testid="pcw-use-clover" disabled={!canAct} onClick={() => { onUseClover(); onClose(); }}>{tt('ways.act.clover')}</button>;
    } else if (c.key === 'tap_to_pay_iphone') {
      facts.push([tt('ways.f.phones'), tt('ways.phonesOnline', { online: f.onlinePhones ?? 0, total: f.capablePhones ?? 0 })], [tt('ways.f.apple'), f.appleEntitlement ? tt('ways.onb.' + f.appleEntitlement) : null],
        [tt('ways.f.processorTtp'), f.processorTtp ? tt('ways.onb.' + f.processorTtp) : null]);
      const devices: { deviceId: string; label: string | null; userName: string | null }[] = Array.isArray(f.devices) ? f.devices : [];
      primary = devices.length ? <div className="pcw-devs">{devices.slice(0, 3).map((dv) => (
        <button key={dv.deviceId} className="btn primary pcw-primary" data-testid="pcw-send-phone" disabled={!canAct}
          onClick={() => act('phone:' + dv.deviceId, () => posMobilePaymentsApi.sendToPhone(ticketId!, dv.deviceId), tt('ways.sentPhone', { name: dv.label || tt('ways.aPhone') }))}>
          {tt('ways.act.phone', { name: dv.label || tt('ways.aPhone') })}</button>))}</div>
        : <button className="btn primary pcw-primary" data-testid="pcw-send-phone" disabled>{tt('ways.act.phoneNone')}</button>;
    } else {
      facts.push([tt('ways.f.appPayments'), f.appPaymentsEnabled ? tt('ways.on') : tt('ways.off')], [tt('ways.f.tokenizer'), f.hostedTokenizer ? tt('ways.ready') : tt('ways.notReady')],
        [tt('ways.f.savedCards'), f.customerSavedCards == null ? (ticketId ? '—' : null) : String(f.customerSavedCards)]);
      const prompt = !!f.promptOpen || tk?.inProgressVia === 'customer_app';
      primary = prompt && ticketId
        ? <button className="btn primary pcw-primary" data-testid="pcw-verify-app" disabled={!!busy} onClick={() => act('verify-app', () => posSkipLineApi.verifyAppPayment(ticketId), tt('ways.verifiedApp'))}>{tt('ways.act.verifyApp')}</button>
        : <button className="btn primary pcw-primary" data-testid="pcw-send-app" disabled={!canAct} onClick={() => act('send-app', () => posSkipLineApi.sendAppPayment(ticketId!), tt('ways.sentApp'))}>{tt('ways.act.app')}</button>;
    }
    return (
      <article key={c.key} className={'pcw-card ' + (STATE_TONE[c.state] || '')} data-testid="payment-channel-card" data-channel={c.key} data-state={c.state} aria-labelledby={`pcw-t-${c.key}`}>
        <header className="pcw-card-h">
          <span className="pcw-ico" aria-hidden><svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={ICON[c.key]} /></svg></span>
          <div><h3 id={`pcw-t-${c.key}`}>{tt('ways.title.' + c.key)}</h3><div className="sub">{tt('ways.where.' + c.key)}</div></div>
        </header>
        <div className="pcw-status" data-testid={`pcw-state-${c.key}`}>
          <span className={'chip ' + (STATE_TONE[c.state] || '')}>{tt('ways.state.' + c.state)}</span>
          {c.mode === 'uat' ? <span className="chip info" title={tt('ways.uatHint')}>{tt('ways.uat')}</span> : null}
        </div>
        {c.reason && c.reason !== 'UAT_TEST_LANE' ? <p className="pcw-reason">{reasonText(c)}</p> : c.mode === 'uat' && c.state === 'ready' ? <p className="pcw-reason">{tt('ways.uatHint')}</p> : null}
        <dl className="pcw-facts">{facts.filter(([, v]) => v != null).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        <div className="sub pcw-verified">{c.lastVerifiedAt ? tt('ways.lastVerified', { at: when(c.lastVerifiedAt) ?? '' }) : tt('ways.notVerifiedYet')}</div>
        <div className="pcw-actions">
          {primary}
          {!ticketId ? <div className="sub">{tt('ways.pickTicket')}</div> : c.actionHeldBy ? <div className="sub" data-testid={`pcw-held-${c.key}`}>{held(c)}</div> : null}
          {c.key === 'clover_compact' ? <button className="btn ghost" data-testid="pcw-terminal-details" onClick={() => { onClose(); nav('/tenant/devices/payment-terminals'); }}>{tt('ways.act.terminalDetails')}</button> : null}
        </div>
      </article>
    );
  };

  return (
    <FitDialog wide testId="pcw-dialog" title={tt('ways.title')} subtitle={d ? `${d.branch.name}${d.merchant.masked ? ` · ${tt('ways.merchant', { mid: d.merchant.masked })}` : ''} · ${d.liveMode ? tt('ways.live') : tt('ways.testOnly')}` : undefined}
      onClose={onClose} footer={<>
        <button className="btn ghost" data-testid="pcw-check" onClick={runCheck}>{tt('ways.check')}</button>
        <button className="btn ghost" data-testid="pcw-refresh" onClick={load}>{tt('ways.refresh')}</button>
        <button className="btn" data-testid="pcw-back" onClick={onClose}>{tt('ways.back')}</button>
      </>}>
      {err ? <ErrorRetry message={err} onRetry={load} /> : !d ? <div className="state">{tt('ways.loading')}</div> : <>
        {tk ? <section className={'pcw-ticket ' + ticketTone} data-testid="pcw-ticket" aria-live="polite">
          <div><span className="sub">{tt('ways.ticket')}</span> <b>#{tk.number ?? tk.id.slice(0, 8)}</b></div>
          <div><span className="sub">{tt('ways.balance')}</span> <b className="pcw-money" data-testid="pcw-balance">{tk.balanceCents == null ? '—' : money(tk.balanceCents)}</b>
            {tk.paidCents > 0 && tk.status !== 'paid' ? <span className="sub"> · {tt('ways.paidSoFar', { amount: money(tk.paidCents) })}</span> : null}</div>
          <div><span className={'chip ' + ticketTone} data-testid="pcw-ticket-status">{tt('ways.tstatus.' + tk.status)}</span>
            {tk.status === 'paid' && tk.paidVia ? <span className="sub"> · {tt('ways.paidVia.' + tk.paidVia)}{tk.paidAt ? ` · ${when(tk.paidAt)}` : ''}</span> : null}
            {tk.status === 'in_progress' && tk.inProgressVia ? <span className="sub"> · {tt('ways.via.' + tk.inProgressVia)}</span> : null}</div>
          {tk.status === 'unknown' ? <p className="pcw-warn" role="alert">{tt('ways.unknownHelp')}</p> : null}
          {tk.status === 'in_progress' ? <p className="pcw-warn">{tt('ways.inProgressHelp')}</p> : null}
        </section> : <p className="sub">{tt('ways.noTicket')}</p>}
        {note ? <div className={note.tone === 'ok' ? 'state' : 'err'} role="status" data-testid="pcw-note">{note.text}</div> : null}
        <div className="pcw-cards" ref={cardsRef} data-testid="pcw-cards">{d.channels.map(card)}</div>
        <p className="sub pcw-foot">{tt('ways.foot')}</p>
        {health ? <section className="pcw-health" data-testid="pcw-health" aria-live="polite">
          <h3>{tt('ways.check')}</h3>
          {health === 'loading' ? <div className="state">{tt('ways.checking')}</div> : 'error' in health ? <div className="err">{health.error}</div> : <>
            <p className="sub">{tt('ways.health.overall', { s: tt('ways.hs.' + health.overall), at: when(health.checkedAt) ?? '' })} · {tt('ways.health.readOnly')}</p>
            <ul className="pcw-checks">{health.checks.map((x) => <li key={x.key} data-testid={`pcw-chk-${x.key}`}>
              <span className={'chip ' + (x.state === 'PASSED' ? 'ok' : x.state === 'FAILED' || x.state === 'UNAVAILABLE' ? 'bad' : x.state === 'PROVIDER_APPROVAL_PENDING' ? 'info' : 'warn')}>{tt('ways.hs.' + x.state)}</span>
              <b>{tt('ways.hk.' + x.key)}</b>{x.count ? <span className="sub"> · {x.count}</span> : null}
              {x.reason ? <span className="sub"> — {tt('ways.reason.' + x.reason) !== 'ways.reason.' + x.reason ? tt('ways.reason.' + x.reason) : x.reason}</span> : null}</li>)}
              {fit ? <li data-testid="pcw-chk-screen_fit"><span className={'chip ' + (fit.overflowX || (fit.cardWidths.length === 3 && Math.max(...fit.cardWidths) - Math.min(...fit.cardWidths) > 2) ? 'warn' : 'ok')}>{tt(fit.overflowX ? 'ways.hs.WARNING' : 'ways.hs.PASSED')}</span>
                <b>{tt('ways.hk.screen_fit')}</b><span className="sub"> — {tt('ways.fit', { w: fit.w, h: fit.h, dpr: fit.dpr, cards: fit.cardWidths.join(' / ') || '—' })}{fit.overflowX ? ` · ${tt('ways.fitOverflow')}` : ''}</span></li> : null}
            </ul>
            <p className="sub">{tt('ways.health.layoutNote')}</p>
          </>}
        </section> : null}
      </>}
    </FitDialog>
  );
}
