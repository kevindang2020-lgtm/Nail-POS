// POSPaymentGatewayScreen.tsx — Integrations → Payment Gateway (Fiserv Payment Gateway SUNMI guide, Nov 9 2026).
// Reads the tenant's real payment-processor record (GET /pos/payment-gateway/status, masked) and the three payment channels
// (GET /pos/payment-channels, read-only). Every state is separate and source-backed — the guide's rule that one green
// "Connected" badge must not stand for provider + credentials + connectivity + onboarding + validation + production:
//   • heading · branch · environment · last checked · Refresh
//   • Merchant card (the original fields: processor, environment, masked merchant ID, status, onboarding) + Connector card
//     (card-terminal key stored, Tap to Pay merchant, production gate)
//   • three equal channel cards — Clover Compact · Staff iPhone · Customer App — the same server readiness Checkout shows
//   • Readiness checklist (each line its own fact) · Check Payment Gateway (read-only, no test charge) · terminal &
//     connection history (canonical audit log)
// Sandbox is always "test only — no live money". Production is never claimed from connectivity. No credential, token or
// full MID ever reaches this page. Processors are Fiserv / CardPointe only, never Stripe/Square.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { posPaymentGatewayApi, type MaskedPaymentGateway } from '../api/posPaymentGatewayApi';
import { posPaymentChannelsApi } from '../api/posPaymentChannelsApi';
import type { PcResponse, PcCheckResponse, PcChannel } from '@aipowersalon/api-contracts/tenant';
import { reportError } from './reportsCommon';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { codeLabel } from '../components/codeLabel';
import { FitDialog } from '../components/FitKit';
import { fmtInZone } from '../i18n/format';
import { FleetHistory } from './POSDeviceFleetScreen';

// processor brand names stay as written; 'none' and the onboarding stage are labelled at render (admin.gateway.*)
const PROCESSOR_NAME: Record<string, string> = { fiserv: 'Fiserv', cardpointe: 'CardPointe', clover: 'Clover', bolt: 'Bolt' };
const prettyProcessor = (t: string) => (t === 'none' ? tx('pos.not_connected_2') : PROCESSOR_NAME[t] ?? t);
const onboardingLabel = (s: string) => codeLabel('admin.gateway.onboarding', s, 'gateway');
const tt = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);
const when = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: '2-digit', hour: 'numeric', minute: '2-digit' }) || '—' : '—');
const TONE: Record<string, string> = { ready: 'ok', setup_required: 'warn', provider_pending: 'info', blocked: 'bad', unavailable: 'bad' };
type Line = { key: string; ok: boolean | null; text: string };

