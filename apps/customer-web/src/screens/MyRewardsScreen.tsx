// MyRewardsScreen.tsx — Customer App → My Rewards (Final Completion guide §10). English only.
// Explicit opt-in: the program terms (versioned) + a privacy link + an affirmative tick; never automatic, never inferred from
// booking SMS consent. Shows available and HELD points (held points are reserved by a checkout in progress and cannot be
// spent twice), the redemption equivalent, earning history (salon, effective rate, points, reference) and redemption
// history (salon, held / redeemed / released, ticket reference). No expiry is shown because the program has none.
// Refreshes when the screen regains focus (balance invalidation after a checkout); safe empty / offline / error states.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { centsToUsd } from '@aipowersalon/money';
import { fmtDate } from '@aipowersalon/mobile-sdk';
import { customerRewardsApi, type GlobalRewardsView } from '../api/customerRewardsApi';

const STATUS: Record<string, string> = { HELD: 'Held at checkout', CONFIRMED_REDEEMED: 'Redeemed', RELEASED: 'Released', EXPIRED: 'Released', REVERSED: 'Refunded', EARNED: 'Earned', PARTIALLY_REVERSED: 'Partly refunded' };

/** Extras · GLOBAL LOYALTY 05: which rule version applied when these points were earned (from the earn-time snapshot). */
export function ruleLabel(r: { kind: 'network' | 'salon'; versionNo: number | null } | null | undefined): string {
  if (!r) return 'Rule not recorded';
  return (r.kind === 'salon' ? "Salon's own rate" : 'Network rate') + (r.versionNo == null ? '' : ` (version ${r.versionNo})`);
}

