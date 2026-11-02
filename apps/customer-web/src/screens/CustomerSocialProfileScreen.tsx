// CustomerSocialProfileScreen.tsx — view a NailShowcase social profile. Mounted at /social/me (own, via myProfile) and
// /social/profile/:customerId (anyone, via profile). Privacy is server-enforced: a private profile returns no details to
// others, so this screen shows "This profile is private." Public profiles show avatar, name, bio, rank, score, follower/
// following counts, the post grid, and a Follow button. Never renders phone/email/receipts/etc. — those aren't returned.
import { useEffect, useState, useCallback, type CSSProperties, type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  customerSocialApi, type MySocialProfile, type PublicSocialProfile,
  NS_PRIVATE_OTHER_PROFILE_NOTICE, NS_PRIVATE_OWN_PROFILE_NOTICE,
} from '../api/customerSocialApi';
import { SocialAvatar } from './NailShowcaseLeaderboardCard';
import { rankTier } from './NailShowcaseRankBadge';
import { CustomerFollowButton } from './CustomerFollowButton';
import { customerFollowApi } from '../api/customerFollowApi';
import { NailShowcaseProfilePostGrid } from './NailShowcaseProfilePostGrid';

type ProfileView = {
  customerId: string; isMine: boolean; isPrivate: boolean; isBlockedByMe?: boolean;
  name: string; avatarUrl?: string | null; bio?: string | null;
  rank?: number | null; score?: number; followerCount?: number; followingCount?: number;
  isFollowing?: boolean; allowFollowers?: boolean; showPosts?: boolean; showRank?: boolean;
};

const mineToView = (m: MySocialProfile): ProfileView => ({
  customerId: m.customerId, isMine: true, isPrivate: !m.isPublicProfile,
  name: m.publicDisplayName || 'You', avatarUrl: m.avatarUrl, bio: m.bio,
  rank: m.rank, score: m.score, followerCount: m.followerCount, followingCount: m.followingCount,
  isFollowing: false, allowFollowers: m.allowFollowers, showPosts: m.showPostsOnProfile, showRank: m.showRankOnProfile,
});
const pubToView = (p: PublicSocialProfile): ProfileView => ({
  customerId: p.customerId, isMine: !!p.isMine, isPrivate: !!p.isPrivate, isBlockedByMe: !!p.isBlockedByMe,
  name: p.displayName || 'NailShowcase Member', avatarUrl: p.avatarUrl, bio: p.bio,
  rank: p.rank, score: p.score, followerCount: p.followerCount, followingCount: p.followingCount,
  isFollowing: p.isFollowing, allowFollowers: p.allowFollowers, showPosts: p.showPostsOnProfile !== false, showRank: p.showRankOnProfile !== false,
});

