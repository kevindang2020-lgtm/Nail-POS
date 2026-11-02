// CustomerProfilePrivacySettings.tsx — the public/private control for a NailShowcase profile. Going public is gated:
// the customer must read the exact disclosure (NS_PUBLIC_PROFILE_WARNING) and tick the confirm box before the
// "Make Profile Public" button enables. Going private is one tap. Copy is imported from the API module so it stays in
// lockstep with the backend dto. This component is presentational — the parent owns the actual PATCH call.
import { useState, type CSSProperties } from 'react';
import {
  NS_PUBLIC_PROFILE_WARNING, NS_PUBLIC_CONFIRM_LABEL, NS_PRIVATE_PROFILE_NOTICE, type ProfileVisibility,
} from '../api/customerSocialApi';

export function CustomerProfilePrivacySettings({ visibility, onUpdate, busy }: {
  visibility: ProfileVisibility;
  onUpdate: (v: ProfileVisibility) => void | Promise<void>;
  busy?: boolean;
}) {
  const isPublic = visibility === 'public';
  const [confirmPublic, setConfirmPublic] = useState(false);

  return (
    <div className="cust-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="cust-label">Profile Visibility</div>

      <div style={{ display: 'flex', gap: 8 }}>
        <Opt active={isPublic} label="Public Profile" />
        <Opt active={!isPublic} label="Private Profile" />
      </div>

      {isPublic ? (
        <>
          <div className="cust-sub" style={{ fontSize: 13 }}>
            Your profile is public. Other customers can see your avatar, display name, NailShowcase posts, follower count, and your current ranking.
          </div>
          <button onClick={() => onUpdate('private')} disabled={busy} style={btn(false, busy)}>Make Profile Private</button>
        </>
      ) : (
        <>
          <div style={{ fontSize: 13, lineHeight: 1.5, background: 'var(--customer-primary-light, #f3eefe)', borderRadius: 12, padding: 12 }}>
            {NS_PUBLIC_PROFILE_WARNING}
          </div>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" aria-label={NS_PUBLIC_CONFIRM_LABEL} checked={confirmPublic} onChange={(e) => setConfirmPublic(e.target.checked)} style={{ marginTop: 2, width: 17, height: 17, flex: '0 0 auto' }} />
            <span style={{ fontWeight: 600 }}>{NS_PUBLIC_CONFIRM_LABEL}</span>
          </label>
          <button onClick={() => onUpdate('public')} disabled={busy || !confirmPublic} style={btn(true, busy || !confirmPublic)}>Make Profile Public</button>
          <div className="cust-sub" style={{ fontSize: 12 }}>{NS_PRIVATE_PROFILE_NOTICE}</div>
        </>
      )}
    </div>
  );
}

function Opt({ active, label }: { active: boolean; label: string }) {
  return (
    <div aria-pressed={active} style={{
      flex: 1, textAlign: 'center', borderRadius: 999, padding: '8px 0', fontWeight: 700, fontSize: 13,
      border: active ? 0 : '1px solid var(--customer-border, #e6e1ef)',
      background: active ? 'var(--customer-primary)' : 'transparent',
      color: active ? '#fff' : 'var(--customer-text-muted, #6b6b6b)',
    }}>{label}</div>
  );
}

function btn(primary: boolean, disabled?: boolean): CSSProperties {
  return {
    border: primary ? 0 : '1px solid var(--customer-primary)', borderRadius: 12, padding: '11px 0',
    fontWeight: 800, fontSize: 14, cursor: disabled ? 'default' : 'pointer',
    background: primary ? 'var(--customer-primary)' : 'transparent', color: primary ? '#fff' : 'var(--customer-primary)',
    opacity: disabled ? 0.5 : 1,
  };
}
