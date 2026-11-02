import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { customerApi } from '../api/customerApi';
import { money2 } from '../lib/appt';
import { useAuth } from '../auth/AuthContext';
import { exitGuestMode } from '../auth/guest';

// Claim screen — opened from a shared gift link (/gift-cards/claim?token=…). Claims the card into the signed-in
// customer's account and shows who sent it. The claimer must be signed in; the app's auth gate handles that, and on
// success the card moves to their own Gift Cards. Tokens are single-use and expire, so re-opening a used link is safe.
const MUTED = 'var(--customer-muted, #7A6C57)';
const REASON: Record<string, string> = {
  not_found: 'This gift link isn\u2019t valid. Double-check it, or ask the sender to resend.',
  expired: 'This gift link has expired. Ask the sender to send a new one.',
  claimed: 'This gift card has already been claimed.',
  revoked: 'This gift link was canceled by the sender.',
  unavailable: 'This gift card couldn\u2019t be claimed just now \u2014 it may have already been claimed.',
};

export function ClaimGiftCardScreen() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const { principal } = useAuth();
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [result, setResult] = useState<{ reference?: string; balanceCents?: number; senderName?: string; message?: string } | null>(null);
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    if (!token) { setState('error'); setReason('This gift link is missing its code.'); return; }
    if (!principal) return; // not signed in yet — the sign-in prompt below handles it; don't fire a 401
    setState('loading');
    customerApi.claimGiftCard(token).then((r) => {
      if (!live) return;
      if (r.ok) { setResult(r); setState('ok'); }
      else { setReason(REASON[r.reason || ''] || 'This gift link couldn\u2019t be claimed.'); setState('error'); }
    }).catch((e: any) => { if (live) { setReason(e?.message || 'Something went wrong claiming this gift. Make sure you\u2019re signed in and try again.'); setState('error'); } });
    return () => { live = false; };
  }, [token, principal]);

  // Opened by someone who isn't signed in (a guest tapped the shared link). Rather than a raw error, invite them to
  // sign in or create a free account; the app's auth gate preserves this URL, so the claim runs the moment they're in.
  if (token && !principal) {
    return (
      <div className="cust-page">
        <h1 className="cust-h1">Claim your gift</h1>
        <div className="cust-hero" style={{ background: 'linear-gradient(135deg, #2A2118, #5A4326 55%, #A96F22)' }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Someone sent you a gift card!</div>
          <div style={{ fontSize: 12.5, opacity: 0.9, marginTop: 6 }}>Sign in or create your free account to add it to your wallet \u2014 it only takes a minute.</div>
        </div>
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button onClick={() => { exitGuestMode(); window.location.reload(); }} style={{ background: 'var(--customer-accent, #A96F22)', color: '#fff', border: 0, borderRadius: 10, padding: '11px 20px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Sign in to claim</button>
        </div>
      </div>
    );
  }

  return (
    <div className="cust-page">
      <h1 className="cust-h1">Claim your gift</h1>
      {state === 'loading' && (
        <div className="cust-hero" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="cust-skel" style={{ width: 140, height: 16 }} />
          <div className="cust-skel" style={{ width: 100, height: 34 }} />
          <div className="cust-skel" style={{ width: 80, height: 14 }} />
        </div>
      )}
      {state === 'ok' && result && (
        <>
          <div className="cust-hero" style={{ background: 'linear-gradient(135deg, #2A2118, #5A4326 55%, #A96F22)' }}>
            <div style={{ fontSize: 13, opacity: 0.85 }}>{result.senderName ? `${result.senderName} sent you a gift card` : 'You received a gift card'}</div>
            <div style={{ fontSize: 32, fontWeight: 800, marginTop: 4 }}>{money2(result.balanceCents || 0)}</div>
            <div style={{ fontSize: 12.5, opacity: 0.85, marginTop: 4 }}>{result.reference}</div>
            {result.message && <div style={{ fontSize: 13, opacity: 0.95, marginTop: 10, fontStyle: 'italic' }}>{'\u201c'}{result.message}{'\u201d'}</div>}
          </div>
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <div style={{ color: MUTED, fontSize: 13 }}>It{'\u2019'}s in your account now {'\u2014'} use it at the salon anytime.</div>
            <Link to="/gift-cards" style={{ display: 'inline-block', marginTop: 12, background: 'var(--customer-accent, #A96F22)', color: '#fff', borderRadius: 10, padding: '10px 18px', fontWeight: 700, fontSize: 14, textDecoration: 'none' }}>View my gift cards</Link>
          </div>
        </>
      )}
      {state === 'error' && (
        <div className="cust-card" style={{ padding: 18, textAlign: 'center', marginTop: 12 }}>
          <div style={{ fontSize: 14 }}>{reason}</div>
          <Link to="/gift-cards" style={{ display: 'inline-block', marginTop: 12, color: 'var(--customer-accent, #A96F22)', fontWeight: 600, fontSize: 14, textDecoration: 'none' }}>Go to my gift cards</Link>
        </div>
      )}
    </div>
  );
}
