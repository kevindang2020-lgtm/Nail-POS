// import { useEffect, useState } from 'react';
// import { ownerMoreApi, type OwnerSettingsSnapshot } from '../api/ownerApi';
// import { useOwnerNav } from '../shell/nav';
// import {
//   FiGlobe,
//   FiKey,
//   FiCheck,
//   FiX,
//   FiChevronRight,
//   FiSmartphone,
//   FiBell,
// } from 'react-icons/fi';

// export function OwnerSettingScreen() {
//   const { back, openNotifications } = useOwnerNav();
//   const [settings, setSettings] = useState<OwnerSettingsSnapshot | null>(null);
//   const [loading, setLoading] = useState(true);

//   // Submenu states (for design preview)
//   const [isFaceIdEnabled, setIsFaceIdEnabled] = useState(false);
//   const [selectedLanguage, setSelectedLanguage] = useState('English (US)');
//   const [showPasswordModal, setShowPasswordModal] = useState(false);
//   const [passwordSavedMsg, setPasswordSavedMsg] = useState(false);

//   // Form states for change password design
//   const [currentPassword, setCurrentPassword] = useState('');
//   const [newPassword, setNewPassword] = useState('');
//   const [confirmPassword, setConfirmPassword] = useState('');

//   useEffect(() => {
//     ownerMoreApi
//       .settings()
//       .then(setSettings)
//       .catch(() => {
//         /* fallback display */
//       })
//       .finally(() => setLoading(false));
//   }, []);

//   const handlePasswordSubmit = (e: React.FormEvent) => {
//     e.preventDefault();
//     setPasswordSavedMsg(true);
//     setTimeout(() => {
//       setPasswordSavedMsg(false);
//       setShowPasswordModal(false);
//       setCurrentPassword('');
//       setNewPassword('');
//       setConfirmPassword('');
//     }, 1200);
//   };

//   return (
//     <>
//       <header className="owner-header">
//         <button className="owner-back" aria-label="Back" onClick={back}>
//           <svg
//             width="20"
//             height="20"
//             viewBox="0 0 24 24"
//             fill="none"
//             stroke="var(--owner-text)"
//             strokeWidth="2.2"
//             strokeLinecap="round"
//             strokeLinejoin="round"
//           >
//             <path d="M15 18l-6-6 6-6" />
//           </svg>
//         </button>
//         <div className="owner-greet" style={{ textAlign: 'center' }}>
//           <div
//             className="n owner-serif"
//             style={{ cursor: 'default', justifyContent: 'center' }}
//           >
//             Settings
//           </div>
//         </div>
//         <div style={{ width: 40 }} />
//       </header>

//       {loading && (
//         <div className="owner-state">
//           <div className="big owner-serif">Loading settings…</div>
//         </div>
//       )}

//       {!loading && (
//         <div className="owner-menu">
//           {/* Security & Authentication */}
//           <section className="owner-menu-section">
//             <div className="owner-menu-section-head">
//               <h6>SECURITY &amp; ACCESS</h6>
//               <p>Authentication and security preferences</p>
//             </div>

//             <div className="owner-menu-card">
//               {/* Change Password */}
//               <button
//                 className="owner-menurow"
//                 onClick={() => setShowPasswordModal(true)}
//               >
//                 <span className="owner-menu-icon">
//                   <FiKey />
//                 </span>

//                 <div className="owner-menu-content">
//                   <span className="ml">Change Password</span>
//                   <span className="owner-menu-subtitle">
//                     Update your account login password
//                   </span>
//                 </div>

//                 <FiChevronRight className="owner-menu-chevron" />
//               </button>

//               {/* Face ID / Biometrics Toggler */}
//               <div
//                 className="owner-menurow"
//                 style={{ cursor: 'pointer' }}
//                 onClick={() => setIsFaceIdEnabled((prev) => !prev)}
//               >
//                 <span className="owner-menu-icon">
//                   <FiSmartphone />
//                 </span>

