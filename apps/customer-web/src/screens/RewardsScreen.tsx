import { useEffect, useState } from 'react';
import { customerApi, type CustomerLoyaltySummary, type RewardsView } from '../api/customerApi';
import { isGuest, exitGuestMode } from '../auth/guest';

// Rewards — real loyalty (points, tier, progress) plus a redeemable rewards catalog from /customer/rewards. Redeeming
// deducts points server-side (atomic) and returns a code to show at the salon. No fabricated values or fake rewards.
export function RewardsScreen() {
  // A guest has no loyalty account: nothing is fetched and no points / tier are shown — only the sign-in invitation.
  const guest = isGuest();
  const [l, setL] = useState<CustomerLoyaltySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rw, setRw] = useState<RewardsView | null>(null);
  const [redeemingId, setRedeemingId] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [redeemErr, setRedeemErr] = useState<string | null>(null);

  useEffect(() => { if (guest) return; let live = true; customerApi.loyalty().then((d) => live && setL(d)).catch((e: any) => live && setError(e?.message || 'Could not load rewards.')); return () => { live = false; }; }, [guest]);
  const loadRewards = () => customerApi.rewards().then(setRw).catch(() => {});
  useEffect(() => { if (guest) return; let live = true; customerApi.rewards().then((d) => live && setRw(d)).catch(() => {}); return () => { live = false; }; }, [guest]);

  const redeem = async (id: string) => {
    setRedeemingId(id); setRedeemErr(null); setCode(null);
    try {
      const r = await customerApi.redeemReward(id);
      if (r.ok) { setCode(r.code || null); await loadRewards(); customerApi.loyalty().then(setL).catch(() => {}); }
      else setRedeemErr(r.message || 'Could not redeem this reward.');
    } catch (e: any) { setRedeemErr(e?.message || 'Could not redeem this reward.'); }
    finally { setRedeemingId(null); }
  };

  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 className="cust-h1">Rewards</h1>

      {guest ? (
        <div style={{
          background: 'linear-gradient(135deg, #FFFDF8 0%, #F9F1E2 100%)',
          border: '1px solid #E7DCC9',
          borderRadius: 16,
          padding: '16px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          boxShadow: '0 4px 14px rgba(42,33,24,0.04)'
        }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: '#2A2118' }}>Unlock Loyalty Perks &amp; Rewards</div>
            <div style={{ fontSize: 13, color: '#70604E', marginTop: 4, lineHeight: 1.45 }}>
              Sign in or create your account to earn points on every treatment, level up tiers, and redeem exclusive discounts.
            </div>
          </div>
          <button
            type="button"
            onClick={() => exitGuestMode()}
            style={{
              height: 44,
              borderRadius: 12,
              border: 'none',
              background: 'linear-gradient(180deg, #C9971B 0%, #A96F22 100%)',
              color: '#fff',
              fontWeight: 700,
              fontSize: 14,
              cursor: 'pointer',
              boxShadow: '0 2px 10px rgba(169,111,34,.25)',
              alignSelf: 'flex-start',
              padding: '0 20px',
            }}>
            Sign In or Register
          </button>
        </div>
      ) : error ? <div className="cust-card" style={{ padding: 16, color: 'var(--customer-red)', background: 'var(--customer-red-light)', border: 0 }}>{error}</div>
        : !l ? (
          <>
            <div className="cust-hero" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="cust-skel" style={{ width: 100, height: 16 }} />
              <div className="cust-skel" style={{ width: 140, height: 34 }} />
              <div className="cust-skel" style={{ width: 120, height: 18 }} />
              <div className="cust-skel" style={{ width: '100%', height: 14, marginTop: 8 }} />
              <div className="cust-skel" style={{ width: 160, height: 14 }} />
            </div>
            <div>
              <h2 className="cust-h2" style={{ marginBottom: 10 }}>Redeem your points</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[1, 2, 3].map(i => (
                  <div key={i} className="cust-card" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div className="cust-skel" style={{ width: 140, height: 16 }} />
                      <div className="cust-skel" style={{ width: 180, height: 14 }} />
                      <div className="cust-skel" style={{ width: 80, height: 14 }} />
                    </div>
                    <div className="cust-skel" style={{ width: 80, height: 42, borderRadius: 12 }} />
                  </div>
                ))}
              </div>
            </div>
            <div className="cust-card" style={{ padding: 16 }}>
              <h2 className="cust-h2">How you earn</h2>
              <div className="cust-sub" style={{ marginTop: 6 }}>Earn loyalty points on every visit and redeem them on future services. Your tier and rewards follow this salon’s loyalty program.</div>
            </div>
          </>
        )
        : (<>
          <div className="cust-hero">
            <div style={{ opacity: 0.85, fontSize: 13, fontWeight: 600 }}>Loyalty Points</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 2 }}><span style={{ fontSize: 34, fontWeight: 800 }}>{l.points.toLocaleString('en-US')}</span><span style={{ opacity: 0.85 }}>pts</span></div>
            <div style={{ fontWeight: 700, marginTop: 4 }}>{l.tier} Member</div>
            {l.nextTier ? (<div style={{ marginTop: 12 }}><div className="cust-progress"><span style={{ width: `${Math.max(2, Math.min(100, l.progressPercent))}%` }} /></div><div style={{ opacity: 0.9, fontSize: 12.5, marginTop: 6 }}>{l.pointsToNextTier.toLocaleString('en-US')} pts to {l.nextTier}</div></div>) : <div style={{ opacity: 0.9, fontSize: 12.5, marginTop: 10 }}>You’ve reached the top tier 🎉</div>}
          </div>

          {code ? (
            <div className="cust-card" style={{ padding: 16, background: 'var(--customer-green-light)', border: 0 }}>
              <div style={{ fontWeight: 800 }}>Reward redeemed 🎉</div>
              <div className="cust-sub" style={{ marginTop: 4 }}>Show this code at the salon:</div>
              <div style={{ marginTop: 8, fontWeight: 800, fontSize: 22, letterSpacing: 1, color: '#0E8A63' }}>{code}</div>
            </div>
          ) : null}

          <div>
            <h2 className="cust-h2" style={{ marginBottom: 10 }}>Redeem your points</h2>
            {redeemErr ? <div className="cust-sub" style={{ color: 'var(--customer-red)', marginBottom: 10 }}>{redeemErr}</div> : null}
            {!rw ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {[1, 2, 3].map(i => (
                    <div key={i} className="cust-card" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div className="cust-skel" style={{ width: 140, height: 16 }} />
                        <div className="cust-skel" style={{ width: 180, height: 14 }} />
                        <div className="cust-skel" style={{ width: 80, height: 14 }} />
                      </div>
                      <div className="cust-skel" style={{ width: 80, height: 42, borderRadius: 12 }} />
                    </div>
                  ))}
                </div>
              )
              : rw.rewards.length === 0 ? <div className="cust-card" style={{ padding: 20, textAlign: 'center' }}><div className="cust-sub">No rewards available yet — check back soon.</div></div>
              : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {rw.rewards.map((r) => (
                    <div key={r.id} className="cust-card" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700 }}>{r.title}</div>
                        {r.description ? <div className="cust-sub" style={{ fontSize: 13, marginTop: 2 }}>{r.description}</div> : null}
                        {(r as any).valueLabel ? <div style={{ fontSize: 13, marginTop: 2, fontWeight: 700 }}>{(r as any).valueLabel} at checkout{(r as any).validDays ? ` · code valid ${(r as any).validDays} days` : ''}</div> : null}
                        <div style={{ marginTop: 6, fontWeight: 800, color: 'var(--customer-primary)', fontSize: 14 }}>{r.pointsCost.toLocaleString('en-US')} pts</div>
                      </div>
                      <button onClick={() => redeem(r.id)} disabled={!r.affordable || redeemingId === r.id}
                        className="cust-btn" style={{ width: 'auto', height: 42, padding: '0 18px', opacity: !r.affordable || redeemingId === r.id ? 0.5 : 1, cursor: !r.affordable ? 'not-allowed' : 'pointer' }}>
                        {redeemingId === r.id ? '…' : r.affordable ? 'Redeem' : 'Locked'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
          </div>

          <div className="cust-card" style={{ padding: 16 }}>
            <h2 className="cust-h2">How you earn</h2>
            <div className="cust-sub" style={{ marginTop: 6 }}>Earn loyalty points on every visit and redeem them on future services. Your tier and rewards follow this salon’s loyalty program.</div>
          </div>
        </>)}
    </div>
  );
}
