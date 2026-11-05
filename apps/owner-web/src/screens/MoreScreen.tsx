import { useEffect, useState } from 'react';
import { useInlineConfirm } from '../components/InlineConfirm';
import { ownerMoreApi, type OwnerProfileCard } from '../api/ownerApi';
import { useOwnerNav } from '../shell/nav';
import { useAuth } from '../auth/AuthContext';
import { FiUser, FiBell, FiTrendingUp, FiUsers, FiDollarSign, FiGift, FiAward, FiBox, FiTarget, FiCreditCard, FiCpu, FiSettings, FiPackage, FiMonitor, FiBriefcase, FiRepeat, FiLock, FiFileText, FiTrash2, FiLogOut, FiActivity } from 'react-icons/fi';
// MoreScreen — Module 6. Owner profile card + menu: Business Alerts (with live unread badge), Settings (inline snapshot),
// and Logout. Real data from /owner/profile, /owner/alerts/summary, /owner/settings. Every row is functional (no dead buttons).
const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || 'O';
const Chevron = () => <svg className="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>;

export function MoreScreen() {
  const { go, openProfile, openPayroll, openCustomers, openGiftCards, openInventory, openMarketing, openPayments, openAiCenter, openMemberships, openAlerts, openSettings, openAudit, openHardwarePayment, openCashHandoff, openCashDrawer, openCashSummary, openPrivacy, openTerms, openDeleteAccount, openAiPackages, openTickets } = useOwnerNav();
  const { logout } = useAuth();
  const [profile, setProfile] = useState<OwnerProfileCard | null>(null);
  const [unread, setUnread] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([ownerMoreApi.profile(), ownerMoreApi.alertSummary().catch(() => null)])
      .then(([p, s]) => { setProfile(p); if (s) setUnread(s.unread); })
      .catch(() => { /* profile failure shows fallback below */ })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const scrollEl = document.querySelector('.owner-scroll');
    if (!scrollEl) return;

    const saved = sessionStorage.getItem('ownerMoreScroll');
    if (saved) {
      scrollEl.scrollTop = parseInt(saved, 10);
    }

    let timeout: any;
    const onScroll = () => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        sessionStorage.setItem('ownerMoreScroll', scrollEl.scrollTop.toString());
      }, 100);
    };

    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      if (timeout) clearTimeout(timeout);
      scrollEl.removeEventListener('scroll', onScroll);
    };
  }, []);

  const onLogout = () =>
    askConfirm(
      'Are you sure you want to log out of your PowerSalon owner session?',
      () => logout(),
      {
        title: 'Confirm Logout',
        confirmLabel: 'Log Out',
        destructive: true,
      }
    );
  const { confirm: askConfirm, confirmUi } = useInlineConfirm();

  return (
    <>
      {confirmUi}
      <header className="owner-header">
       
        <div className="owner-greet" ><div className="n owner-serif" style={{ cursor: 'default', justifyContent: 'center' }}>More</div></div>
    
      </header>

      <div className="owner-profilecard" role="button" tabIndex={0} onClick={openProfile} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openProfile(); } }} style={{ cursor: 'pointer' }} aria-label="Open profile and settings">
        {loading ? (
          <>
            <div className="av">
              <div className="owner-skel" style={{ width: 44, height: 44, borderRadius: '50%' }} />
            </div>
            <div>
              <div className="owner-skel" style={{ width: 120, height: 16, marginBottom: 4 }} />
              <div className="owner-skel" style={{ width: 180, height: 14, marginBottom: 4 }} />
              <div className="owner-skel" style={{ width: 80, height: 14 }} />
            </div>
          </>
        ) : (
          <>
            <div className="av" style={profile?.avatarUrl ? { padding: 0, overflow: 'hidden' } : {}}>
              {profile?.avatarUrl ? (
                <img src={profile.avatarUrl} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                initials(profile?.fullName ?? 'Owner')
              )}
            </div>
            <div>
              <div className="nm">{profile?.fullName ?? 'Owner'}</div>
              <div className="bz">{profile?.businessName ?? '—'}{profile?.email ? ` · ${profile.email}` : ''}</div>
              <span className="rl">{(profile?.role ?? 'OWNER').replace('_', ' ')}</span>
            </div>
          </>
        )}
      </div>
      <div className="owner-menu">
            <section className="owner-menu-section">
              <div className="owner-menu-section-head">
                <h6>PROFILE</h6>
                <p>Manage your account and business</p>
              </div>

              <div className="owner-menu-card">

                <button
                  className="owner-menurow"
                  onClick={openProfile}
                >
                  <span className="owner-menu-icon">
                    <FiUser />
                  </span>

                  <div className="owner-menu-content">
                    <span className="ml">My Profile</span>
                    <span className="owner-menu-subtitle">
                      Account and business details
                    </span>
                  </div>

                  <Chevron />
                </button>

                <button
                  className="owner-menurow"
                  onClick={openSettings}
                >
                  <span className="owner-menu-icon">
                    <FiSettings />
                  </span>

                  <div className="owner-menu-content">
                    <span className="ml">Settings</span>
                    <span className="owner-menu-subtitle">
                      Preferences and configuration
                    </span>
                  </div>

                  <Chevron />
                </button>
              </div>
            </section>
            <section className="owner-menu-section">
              <div className="owner-menu-section-head">
                <h6>BUSINESS</h6>
                <p>Monitor and manage your salon</p>
              </div>

              <div className="owner-menu-card">

                <button
                  className="owner-menurow"
                  onClick={openAlerts}
                >
                  <span className="owner-menu-icon">
                    <FiBell />
                  </span>

                  <div className="owner-menu-content">
                    <span className="ml">Business Alerts</span>
                    <span className="owner-menu-subtitle">
                      Important business notifications
                    </span>
                  </div>

                  {unread > 0 && (
                    <span className="owner-menubadge">
                      {unread}
                    </span>
                  )}

                  <Chevron />
                </button>


                <button
                  className="owner-menurow"
                  onClick={() => go('branches')}
                >
                  <span className="owner-menu-icon">
                    <FiTrendingUp />
                  </span>

                  <div className="owner-menu-content">
                    <span className="ml">Branch Performance</span>
                    <span className="owner-menu-subtitle">
                      Track branch performance
                    </span>
                  </div>

                  <Chevron />
                </button>


                <button
                  className="owner-menurow"
                  onClick={() => go('staff')}
                >
                  <span className="owner-menu-icon">
                    <FiUsers />
                  </span>

                  <div className="owner-menu-content">
                    <span className="ml">Team Performance</span>
                    <span className="owner-menu-subtitle">
                      Monitor your staff
                    </span>
                  </div>

                  <Chevron />
                </button>


                <button
                  className="owner-menurow"
                  onClick={() => openPayroll()}
                >
                  <span className="owner-menu-icon">
                    <FiDollarSign />
                  </span>

                  <div className="owner-menu-content">
                    <span className="ml">Commission &amp; Payroll</span>
                    <span className="owner-menu-subtitle">
                      Manage commissions and payouts
                    </span>
                  </div>

                  <Chevron />
                </button>

              </div>
            </section>
            <section className="owner-menu-section">
              <div className="owner-menu-section-head">
                <h6>CUSTOMERS &amp; SALES</h6>
                <p>Customers, loyalty and revenue tools</p>
              </div>

              <div className="owner-menu-card">

                <button
                  className="owner-menurow"
                  onClick={openCustomers}
                >
                  <span className="owner-menu-icon">
                    <FiUsers />
                  </span>

                  <div className="owner-menu-content">
                    <span className="ml">Customers &amp; Loyalty</span>
                    <span className="owner-menu-subtitle">
                      Customer relationships and rewards
                    </span>
                  </div>

                  <Chevron />
                </button>


                <button
                  className="owner-menurow"
                  onClick={openGiftCards}
                >
                  <span className="owner-menu-icon">
                    <FiGift />
                  </span>

                  <div className="owner-menu-content">
                    <span className="ml">Gift Cards</span>
                    <span className="owner-menu-subtitle">
                      Manage salon gift cards
                    </span>
                  </div>

                  <Chevron />
                </button>


                <button
                  className="owner-menurow"
                  onClick={openMemberships}
                >
                  <span className="owner-menu-icon">
                    <FiAward />
                  </span>

                  <div className="owner-menu-content">
                    <span className="ml">Memberships</span>
                    <span className="owner-menu-subtitle">
                      Customer membership plans
                    </span>
                  </div>

                  <Chevron />
                </button>

              </div>
            </section>
            <section className="owner-menu-section">
              <div className="owner-menu-section-head">
                <h6>OPERATIONS</h6>
                <p>Daily business tools and management</p>
              </div>

              <div className="owner-menu-card">

                <button className="owner-menurow" onClick={openInventory}>
                  <span className="owner-menu-icon">
                    <FiBox />
                  </span>

                  <div className="owner-menu-content">
                    <span className="ml">Inventory &amp; Products</span>
                    <span className="owner-menu-subtitle">
                      Products and stock management
                    </span>
                  </div>

                  <Chevron />
                </button>


                <button className="owner-menurow" onClick={openMarketing}>
                  <span className="owner-menu-icon">
                    <FiTarget />
                  </span>

                  <div className="owner-menu-content">
                    <span className="ml">Marketing &amp; Growth</span>
                    <span className="owner-menu-subtitle">
                      Promotions and customer growth
                    </span>
                  </div>

                  <Chevron />
                </button>


                <button className="owner-menurow" onClick={openPayments}>
                  <span className="owner-menu-icon">
                    <FiCreditCard />
                  </span>

                  <div className="owner-menu-content">
                    <span className="ml">Payments &amp; Money</span>
                    <span className="owner-menu-subtitle">
                      Revenue and payment management
                    </span>
                  </div>

                  <Chevron />
                </button>


                <button className="owner-menurow" onClick={openAiCenter}>
                  <span className="owner-menu-icon">
                    <FiCpu />
                  </span>

                  <div className="owner-menu-content">
                    <span className="ml">AI Center</span>
                    <span className="owner-menu-subtitle">
                      AI-powered salon tools
                    </span>
                  </div>

                  <Chevron />
                </button>


                <button className="owner-menurow" onClick={openAiPackages}>
                  <span className="owner-menu-icon">
                    <FiPackage />
                  </span>

                  <div className="owner-menu-content">
                    <span className="ml">AI Packages</span>
                    <span className="owner-menu-subtitle">
                      Manage AI plans and packages
                    </span>
                  </div>

                  <Chevron />
                </button>

              </div>
            </section>
            <section className="owner-menu-section">
              <div className="owner-menu-section-head">
                <h6>PAYMENTS &amp; CASH</h6>
                <p>Hardware, cash and daily transactions</p>
              </div>

              <div className="owner-menu-card">

                <button className="owner-menurow" onClick={openHardwarePayment}>
                  <span className="owner-menu-icon">
                    <FiMonitor />
                  </span>

                  <div className="owner-menu-content">
                    <span className="ml">Hardware Payments</span>
                  </div>

                  <Chevron />
                </button>


                <button className="owner-menurow" onClick={openCashSummary}>
                  <span className="owner-menu-icon">
                    <FiBriefcase />
                  </span>

                  <div className="owner-menu-content">
                    <span className="ml">Daily Cash</span>
                  </div>

                  <Chevron />
                </button>


                <button className="owner-menurow" onClick={openCashHandoff}>
                  <span className="owner-menu-icon">
                    <FiRepeat />
                  </span>

                  <div className="owner-menu-content">
                    <span className="ml">End-of-Day Cash</span>
                  </div>

                  <Chevron />
                </button>


                <button className="owner-menurow" onClick={openCashDrawer}>
                  <span className="owner-menu-icon">
                    <FiDollarSign />
                  </span>

                  <div className="owner-menu-content">
                    <span className="ml">Cash Drawer</span>
                  </div>

                  <Chevron />
                </button>

              </div>
            </section>
            <section className="owner-menu-section">
              <div className="owner-menu-section-head">
                <h6>ACCOUNT &amp; SYSTEM</h6>
                <p>Security, activity and account management</p>
              </div>

              <div className="owner-menu-card">

                <button className="owner-menurow" onClick={openTickets}>
                  <span className="owner-menu-icon">
                    <FiFileText />
                  </span>

                  <div className="owner-menu-content">
                    <span className="ml">Ticket Oversight</span>
                  </div>

                  <Chevron />
                </button>


                <button className="owner-menurow" onClick={openAudit}>
                  <span className="owner-menu-icon">
                    <FiActivity />
                  </span>

                  <div className="owner-menu-content">
                    <span className="ml">Activity Log</span>
                  </div>

                  <Chevron />
                </button>


                <button className="owner-menurow" onClick={openPrivacy}>
                  <span className="owner-menu-icon">
                    <FiLock />
                  </span>

                  <div className="owner-menu-content">
                    <span className="ml">Privacy Policy</span>
                  </div>

                  <Chevron />
                </button>


                <button className="owner-menurow" onClick={openTerms}>
                  <span className="owner-menu-icon">
                    <FiFileText />
                  </span>

                  <div className="owner-menu-content">
                    <span className="ml">Terms of Service</span>
                  </div>

                  <Chevron />
                </button>


                <button
                  className="owner-menurow danger"
                  onClick={openDeleteAccount}
                >
                  <span className="owner-menu-icon">
                    <FiTrash2 />
                  </span>

                  <div className="owner-menu-content">
                    <span className="ml">Account Deactivation</span>
                  </div>

                  <Chevron />
                </button>

              </div>
            </section>
            <section className="owner-menu-section">

              <div className="owner-menu-card">

                <button
                  className="owner-menurow danger"
                  onClick={onLogout}
                >
                  <span className="owner-menu-icon">
                    <FiLogOut />
                  </span>

                  <div className="owner-menu-content">
                    <span className="ml">Log Out</span>
                    <span className="owner-menu-subtitle">
                      Sign out from your account
                    </span>
                  </div>

                  <Chevron />
                </button>

              </div>

            </section>

          </div>

          <div className="owner-chartcard" style={{ marginTop: 14 }}>
            <div className="muted" style={{ fontSize: 11.5 }}>Business Alerts are backed by the new <code>owner_alerts</code> table (severity + lifecycle status). The unread badge reflects alerts with status “new”.</div>
          </div>
    </>
  );
}