export function CustomerSocialProfileScreen() {
  const nav = useNavigate();
  const { customerId } = useParams();
  const [view, setView] = useState<ProfileView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setView(null); setError(null);
    let live = true;
    const req = customerId
      ? customerSocialApi.profile(customerId).then(pubToView)
      : customerSocialApi.myProfile().then(mineToView);
    req.then((v) => { if (live) setView(v); })
      .catch((e: { message?: string }) => { if (live) setError(e?.message || 'Could not load this profile.'); });
    return () => { live = false; };
  }, [customerId]);
  useEffect(() => load(), [load]);

  const back = (
    <button onClick={() => nav(-1)} aria-label="Back" style={{ border: 0, background: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--customer-text)' }}>‹</button>
  );

  if (error) return <Shell back={back}><div className="cust-card" style={{ padding: 14, color: 'var(--customer-red)', background: 'var(--customer-red-light)', border: 0 }}>{error}</div></Shell>;
  if (!view) return (
    <Shell back={back}>
      <div className="cust-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div className="cust-skel" style={{ width: 72, height: 72, borderRadius: '50%' }} />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="cust-skel" style={{ width: 140, height: 20 }} />
            <div className="cust-skel" style={{ width: 180, height: 16 }} />
          </div>
        </div>
        <div className="cust-skel" style={{ width: '100%', height: 14, marginTop: 4 }} />
        <div className="cust-skel" style={{ width: '60%', height: 14 }} />
        <div style={{ display: 'flex', gap: 18, marginTop: 8 }}>
          <div className="cust-skel" style={{ width: 80, height: 20 }} />
          <div className="cust-skel" style={{ width: 80, height: 20 }} />
        </div>
      </div>
    </Shell>
  );

  // Private profile, viewed by someone else → no details at all.
  if (view.isPrivate && !view.isMine) {
    return (
      <Shell back={back}>
        <div className="cust-card" style={{ padding: 28, textAlign: 'center' }}>
          <div aria-hidden style={{ fontSize: 30 }}>🔒</div>
          <h2 className="cust-h2" style={{ marginTop: 8 }}>{NS_PRIVATE_OTHER_PROFILE_NOTICE}</h2>
        </div>
      </Shell>
    );
  }

  const tier = view.showRank ? rankTier(view.rank) : null;
  return (
    <Shell back={back}>
      <div className="cust-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <SocialAvatar url={view.avatarUrl} name={view.name} size={72} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 18 }}>{view.name}{view.isMine ? ' (You)' : ''}</div>
            {view.showRank && view.rank ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <span style={{ fontWeight: 800, color: 'var(--customer-primary)' }}>#{view.rank}</span>
                {tier ? <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: 'var(--customer-primary)', borderRadius: 999, padding: '2px 8px' }}>{tier}</span> : null}
                <span className="cust-sub" style={{ fontSize: 13 }}>Score: {(view.score ?? 0).toLocaleString()}</span>
              </div>
            ) : null}
          </div>
        </div>

        {view.bio ? <div style={{ fontSize: 14, lineHeight: 1.5 }}>{view.bio}</div> : null}

        <div style={{ display: 'flex', gap: 18 }}>
          <button onClick={() => nav(`/social/profile/${view.customerId}/followers`)} style={statBtn}>
            <strong>{(view.followerCount ?? 0).toLocaleString()}</strong> <span className="cust-sub">Followers</span>
          </button>
          <button onClick={() => nav(`/social/profile/${view.customerId}/following`)} style={statBtn}>
            <strong>{(view.followingCount ?? 0).toLocaleString()}</strong> <span className="cust-sub">Following</span>
          </button>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {view.isMine
            ? <button onClick={() => nav('/social/edit')} style={{ flex: 1, border: '1px solid var(--customer-primary)', borderRadius: 12, padding: '10px 0', fontWeight: 800, fontSize: 14, background: 'transparent', color: 'var(--customer-primary)', cursor: 'pointer' }}>Edit profile</button>
            : view.isBlockedByMe
              ? <div style={{ flex: 1, textAlign: 'center', fontWeight: 700, fontSize: 14, color: 'var(--customer-text-muted, #6b6b6b)' }}>You blocked this customer</div>
              : view.allowFollowers !== false
                ? <CustomerFollowButton customerId={view.customerId} following={!!view.isFollowing} />
                : null}
          {!view.isMine ? (
            view.isBlockedByMe
              ? <button onClick={() => toggleBlock(view.customerId, true, load, setError)} style={linkBtn}>Unblock</button>
              : (
                <>
                  <button onClick={() => reportProfile(view.customerId, setError)} style={linkBtn}>Report</button>
                  <button onClick={() => toggleBlock(view.customerId, false, load, setError)} style={linkBtn}>Block</button>
                </>
              )
          ) : null}
        </div>
      </div>

      {view.isMine && view.isPrivate ? (
        <div className="cust-card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 700 }}>{NS_PRIVATE_OWN_PROFILE_NOTICE}</div>
          <button onClick={() => nav('/social/edit')} style={{ marginTop: 10, border: 0, borderRadius: 12, padding: '10px 16px', fontWeight: 800, background: 'var(--customer-primary)', color: '#fff', cursor: 'pointer' }}>Profile Visibility</button>
        </div>
      ) : view.showPosts !== false ? (
        <>
          <div className="cust-label">NailShowcase Posts</div>
          <NailShowcaseProfilePostGrid customerId={view.customerId} />
        </>
      ) : null}
    </Shell>
  );
}

async function reportProfile(customerId: string, setError: (s: string | null) => void) {
  try { await customerSocialApi.report(customerId, 'inappropriate'); setError('Thanks — this profile was reported for review.'); }
  catch (e) { setError((e as { message?: string })?.message || 'Could not submit report.'); }
}

async function toggleBlock(customerId: string, currentlyBlocked: boolean, reload: () => void, setError: (s: string | null) => void) {
  try {
    if (currentlyBlocked) await customerFollowApi.unblock(customerId);
    else await customerFollowApi.block(customerId);
    reload();
  } catch (e) { setError((e as { message?: string })?.message || 'Could not update block status.'); }
}

const linkBtn: CSSProperties = { border: 0, background: 'none', color: 'var(--customer-text-muted, #6b6b6b)', fontSize: 13, cursor: 'pointer', textDecoration: 'underline' };

const statBtn: CSSProperties = { border: 0, background: 'none', padding: 0, cursor: 'pointer', fontSize: 14 };

function Shell({ back, children }: { back: ReactNode; children: ReactNode }) {
  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>{back}<h1 className="cust-h1" style={{ fontSize: 20 }}>Profile</h1></div>
      {children}
    </div>
  );
}
