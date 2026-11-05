// CustomerFollowButton.tsx — toggles follow/unfollow for a customer. Manages its own optimistic-ish state and surfaces
// server errors (e.g. trying to follow a profile that just went private).
import { useState } from 'react';
import { customerFollowApi } from '../api/customerFollowApi';

export function CustomerFollowButton({ customerId, following, onChange }: { customerId: string; following: boolean; onChange?: (following: boolean, followerCount: number) => void }) {
  const [isFollowing, setIsFollowing] = useState(following);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggle = async () => {
    setBusy(true); setErr(null);
    try {
      const res = isFollowing ? await customerFollowApi.unfollow(customerId) : await customerFollowApi.follow(customerId);
      setIsFollowing(res.following);
      onChange?.(res.following, res.followerCount);
    } catch (e) { setErr((e as { message?: string })?.message || 'Could not update.'); }
    finally { setBusy(false); }
  };

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
      <button
        onClick={toggle}
        disabled={busy}
        aria-pressed={isFollowing}
        style={{
          border: isFollowing ? '1px solid var(--customer-primary)' : 0, borderRadius: 999, cursor: busy ? 'default' : 'pointer',
          background: isFollowing ? 'transparent' : 'var(--customer-primary)', color: isFollowing ? 'var(--customer-primary)' : '#fff',
          fontWeight: 800, fontSize: 13, padding: '7px 16px', opacity: busy ? 0.6 : 1,
        }}
      >{isFollowing ? 'Following' : 'Follow'}</button>
      {err ? <span style={{ color: 'var(--customer-red)', fontSize: 11 }}>{err}</span> : null}
    </span>
  );
}
