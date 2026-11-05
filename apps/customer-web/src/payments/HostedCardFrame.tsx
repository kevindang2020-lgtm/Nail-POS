// HostedCardFrame — the Fiserv CardSecure hosted iFrame as a React component (Fiserv master build §4 / §8).
// Loads the salon's tokenizer config from the API, renders the provider page, and reports ONLY a token (+ expiry) back,
// after the origin + source checks in hostedTokenizer.ts. The card number, expiry and CVV never enter this app.
import { useEffect, useRef, useState } from 'react';
import { customerApi } from '../api/customerApi';
import { trustedTokenizerFrame, readTokenizerMessage, type TokenizerFrame } from './hostedTokenizer';

export interface HostedCardToken { token: string; expiry?: string }

export function HostedCardFrame({ onToken, onUnavailable }: { onToken: (t: HostedCardToken | null) => void; onUnavailable?: () => void }) {
  const [frame, setFrame] = useState<TokenizerFrame | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState<HostedCardToken | null>(null);
  const ref = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    let live = true;
    customerApi.cardTokenizer().then((cfg) => {
      if (!live) return;
      const f = trustedTokenizerFrame(cfg);
      setFrame(f); setState(f ? 'ready' : 'unavailable');
      if (!f) onUnavailable?.();
    }).catch(() => { if (live) { setState('unavailable'); onUnavailable?.(); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!frame) return;
    const onMessage = (ev: MessageEvent) => {
      const m = readTokenizerMessage(ev, frame, ref.current?.contentWindow ?? null);
      if (m.kind === 'token') { const t = { token: m.token, expiry: m.expiry }; setReady(t); setError(null); onToken(t); }
      else if (m.kind === 'error') { setReady(null); setError(m.message); onToken(null); }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [frame, onToken]);

  if (state === 'unavailable') return <div role="status" className="cust-sub">Paying with a new card is not available at this salon yet.</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {frame ? (
        <iframe ref={ref} title="Secure card entry" src={frame.url} sandbox="allow-scripts allow-same-origin allow-forms" referrerPolicy="no-referrer"
          style={{ width: '100%', height: 160, border: '1px solid var(--customer-border)', borderRadius: 10, background: '#fff' }} />
      ) : <div className="cust-skel" style={{ width: '100%', height: 160, borderRadius: 10 }} aria-label="Loading secure card form" />}
      {ready ? <div className="cust-sub" style={{ fontSize: 12 }}>Card ready •••• {ready.token.slice(-4)}</div> : null}
      {error ? <div className="cust-sub" style={{ color: 'var(--customer-red)', fontSize: 12 }}>{error}</div> : null}
    </div>
  );
}