//                 <div className="owner-menu-content">
//                   <span className="ml">Face ID / Biometric Login</span>
//                   <span className="owner-menu-subtitle">
//                     Quick &amp; secure biometric access
//                   </span>
//                 </div>

//                 <label
//                   style={{
//                     position: 'relative',
//                     display: 'inline-block',
//                     width: 44,
//                     height: 24,
//                     cursor: 'pointer',
//                   }}
//                   onClick={(e) => e.stopPropagation()}
//                 >
//                   <input
//                     type="checkbox"
//                     checked={isFaceIdEnabled}
//                     onChange={(e) => setIsFaceIdEnabled(e.target.checked)}
//                     style={{ opacity: 0, width: 0, height: 0 }}
//                   />
//                   <span
//                     style={{
//                       position: 'absolute',
//                       cursor: 'pointer',
//                       inset: 0,
//                       backgroundColor: isFaceIdEnabled
//                         ? 'var(--owner-primary)'
//                         : 'var(--owner-border)',
//                       transition: '.2s',
//                       borderRadius: 24,
//                     }}
//                   >
//                     <span
//                       style={{
//                         position: 'absolute',
//                         content: '""',
//                         height: 18,
//                         width: 18,
//                         left: isFaceIdEnabled ? 22 : 3,
//                         bottom: 3,
//                         backgroundColor: 'white',
//                         transition: '.2s',
//                         borderRadius: '50%',
//                         boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
//                       }}
//                     />
//                   </span>
//                 </label>
//               </div>
//             </div>
//           </section>

//           {/* Preferences */}
//           <section className="owner-menu-section">
//             <div className="owner-menu-section-head">
//               <h6>PREFERENCES</h6>
//               <p>Regional and display settings</p>
//             </div>

//             <div className="owner-menu-card">
//               {/* Notifications Row */}
//               <button
//                 className="owner-menurow"
//                 onClick={openNotifications}
//                 style={{ width: '100%', cursor: 'pointer', textAlign: 'left', background: 'none', border: 'none' }}
//               >
//                 <span className="owner-menu-icon">
//                   <FiBell />
//                 </span>

//                 <div className="owner-menu-content">
//                   <span className="ml">Notifications</span>
//                   <span className="owner-menu-subtitle">
//                     Push alerts, email summaries &amp; operational notifications
//                   </span>
//                 </div>

//                 <FiChevronRight className="owner-menu-chevron" />
//               </button>

//               <div className="owner-menurow" style={{ alignItems: 'center' }}>
//                 <span className="owner-menu-icon">
//                   <FiGlobe />
//                 </span>

//                 <div className="owner-menu-content">
//                   <span className="ml">Language</span>
//                   <span className="owner-menu-subtitle">
//                     App interface display language
//                   </span>
//                 </div>

//                 <select
//                   value={selectedLanguage}
//                   onChange={(e) => setSelectedLanguage(e.target.value)}
//                   style={{
//                     appearance: 'none',
//                     border: '1px solid var(--owner-border)',
//                     background: 'var(--owner-surface)',
//                     borderRadius: 8,
//                     padding: '6px 12px',
//                     fontSize: 13,
//                     fontWeight: 600,
//                     color: 'var(--owner-text)',
//                     cursor: 'pointer',
//                     outline: 'none',
//                   }}
//                 >
//                   <option value="English (US)">English (US)</option>
//                   <option value="Spanish">Español</option>
//                   <option value="French">Français</option>
//                   <option value="Vietnamese">Tiếng Việt</option>
//                   <option value="Chinese">中文</option>
//                 </select>
//               </div>
//             </div>
//           </section>

//           {/* Business Snapshot Info */}
//           <section className="owner-menu-section">
//             <div className="owner-menu-section-head">
//               <h6>BUSINESS CONFIGURATION</h6>
//               <p>Active salon parameters</p>
//             </div>