export function MyRewardsScreen() {
  const nav = useNavigate();
  const [v, setV] = useState<GlobalRewardsView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const load = useCallback(() => { setErr(null); customerRewardsApi.mine().then(setV).catch((e: any) => setErr(typeof navigator !== 'undefined' && navigator.onLine === false ? 'You are offline. Your rewards will show when you reconnect.' : e?.message || 'Could not load your rewards.')); }, []);
  useEffect(() => { load(); const onFocus = () => load(); window.addEventListener('focus', onFocus); return () => window.removeEventListener('focus', onFocus); }, [load]);

  const join = async () => { if (!v) return; setBusy(true); setErr(null); try { await customerRewardsApi.optIn(v.terms.version); setNote('Welcome to AI PowerSalon Rewards.'); setAgree(false); load(); } catch (e: any) { setErr(e?.message || 'Could not join.'); } finally { setBusy(false); } };
  const leave = async () => { setBusy(true); setErr(null); try { const r = await customerRewardsApi.withdraw(); setNote(`You left the program. Your ${r.keptPoints} points are kept.`); setConfirmLeave(false); load(); } catch (e: any) { setErr(e?.message || 'Could not leave the program.'); } finally { setBusy(false); } };

  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }} data-testid="my-rewards">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => nav(-1)} aria-label="Back" className="customer-back"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg></button>
        <h1 className="cust-h1" style={{ fontSize: 20 }}>My Rewards</h1>
      </div>
      {note ? <div className="cust-card" role="status" style={{ padding: 14, color: '#065F46', background: '#D1FAE5', border: '1px solid #A7F3D0', fontWeight: 600 }}>{note}</div> : null}
      {err ? <div className="cust-card" role="alert" style={{ padding: 14, color: '#991B1B', background: '#FEE2E2', border: '1px solid #FECACA' }}>{err} <button onClick={load} style={{ marginLeft: 8, fontWeight: 700 }}>Try again</button></div> : null}
      {!v && !err ? <div className="cust-skel" style={{ height: 140 }} /> : null}

      {v && (v.state === 'NOT_JOINED' || v.state === 'WITHDRAWN') ? (
        <div className="cust-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }} data-testid="rewards-optin">
          <h2 className="cust-h2" style={{ fontSize: 17 }}>{v.terms.title}</h2>
          {v.state === 'WITHDRAWN' && v.account ? <div style={{ fontSize: 13 }}>You left the program. You still have <b>{v.account.availablePoints} points</b>; join again to use them.</div> : null}
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.5 }}>{v.terms.summary.map((s) => <li key={s}>{s}</li>)}</ul>
          <div style={{ fontSize: 12, color: '#6B7280' }}>Terms version {v.terms.version} · <a href={v.terms.privacyPath} onClick={(e) => { e.preventDefault(); nav(v.terms.privacyPath); }}>Privacy policy</a></div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13.5 }}><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} data-testid="rewards-agree" /> I agree to the AI PowerSalon Rewards terms (version {v.terms.version}).</label>
          <button disabled={!agree || busy || !v.program.available} onClick={() => void join()} className="cust-btn" data-testid="rewards-join">{busy ? 'Joining…' : 'Join AI PowerSalon Rewards'}</button>
          {!v.program.available ? <div style={{ fontSize: 12, color: '#6B7280' }}>The rewards program is not available at this salon yet.</div> : null}
        </div>
      ) : null}
      {v && (v.state === 'NOT_VERIFIED' || v.state === 'NO_IDENTITY') ? <div className="cust-card" style={{ padding: 16, fontSize: 14 }}>Verify your phone number to join AI PowerSalon Rewards. <button onClick={() => nav('/profile/security')} style={{ fontWeight: 700 }}>Verify now</button></div> : null}
      {v && v.state === 'SUSPENDED' ? <div className="cust-card" style={{ padding: 16, fontSize: 14 }}>Your rewards account is paused. Your points are kept. Contact the salon for help.</div> : null}

      {v && v.account && v.state !== 'NOT_JOINED' ? (
        <div className="cust-card" style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }} data-testid="rewards-balance">
          <div><div style={{ fontSize: 12, color: '#6B7280' }}>Available</div><div style={{ fontSize: 24, fontWeight: 800 }}>{v.account.availablePoints} pts</div><div style={{ fontSize: 12 }}>= {centsToUsd(v.account.redemptionValueCents)} to use</div></div>
          <div><div style={{ fontSize: 12, color: '#6B7280' }}>Held</div><div style={{ fontSize: 24, fontWeight: 800 }}>{v.account.heldPoints} pts</div><div style={{ fontSize: 12 }}>Reserved by a checkout in progress</div></div>
          <div><div style={{ fontSize: 12, color: '#6B7280' }}>Value</div><div style={{ fontSize: 15, fontWeight: 700 }}>{v.program.pointsPerRedeemBlock} points = {centsToUsd(v.program.redeemBlockValueCents)}</div><div style={{ fontSize: 12 }}>Points do not expire</div></div>
        </div>
      ) : null}

      {v && v.account && v.state !== 'NOT_JOINED' ? (
        <div className="cust-card" style={{ padding: 16 }}>
          <h2 className="cust-h2" style={{ fontSize: 16, marginBottom: 8 }}>Points earned</h2>
          {v.earned.length === 0 ? <div style={{ fontSize: 13, color: '#6B7280' }}>No points yet. You earn on what you pay at participating salons.</div> : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="rewards-earned">
              {v.earned.map((e) => <li key={e.ref} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13.5 }}><span><b>{e.salon}</b><br /><span style={{ color: '#6B7280', fontSize: 12 }}>{e.at ? fmtDate(e.at) : ''} · {e.rate} · {e.ref}</span>{e.rule || e.spendableFrom !== undefined ? <><br /><span style={{ color: '#6B7280', fontSize: 12 }} data-testid="rewards-earned-why">{ruleLabel(e.rule)}{' · '}{e.spendableFrom ? `Spendable since ${fmtDate(e.spendableFrom)}` : 'Refunded — not spendable'}</span></> : null}</span><span style={{ fontWeight: 700 }}>+{e.points}</span></li>)}
            </ul>)}
        </div>
      ) : null}
      {v && v.account && v.state !== 'NOT_JOINED' ? (
        <div className="cust-card" style={{ padding: 16 }}>
          <h2 className="cust-h2" style={{ fontSize: 16, marginBottom: 8 }}>Points used</h2>
          {v.redemptions.length === 0 ? <div style={{ fontSize: 13, color: '#6B7280' }}>You have not used points yet.</div> : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="rewards-redemptions">
              {v.redemptions.map((r) => <li key={r.ref} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13.5 }}><span><b>{r.salon}</b> · {STATUS[r.status] ?? r.status}<br /><span style={{ color: '#6B7280', fontSize: 12 }}>{r.at ? fmtDate(r.at) : ''} · {r.ticketRef}{r.reason ? ` · ${r.reason}` : ''}</span></span><span style={{ fontWeight: 700 }}>−{r.points} ({centsToUsd(r.valueCents)})</span></li>)}
            </ul>)}
        </div>
      ) : null}

      {v && v.state === 'ACTIVE' ? (
        <div style={{ fontSize: 13 }}>{!confirmLeave ? <button onClick={() => setConfirmLeave(true)} style={{ color: '#991B1B' }}>Leave AI PowerSalon Rewards</button> : (
          <div className="cust-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>Leaving stops earning and using points. Your points are kept, not erased.
            <div style={{ display: 'flex', gap: 8 }}><button onClick={() => setConfirmLeave(false)} disabled={busy}>Stay</button><button onClick={() => void leave()} disabled={busy} style={{ color: '#991B1B', fontWeight: 700 }} data-testid="rewards-leave">Leave the program</button></div></div>)}</div>
      ) : null}
    </div>
  );
}
