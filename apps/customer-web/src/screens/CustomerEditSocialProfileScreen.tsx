// CustomerEditSocialProfileScreen.tsx — edit the signed-in customer's NailShowcase profile: avatar, display name, bio,
// and the "what shows on my profile" toggles. Visibility (public/private) is handled by the embedded privacy control,
// which gates going public behind the disclosure + confirm. All reads/writes go through /customer/social/me/*.
import { useEffect, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { customerSocialApi, type MySocialProfile, type ProfileVisibility } from '../api/customerSocialApi';
import { CustomerProfilePrivacySettings } from './CustomerProfilePrivacySettings';
import { CustomerBlockedAccounts } from './CustomerBlockedAccounts';
import { SocialAvatar } from './NailShowcaseLeaderboardCard';

export function CustomerEditSocialProfileScreen() {
  const nav = useNavigate();
  const [profile, setProfile] = useState<MySocialProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(''); const [bio, setBio] = useState('');
  const [showRank, setShowRank] = useState(true); const [showPosts, setShowPosts] = useState(true); const [allowFollowers, setAllowFollowers] = useState(true);
  const [saving, setSaving] = useState(false); const [saved, setSaved] = useState(false);
  const [vizBusy, setVizBusy] = useState(false); const [avatarBusy, setAvatarBusy] = useState(false);

  const hydrate = (p: MySocialProfile) => {
    setProfile(p); setName(p.publicDisplayName || ''); setBio(p.bio || '');
    setShowRank(p.showRankOnProfile); setShowPosts(p.showPostsOnProfile); setAllowFollowers(p.allowFollowers);
  };
  useEffect(() => {
    let live = true;
    customerSocialApi.myProfile().then((p) => { if (live) hydrate(p); })
      .catch((e: { message?: string }) => { if (live) setError(e?.message || 'Could not load your profile.'); });
    return () => { live = false; };
  }, []);

  const save = async () => {
    setSaving(true); setSaved(false); setError(null);
    try {
      const p = await customerSocialApi.updateMyProfile({ publicDisplayName: name.trim(), bio: bio.trim(), showRankOnProfile: showRank, showPostsOnProfile: showPosts, allowFollowers });
      hydrate(p); setSaved(true);
    } catch (e) { setError((e as { message?: string })?.message || 'Could not save.'); }
    finally { setSaving(false); }
  };
  const changeVisibility = async (v: ProfileVisibility) => {
    setVizBusy(true); setError(null);
    try { const p = await customerSocialApi.updateMyProfile({ profileVisibility: v }); hydrate(p); }
    catch (e) { setError((e as { message?: string })?.message || 'Could not update visibility.'); }
    finally { setVizBusy(false); }
  };
  const onAvatar = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setAvatarBusy(true); setError(null);
    try { await customerSocialApi.uploadAvatar(file); const p = await customerSocialApi.myProfile(); hydrate(p); }
    catch (err) { setError((err as { message?: string })?.message || 'Could not upload avatar.'); }
    finally { setAvatarBusy(false); }
  };

  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => nav(-1)} aria-label="Back" style={{ border: 0, background: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--customer-text)' }}>‹</button>
        <h1 className="cust-h1" style={{ fontSize: 20 }}>Edit NailShowcase Profile</h1>
      </div>

      {error ? <div className="cust-card" style={{ padding: 14, color: 'var(--customer-red)', background: 'var(--customer-red-light)', border: 0 }}>{error}</div> : null}
      {!profile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="cust-card" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
            <div className="cust-skel" style={{ width: 64, height: 64, borderRadius: '50%' }} />
            <div className="cust-skel" style={{ width: 120, height: 32, borderRadius: 999 }} />
          </div>
          <div className="cust-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="cust-skel" style={{ width: 100, height: 14 }} />
            <div className="cust-skel" style={{ width: '100%', height: 40, borderRadius: 12 }} />
            <div className="cust-skel" style={{ width: 40, height: 14, marginTop: 4 }} />
            <div className="cust-skel" style={{ width: '100%', height: 80, borderRadius: 12 }} />
            <div className="cust-skel" style={{ width: '100%', height: 44, borderRadius: 12, marginTop: 12 }} />
          </div>
        </div>
      ) : (
        <>
          <div className="cust-card" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
            <SocialAvatar url={profile.avatarUrl} name={name || profile.publicDisplayName || '?'} size={64} />
            <label style={{ border: '1px solid var(--customer-primary)', borderRadius: 999, padding: '8px 16px', fontWeight: 800, fontSize: 13, color: 'var(--customer-primary)', cursor: avatarBusy ? 'default' : 'pointer', opacity: avatarBusy ? 0.5 : 1 }}>
              {avatarBusy ? 'Uploading…' : 'Change photo'}
              <input type="file" accept="image/*" aria-label="Upload avatar" disabled={avatarBusy} onChange={onAvatar} style={{ display: 'none' }} />
            </label>
          </div>

          <div className="cust-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div className="cust-label">Display name</div>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="e.g. Sophia N." style={field} />
            </div>
            <div>
              <div className="cust-label">Bio</div>
              <textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={160} rows={3} placeholder="A little about your nail style (optional)" style={{ ...field, resize: 'vertical' }} />
            </div>
            <Toggle label="Show my rank on my profile" on={showRank} onChange={setShowRank} />
            <Toggle label="Show my posts on my profile" on={showPosts} onChange={setShowPosts} />
            <Toggle label="Allow other customers to follow me" on={allowFollowers} onChange={setAllowFollowers} />
            <button onClick={save} disabled={saving} style={{ border: 0, borderRadius: 12, padding: '12px 0', fontWeight: 800, fontSize: 15, background: 'var(--customer-primary)', color: '#fff', cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save profile'}</button>
            {saved ? <div className="cust-sub" style={{ fontSize: 12, color: 'var(--customer-primary)' }}>Saved.</div> : null}
          </div>

          <CustomerProfilePrivacySettings visibility={profile.profileVisibility} onUpdate={changeVisibility} busy={vizBusy} />

      {/* You could block someone and had NO screen to unblock them from — the toggle lived only on the
          profile of a person you had just made disappear. See CustomerBlockedAccounts. */}
      <CustomerBlockedAccounts />
        </>
      )}
    </div>
  );
}

const field: import('react').CSSProperties = {
  width: '100%', boxSizing: 'border-box', marginTop: 6, padding: '10px 12px', borderRadius: 12,
  border: '1px solid var(--customer-border, #e6e1ef)', fontSize: 14, fontFamily: 'inherit', background: 'var(--customer-surface, #fff)',
};

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 14 }}>{label}</div>
      <label style={{ position: 'relative', display: 'inline-block', width: 46, height: 28, flex: '0 0 auto' }}>
        <input type="checkbox" aria-label={label} checked={on} onChange={(e) => onChange(e.target.checked)} style={{ opacity: 0, width: 0, height: 0 }} />
        <span aria-hidden style={{ position: 'absolute', inset: 0, borderRadius: 999, transition: '.2s', background: on ? 'var(--customer-primary)' : 'var(--customer-border, #e6e1ef)' }} />
        <span aria-hidden style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 22, height: 22, borderRadius: 999, background: '#fff', transition: '.2s' }} />
      </label>
    </div>
  );
}