//             <div className="owner-menu-card">
//               <div className="owner-settingspanel" style={{ borderTop: 'none' }}>
//                 <div>
//                   <div className="k">Business</div>
//                   <div className="v">{settings?.businessName ?? '—'}</div>
//                 </div>

//                 <div>
//                   <div className="k">Time Zone</div>
//                   <div className="v">{settings?.timezone ?? '—'}</div>
//                 </div>

//                 <div>
//                   <div className="k">Currency</div>
//                   <div className="v">{settings?.currency ?? '—'}</div>
//                 </div>

//                 <div>
//                   <div className="k">Branches</div>
//                   <div className="v">
//                     {settings
//                       ? `${settings.activeBranchCount} active / ${settings.branchCount}`
//                       : '—'}
//                   </div>
//                 </div>
//               </div>
//             </div>
//           </section>
//         </div>
//       )}

//       {/* Change Password Modal UI */}
//       {showPasswordModal && (
//         <div
//           style={{
//             position: 'fixed',
//             inset: 0,
//             backgroundColor: 'rgba(0, 0, 0, 0.45)',
//             zIndex: 100,
//             display: 'flex',
//             alignItems: 'center',
//             justifyContent: 'center',
//             padding: 18,
//           }}
//           onClick={() => setShowPasswordModal(false)}
//         >
//           <div
//             style={{
//               width: '100%',
//               maxWidth: 390,
//               background: 'var(--owner-surface)',
//               borderRadius: 18,
//               padding: 20,
//               boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
//               border: '1px solid var(--owner-border-gold)',
//             }}
//             onClick={(e) => e.stopPropagation()}
//           >
//             <div
//               style={{
//                 display: 'flex',
//                 justifyContent: 'space-between',
//                 alignItems: 'center',
//                 marginBottom: 16,
//               }}
//             >
//               <div
//                 className="owner-serif"
//                 style={{ fontSize: 18, fontWeight: 700 }}
//               >
//                 Change Password
//               </div>
//               <button
//                 className="owner-iconbtn"
//                 onClick={() => setShowPasswordModal(false)}
//                 aria-label="Close modal"
//               >
//                 <FiX size={18} />
//               </button>
//             </div>

//             {passwordSavedMsg ? (
//               <div
//                 style={{
//                   textAlign: 'center',
//                   padding: '24px 0',
//                   color: 'var(--owner-success)',
//                 }}
//               >
//                 <FiCheck size={32} style={{ marginBottom: 8 }} />
//                 <div style={{ fontWeight: 700 }}>Password Updated</div>
//               </div>
//             ) : (
//               <form
//                 onSubmit={handlePasswordSubmit}
//                 style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
//               >
//                 <div>
//                   <label
//                     style={{
//                       fontSize: 12,
//                       fontWeight: 600,
//                       color: 'var(--owner-text-secondary)',
//                       display: 'block',
//                       marginBottom: 4,
//                     }}
//                   >
//                     Current Password
//                   </label>
//                   <input
//                     type="password"
//                     className="owner-input"
//                     value={currentPassword}
//                     onChange={(e) => setCurrentPassword(e.target.value)}
//                     placeholder="••••••••"
//                     required
//                   />
//                 </div>

//                 <div>
//                   <label
//                     style={{
//                       fontSize: 12,
//                       fontWeight: 600,
//                       color: 'var(--owner-text-secondary)',
//                       display: 'block',
//                       marginBottom: 4,
//                     }}
//                   >
//                     New Password
//                   </label>
//                   <input
//                     type="password"
//                     className="owner-input"
//                     value={newPassword}
//                     onChange={(e) => setNewPassword(e.target.value)}
//                     placeholder="••••••••"
//                     required
//                   />
//                 </div>

