import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { superAdminApi } from "../api/superAdminApi";
import { ScopeProvider } from "./ScopeContext";
import { StepUpHost } from "../components/StepUpHost";
import { canOpen } from "./navPermissions";
import { SupportModeBanner } from "../components/SupportModeBanner";
import { PlatformSearchBox } from "../components/PlatformSearchBox";
import { TenantScopeSelector } from "./TenantScopeSelector";
import { ProfileAvatarWithPreview } from '@aipowersalon/ui';
import { FaBars, FaTimes } from "react-icons/fa";
const link = ({ isActive }: { isActive: boolean }) =>
  "navlink" + (isActive ? " active" : "");

type SANavChild = { to: string; label: string };
type SANavItem = {
  to: string;
  label: string;
  badge?: "applications" | "leads" | "hardware" | "support";
  isNew?: boolean;
  disabled?: boolean;
  children?: SANavChild[];
};
type SANavGroup = { section?: string; items: SANavItem[] };
/** Constitution 7 §10 — the groups/items this principal may open (children filtered too; an emptied group disappears). */
export function visibleNavGroups(groups: SANavGroup[], permissions: readonly string[] | undefined): SANavGroup[] {
  return groups
    .map((g) => ({ ...g, items: g.items
      .map((n) => (n.children ? { ...n, children: n.children.filter((c) => canOpen(c.to, permissions)) } : n))
      .filter((n) => (n.children ? n.children.length > 0 : canOpen(n.to, permissions))) }))
    .filter((g) => g.items.length > 0);
}