export function POSPaymentGatewayScreen() {
  const nav = useNavigate();
  const [g, setG] = useState<MaskedPaymentGateway | null>(null);
  const [ch, setCh] = useState<PcResponse | null>(null);
  const [chErr, setChErr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [health, setHealth] = useState<PcCheckResponse | 'loading' | { error: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null); setChErr(null);
    try { setG(await posPaymentGatewayApi.status()); setCheckedAt(new Date().toISOString()); }
    catch (e: any) { setError(reportError(e, tx('admin.gateway.noun'))); }
    finally { setLoading(false); }
    posPaymentChannelsApi.channels(null).then(setCh).catch((e) => setChErr(reportError(e, tx('admin.gateway.noun'))));
  }, []);
  useEffect(() => { void load(); }, [load]);
  const runCheck = () => { setHealth('loading'); posPaymentChannelsApi.check().then(setHealth).catch((e) => setHealth({ error: reportError(e, tx('admin.gateway.noun')) })); };

  if (loading && !g) return <div className="work"><div className="state">{tx('pos.loading_payment_gateway')}</div></div>;
  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!g) return <div className="work"><div className="state">{tx('pos.no_data')}</div></div>;

  const selected = g.processorType !== 'none';
  const configured = !g.setupRequired && selected;
  const sandbox = g.environment !== 'production';
  // the readiness checklist — every line its own fact; "null" = not known from this page (never shown as done)
  const lines: Line[] = [
    { key: 'provider', ok: selected, text: selected ? tt('pgx.line.provider', { p: prettyProcessor(g.processorType) }) : tt('pgx.line.noProvider') },
    { key: 'merchant', ok: configured, text: configured ? tt('pgx.line.merchant', { mid: g.merchantIdMasked || '—' }) : tt('pgx.line.noMerchant') },
    { key: 'environment', ok: !sandbox, text: sandbox ? tt('pgx.line.sandbox') : tt('pgx.line.production') },
    { key: 'onboarding', ok: ['approved', 'active', 'activated', 'boarded'].includes(String(g.onboardingStatus).toLowerCase()), text: tt('pgx.line.onboarding', { s: onboardingLabel(g.onboardingStatus) }) },
    { key: 'terminal', ok: g.terminalConfigured ?? null, text: g.terminalConfigured ? tt('pgx.line.terminalKey') : tt('pgx.line.noTerminalKey') },
    { key: 'ttp', ok: g.tapToPayConfigured ?? null, text: g.tapToPayConfigured ? tt('pgx.line.ttp', { mid: g.tapToPayMerchantIdMasked || '—' }) : tt('pgx.line.noTtp') },
    { key: 'live', ok: ch ? ch.liveMode : null, text: ch ? (ch.liveMode ? tt('pgx.line.live') : tt('pgx.line.notLive')) : tt('pgx.line.liveUnknown') },
  ];
  const card = (c: PcChannel) => (
    <article key={c.key} className={'pcw-card pgx-ch ' + (TONE[c.state] || '')} data-testid="pgx-channel" data-channel={c.key} data-state={c.state}>
      <h3>{tt('ways.title.' + c.key)}</h3>
      <div className="sub">{tt('ways.where.' + c.key)}</div>
      <div className="pcw-status"><span className={'chip ' + (TONE[c.state] || '')}>{tt('ways.state.' + c.state)}</span>{c.mode === 'uat' ? <span className="chip info">{tt('ways.uat')}</span> : null}</div>
      {c.reason && c.reason !== 'UAT_TEST_LANE' ? <p className="pcw-reason">{tt('ways.reason.' + c.reason) !== 'ways.reason.' + c.reason ? tt('ways.reason.' + c.reason) : tt('ways.reason.generic.' + c.state, { code: c.reason })}</p> : null}
      <div className="sub pcw-verified">{c.lastVerifiedAt ? tt('ways.lastVerified', { at: when(c.lastVerifiedAt) }) : tt('ways.notVerifiedYet')}</div>
    </article>
  );

  return (
    <div className="work" data-testid="pgx-screen">
      <div className="vh dfx-head" style={{ marginBottom: 10 }}>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <h1>{tx('pos.payment_gateway_2')}</h1>
          <div className="sub">{tx('pos.how_this_salon_takes_card_payments')}{ch ? ` · ${ch.branch.name}` : ''} · {tt('pgx.checked', { at: when(checkedAt) })}</div>
        </div>
        <button className="btn ghost" data-testid="pgx-terminals" onClick={() => nav('/tenant/devices/payment-terminals')}>{tt('pgx.toTerminals')}</button>
        <button className="btn ghost" data-testid="pgx-refresh" onClick={() => { void load(); }}>{tx('pos.refresh')}</button>
        <button className="btn" data-testid="pgx-check" onClick={runCheck}>{tt('pgx.check')}</button>
      </div>
      {sandbox && selected ? <div className="pgx-banner" data-testid="pgx-sandbox" role="status">{tt('pgx.sandboxBanner')}</div> : null}

      <div className="pgx-two" data-testid="pgx-cards">
        <section className="panel" data-testid="pgx-merchant">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 10, height: 10, borderRadius: 5, background: configured ? '#2E9E54' : '#B5651D', display: 'inline-block' }} />
            <span style={{ fontWeight: 800, fontSize: 16 }}>{configured ? tt('pgx.selected', { p: prettyProcessor(g.processorType) }) : tx('pos.not_connected_yet_2')}</span>
          </div>
          {configured ? (
            <div className="grid grid-cols-[160px_1fr] gap-x-4 gap-y-2 mt-3.5 text-[15px]">
              <div className="sub">{tx('pos.processor_2')}</div><div style={{ fontWeight: 600 }}>{prettyProcessor(g.processorType)}</div>
              <div className="sub">{tx('pos.environment')}</div><div className="break-all">{g.environment || '—'}{sandbox ? <span className="chip info" style={{ marginLeft: 8 }}>{tt('ways.uat')}</span> : null}</div>
              <div className="sub">{tx('pos.merchant_id')}</div><div className="break-all" style={{ fontFamily: 'monospace' }}>{g.merchantIdMasked || '—'}</div>
              <div className="sub">{tx('pos.status')}</div><div className="break-all">{g.status || '—'} <span className="sub">· {tt('pgx.statusMeans')}</span></div>
              <div className="sub">{tx('pos.onboarding')}</div><div className="break-all">{onboardingLabel(g.onboardingStatus)}</div>
            </div>
          ) : (
            <div style={{ marginTop: 12, fontSize: 15, lineHeight: 1.6 }}>
              <p style={{ margin: '0 0 8px' }}>{tx('pos.card_processing_isn_t_set_up_1pig')}{' '}<b>{onboardingLabel(g.onboardingStatus)}</b>.</p>
              <p className="sub" style={{ margin: 0 }}>{tx('pos.aipowersalon_processes_cards_through_fiserv_cardpointe_1oqe')}</p>
            </div>
          )}
        </section>
        <section className="panel" data-testid="pgx-connector">
          <div style={{ fontWeight: 800, fontSize: 16 }}>{tt('pgx.connector')}</div>
          <div className="grid grid-cols-[200px_1fr] gap-x-4 gap-y-2 mt-3.5 text-[15px]">
            <div className="sub">{tt('pgx.terminalKey')}</div><div>{g.terminalConfigured ? tt('pgx.stored') : tt('pgx.notStored')}</div>
            <div className="sub">{tt('pgx.terminalHost')}</div><div className="break-all">{g.terminalBaseUrl || '—'}</div>
            <div className="sub">{tt('pgx.ttpMerchant')}</div><div style={{ fontFamily: 'monospace' }}>{g.tapToPayConfigured ? (g.tapToPayMerchantIdMasked || '—') : tt('pgx.notStored')}</div>
            <div className="sub">{tt('pgx.livePayments')}</div><div data-testid="pgx-live">{ch ? (ch.liveMode ? tt('pgx.on') : tt('pgx.offUntilCert')) : '—'}</div>
          </div>
          <p className="sub" style={{ marginTop: 10 }}>{tt('pgx.billingNote')}</p>
        </section>
      </div>

      <section className="pgx-channels-wrap" data-testid="pgx-channels">
        <div className="p-h" style={{ margin: '14px 0 8px' }}>{tt('pgx.channels')}</div>
        {chErr ? <div className="err">{chErr}</div> : !ch ? <div className="state">{tt('ways.loading')}</div> : <div className="pcw-cards">{ch.channels.map(card)}</div>}
      </section>

      <section className="panel" data-testid="pgx-readiness" style={{ marginTop: 14 }}>
        <div className="p-h">{tt('pgx.readiness')}</div>
        <ul className="pgx-lines">{lines.map((l) => <li key={l.key} data-testid={`pgx-line-${l.key}`}><span className={'chip ' + (l.ok ? 'ok' : l.ok === false ? 'warn' : '')}>{tt(l.ok ? 'pgx.done' : l.ok === false ? 'pgx.notYet' : 'pgx.unknown')}</span> {l.text}</li>)}</ul>
        <p className="sub">{tt('pgx.readinessNote')}</p>
      </section>

      <section data-testid="pgx-history" style={{ marginTop: 14 }}>
        <div className="p-h" style={{ marginBottom: 8 }}>{tt('pgx.history')}</div>
        <FleetHistory cls="terminal" />
      </section>

      <div className="sub" style={{ fontSize: 13, marginTop: 12 }}>{tx('pos.full_processor_credentials_never_leave_the_1n19')}</div>

      {health ? <FitDialog wide testId="pgx-health" title={tt('pgx.check')} onClose={() => setHealth(null)} footer={<button className="btn ghost" onClick={() => setHealth(null)}>{tx('pos.close')}</button>}>
        {health === 'loading' ? <div className="state">{tt('ways.checking')}</div> : 'error' in health ? <div className="err">{health.error}</div> : <>
          <p className="sub">{tt('ways.health.overall', { s: tt('ways.hs.' + health.overall), at: when(health.checkedAt) })} · {tt('ways.health.readOnly')}</p>
          <ul className="pcw-checks">{health.checks.map((x) => <li key={x.key} data-testid={`pgx-chk-${x.key}`}>
            <span className={'chip ' + (x.state === 'PASSED' ? 'ok' : x.state === 'FAILED' || x.state === 'UNAVAILABLE' ? 'bad' : x.state === 'PROVIDER_APPROVAL_PENDING' ? 'info' : 'warn')}>{tt('ways.hs.' + x.state)}</span>
            <b>{tt('ways.hk.' + x.key)}</b>{x.count ? <span className="sub"> · {x.count}</span> : null}
            {x.reason ? <span className="sub"> — {tt('ways.reason.' + x.reason) !== 'ways.reason.' + x.reason ? tt('ways.reason.' + x.reason) : x.reason}</span> : null}</li>)}</ul>
        </>}
      </FitDialog> : null}
    </div>
  );
}