//                 <div>
//                   <label
//                     style={{
//                       fontSize: 12,
//                       fontWeight: 600,
//                       color: 'var(--owner-text-secondary)',
//                       display: 'block',
//                       marginBottom: 4,
//                     }}
//                   >
//                     Confirm New Password
//                   </label>
//                   <input
//                     type="password"
//                     className="owner-input"
//                     value={confirmPassword}
//                     onChange={(e) => setConfirmPassword(e.target.value)}
//                     placeholder="••••••••"
//                     required
//                   />
//                 </div>

//                 <div
//                   style={{
//                     display: 'flex',
//                     gap: 10,
//                     marginTop: 12,
//                     justifyContent: 'flex-end',
//                   }}
//                 >
//                   <button
//                     type="button"
//                     className="owner-btn ghost"
//                     style={{
//                       minHeight: 44,
//                       fontSize: 14,
//                       padding: '8px 16px',
//                     }}
//                     onClick={() => setShowPasswordModal(false)}
//                   >
//                     Cancel
//                   </button>
//                   <button
//                     type="submit"
//                     className="owner-btn"
//                     style={{
//                       minHeight: 44,
//                       fontSize: 14,
//                       padding: '8px 16px',
//                     }}
//                   >
//                     Update Password
//                   </button>
//                 </div>
//               </form>
//             )}
//           </div>
//         </div>
//       )}
//     </>
//   );
// }

// export { OwnerSettingScreen as SettingsScreen, OwnerSettingScreen as OwnerSettingsScreen };