export const NAV_GROUPS: SANavGroup[] = [
  {
    section: "Platform Overview",
    items: [
      { to: "/dashboard", label: "Overview" },
      { to: "/live-operations", label: "Live Operations" },
      { to: "/analytics", label: "Analytics" },
      { to: "/platform-dashboard", label: "Platform Dashboard" },
      { to: "/report-builder", label: "Report Builder" },
      { to: "/scheduled-reports", label: "Scheduled Reports" },
      { to: "/compensation-oversight", label: "Compensation Oversight" },
    ],
  },
  {
    section: "Tenant Management",
    items: [
      { to: "/tenants", label: "Tenants" },
      { to: "/branches", label: "Branches" },
      { to: "/users-roles", label: "Users & Roles" },
      { to: "/platform-staff", label: "Platform Staff" },
      { to: "/approvals", label: "Approvals" },
      { to: "/feature-registry", label: "Feature Registry" },
      {
        to: "/onboarding",
        label: "Onboarding & Approvals",
        badge: "applications",
        children: [
          { to: "/onboarding", label: "All Applications" },
          { to: "/onboarding/business-info", label: "Business Info" },
          { to: "/onboarding/identity", label: "Identity Verification" },
          { to: "/onboarding/legal", label: "Legal Documents" },
          { to: "/onboarding/merchant", label: "Merchant Setup" },
          { to: "/onboarding/bank", label: "Bank Verification" },
          { to: "/onboarding/hardware", label: "Hardware Assignment" },
          { to: "/onboarding/data-import", label: "Data Import" },
          { to: "/onboarding/training", label: "Training" },
          { to: "/onboarding/final-review", label: "Final Review" },
          { to: "/onboarding/activations", label: "Activations" },
          { to: "/onboarding/approvals", label: "Approvals" },
        ],
      },
      { to: "/plans", label: "Plans & Feature Limits" },
      { to: "/sms-verification-packages", label: "SMS Verification Packages" },
      {
        to: "/tenant-applications",
        label: "Tenant Applications",
        badge: "applications",
      },
      { to: "/website-leads", label: "Website Leads", badge: "leads" },
      { to: "/owner-salons", label: "Owner Salons" },
      { to: "/tenant-activity", label: "Tenant Activity" },
    ],
  },
  {
    section: "Operations Oversight",
    items: [
      {
        to: "/appointment-oversight",
        label: "Appointment Oversight",
        children: [
          { to: "/appointment-oversight", label: "Overview" },
          { to: "/appointment-oversight/search", label: "Appointment Search" },
          {
            to: "/appointment-oversight/booking-source",
            label: "Booking Source",
          },
          { to: "/appointment-oversight/failures", label: "Failures & Issues" },
          { to: "/appointment-oversight/duplicates", label: "Duplicates" },
          {
            to: "/appointment-oversight/overlapping",
            label: "Overlapping Appointments",
          },
          {
            to: "/appointment-oversight/rescheduled",
            label: "Rescheduled Appointments",
          },
          {
            to: "/appointment-oversight/change-history",
            label: "Change History",
          },
          {
            to: "/appointment-oversight/missing-info",
            label: "Missing Information",
          },
          {
            to: "/appointment-oversight/sync-failures",
            label: "Synchronization Failures",
          },
        ],
      },
      {
        to: "/customer-data-oversight",
        label: "Customer Data Oversight",
        children: [
          { to: "/customer-data-oversight", label: "All Customers" },
          {
            to: "/customer-data-oversight/duplicate-detection",
            label: "Duplicate Detection",
          },
          {
            to: "/customer-data-oversight/import-history",
            label: "Import History",
          },
          {
            to: "/customer-data-oversight/merge-history",
            label: "Merge History",
          },
          {
            to: "/customer-data-oversight/privacy-requests",
            label: "Privacy Requests",
          },
          {
            to: "/customer-data-oversight/data-exports",
            label: "Data Exports",
          },
          {
            to: "/customer-data-oversight/deletion-requests",
            label: "Deletion Requests",
          },
          {
            to: "/customer-data-oversight/consent-status",
            label: "Consent Status",
          },
          {
            to: "/customer-data-oversight/audit-history",
            label: "Audit History",
          },
          { to: "/customer-data-oversight/legal-hold", label: "Legal Hold" },
        ],
      },
      { to: "/customer-phone-oversight", label: "Customer Phone Oversight" },   // BUILD_PLAN Phase 3: phone-number changes, counts only
      { to: "/booking-verification-oversight", label: "Booking Verification Oversight" },
      { to: "/deals-oversight", label: "Deals Oversight" },   // BUILD_PLAN Phase 5: the marketplace across salons, suspend with reason, per-salon switch + limit   // BUILD_PLAN Phase 4: module + emergency switches, per-salon state, counts only
      {
        to: "/staff",
        label: "Workforce Oversight",
        children: [
          { to: "/staff", label: "All Workers" },
          { to: "/staff/technicians", label: "Technician Account Management" },
          { to: "/staff?role=technician", label: "Technicians" },
          { to: "/staff?role=receptionist", label: "Receptionists" },
          { to: "/staff?role=manager", label: "Managers" },
          { to: "/staff?panel=transfers", label: "Transfers" },
          { to: "/staff?status=suspended", label: "Access & Connectivity" },
          { to: "/staff?panel=payroll", label: "Payroll Sync" },
          { to: "/audit-logs", label: "Audit Events" },
        ],
      },
      {
        to: "/booking-checkin",
        label: "Booking & Check-In Monitor",
        children: [
          { to: "/booking-checkin", label: "Overview" },
          { to: "/booking-checkin/booking-sources", label: "Booking Sources" },
          {
            to: "/booking-checkin/check-in-performance",
            label: "Check-In Performance",
          },
          { to: "/booking-checkin/failed-events", label: "Failed Events" },
          {
            to: "/booking-checkin/wait-time-analysis",
            label: "Wait-Time Analysis",
          },
          { to: "/booking-checkin/device-status", label: "Device Status" },
          { to: "/booking-checkin/ai-handoffs", label: "AI Handoffs" },
        ],
      },
      {
        to: "/queue-management",
        label: "Live Queue Monitor",
        children: [
          { to: "/queue-management", label: "All Queues" },
          { to: "/queue-management/timelines", label: "Queue Timelines" },
          { to: "/queue-management/stuck", label: "Stuck Records" },
          { to: "/queue-management/sync", label: "Sync Status" },
          { to: "/queue-management/wait-times", label: "Wait-Time Analytics" },
        ],
      },
      { to: "/ai-queue-assignment", label: "AI Queue Assignment" },   // BUILD_PLAN Phase 6: per-salon auto-assign state, alerts, salon kill switch (reason + step-up)
      { to: "/services", label: "Catalog Management" },
      { to: "/service-templates", label: "Service Templates" },
      { to: "/product-catalog", label: "Product Catalog" },
      { to: "/ticket-oversight", label: "Ticket Oversight" },
    ],
  },
  {
    section: "Payments & Revenue",
    items: [
      { to: "/payments-transactions", label: "Payments & Transactions" },
      { to: "/merchant-accounts", label: "Merchant Accounts" },
      { to: "/settlements-deposits", label: "Settlements & Deposits" },
      { to: "/gift-card-programs", label: "Gift Card Programs" },
      { to: "/gift-card-settlement", label: "Gift Card Settlement" },
      { to: "/chargebacks-disputes", label: "Chargebacks & Disputes" },
      { to: "/platform-reports", label: "Revenue & Refunds" },
      { to: "/payment-gateways", label: "Payment Gateways" },
      { to: "/tap-to-pay", label: "Tap to Pay" },
      { to: "/revenue-residuals", label: "Revenue & Residuals" },
      {
        to: "/hardware-packages",
        label: "Hardware Packages",
        badge: "hardware",
      },
      { to: "/hardware-payments", label: "Hardware Payments" },
      { to: "/hardware-payment-reports", label: "HW Payment Reports" },
    ],
  },
  {
    section: "Business Management",
    items: [
      { to: "/marketing-campaigns", label: "Marketing & Campaigns" },
      { to: "/promotions-offers", label: "Promotions & Offers" },
      { to: "/loyalty-programs", label: "Loyalty Programs" },
      {
        to: "/communications",
        label: "Communications",
        children: [
          { to: "/communications", label: "Overview" },
          { to: "/communications/inbox", label: "Inbox" },
          { to: "/communications/platform-announcements", label: "Platform Announcements" },
        ],
      },
      { to: "/membership-programs", label: "Membership Programs", isNew: true },
      { to: "/nail-showcase", label: "NailShowcase" },
      { to: "/tech-profiles", label: "Tech Profiles" },
      { to: "/community-moderation", label: "Safety Community Moderation" },   // BUILD_PLAN Phase 8
    ],
  },
  {
    section: "AI & Automation",
    items: [
      { to: "/ai-insights", label: "AI Insights" },
      { to: "/ai-reports", label: "AI Reports" },
      {
        to: "/smart-reminders",
        label: "Smart Reminders",
        children: [
          { to: "/smart-reminders", label: "Overview" },
          { to: "/smart-reminders/performance", label: "Performance" },
        ],
      },
      { to: "/automation-rules", label: "Automation Rules" },
      { to: "/ai-usage-configuration", label: "AI Usage & Configuration" },
      { to: "/ai-receptionist", label: "AI Receptionist" },
      { to: "/reception-copilot", label: "Reception Copilot" },
      { to: "/tenant-messaging", label: "Tenant Messaging (Twilio)" },
      { to: "/a2p-registration", label: "A2P 10DLC Registration" },
      { to: "/messaging-environment", label: "Messaging Environment" },
      { to: "/ai-booking-analytics", label: "AI Booking Analytics" },
      { to: "/ai-customer-profile", label: "AI Customer Profile" },
      { to: "/ai-checkout-upsell", label: "AI Checkout Upsell" },
      { to: "/ai-review-reputation", label: "AI Review Reputation" },
      { to: "/ai-scheduling-optimizer", label: "AI Scheduling Optimizer" },
      { to: "/ai-ocr-receipt", label: "AI OCR Receipt" },
      { to: "/ai-forecasting", label: "AI Forecasting" },
      { to: "/ai-business-adoption", label: "AI Business Assistant" },
      { to: "/ai-platform", label: "AI Platform" },   // Constitution 10 (kept through the Sep 2026 layout merge)
      { to: "/ai-packages", label: "AI Packages" },
      { to: "/ai-plans", label: "AI Plans" },
      { to: "/ai-subscriptions", label: "AI Subscriptions" },
      { to: "/usage-limits", label: "Usage Limits" },
    ],
  },
  {
    section: "System Settings",
    items: [
      { to: "/settings", label: "General Settings" },
      { to: "/subscriptions", label: "Billing & Subscriptions" },
      { to: "/billing-cycle", label: "Billing Cycle" },
      { to: "/loyalty-network", label: "Loyalty Network" },
      { to: "/integrations", label: "Integrations" },
      { to: "/devices-management", label: "Device Management" },
      { to: "/security-compliance", label: "Security & Compliance" },
      {
        to: "/audit-logs",
        label: "Audit Logs",
        children: [
          { to: "/audit-logs", label: "Overview" },
          { to: "/audit-logs/browse", label: "Browse Events" },
        ],
      },
      { to: "/check-in-devices", label: "Check-In Devices" },
    ],
  },
  {
    section: "Support",
    items: [
      { to: "/support-access", label: "Support Center", badge: "support" },
      { to: "/system-operations", label: "System Operations" },   // Constitution 11 (kept through the Sep 2026 layout merge)
      { to: "/jobs", label: "Jobs & Dead Letters" },   // BUILD_PLAN Phase 2: the job queue + event dead letters
      { to: "/database", label: "Database" },   // BUILD_PLAN Phase 10: Constitution 1 §97 System Operations → Database
      { to: "/mobile-versions", label: "Mobile App Versions" },   // BUILD_PLAN Phase 13 B: Constitution 6 §150 app version dashboard
      { to: "/request-search", label: "Request Search" },   // BUILD_PLAN Phase 14 A: Constitution 11 §291–292 request / correlation / trace search
      { to: "/oncall", label: "On-call & Monitoring" },   // BUILD_PLAN Phase 14 C: Constitution 11 §262–265 on-call chain, paged alerts, synthetic probes, backups
      { to: "/ops-dashboards", label: "Operations Dashboards" },   // BUILD_PLAN Phase 14 B: Storage / Mobile / Deployment / Redis / Payments / Communications / Incidents (C11 §145, §149–155)
      { to: "/branch-health", label: "Branch Health" },   // BUILD_PLAN Phase 14 B: C11 §345
      { to: "/system-status", label: "System Status" },
      { to: "/system-health", label: "System Health" },
      { to: "/project-status", label: "Project Status" },
      { to: "/alerts", label: "Alerts" },
    ],
  },
];

