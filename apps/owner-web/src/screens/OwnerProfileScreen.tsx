import { useEffect, useState, type CSSProperties } from 'react';
import { useInlineConfirm } from '../components/InlineConfirm';
import { useOwnerNav } from '../shell/nav';
import { useAuth } from '../auth/AuthContext';
import {
  ownerMoreApi,
  ownerContextApi,
  ownerSecurityApi,
  type OwnerProfileCard,
  type OwnerContextResponse,
} from '../api/ownerApi';
import {
  FiMail,
  FiPhone,
  FiGlobe,
  FiClock,
  FiShield,
  FiChevronRight,
  FiMapPin,
  FiFileText,
  FiKey,
  FiCheck,
  FiCamera,
} from 'react-icons/fi';
import { OwnerSkeletonList } from '../components/OwnerSkeleton';

const initials = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || 'O';

const inputStyle: CSSProperties = {
  width: '100%',
  height: 46,
  borderRadius: 12,
  border: '1px solid var(--owner-border)',
  background: 'var(--owner-surface)',
  padding: '0 14px',
  font: 'inherit',
  marginTop: 8,
};

function OwnerAccessCodeCard() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [curPw, setCurPw] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    ownerSecurityApi
      .status()
      .then((s) => {
        if (alive) setConfigured(s.accessCodeConfigured);
      })
      .catch(() => {
        if (alive) setConfigured(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const save = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await ownerSecurityApi.setAccessCode(curPw, code);
      setConfigured(r.configured);
      setMsg(
        r.configured
          ? 'Owner Access Code updated.'
          : 'Owner Access Code removed.'
      );
      setCurPw('');
      setCode('');
      setOpen(false);
    } catch (e: any) {
      setErr(e?.message || 'Could not update the Owner Access Code.');
    } finally {
      setBusy(false);
    }
  };

  const saveLabel = code.trim()
    ? configured
      ? 'Update code'
      : 'Set code'
    : configured
      ? 'Remove code'
      : 'Save';

  return (
    <div className="owner-menu-card" style={{ marginBottom: 12 }}>
      <button
        className="owner-menurow"
        onClick={() => {
          setOpen((o) => !o);
          setErr(null);
        }}
      >
        <span className="owner-menu-icon">
          <FiKey />
        </span>
        <div className="owner-menu-content">
          <span className="ml">Owner Access Code</span>
          <span className="owner-menu-subtitle">
            Optional sign-in security factor
          </span>
        </div>
        <span className="owner-pill">
          {configured === null ? '—' : configured ? 'On' : 'Off'}
        </span>
        <FiChevronRight
          className="owner-menu-chevron"
          style={{
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform 0.2s',
          }}
        />
      </button>

      {open && (
        <div style={{ padding: '4px 16px 16px', borderTop: '1px solid var(--owner-border-subtle)' }}>
          <div
            className="owner-text-muted"
            style={{ fontSize: 12.5, marginBottom: 8, marginTop: 4 }}
          >
            An optional code asked for at owner sign-in, on top of your
            password. Leave the new code blank to remove it.
          </div>
          <input
            type="password"
            placeholder="Current password"
            value={curPw}
            autoComplete="current-password"
            onChange={(e) => setCurPw(e.target.value)}
            style={inputStyle}
            aria-label="Current password"
          />
          <input
            type="text"
            placeholder={configured ? 'New code (blank to remove)' : 'New code'}
            value={code}
            autoComplete="off"
            autoCapitalize="characters"
            onChange={(e) => setCode(e.target.value)}
            style={inputStyle}
            aria-label="New Owner Access Code"
          />
          {err && (
            <div
              style={{ color: 'var(--owner-danger)', fontSize: 13, marginTop: 8 }}
              role="alert"
            >
              {err}
            </div>
          )}
          <button
            className="owner-btn"
            disabled={busy || !curPw}
            onClick={save}
            style={{ marginTop: 12, width: '100%' }}
          >
            {busy ? 'Saving\u2026' : saveLabel}
          </button>
        </div>
      )}
      {!open && msg && (
        <div
          style={{
            padding: '0 16px 12px',
            color: 'var(--owner-success)',
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
          role="status"
        >
          <FiCheck size={14} /> {msg}
        </div>
      )}
    </div>
  );
}


export function OwnerProfileScreen() {
  const { back, openAudit } = useOwnerNav();
  const { logout } = useAuth();
  const [profile, setProfile] = useState<OwnerProfileCard | null>(null);
  const [ctx, setCtx] = useState<OwnerContextResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([ownerMoreApi.profile(), ownerContextApi.context()])
      .then(([p, c]) => {
        if (!alive) return;
        setProfile(p);
        setCtx(c);
        setLoading(false);
      })
      .catch((e: any) => {
        if (!alive) return;
        setError(e?.message || 'Could not load your profile.');
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const { confirmUi } = useInlineConfirm();
  const branches = ctx?.allowedBranches ?? [];
  const primaryId = ctx?.defaultBranchId;

  return (
    <>
      {confirmUi}
      <header className="owner-header">
        <button className="owner-back" aria-label="Back" onClick={back}>
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--owner-text)"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div className="owner-greet" style={{ textAlign: 'center' }}>
          <div
            className="n owner-serif"
            style={{ cursor: 'default', justifyContent: 'center' }}
          >
            Profile &amp; Account
          </div>
        </div>
        <div style={{ width: 40 }} />
      </header>

      {error && (
        <div className="owner-state" role="alert" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

        <div className="owner-menu" style={{ paddingBottom: 32 }}>
          {/* User Hero Card */}
          <div
            className="owner-menu-card owner-profilecard"
            style={{
              padding: 20,
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              marginBottom: 16,
              background: 'linear-gradient(135deg, var(--owner-surface) 0%, rgba(212, 175, 55, 0.05) 100%)',
              border: '1px solid var(--owner-border-gold, var(--owner-border))',
            }}
          >
            {loading ? (
              <>
                <div className="owner-skel" style={{ width: 56, height: 56, borderRadius: '50%', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div className="owner-skel" style={{ width: 140, height: 18, marginBottom: 6 }} />
                  <div className="owner-skel" style={{ width: 100, height: 13, marginBottom: 6 }} />
                  <div className="owner-skel" style={{ width: 60, height: 16, borderRadius: 12 }} />
                </div>
              </>
            ) : (
              <>
                <label style={{ position: 'relative', cursor: 'pointer', display: 'block', flexShrink: 0 }}>
                  {profile?.avatarUrl ? (
                    <img src={profile.avatarUrl} style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover', display: 'block', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }} alt="Avatar" />
                  ) : (
                    <div
                      className="av"
                      style={{
                        width: 56,
                        height: 56,
                        borderRadius: '50%',
                        background: 'linear-gradient(135deg, var(--owner-primary, #d4af37) 0%, #b8860b 100%)',
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 20,
                        fontWeight: 700,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                        flexShrink: 0,
                      }}
                    >
                      {initials(profile?.fullName ?? 'Owner')}
                    </div>
                  )}
                  <div style={{ position: 'absolute', bottom: -4, right: -4, background: '#fff', borderRadius: '50%', padding: 4, boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
                    <FiCamera size={12} color="var(--owner-primary, #b8860b)" />
                  </div>
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={async (e) => {
                     const f = e.target.files?.[0];
                    if (f) {
                       try {
                         const res = await ownerMoreApi.uploadAvatar(f);
                         setProfile(p => p ? { ...p, avatarUrl: res.url } : p);
                         window.dispatchEvent(new CustomEvent('owner-avatar-updated', { detail: res.url }));
                       } catch(err: any) {
                         alert(err.message || 'Failed to upload image');
                       }
                    }
                  }} />
                </label>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    className="nm"
                    style={{
                      fontSize: 18,
                      fontWeight: 700,
                      color: 'var(--owner-text)',
                      lineHeight: 1.2,
                      marginBottom: 2,
                    }}
                  >
                    {profile?.fullName ?? 'Owner'}
                  </div>
                  <div
                    className="bz"
                    style={{
                      fontSize: 13,
                      color: 'var(--owner-text-secondary)',
                      fontWeight: 500,
                      marginBottom: 6,
                    }}
                  >
                    {profile?.businessName ?? '—'}
                  </div>
                  <span
                    className="rl"
                    style={{
                      display: 'inline-block',
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 12,
                      background: 'rgba(212, 175, 55, 0.15)',
                      color: 'var(--owner-primary, #b8860b)',
                      letterSpacing: 0.5,
                      textTransform: 'uppercase',
                    }}
                  >
                    {(profile?.role ?? 'OWNER').replace('_', ' ')}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Account Details Section */}
          <section className="owner-menu-section">
            <div className="owner-menu-section-head">
              <h6>ACCOUNT DETAILS</h6>
              <p>Personal profile &amp; tenant information</p>
            </div>

            <div className="owner-menu-card">
              <div className="owner-settingspanel" style={{ borderTop: 'none', gridTemplateColumns: '1fr' }}>
                <div>
                  <div className="k" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <FiMail size={13} style={{ opacity: 0.7 }} /> Email
                  </div>
                  <div className="v">{loading ? <div className="owner-skel" style={{ width: 140, height: 14, display: 'inline-block' }} /> : (profile?.email ?? '—')}</div>
                </div>

                <div className="owner-sechead" style={{ marginTop: 18 }}><div className="h">Security</div><div className="d" /></div>
                <OwnerAccessCodeCard />
                <div>
                  <div className="k" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <FiPhone size={13} style={{ opacity: 0.7 }} /> Phone
                  </div>
                  <div className="v">{loading ? <div className="owner-skel" style={{ width: 100, height: 14, display: 'inline-block' }} /> : (profile?.phone ?? '—')}</div>
                </div>

                <div>
                  <div className="k" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <FiGlobe size={13} style={{ opacity: 0.7 }} /> Currency
                  </div>
                  <div className="v">{loading ? <div className="owner-skel" style={{ width: 60, height: 14, display: 'inline-block' }} /> : (profile?.currency ?? '—')}</div>
                </div>

                <div>
                  <div className="k" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <FiClock size={13} style={{ opacity: 0.7 }} /> Time Zone
                  </div>
                  <div className="v">{loading ? <div className="owner-skel" style={{ width: 80, height: 14, display: 'inline-block' }} /> : (profile?.timezone ?? '—')}</div>
                </div>

                <div>
                  <div className="k" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <FiShield size={13} style={{ opacity: 0.7 }} /> Tenant ID
                  </div>
                  <div className="v" style={{ fontSize: 12, wordBreak: 'break-all', fontFamily: 'monospace' }}>
                    {loading ? <div className="owner-skel" style={{ width: 160, height: 14, display: 'inline-block' }} /> : (profile?.tenantId ?? '—')}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Multi-Location Access Section */}
          <section className="owner-menu-section">
            <div className="owner-menu-section-head">
              <h6>Multi-Location Access</h6>
              <p>{branches.length} branch{branches.length === 1 ? '' : 'es'} with active authorization</p>
            </div>

            <div className="owner-menu-card">
              {loading ? (
                <div style={{ padding: 12 }}>
                  <OwnerSkeletonList count={2} />
                </div>
              ) : branches.length === 0 ? (
                <div className="owner-state" style={{ padding: 16 }}>No branches assigned.</div>
              ) : (
                branches.map((b) => (
                  <div
                    className="owner-menurow"
                    key={b.branchId}
                    style={{ cursor: 'default' }}
                  >
                    <span className="owner-menu-icon">
                      <FiMapPin />
                    </span>
                    <div className="owner-menu-content">
                      <span className="ml">
                        {b.branchName || b.salonName}
                        {b.city || b.state ? (
                          <span className="owner-text-muted" style={{ fontWeight: 500 }}>
                            {' '}· {[b.city, b.state].filter(Boolean).join(', ')}
                          </span>
                        ) : null}
                      </span>
                    </div>

                    {b.branchId === primaryId ? (
                      <span className="owner-pill">Primary</span>
                    ) : b.accessLevel !== 'owner' ? (
                      <span
                        className="owner-pill"
                        style={{ textTransform: 'capitalize' }}
                      >
                        {b.accessLevel.replace('_', ' ')}
                      </span>
                    ) : (
                      <span />
                    )}
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Security & Audit Section */}
          <section className="owner-menu-section">
            <div className="owner-menu-section-head">
              <h6> AUDIT</h6>
              <p>Account access control and system logs</p>
            </div>



            <div className="owner-menu-card">
              <button className="owner-menurow" onClick={openAudit}>
                <span className="owner-menu-icon">
                  <FiFileText />
                </span>
                <div className="owner-menu-content">
                  <span className="ml">Audit History</span>
                  <span className="owner-menu-subtitle">
                    View account activity &amp; audit trails
                  </span>
                </div>
                <FiChevronRight className="owner-menu-chevron" />
              </button>
            </div>
          </section>
        </div>
    </>
  );
}
