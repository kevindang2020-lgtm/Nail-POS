// ProviderReadinessStrip — extras Communications SMS Inbox 04: the salon's texting provider readiness inside the inbox, five
// facts read from the ONE server readiness (GET /tenant/messaging/readiness — the same object Messaging Setup shows):
// provider account, sender number, carrier registration (A2P / toll-free), inbound callback, delivery status callback. Each
// item shows the server state and its reason; nothing is computed here. Only for people who may view settings (the route's
// permission); others keep the composer's own blocked/ready answer. A failed read says so — never a guessed "ready".
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import type { MessagingReadiness } from '@aipowersalon/api-contracts/tenant';
import { posPhoneApi } from '../api/posPhoneApi';
import { codeLabel } from './peopleLabels';

type Item = { key: 'account' | 'sender' | 'registration' | 'inbound' | 'status'; state: string; reasonCode: string | null; fixLink: string; at: string | null };
const GOOD = new Set(['ready', 'connected', 'verified', 'approved', 'active', 'ok', 'done', 'not_applicable', 'assigned', 'matches']);
const BAD = new Set(['failed', 'blocked', 'rejected', 'error', 'missing', 'not_configured', 'disconnected', 'attention_required', 'suspended', 'invalid', 'misconfigured', 'unreachable', 'not_owned', 'missing_secret', 'not_set', 'disabled']);
export const toneOf = (state: string) => (GOOD.has(state) ? 'ok' : BAD.has(state) ? 'bad' : 'warn');

/** The five items, in order, straight from the server object (no state is derived here). */
export function readinessItems(r: MessagingReadiness): Item[] {
  return [
    { key: 'account', state: r.account.state, reasonCode: r.account.reasonCode, fixLink: r.account.fixLink, at: r.account.lastCheckedAt },
    { key: 'sender', state: r.sender.state, reasonCode: r.sender.reasonCode, fixLink: r.sender.fixLink, at: r.sender.lastCheckedAt },
    { key: 'registration', state: r.a2p.applicable ? r.a2p.state : r.tollFree ? r.tollFree.state : 'not_applicable', reasonCode: r.a2p.applicable ? r.a2p.reasonCode : r.tollFree?.reasonCode ?? null, fixLink: r.a2p.fixLink, at: r.a2p.lastCheckedAt },
    { key: 'inbound', state: r.inbound.state, reasonCode: r.inbound.reasonCode, fixLink: r.inbound.fixLink, at: r.inbound.lastVerifiedEventAt },
    { key: 'status', state: r.inbound.statusCallback.state, reasonCode: r.inbound.statusCallback.reasonCode, fixLink: r.inbound.statusCallback.fixLink, at: r.inbound.statusCallback.lastVerifiedEventAt },
  ];
}

export function ProviderReadinessStrip({ branchId = '' }: { branchId?: string }) {
  const nav = useNavigate();
  const [r, setR] = useState<MessagingReadiness | null>(null); const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true; setErr(false);
    posPhoneApi.readiness(branchId).then((x) => { if (alive) setR(x); }).catch(() => { if (alive) { setR(null); setErr(true); } });
    return () => { alive = false; };
  }, [branchId]);
  if (err) return <div className="ci-small warn" data-testid="ci-provider-error">{tx('ci.prov.error')}</div>;
  if (!r) return null;
  return (
    <section className="ci-provider" aria-label={tx('ci.prov.title')} data-testid="ci-provider" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', margin: '4px 0' }}>
      <b>{tx('ci.prov.title')}</b>
      {readinessItems(r).map((it) => (
        <button type="button" key={it.key} className={'fk-chip ' + toneOf(it.state)} data-testid={'ci-prov-' + it.key} data-state={it.state} onClick={() => nav(it.fixLink || '/tenant/communications/messaging-setup')}
          title={it.reasonCode ? codeLabel('ci.prov.reason.' + it.reasonCode, it.reasonCode) : undefined}>
          {tx('ci.prov.item.' + it.key)}: {codeLabel('ci.prov.state.' + it.state, it.state)}
        </button>
      ))}
    </section>
  );
}