export function AdminLayout() {
  const { principal, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  // Collapsible nav sections (reference expandable groups). Default = all expanded, so every item renders
  // on first paint; collapse is per-session in-memory state and never hides the active route's section.
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    new Set(),
  );
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const toggleSection = (s: string) =>
    setCollapsedSections((prev) => {
      const n = new Set(prev);
      if (n.has(s)) n.delete(s);
      else n.add(s);
      return n;
    });
  const [q, setQ] = useState("");
  const [counts, setCounts] = useState<{
    newApplications: number;
    newLeads: number;
    hardwarePending: number;
    activeSupportSessions: number;
  } | null>(null);
  const [alertsUnread, setAlertsUnread] = useState(0);
  const [health, setHealth] = useState<{
    ok?: boolean;
    database?: { ok: boolean } | null;
    gateway?: { ok: boolean } | null;
  } | null>(null);
  const [healthLoaded, setHealthLoaded] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [menuOpen]);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // live sidebar badges (new applications / new leads / pending hardware / active support sessions)
  useEffect(() => {
    let alive = true;
    // SCAN (Oct 12 2026): poll only what this role may read — every role used to get three 403s per page per minute
    const may = (k: string) => !!principal?.permissions?.includes(k);
    const load = () => {
      if (may("super_admin.analytics.view")) superAdminApi
        .platformState()
        .then((s: any) => {
          if (alive && s?.counts) setCounts(s.counts);
        })
        .catch(() => {
          /* badges are decoration; never block the shell */
        });
      if (may("super_admin.system_operations.view")) superAdminApi
        .alertsUnreadCount()
        .then((n: any) => {
          if (alive) setAlertsUnread(Number(n) || 0);
        })
        .catch(() => {
          /* alerts table may not be synced yet */
        });
      if (!may("super_admin.system_operations.view")) { if (alive) setHealthLoaded(true); } else superAdminApi
        .systemHealth()
        .then((h: any) => {
          if (alive) {
            setHealth(h || null);
            setHealthLoaded(true);
          }
        })
        .catch(() => {
          if (alive) {
            setHealth(null);
            setHealthLoaded(true);
          }
        });
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [principal?.permissions]);

  const badgeFor = (k?: string) => {
    if (!k || !counts) return 0;
    return k === "applications"
      ? counts.newApplications
      : k === "leads"
        ? counts.newLeads
        : k === "hardware"
          ? counts.hardwarePending
          : counts.activeSupportSessions;
  };

  // Honest platform-status badge: never claims "Operational" unless real health says so; degrades to Unknown/Unavailable.
  const sysStatus: { label: string; color: string } = (() => {
    if (!healthLoaded)
      return { label: "Checking status…", color: "var(--muted, #8a7f6d)" };
    if (!health)
      return { label: "Status Unavailable", color: "var(--muted, #8a7f6d)" };
    const dbOk = health.database ? health.database.ok : undefined;
    const gwOk = health.gateway ? health.gateway.ok : undefined;
    if (dbOk === false)
      return { label: "Database Outage", color: "var(--danger, #c0392b)" };
    if (health.ok === false || gwOk === false)
      return { label: "Degraded", color: "var(--warn, #b8860b)" };
    if (health.ok === true)
      return { label: "All Systems Operational", color: "var(--ok, #2e7d32)" };
    return { label: "Status Unknown", color: "var(--muted, #8a7f6d)" };
  })();

  return (
    <ScopeProvider>
      <div className="shell theme-superadmin">
        <aside
          className={`sidebar transform transition-transform duration-500 ease-in-out ${mobileSidebarOpen
              ? "max-[800px]:translate-x-0"
              : "max-[800px]:-translate-x-full"
            }`}
        >
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(false)}
            className="absolute right-3 top-3 z-10 hidden h-9 w-9 items-center justify-center rounded-lg border border-[#e5d8c3] bg-white text-[#5b5043] shadow-sm max-[800px]:flex"
            aria-label="Close navigation"
          >
            <FaTimes size={17} />
          </button>
          <div className="brand">
            <img
              className="brandlogo"
              src="/brand/aipowersalon-logo.png"
              alt="AI PowerSalon"
              draggable={false}
            />
          </div>
          <nav className="sidenav">
            {visibleNavGroups(NAV_GROUPS, principal?.permissions).map((g, gi) => {
              const isCollapsed = g.section
                ? collapsedSections.has(g.section)
                : false;
              return (
                <div key={g.section || `g${gi}`}>
                  {g.section ? (
                    <button
                      type="button"
                      className="navgroup"
                      aria-expanded={!isCollapsed}
                      onClick={() => toggleSection(g.section!)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        width: "100%",
                        background: "none",
                        border: 0,
                        font: "inherit",
                        color: "inherit",
                        cursor: "pointer",
                      }}
                    >
                      <span>{g.section}</span>
                      <span
                        aria-hidden="true"
                        style={{ fontSize: 9, opacity: 0.6 }}
                      >
                        {isCollapsed ? "\u25B8" : "\u25BE"}
                      </span>
                    </button>
                  ) : null}
                  {!isCollapsed
                    ? g.items.map((n) =>
                      n.disabled ? (
                        <span
                          key={n.label}
                          className="navlink"
                          aria-disabled="true"
                          title="Coming soon"
                          style={{
                            opacity: 0.45,
                            cursor: "default",
                            pointerEvents: "none",
                          }}
                        >
                          <span className="dot" />
                          <span className="lbl">{n.label}</span>
                        </span>
                      ) : n.children ? (
                        (() => {
                          const expanded =
                            loc.pathname === n.to ||
                            loc.pathname.startsWith(n.to + "/");
                          return (
                            <div key={n.to}>
                              <NavLink
                                to={n.to}
                                className={() =>
                                  "navlink" + (expanded ? " active" : "")
                                }
                                aria-expanded={expanded}
                              >
                                <span className="dot" />
                                <span className="lbl">{n.label}</span>
                                {badgeFor(n.badge) > 0 ? (
                                  <span className="nbadge">
                                    {badgeFor(n.badge)}
                                  </span>
                                ) : null}
                              </NavLink>
                              {expanded ? (
                                <div
                                  className="subnav"
                                  role="group"
                                  aria-label={n.label}
                                  style={{
                                    marginLeft: 14,
                                    borderLeft: "1px solid var(--line)",
                                    paddingLeft: 6,
                                  }}
                                >
                                  {n.children.map((c) => (
                                    <NavLink
                                      key={c.to}
                                      to={c.to}
                                      end
                                      className={({ isActive }) =>
                                        "navlink" +
                                        ((
                                          c.to.includes("?")
                                            ? c.to ===
                                            loc.pathname + loc.search
                                            : isActive && !loc.search
                                        )
                                          ? " active"
                                          : "")
                                      }
                                      style={{ fontSize: 12.5 }}
                                    >
                                      <span
                                        className="dot"
                                        style={{ opacity: 0.5 }}
                                      />
                                      <span className="lbl">{c.label}</span>
                                    </NavLink>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          );
                        })()
                      ) : (
                        <NavLink key={n.to} to={n.to} className={link}>
                          <span className="dot" />
                          <span className="lbl">{n.label}</span>
                          {n.isNew ? (
                            <span
                              className="nbadge"
                              style={{
                                background: "var(--g7,#A96F22)",
                                color: "#fff",
                              }}
                            >
                              New
                            </span>
                          ) : null}
                          {badgeFor(n.badge) > 0 ? (
                            <span className="nbadge">
                              {badgeFor(n.badge)}
                            </span>
                          ) : null}
                        </NavLink>
                      ),
                    )
                    : null}
                </div>
              );
            })}
            <NavLink
              to="/help-center"
              className={link}
              style={{ marginTop: 10 }}
            >
              <span className="dot" />
              <span className="lbl">Visit AI PowerSalon Help Center</span>
            </NavLink>
          </nav>
          <div className="statuscard">
            <div className="t">System Status</div>
            <div className="s" style={{ color: sysStatus.color }}>
              {sysStatus.label}
            </div>
            <div className="v">v2.4.1</div>
          </div>
        </aside>
        <div className="main" style={{ overflowY: "auto" }}>
          <header className="topbar relative !gap-3 sm:!gap-3  !px-2 sm:!px-[20px]">
            <PlatformSearchBox />   {/* Constitution 7 §140–§141: permission-aware platform search */}
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#e5d8c3] bg-white text-[#5b5043] shadow-sm max-[800px]:flex"
              aria-label="Open navigation"
            >
              <FaBars size={18} />
            </button>
            <TenantScopeSelector />

            <div className="search !hidden md:!flex">
              <input
                placeholder="Search anything…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    nav(`/tenants?search=${encodeURIComponent(q)}`);
                  }
                }}
              />

              <button
                className="searchbtn"
                aria-label="Search"
                onClick={() => nav(`/tenants?search=${encodeURIComponent(q)}`)}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="M21 21l-4-4" />
                </svg>
              </button>
            </div>
            <button
              className=" !flex md:!hidden"
              aria-label="Open search"
              onClick={() => setSearchOpen(true)}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4-4" />
              </svg>
            </button>
            <div className="topright">
              <div className="clock ">
                <div className="text-xs sm:text-sm font-bold">
                  {now.toLocaleDateString("en-US", {
                    month: "short",
                    day: "2-digit",
                    year: "numeric",
                  })}
                </div>
                <div className="text-xs sm:text-sm">
                  {now.toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </div>
              </div>
              <button
                className="tbicon !hidden sm:!flex"
                title="Alerts"
                aria-label="Alerts"
                onClick={() => nav("/alerts")}
              >
                <svg
                  width="19"
                  height="19"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                {alertsUnread > 0 ? (
                  <span className="tbbadge">
                    {alertsUnread > 99 ? "99+" : alertsUnread}
                  </span>
                ) : null}
              </button>
              <button
                className="tbicon !hidden sm:!flex"
                title="Support sessions"
                aria-label="Support sessions"
                onClick={() => nav("/support-access")}
              >
                <svg
                  width="19"
                  height="19"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7A8.38 8.38 0 0 1 4 11.5 8.5 8.5 0 0 1 21 11.5z" />
                </svg>
                {counts && counts.activeSupportSessions > 0 ? (
                  <span className="tbbadge">
                    {counts.activeSupportSessions}
                  </span>
                ) : null}
              </button>
              <div className="who" ref={profileMenuRef} onClick={() => setMenuOpen((o) => !o)} style={{ position: "relative" }}>
                <ProfileAvatarWithPreview
                  name={principal?.fullName || "Super Admin"}
                  url={principal?.avatarUrl}
                  size={32}
                  type="superadmin"
                  badgeLabel="Super Admin Profile"
                  subtitle="Platform Super Admin"
                  showPreview={true}
                />
                <div>
                  <div className="nm">
                    {principal?.fullName || "Super Admin"}
                  </div>
                  <div className="rl">Administrator</div>
                </div>
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    transform: menuOpen ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 0.15s ease",
                  }}
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
                {menuOpen ? (
                  <div
                    className="whomenu"
                    role="menu"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      position: "absolute",
                      top: "calc(100% + 8px)",
                      right: 0,
                      left: "auto",
                      minWidth: "180px",
                      background: "#ffffff",
                      border: "1px solid #E5D8C3",
                      borderRadius: "12px",
                      boxShadow: "0 12px 32px rgba(40, 25, 10, 0.16)",
                      padding: "6px",
                      zIndex: 100,
                      whiteSpace: "normal",
                      gap: "3px",
                    }}
                  >
                    <button
                      type="button"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        width: "100%",
                        padding: "8px 12px",
                        border: "none",
                        background: "transparent",
                        borderRadius: "8px",
                        fontSize: "13px",
                        fontWeight: 500,
                        color: "#2c251e",
                        cursor: "pointer",
                        textAlign: "left",
                        whiteSpace: "nowrap",
                        boxSizing: "border-box",
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpen(false);
                        nav("/account");
                      }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#A96F22" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                        <circle cx="12" cy="7" r="4" />
                      </svg>
                      Account
                    </button>
                    <button
                      type="button"
                      className="sm:hidden"
                      title="Support sessions"
                      aria-label="Support sessions"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        width: "100%",
                        padding: "8px 12px",
                        border: "none",
                        background: "transparent",
                        borderRadius: "8px",
                        fontSize: "13px",
                        fontWeight: 500,
                        color: "#2c251e",
                        cursor: "pointer",
                        textAlign: "left",
                        whiteSpace: "nowrap",
                        boxSizing: "border-box",
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpen(false);
                        nav("/support-access");
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#A96F22" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7A8.38 8.38 0 0 1 4 11.5 8.5 8.5 0 0 1 21 11.5z" />
                        </svg>
                        Support Access
                      </span>
                      {counts && counts.activeSupportSessions > 0 ? <span className="tbbadge">{counts.activeSupportSessions}</span> : null}
                    </button>
                    <button
                      type="button"
                      className="sm:hidden"
                      title="Alerts"
                      aria-label="Alerts"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        width: "100%",
                        padding: "8px 12px",
                        border: "none",
                        background: "transparent",
                        borderRadius: "8px",
                        fontSize: "13px",
                        fontWeight: 500,
                        color: "#2c251e",
                        cursor: "pointer",
                        textAlign: "left",
                        whiteSpace: "nowrap",
                        boxSizing: "border-box",
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpen(false);
                        nav("/alerts");
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#A96F22" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                        </svg>
                        Notifications
                      </span>
                      {alertsUnread > 0 ? (
                        <span className="tbbadge">
                          {alertsUnread > 99 ? "99+" : alertsUnread}
                        </span>
                      ) : null}
                    </button>
                    <div style={{ height: "1px", background: "#E5D8C3", margin: "4px 2px" }} />
                    <button
                      type="button"
                      className="danger"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        width: "100%",
                        padding: "8px 12px",
                        border: "none",
                        background: "transparent",
                        borderRadius: "8px",
                        fontSize: "13px",
                        fontWeight: 600,
                        color: "#b23b3b",
                        cursor: "pointer",
                        textAlign: "left",
                        whiteSpace: "nowrap",
                        boxSizing: "border-box",
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpen(false);
                        void logout();
                      }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#b23b3b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                        <polyline points="16 17 21 12 16 7" />
                        <line x1="21" y1="12" x2="9" y2="12" />
                      </svg>
                      Sign out
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
            {/* Mobile Search Overlay */}
            {searchOpen && (
              <div className="absolute left-0 top-0 z-50 flex h-full w-full items-center gap-2 bg-[#f8f5ed] px-2 sm:hidden">

                <div className="search flex flex-1">
                  <input
                    autoFocus
                    placeholder="Search anything…"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        nav(`/tenants?search=${encodeURIComponent(q)}`);
                        setSearchOpen(false);
                      }
                    }}
                  />

                  <button
                    className="searchbtn"
                    aria-label="Search"
                    onClick={() => {
                      nav(`/tenants?search=${encodeURIComponent(q)}`);
                      setSearchOpen(false);
                    }}
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="11" cy="11" r="7" />
                      <path d="M21 21l-4-4" />
                    </svg>
                  </button>
                </div>

                {/* Close Button */}
                <button
                  className="tbicon shrink-0"
                  aria-label="Close search"
                  onClick={() => setSearchOpen(false)}
                >
                  ✕
                </button>
              </div>
            )}
          </header>
          <SupportModeBanner /><Outlet /><StepUpHost />
        </div>
      </div>
    </ScopeProvider>
  );
}
