// POSAIAudienceBuilderScreen.tsx — AI Center → AI Marketing → Audience Builder (/tenant/ai/marketing/audiences). Audience Builder guide
// (Nov 3 2026). AGGREGATE-ONLY: how many customers match a goal and, channel by channel, how many are excluded and why (no consent ·
// opted out · no usable phone / email · recently contacted · upcoming booking · never visited), the eligible count, and the number of
// unique people when both channels are chosen. The goals use the ONE rule the Customer Retention module owns (before: a customer who
// visited yesterday still counted as "lapsed" if they also had an old visit). No customer list is shown and nothing is saved or sent;
// "Build a campaign" continues in the Campaign Builder, custom audiences are built in Customer Segments.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MkFunnel, MkHealthButton, mt } from '../components/MarketingKit';
import type { MkKind } from '../api/posAIMarketingApi';

const KINDS: MkKind[] = ['rebooking', 'winback', 'birthday'];
export function POSAIAudienceBuilderScreen() {
  const [kind, setKind] = useState<MkKind | null>(null);
  const [channel, setChannel] = useState<'sms' | 'email' | 'both'>('sms');
  return (
    <div className="work rvw" data-testid="amk-audiences">
      <div className="rvw-head">
        <div className="vh"><h1>{mt('amk.aud.title')}</h1><div className="sub">{mt('amk.aud.sub')}</div></div>
        <div className="rvw-actions"><MkHealthButton /><Link className="btn ghost" to="/tenant/marketing/segments">{mt('amk.aud.segments')}</Link></div>
      </div>
      <section className="panel" style={{ padding: 12 }}>
        <div className="p-h">{mt('amk.aud.goal')}</div>
        <div className="amk-recs">{KINDS.map((k) => (
          <button key={k} type="button" className={'amk-rec' + (kind === k ? ' on' : '')} data-testid={`amk-aud-${k}`} aria-pressed={kind === k} onClick={() => setKind(k)} style={{ textAlign: 'left', cursor: 'pointer', borderColor: kind === k ? 'var(--gold)' : undefined }}>
            <b>{mt('amk.kind.' + k)}</b><span className="sub">{mt('amk.kindDesc.' + k)}</span>
          </button>))}
        </div>
        <div className="rvw-dates" style={{ marginTop: 10 }}>
          {(['sms', 'email', 'both'] as const).map((c) => <button key={c} type="button" className={'btn ghost' + (channel === c ? ' on' : '')} data-testid={`amk-aud-ch-${c}`} onClick={() => setChannel(c)}>{mt('amk.channel.' + c)}</button>)}
        </div>
      </section>
      {kind ? <section className="panel" style={{ padding: 12, marginTop: 12 }}>
        <MkFunnel kind={kind} channel={channel} />
        <div className="rvw-actions">
          {kind === 'birthday' ? <Link className="btn" to="/tenant/marketing/birthdays">{mt('amk.openBirthdays')}</Link>
            : <Link className="btn" data-testid="amk-aud-build" to={`/tenant/ai/marketing/builder?kind=${kind}&channel=${channel === 'email' ? 'email' : 'sms'}`}>{mt('amk.buildDraft')}</Link>}
        </div>
      </section> : <p className="sub" style={{ marginTop: 12 }}>{mt('amk.aud.pick')}</p>}
    </div>
  );
}
