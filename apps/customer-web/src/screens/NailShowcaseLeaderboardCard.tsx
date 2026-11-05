// NailShowcaseLeaderboardCard.tsx — one leaderboard row (rank, avatar, name, score, ❤️/💬/👎 counts, follow button).
import type { LeaderboardEntry } from '../api/customerNailShowcaseLeaderboardApi';
import { NailShowcaseRankBadge } from './NailShowcaseRankBadge';
import { CustomerFollowButton } from './CustomerFollowButton';

export function SocialAvatar({ url, name, size = 44 }: { url?: string | null; name?: string; size?: number }) {
  const initial = (name ?? '?').trim().charAt(0).toUpperCase() || '?';
  if (url) return <img src={url} alt={name ?? 'avatar'} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flex: '0 0 auto' }} />;
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--customer-primary-light, #efe7ff)', color: 'var(--customer-primary)', fontWeight: 800, fontSize: size * 0.4 }}>{initial}</div>
  );
}

export function NailShowcaseLeaderboardCard({ entry, onOpen }: { entry: LeaderboardEntry; onOpen?: (id: string) => void }) {
  return (
    <div className="cust-card" style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ fontWeight: 800, width: 30, textAlign: 'center', color: 'var(--customer-primary)' }}>#{entry.rank}</div>
      <SocialAvatar url={entry.avatarUrl} name={entry.displayName} />
      <button onClick={() => onOpen?.(entry.customerId)} style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 0, background: 'none', cursor: onOpen ? 'pointer' : 'default', padding: 0 }}>
        <div style={{ fontWeight: 700 }}>{entry.displayName}{entry.isMe ? ' (You)' : ''}</div>
        <div style={{ marginTop: 2 }}><NailShowcaseRankBadge rank={entry.rank} /></div>
        <div className="cust-sub" style={{ fontSize: 12, marginTop: 2 }}>Score: {entry.score.toLocaleString()}</div>
        <div style={{ fontSize: 12, marginTop: 2 }}>❤️ {entry.likesCount}   💬 {entry.commentsCount}   👎 {entry.dislikesCount}</div>
      </button>
      {!entry.isMe ? <CustomerFollowButton customerId={entry.customerId} following={!!entry.isFollowing} /> : null}
    </div>
  );
}
