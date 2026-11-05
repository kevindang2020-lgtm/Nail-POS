import { useCallback, useEffect, useState } from 'react';
import { customerFollowApi, type BlockedAccount } from '../api/customerFollowApi';

// CustomerBlockedAccounts — the list you needed in order to UNDO a block.
//
// == THE BUG THIS CLOSES ==================================================================================
//
// The social API has all three:
//
//     block(customerId)     POST   /customer/social/block/:id     — wired, on the profile screen
//     unblock(customerId)   DELETE /customer/social/block/:id     — wired, on the profile screen
//     blocked()             GET    /customer/social/me/blocked    — EXISTED. NO SCREEN CALLED IT.
//
// Both halves of the toggle live on the OTHER PERSON'S PROFILE SCREEN. Which is fine right up until you use it —
// because the point of blocking somebody is that you stop seeing them. To unblock, you had to navigate back to
// the profile of a person you had just made disappear.
//
// There was no blocked-accounts list anywhere in the app. So a block was, from the user's side, a one-way door:
// tap it once by accident and there is no screen that will ever show you what you did or let you take it back.
//
// A privacy control with no way to review or reverse it is not a privacy control. It is a trap.

export function CustomerBlockedAccounts() {
  const [rows, setRows] = useState<BlockedAccount[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    customerFollowApi.blocked()
      .then((r) => { setRows(r?.entries ?? []); setErr(null); })
      .catch((e: any) => setErr(e?.message || 'Couldn’t load your blocked accounts.'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const unblock = async (b: BlockedAccount) => {
    setBusy(b.customerId); setErr(null);
    try { await customerFollowApi.unblock(b.customerId); load(); }
    catch (e: any) { setErr(e?.message || 'Couldn’t unblock that account.'); }
    finally { setBusy(null); }
  };

  return (
    <div className="cust-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="cust-label">Blocked accounts</div>
      <div className="cust-sub" style={{ fontSize: 13, lineHeight: 1.5 }}>
        People you’ve blocked can’t see your profile or follow you. Unblock anyone here.
      </div>

      {err ? <div style={{ fontSize: 12.5, color: '#B3403C' }}>{err}</div> : null}

      {rows === null ? (
        <div className="cust-sub" style={{ fontSize: 13 }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div className="cust-sub" style={{ fontSize: 13 }}>You haven’t blocked anyone.</div>
      ) : (
        rows.map((b) => (
          <div key={b.customerId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid #EFE7DA' }}>
            {b.avatarUrl
              ? <img src={b.avatarUrl} alt="" width={34} height={34} style={{ borderRadius: 999, objectFit: 'cover' }} />
              : <div style={{ width: 34, height: 34, borderRadius: 999, background: '#F3EADB' }} />}
            <span style={{ fontSize: 14 }}>{b.displayName}</span>
            <button
              onClick={() => unblock(b)}
              disabled={busy === b.customerId}
              style={{
                marginLeft: 'auto', padding: '6px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 600,
                border: '1px solid #A96F22', background: 'transparent', color: '#A96F22',
                cursor: busy === b.customerId ? 'default' : 'pointer',
              }}
            >
              {busy === b.customerId ? 'Unblocking…' : 'Unblock'}
            </button>
          </div>
        ))
      )}
    </div>
  );
}