import { useEffect, useState } from 'react';
import { ownerMoreApi, type OwnerSettingsSnapshot } from '../api/ownerApi';
import { useOwnerNav } from '../shell/nav';
import { OwnerSkeletonCards } from '../components/OwnerSkeleton';
import {
  FiGlobe,
  FiKey,
  FiCheck,
  FiX,
  FiChevronRight,
  FiSmartphone,
  FiBell,
} from 'react-icons/fi';
import {
  enrollFaceId,
  faceIdMode,
  getPendingBioCreds,
  disableFaceId,
} from '../auth/faceid';
export function OwnerSettingScreen() {
  const { back, openNotifications } = useOwnerNav();
  const [settings, setSettings] = useState<OwnerSettingsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  // Submenu states (for design preview)
  const [faceIdSupported, setFaceIdSupported] = useState(false);
  const [isFaceIdEnabled, setIsFaceIdEnabled] = useState(false);
  const [isAutoStartupEnabled, setIsAutoStartupEnabled] = useState(() => localStorage.getItem('owner_faceid_enabled') !== 'false');
  const [enrolling, setEnrolling] = useState(false);
  const [bioErr, setBioErr] = useState<string | null>(null);
  const [bioOk, setBioOk] = useState<string | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState('English (US)');
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordSavedMsg, setPasswordSavedMsg] = useState(false);

  // Form states for change password design
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    ownerMoreApi
      .settings()
      .then(setSettings)
      .catch(() => {
        /* fallback display */
      })
      .finally(() => setLoading(false));
  }, []);

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordSavedMsg(true);
    setTimeout(() => {
      setPasswordSavedMsg(false);
      setShowPasswordModal(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    }, 1200);
  };
  const enableBiometrics = async () => {
    if (enrolling) return;

    setBioErr(null);
    setBioOk(null);
    setEnrolling(true);

    try {
      await enrollFaceId();

      localStorage.setItem('owner_faceid_enabled', 'true');
      setIsFaceIdEnabled(true);
      setIsAutoStartupEnabled(true);
      setBioOk('Biometric login has been enabled.');
    } catch (e: any) {
      const msg = String(e?.message || '');

      if (!/cancel/i.test(msg)) {
        setBioErr(
          msg || 'Could not enable biometric login. Please try again.'
        );
      }
    } finally {
      setEnrolling(false);
    }
  };
  const disableBiometrics = async () => {
    setBioErr(null);
    setBioOk(null);

    try {
      await disableFaceId();

      sessionStorage.removeItem('aps_bio_login_success');
      localStorage.setItem('owner_faceid_enabled', 'false');

      setIsFaceIdEnabled(false);
      setIsAutoStartupEnabled(false);
      setBioOk('Biometric login has been disabled.');
    } catch (e: any) {
      setBioErr(
        e?.message || 'Could not disable biometric login.'
      );
    }
  };
 const handleFaceIdToggle = async () => {
  if (enrolling) return;

  setBioErr(null);
  setBioOk(null);

  if (isFaceIdEnabled) {
    await disableBiometrics();
    return;
  }

  if (!getPendingBioCreds()) {
    setBioErr(
      'To set up Biometrics, please sign out and sign back in with your password first.'
    );
    return;
  }

  await enableBiometrics();
};
  useEffect(() => {
    let alive = true;

    faceIdMode().then((mode) => {
      if (!alive) return;

      const supported = mode !== 'none';
      setFaceIdSupported(supported);

      if (supported) {
        const enrolled =
          sessionStorage.getItem('aps_bio_login_success') === 'true';

        setIsFaceIdEnabled(enrolled);
      }
    });

    return () => {
      alive = false;
    };
  }, []);
  return (
    <>
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
            Settings
          </div>
        </div>
        <div style={{ width: 40 }} />
      </header>

      {loading && <OwnerSkeletonCards count={3} />}

      {!loading && (
        <div className="owner-menu">
          {/* Security & Authentication */}
          <section className="owner-menu-section">
            <div className="owner-menu-section-head">
              <h6>SECURITY &amp; ACCESS</h6>
              <p>Authentication and security preferences</p>
            </div>

            <div className="owner-menu-card">
              {/* Change Password */}
              <button
                className="owner-menurow"
                onClick={() => setShowPasswordModal(true)}
              >
                <span className="owner-menu-icon">
                  <FiKey />
                </span>

                <div className="owner-menu-content">
                  <span className="ml">Change Password</span>
                  <span className="owner-menu-subtitle">
                    Update your account login password
                  </span>
                </div>

                <FiChevronRight className="owner-menu-chevron" />
              </button>

              {/* Face ID / Biometrics Toggler */}
              <div
                className="owner-menurow"
                style={{
                  cursor: faceIdSupported ? 'pointer' : 'default',
                  opacity: faceIdSupported ? 1 : 0.6,
                }}
                onClick={() => {
                  if (faceIdSupported) {
                    handleFaceIdToggle();
                  }
                }}
              >
                <span className="owner-menu-icon">
                  <FiSmartphone />
                </span>

                <div className="owner-menu-content">
                  <span className="ml">Face ID / Biometric Login</span>
                  <span className="owner-menu-subtitle">
                    Quick &amp; secure biometric access
                  </span>
                </div>

                <label
                  style={{
                    position: 'relative',
                    display: 'inline-block',
                    width: 44,
                    height: 24,
                    cursor: 'pointer',
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    aria-label="Face ID / Biometric Login"
                    checked={isFaceIdEnabled}
                    disabled={!faceIdSupported || enrolling}
                    onChange={handleFaceIdToggle}
                    style={{ opacity: 0, width: 0, height: 0 }}
                  />
                  <span
                    style={{
                      position: 'absolute',
                      cursor: 'pointer',
                      inset: 0,
                      backgroundColor: isFaceIdEnabled
                        ? 'var(--owner-primary)'
                        : 'var(--owner-border)',
                      transition: '.2s',
                      borderRadius: 24,
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        content: '""',
                        height: 18,
                        width: 18,
                        left: isFaceIdEnabled ? 22 : 3,
                        bottom: 3,
                        backgroundColor: 'white',
                        transition: '.2s',
                        borderRadius: '50%',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                      }}
                    />
                  </span>
                </label>
              </div>

              {/* Auto Biometrics on Startup Toggler */}
              <div
                className="owner-menurow"
                style={{
                  cursor: isFaceIdEnabled ? 'pointer' : 'default',
                  opacity: isFaceIdEnabled ? 1 : 0.6,
                }}
                onClick={() => {
                  if (isFaceIdEnabled) {
                    const next = !isAutoStartupEnabled;
                    setIsAutoStartupEnabled(next);
                    localStorage.setItem('owner_faceid_enabled', String(next));
                  }
                }}
              >
                <span className="owner-menu-icon">
                  <FiSmartphone />
                </span>

                <div className="owner-menu-content">
                  <span className="ml">Auto Biometrics on Startup</span>
                  <span className="owner-menu-subtitle">
                    Automatically prompt for Face ID when opening the app
                  </span>
                </div>

                <label
                  style={{
                    position: 'relative',
                    display: 'inline-block',
                    width: 44,
                    height: 24,
                    cursor: 'pointer',
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    aria-label="Prompt for Face ID on app open"
                    checked={isAutoStartupEnabled}
                    disabled={!isFaceIdEnabled}
                    onChange={() => {
                      const next = !isAutoStartupEnabled;
                      setIsAutoStartupEnabled(next);
                      localStorage.setItem('owner_faceid_enabled', String(next));
                    }}
                    style={{ opacity: 0, width: 0, height: 0 }}
                  />
                  <span
                    style={{
                      position: 'absolute',
                      cursor: 'pointer',
                      inset: 0,
                      backgroundColor: isAutoStartupEnabled
                        ? 'var(--owner-primary)'
                        : 'var(--owner-border)',
                      transition: '.2s',
                      borderRadius: 24,
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        content: '""',
                        height: 18,
                        width: 18,
                        left: isAutoStartupEnabled ? 22 : 3,
                        bottom: 3,
                        backgroundColor: 'white',
                        transition: '.2s',
                        borderRadius: '50%',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                      }}
                    />
                  </span>
                </label>
              </div>

              {!faceIdSupported && (
                <div
                  className="owner-text-muted"
                  style={{ padding: '0 16px 12px', fontSize: 12.5 }}
                >
                  Biometric authentication is not supported on this device.
                </div>
              )}

              {bioErr && (
                <div
                  style={{
                    padding: '0 16px 12px',
                    color: 'var(--owner-danger)',
                    fontSize: 13,
                  }}
                  role="alert"
                >
                  {bioErr}
                </div>
              )}

              {bioOk && (
                <div
                  style={{
                    padding: '0 16px 12px',
                    color: 'var(--owner-success)',
                    fontSize: 13,
                  }}
                  role="status"
                >
                  {bioOk}
                </div>
              )}
            </div>
          </section>

          {/* Preferences */}
          <section className="owner-menu-section">
            <div className="owner-menu-section-head">
              <h6>PREFERENCES</h6>
              <p>Regional and display settings</p>
            </div>

            <div className="owner-menu-card">
              {/* Notifications Row */}
              <button
                className="owner-menurow"
                onClick={openNotifications}
                style={{ width: '100%', cursor: 'pointer', textAlign: 'left', background: 'none', border: 'none' }}
              >
                <span className="owner-menu-icon">
                  <FiBell />
                </span>

                <div className="owner-menu-content">
                  <span className="ml">Notifications</span>
                  <span className="owner-menu-subtitle">
                    Push alerts, email summaries &amp; operational notifications
                  </span>
                </div>

                <FiChevronRight className="owner-menu-chevron" />
              </button>

              <div className="owner-menurow" style={{ alignItems: 'center' }}>
                <span className="owner-menu-icon">
                  <FiGlobe />
                </span>

                <div className="owner-menu-content">
                  <span className="ml">Language</span>
                  <span className="owner-menu-subtitle">
                    App interface display language
                  </span>
                </div>

                <select
                  value={selectedLanguage}
                  onChange={(e) => setSelectedLanguage(e.target.value)}
                  style={{
                    appearance: 'none',
                    border: '1px solid var(--owner-border)',
                    background: 'var(--owner-surface)',
                    borderRadius: 8,
                    padding: '6px 12px',
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--owner-text)',
                    cursor: 'pointer',
                    outline: 'none',
                  }}
                >
                  <option value="English (US)">English (US)</option>
                  <option value="Spanish">Español</option>
                  <option value="French">Français</option>
                  <option value="Vietnamese">Tiếng Việt</option>
                  <option value="Chinese">中文</option>
                </select>
              </div>
            </div>
          </section>

          {/* Business Snapshot Info */}
          <section className="owner-menu-section">
            <div className="owner-menu-section-head">
              <h6>BUSINESS CONFIGURATION</h6>
              <p>Active salon parameters</p>
            </div>

            <div className="owner-menu-card">
              <div className="owner-settingspanel" style={{ borderTop: 'none' }}>
                <div>
                  <div className="k">Business</div>
                  <div className="v">{settings?.businessName ?? '—'}</div>
                </div>

                <div>
                  <div className="k">Time Zone</div>
                  <div className="v">{settings?.timezone ?? '—'}</div>
                </div>

                <div>
                  <div className="k">Currency</div>
                  <div className="v">{settings?.currency ?? '—'}</div>
                </div>

                <div>
                  <div className="k">Branches</div>
                  <div className="v">
                    {settings
                      ? `${settings.activeBranchCount} active / ${settings.branchCount}`
                      : '—'}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* Change Password Modal UI */}
      {showPasswordModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.45)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 18,
          }}
          onClick={() => setShowPasswordModal(false)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 390,
              background: 'var(--owner-surface)',
              borderRadius: 18,
              padding: 20,
              boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
              border: '1px solid var(--owner-border-gold)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 16,
              }}
            >
              <div
                className="owner-serif"
                style={{ fontSize: 18, fontWeight: 700 }}
              >
                Change Password
              </div>
              <button
                className="owner-iconbtn"
                onClick={() => setShowPasswordModal(false)}
                aria-label="Close modal"
              >
                <FiX size={18} />
              </button>
            </div>

            {passwordSavedMsg ? (
              <div
                style={{
                  textAlign: 'center',
                  padding: '24px 0',
                  color: 'var(--owner-success)',
                }}
              >
                <FiCheck size={32} style={{ marginBottom: 8 }} />
                <div style={{ fontWeight: 700 }}>Password Updated</div>
              </div>
            ) : (
              <form
                onSubmit={handlePasswordSubmit}
                style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
              >
                <div>
                  <label
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--owner-text-secondary)',
                      display: 'block',
                      marginBottom: 4,
                    }}
                  >
                    Current Password
                  </label>
                  <input
                    type="password"
                    className="owner-input"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                  />
                </div>

                <div>
                  <label
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--owner-text-secondary)',
                      display: 'block',
                      marginBottom: 4,
                    }}
                  >
                    New Password
                  </label>
                  <input
                    type="password"
                    className="owner-input"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                  />
                </div>

                <div>
                  <label
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--owner-text-secondary)',
                      display: 'block',
                      marginBottom: 4,
                    }}
                  >
                    Confirm New Password
                  </label>
                  <input
                    type="password"
                    className="owner-input"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                  />
                </div>

                <div
                  style={{
                    display: 'flex',
                    gap: 10,
                    marginTop: 12,
                    justifyContent: 'flex-end',
                  }}
                >
                  <button
                    type="button"
                    className="owner-btn ghost"
                    style={{
                      minHeight: 44,
                      fontSize: 14,
                      padding: '8px 16px',
                    }}
                    onClick={() => setShowPasswordModal(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="owner-btn"
                    style={{
                      minHeight: 44,
                      fontSize: 14,
                      padding: '8px 16px',
                    }}
                  >
                    Update Password
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export { OwnerSettingScreen as SettingsScreen, OwnerSettingScreen as OwnerSettingsScreen };
