// tenant-nav.tsx — data-driven tenant POS navigation (single source for the sidebar).
// TODAY items map to EXISTING working routes (reused, not duplicated). Collapsible-group children that don't yet
// have a dedicated screen route to /tenant/* and render the shared, gated FeaturePage (never a dead link/blank page).
// Each item: { id, label, route, icon, permission?, featureFlag?, aiPackageCode?, badgeKey? }.
//
// BUILD_PLAN Phase 9 (Constitution 2 §permission-driven navigation): the sidebar follows PERMISSIONS, never role names.
// A section may declare the key every item in it needs; an item declares its own key(s) (a list = ALL of them). There
// are no role lists and no OWNER shortcut — an owner sees everything because the owner HOLDS every tenant key. The keys
// were chosen so each server role (OWNER, MANAGER, FRONT_DESK / RECEPTION, TECHNICIAN) sees exactly what it saw under
// the old role lists; the per-role snapshot and the catalog check live in tenant-nav.wiring.test.ts.
import type { ReactNode } from 'react';
import { t } from '@aipowersalon/mobile-sdk/i18n';

export type BadgeKey =
  | 'checkIn' | 'techQueue' | 'customerQueue' | 'serviceDone' | 'checkout' | 'messages'
  | 'notifications' | 'techReportsPending'
  | 'inventoryAlerts' | 'reviews' | 'payrollPending' | 'billingAlerts' | 'aiUsageAlerts' | 'supportTickets' | 'setupHealthAlerts';

/** One catalog key, or a list that must ALL be held. */
export type NavPermission = string | string[];
export interface NavItem {
  id: string; label: string; route: string; icon: IconName;
  permission?: NavPermission; featureFlag?: string; aiPackageCode?: string; badgeKey?: BadgeKey;
}
export interface NavSection {
  /** stable id (the English label): React key + the sidebar's open/closed memory — never the translated `section` */
  id: string;
  section: string; icon?: IconName; collapsible?: boolean; permission?: string; items: NavItem[];
}

// ---- compact line-icon set (brown/gold stroke, sized in CSS) ----
export type IconName =
  | 'overview' | 'dashboard' | 'checkin' | 'booking' | 'techqueue' | 'queue' | 'serving' | 'done' | 'checkout'
  | 'customers' | 'team' | 'services' | 'payments' | 'comms' | 'marketing' | 'ai' | 'reports' | 'management'
  | 'devices' | 'account' | 'dot' | 'chevron' | 'lock' | 'help' | 'pin'
  | 'walkin' | 'scissors' | 'product' | 'receipt' | 'drawer' | 'search' | 'bell' | 'mail' | 'shield';

const P = (d: string) => <path d={d} />;
const ICONS: Record<IconName, ReactNode> = {
  overview: <>{P('M3 3h8v8H3z')}{P('M13 3h8v5h-8z')}{P('M13 10h8v11h-8z')}{P('M3 13h8v8H3z')}</>,
  dashboard: <>{P('M3 13a9 9 0 0118 0')}{P('M12 13l4-3')}<circle cx="12" cy="13" r="1.6" /></>,
  checkin: <>{P('M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2')}<circle cx="9" cy="7" r="4" />{P('M19 8l2 2 3-3')}</>,
  booking: <>{P('M3 4h18v18H3z')}{P('M3 9h18M8 2v4M16 2v4')}</>,
  techqueue: <><circle cx="9" cy="8" r="3.2" />{P('M3 20c0-3.3 2.7-6 6-6')}{P('M15 11l2 2 4-4')}</>,
  queue: <>{P('M3 6h18M3 12h18M3 18h12')}</>,
  serving: <><circle cx="12" cy="12" r="9" />{P('M12 7v5l3 2')}</>,
  done: <><circle cx="12" cy="12" r="9" />{P('M8 12l3 3 5-6')}</>,
  checkout: <>{P('M6 6h15l-1.5 9h-12z')}<circle cx="9" cy="20" r="1.4" /><circle cx="18" cy="20" r="1.4" />{P('M6 6L5 3H2')}</>,
  customers: <><circle cx="9" cy="8" r="3.2" />{P('M2 21c0-3.9 3.1-7 7-7s7 3.1 7 7')}{P('M16 3.5a3.5 3.5 0 010 7M22 21a5.5 5.5 0 00-4-5.3')}</>,
  team: <><circle cx="7" cy="8" r="3" /><circle cx="17" cy="8" r="3" />{P('M2 20c0-3 2.2-5 5-5M22 20c0-3-2.2-5-5-5')}</>,
  services: <>{P('M14 4l6 6L10 20H4v-6z')}{P('M12 6l6 6')}</>,
  payments: <>{P('M2 6h20v12H2z')}{P('M2 10h20M6 15h4')}</>,
  comms: <>{P('M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z')}</>,
  marketing: <>{P('M3 11l16-7v16L3 13z')}{P('M7 12v5l3 1')}</>,
  ai: <>{P('M12 2l2.2 5.5L20 9l-5 4 1.5 6L12 16l-4.5 3L9 13 4 9l5.8-1.5z')}</>,
  reports: <>{P('M3 3v18h18')}{P('M7 15l3-4 3 3 5-7')}</>,
  management: <><circle cx="12" cy="12" r="3" />{P('M19 12a7 7 0 00-.1-1.3l2-1.5-2-3.4-2.3 1a7 7 0 00-2.3-1.3L14 2h-4l-.6 2.5a7 7 0 00-2.3 1.3l-2.3-1-2 3.4 2 1.5A7 7 0 005 12c0 .4 0 .9.1 1.3l-2 1.5 2 3.4 2.3-1c.7.6 1.5 1 2.3 1.3L10 22h4l.6-2.5c.8-.3 1.6-.7 2.3-1.3l2.3 1 2-3.4-2-1.5c.1-.4.1-.9.1-1.3z')}</>,
  devices: <>{P('M3 4h14v10H3z')}{P('M19 8h2v12h-8v-2')}{P('M8 18h4')}</>,
  account: <><circle cx="12" cy="8" r="4" />{P('M4 21c0-4 4-6 8-6s8 2 8 6')}</>,
  dot: <circle cx="12" cy="12" r="2.4" />,
  chevron: P('M9 6l6 6-6 6'),
  lock: <>{P('M5 11h14v10H5z')}{P('M8 11V8a4 4 0 018 0v3')}</>,
  help: <><circle cx="12" cy="12" r="9" />{P('M9.5 9a2.5 2.5 0 113.5 2.3c-.8.4-1 .9-1 1.7')}<circle cx="12" cy="17" r="1" /></>,
  pin: <>{P('M12 21s7-5.6 7-11a7 7 0 10-14 0c0 5.4 7 11 7 11z')}<circle cx="12" cy="10" r="2.6" /></>,
  walkin: <><circle cx="13" cy="4" r="2" />{P('M13 7l-2 5 3 2 1.5 6M11 12L7 14M13 9.5l3 1.5')}</>,
  scissors: <><circle cx="6" cy="6" r="2.4" /><circle cx="6" cy="18" r="2.4" />{P('M8 7.6l12 9M8 16.4L20 7.5')}</>,
  product: <>{P('M3 7l9-4 9 4v10l-9 4-9-4z')}{P('M3 7l9 4 9-4M12 11v10')}</>,
  receipt: <>{P('M6 9V3h12v6')}{P('M6 17H4a2 2 0 01-2-2v-3a2 2 0 012-2h16a2 2 0 012 2v3a2 2 0 01-2 2h-2')}{P('M6 14h12v7H6z')}</>,
  drawer: <>{P('M3 10h18v8a2 2 0 01-2 2H5a2 2 0 01-2-2z')}{P('M3 10l2-5h14l2 5M9.5 14h5')}</>,
  search: <><circle cx="11" cy="11" r="7" />{P('M21 21l-4.35-4.35')}</>,
  bell: <>{P('M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9')}{P('M13.7 21a2 2 0 01-3.4 0')}</>,
  mail: <>{P('M3 5h18v14H3z')}{P('M3 6l9 7 9-7')}</>,
  shield: <>{P('M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z')}{P('M9 12l2 2 4-4')}</>,
};
export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="18" height="18" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICONS[name]}
    </svg>
  );
}

// Vietnamese POS mandate (WP-B): every `label` / `section` is a GETTER, translated when the sidebar reads it — this table
// is built once at import, and a language switch re-renders the shell in place (no reload, no remount), so a plain
// `label: t(...)` here would stay in the language the app started in. Never copy these objects at import time.
// TODAY items reuse existing working routes; group children use /tenant/* (FeaturePage) unless an existing
// screen already covers them (then we point at the existing route to avoid duplication).
export const TENANT_NAV: NavSection[] = [
  { id: 'TODAY', get section() { return t('pos.today_9'); }, items: [
    { id: 'overview', get label() { return t('pos.overview'); }, route: '/overview', icon: 'overview', permission: 'dashboard.view' },
    { id: 'dashboard', get label() { return t('pos.live_operations'); }, route: '/dashboard', icon: 'dashboard', permission: 'reports.view' },  // Kevin's call (Jul 27): keep this name — do not rename to match the mockup
    { id: 'checkin', get label() { return t('pos.check_in_2'); }, route: '/check-in', icon: 'checkin', badgeKey: 'checkIn', permission: ['checkin.view', 'queue.manage'] },
    { id: 'booking', get label() { return t('pos.booking'); }, route: '/booking', icon: 'booking', permission: ['booking.view', 'customers.edit'] },
    { id: 'techqueue', get label() { return t('pos.tech_queue'); }, route: '/tech-queue', icon: 'techqueue', badgeKey: 'techQueue', permission: 'queue.view' },
    { id: 'queue', get label() { return t('pos.customer_queue'); }, route: '/queue', icon: 'queue', badgeKey: 'customerQueue', permission: 'queue.view' },
    { id: 'serving', get label() { return t('pos.serving'); }, route: '/serving', icon: 'serving', permission: 'serving.view' },
    { id: 'done', get label() { return t('pos.service_done'); }, route: '/service-done', icon: 'done', badgeKey: 'serviceDone', permission: 'serving.view' },
    { id: 'checkout', get label() { return t('pos.checkout'); }, route: '/checkout', icon: 'checkout', badgeKey: 'checkout', permission: 'checkout.view' },
    // BUILD_PLAN Phase 9: the salon's one approvals inbox (agent D's screen) — everyone who may see or ask for approvals
    { id: 'approvals', get label() { return t('pos.approvals'); }, route: '/approvals', icon: 'shield', permission: 'approvals.view' },
    // BUILD_PLAN Phase 8: every role with community.feed.view (a technician only when the salon granted it — the server says so)
    { id: 'safety-community', get label() { return t('pos.safety_community'); }, route: '/community', icon: 'shield', permission: 'community.feed.view' },
  ]},

  { id: 'CUSTOMERS', get section() { return t('pos.customers_3'); }, icon: 'customers', collapsible: true, permission: 'customers.edit', items: [
    { id: 'cust-dir', get label() { return t('pos.customer_directory'); }, route: '/customers', icon: 'dot', permission: 'customers.view' },
    { id: 'cust-profiles', get label() { return t('pos.customer_profiles'); }, route: '/tenant/customers/profiles', icon: 'dot' },
    { id: 'cust-history', get label() { return t('pos.appointment_history'); }, route: '/tenant/customers/appointment-history', icon: 'dot' },
    { id: 'cust-loyalty', get label() { return t('pos.loyalty_rewards'); }, route: '/tenant/customers/loyalty', icon: 'dot', featureFlag: 'loyalty' },
    { id: 'cust-giftcards', get label() { return t('pos.gift_cards'); }, route: '/tenant/customers/gift-cards', icon: 'dot' },
    { id: 'cust-notes', get label() { return t('pos.customer_notes'); }, route: '/tenant/customers/notes', icon: 'dot' },
    { id: 'cust-saved-cards', get label() { return t('pos.saved_cards'); }, route: '/tenant/customers/saved-cards', icon: 'dot' },
    { id: 'cust-retention', get label() { return t('pos.customer_retention'); }, route: '/tenant/customers/retention', icon: 'dot' },
    { id: 'cust-showcase', get label() { return t('pos.nailshowcase'); }, route: '/nail-showcase', icon: 'dot' },
  ]},

  // Mockup 11 shows Memberships as its own top-level group (was under CUSTOMERS until Jul 28, 2026). The route is
  // unchanged so deep links, tests, and the screen itself are untouched — only the sidebar placement moved.
  { id: 'MEMBERSHIPS', get section() { return t('pos.memberships_2'); }, icon: 'customers', collapsible: true, permission: 'customers.edit', items: [
    { id: 'memberships', get label() { return t('pos.memberships'); }, route: '/tenant/customers/memberships', icon: 'dot', featureFlag: 'memberships' },
  ]},

  { id: 'TEAM', get section() { return t('nav.section.team'); }, icon: 'team', collapsible: true, permission: 'technicians.edit', items: [
    { id: 'team-members', get label() { return t('pos.all_team_members'); }, route: '/tenant/team/members', icon: 'dot', permission: 'technicians.view' },
    { id: 'team-techs', get label() { return t('pos.technicians'); }, route: '/technicians', icon: 'dot', permission: 'technicians.view' },
    { id: 'team-appointments', get label() { return t('pos.technician_appointments'); }, route: '/tech-appointments', icon: 'dot' },
    { id: 'team-skills', get label() { return t('pos.skill_requests'); }, route: '/technicians/skill-requests', icon: 'dot' },
    { id: 'team-schedule', get label() { return t('pos.staff_schedule'); }, route: '/technicians/schedule', icon: 'dot' },
    { id: 'team-timeclock', get label() { return t('pos.time_clock'); }, route: '/tenant/team/time-clock', icon: 'dot' },
    { id: 'team-queue', get label() { return t('pos.technician_queue'); }, route: '/tech-queue', icon: 'dot' },
    { id: 'team-turn-queue', get label() { return t('pos.turn_queue'); }, route: '/tenant/team/turn-queue', icon: 'dot', permission: 'turn_queue.read' },
    { id: 'team-commission', get label() { return t('pos.commission'); }, route: '/tenant/reports/commission', icon: 'dot', permission: 'payroll.view' },
    { id: 'team-tips', get label() { return t('pos.tips'); }, route: '/tenant/team/tips', icon: 'dot' },
    { id: 'team-payroll', get label() { return t('pos.payroll'); }, route: '/tenant/team/payroll', icon: 'dot', badgeKey: 'payrollPending', permission: 'payroll.view' },
    { id: 'team-performance', get label() { return t('pos.performance'); }, route: '/tenant/team/performance', icon: 'dot' },
    { id: 'team-profiles', get label() { return t('pos.technician_profiles'); }, route: '/tenant/team/profiles', icon: 'dot' },
    { id: 'team-permissions', get label() { return t('pos.roles_permissions'); }, route: '/tenant/team/permissions', icon: 'dot', permission: 'roles.view' },   // Decision 12: managers may manage roles too (service still reserves owner-level roles to the owner)
  ]},

  { id: 'SERVICES & PRODUCTS', get section() { return t('pos.services_products_2'); }, icon: 'services', collapsible: true, permission: 'services.edit', items: [
    { id: 'svc', get label() { return t('pos.services'); }, route: '/services', icon: 'dot', permission: 'services.view' },
    { id: 'svc-cats', get label() { return t('pos.service_categories'); }, route: '/tenant/services/categories', icon: 'dot' },
    { id: 'svc-pricing', get label() { return t('pos.pricing'); }, route: '/tenant/services/pricing', icon: 'dot' },
    { id: 'svc-addons', get label() { return t('pos.add_on_services'); }, route: '/tenant/services/add-ons', icon: 'dot' },
    { id: 'svc-packages', get label() { return t('pos.service_packages'); }, route: '/tenant/services/packages', icon: 'dot' },
    { id: 'svc-discounts', get label() { return t('pos.discounts'); }, route: '/tenant/services/discounts', icon: 'dot' },
    { id: 'products', get label() { return t('pos.products'); }, route: '/tenant/products', icon: 'dot', permission: 'inventory.view' },
    { id: 'inventory', get label() { return t('pos.inventory'); }, route: '/tenant/inventory', icon: 'dot', permission: 'inventory.view' },
    { id: 'inv-po', get label() { return t('pos.purchase_orders'); }, route: '/tenant/inventory/purchase-orders', icon: 'dot', permission: 'inventory.purchase_order.view' },
    { id: 'inv-vendors', get label() { return t('pos.vendors'); }, route: '/tenant/inventory/vendors', icon: 'dot', permission: 'inventory.vendor.manage' },
    { id: 'inv-alerts', get label() { return t('pos.low_stock_alerts_2'); }, route: '/tenant/inventory/alerts', icon: 'dot', badgeKey: 'inventoryAlerts', permission: 'inventory.view' },
  ]},

  { id: 'PAYMENTS & MONEY', get section() { return t('pos.payments_money_2'); }, icon: 'payments', collapsible: true, permission: 'reports.view', items: [
    { id: 'pay-overview', get label() { return t('pos.payments_overview'); }, route: '/tenant/payments/overview', icon: 'dot' },
    { id: 'pay-tx', get label() { return t('pos.transactions'); }, route: '/tenant/payments/transactions', icon: 'dot' },
    { id: 'pay-drawer', get label() { return t('pos.cash_drawer'); }, route: '/cash-drawer', icon: 'dot', permission: 'checkout.process_payment' },
    { id: 'pay-closeout', get label() { return t('pos.daily_closeout'); }, route: '/cash-handoffs', icon: 'dot' },
    { id: 'pay-refunds', get label() { return t('pos.refunds_voids'); }, route: '/tenant/payments/refunds-voids', icon: 'dot', permission: 'checkout.approve_refund' },
    { id: 'pay-split', get label() { return t('pos.split_payments'); }, route: '/tenant/payments/split-payments', icon: 'dot' },
    { id: 'pay-tips', get label() { return t('pos.tips_gratuity'); }, route: '/tenant/payments/tips', icon: 'dot' },
    { id: 'pay-gift', get label() { return t('pos.gift_card_payments'); }, route: '/tenant/customers/gift-cards', icon: 'dot' },
    { id: 'pay-terminals', get label() { return t('pos.payment_terminal_status'); }, route: '/tenant/devices/payment-terminals', icon: 'dot' },
    { id: 'pay-settle', get label() { return t('pos.deposits_settlements'); }, route: '/tenant/payments/settlements', icon: 'dot' },
    { id: 'pay-recon', get label() { return t('pos.ai_deposit_reconciliation'); }, route: '/tenant/payments/deposit-reconciliation', icon: 'dot', permission: 'reconciliation.view' },
    { id: 'pay-invoices', get label() { return t('pos.invoices'); }, route: '/tenant/payments/invoices', icon: 'dot' },
    { id: 'pay-expenses', get label() { return t('pos.expenses'); }, route: '/tenant/payments/expenses', icon: 'dot', permission: 'owner.expenses.view' },
    // 'AI Receipt Recognition' now lives in AI CENTER as 'ai-ocr-receipt' (/tenant/ai/ocr-receipt), next to the other
    // integrated AI workspaces. It was hidden here while AiOcrReceiptModule did not exist; that module now ships.
  ]},

  { id: 'COMMUNICATIONS', get section() { return t('pos.communications_2'); }, icon: 'comms', collapsible: true, permission: 'communications.view', items: [
    { id: 'comm-phone', get label() { return t('pos.phone_caller_id'); }, route: '/tenant/communications/phone', icon: 'dot', permission: 'settings.view' },
    { id: 'comm-ai-recept', get label() { return t('pos.ai_receptionist'); }, route: '/tenant/communications/ai-receptionist', icon: 'dot', aiPackageCode: 'ai_reception' },
    { id: 'comm-messages', get label() { return t('pos.messages_2'); }, route: '/messages', icon: 'dot', badgeKey: 'messages' },
    { id: 'comm-sms', get label() { return t('pos.sms_inbox'); }, route: '/tenant/communications/sms', icon: 'dot' },
    { id: 'comm-email', get label() { return t('pos.email'); }, route: '/tenant/communications/email', icon: 'dot', permission: 'settings.view' },
    { id: 'comm-reminders', get label() { return t('pos.appointment_reminders'); }, route: '/tenant/communications/reminders', icon: 'dot' },
    // Follow-Up Queue guide §07: this item opens the Follow-Up Queue (after-service tasks + a separate Missed Call type);
    // the old 'Missed Call Follow-Up' label did not match the page. Same id and route.
    { id: 'comm-missed', get label() { return t('fuq.nav'); }, route: '/follow-ups', icon: 'dot' },
    { id: 'comm-followup-settings', get label() { return t('pos.follow_up_settings'); }, route: '/settings/follow-ups', icon: 'dot', permission: 'settings.view' },
    { id: 'comm-messaging-setup', get label() { return t('pos.text_messaging_setup_2'); }, route: '/tenant/communications/messaging-setup', icon: 'dot', permission: 'settings.view' },
    // Next to Text Messaging Setup deliberately: the codes go out on the SAME Twilio account configured there, and
    // the verification screen is useless until that one is done. Putting them side by side makes the dependency
    // obvious instead of something a salon owner discovers from an error message.
    { id: 'comm-phone-verification', get label() { return t('pos.booking_phone_verification'); }, route: '/tenant/communications/phone-verification', icon: 'dot', permission: 'settings.view' },
    // Next to Booking Phone Verification deliberately: both decide what has to be PROVED about a phone number, and
    // both send their codes on the same tenant Twilio. Splitting them across the sidebar would hide the fact that
    // they are one policy with two surfaces.
    { id: 'cust-phone-management', get label() { return t('pos.customer_phone_management'); }, route: '/tenant/customers/phone-management', icon: 'dot', permission: 'customers.phone_manage' },
    { id: 'comm-notify', get label() { return t('pos.customer_notifications'); }, route: '/tenant/communications/notifications', icon: 'dot' },
    { id: 'comm-templates', get label() { return t('pos.message_templates'); }, route: '/tenant/communications/templates', icon: 'dot', permission: 'settings.view' },
  ]},

  { id: 'MARKETING & GROWTH', get section() { return t('pos.marketing_growth_2'); }, icon: 'marketing', collapsible: true, permission: 'marketing.view', items: [
    { id: 'mkt', get label() { return t('pos.marketing_dashboard'); }, route: '/tenant/marketing', icon: 'dot', featureFlag: 'marketing' },
    { id: 'mkt-campaigns', get label() { return t('pos.campaigns'); }, route: '/tenant/marketing/campaigns', icon: 'dot', featureFlag: 'marketing' },
    { id: 'mkt-sms', get label() { return t('pos.sms_marketing'); }, route: '/tenant/marketing/sms', icon: 'dot', featureFlag: 'marketing' },
    { id: 'mkt-email', get label() { return t('pos.email_marketing'); }, route: '/tenant/marketing/email', icon: 'dot', featureFlag: 'marketing' },
    { id: 'mkt-promos', get label() { return t('pos.promotions'); }, route: '/tenant/marketing/promotions', icon: 'dot' },
    { id: 'mkt-deals', get label() { return t('pos.deals_offers'); }, route: '/tenant/marketing/deals', icon: 'dot' },
    { id: 'mkt-coupons', get label() { return t('pos.coupons'); }, route: '/tenant/marketing/coupons', icon: 'dot' },
    { id: 'mkt-segments', get label() { return t('pos.customer_segments'); }, route: '/tenant/marketing/segments', icon: 'dot' },
    { id: 'mkt-birthdays', get label() { return t('pos.birthday_campaigns'); }, route: '/tenant/marketing/birthdays', icon: 'dot' },
    { id: 'mkt-winback', get label() { return t('pos.win_back_campaigns'); }, route: '/tenant/marketing/win-back', icon: 'dot' },
    { id: 'mkt-referrals', get label() { return t('pos.referrals'); }, route: '/tenant/marketing/referrals', icon: 'dot' },
    { id: 'mkt-reviews', get label() { return t('pos.reviews_2'); }, route: '/tenant/marketing/reviews', icon: 'dot', badgeKey: 'reviews' },
    { id: 'mkt-social', get label() { return t('pos.social_content'); }, route: '/tenant/marketing/social', icon: 'dot' },
    // 23-inch dual-screen spec §48: the salon's ads on the customer display (right panel while no checkout runs)
    { id: 'mkt-display-ads', get label() { return t('pos.customer_display_advertising'); }, route: '/tenant/marketing/display-ads', icon: 'dot' },
  ]},

  { id: 'AI CENTER', get section() { return t('pos.ai_center_3'); }, icon: 'ai', collapsible: true, permission: 'ai_business.view', items: [
    { id: 'ai-command', get label() { return t('pos.ai_command_center'); }, route: '/tenant/ai/command-center', icon: 'dot' },
    // Constitution 10 §166: governance, not a second KPI page — limits, budget and what AI may do.
    { id: 'ai-platform', get label() { return t('pos.ai_platform_limits'); }, route: '/tenant/ai/platform', icon: 'dot' },
    { id: 'ai-platform-settings', get label() { return t('pos.ai_settings'); }, route: '/tenant/ai/platform/settings', icon: 'dot', permission: 'ai.manage' },
    { id: 'ai-copilot', get label() { return t('pos.reception_copilot'); }, route: '/tenant/ai/copilot', icon: 'dot', aiPackageCode: 'ai_reception_copilot', permission: 'reception_copilot.use' },
    { id: 'ai-receptionist-ws', get label() { return t('pos.ai_receptionist'); }, route: '/tenant/ai/receptionist', icon: 'dot', aiPackageCode: 'ai_reception' },
    { id: 'ai-front-desk', get label() { return t('pos.ai_front_desk'); }, route: '/tenant/ai/receptionist/front-desk', icon: 'dot', aiPackageCode: 'ai_reception' },
    { id: 'ai-followups', get label() { return t('pos.ai_follow_ups'); }, route: '/tenant/ai/receptionist/follow-ups', icon: 'dot', aiPackageCode: 'ai_reception' },
    { id: 'ai-biz-setup', get label() { return t('pos.ai_business_setup'); }, route: '/tenant/ai/receptionist/business-setup', icon: 'dot', aiPackageCode: 'ai_reception' },
    { id: 'ai-calendar', get label() { return t('pos.ai_calendar'); }, route: '/tenant/ai/receptionist/calendar', icon: 'dot', aiPackageCode: 'ai_reception' },
    { id: 'ai-calls', get label() { return t('pos.ai_calls'); }, route: '/tenant/ai/receptionist/calls', icon: 'dot', aiPackageCode: 'ai_reception' },
    { id: 'ai-settings', get label() { return t('pos.ai_receptionist_settings'); }, route: '/tenant/ai/receptionist/settings', icon: 'dot', aiPackageCode: 'ai_reception' },
    { id: 'ai-reception', get label() { return t('pos.ai_reception_copilot'); }, route: '/tenant/ai/reception-copilot', icon: 'dot', aiPackageCode: 'ai_reception_copilot', permission: 'reception_copilot.use' },   // same screen and APIs as /tenant/ai/copilot (Nov 3 audit: it was gated on another package)
    { id: 'ai-booking', get label() { return t('pos.ai_booking_assistant'); }, route: '/tenant/ai/booking', icon: 'dot', aiPackageCode: 'ai_booking_assistant', permission: 'ai_booking.view' },
    { id: 'ai-queue', get label() { return t('pos.ai_queue_assistant'); }, route: '/tenant/ai/queue', icon: 'dot', aiPackageCode: 'ai_queue_technician_assignment', permission: 'ai_queue_assignment.view' },
    // BUILD_PLAN Phase 7: ONE entry — the optimizer workspace (the old /tenant/ai/scheduling package page redirects here)
    { id: 'ai-scheduling-optimizer', get label() { return t('pos.ai_scheduling_optimizer'); }, route: '/tenant/ai/scheduling-optimizer', icon: 'dot', aiPackageCode: 'ai_scheduling_optimizer', permission: 'ai_scheduling.view' },
    { id: 'ai-business', get label() { return t('pos.ai_business_assistant'); }, route: '/tenant/ai/business', icon: 'dot', aiPackageCode: 'ai_business_assistant' },
    { id: 'ai-business-branches', get label() { return t('pos.ai_branch_comparison'); }, route: '/tenant/ai/business/branches', icon: 'dot', aiPackageCode: 'ai_business_assistant' },
    { id: 'ai-business-alerts', get label() { return t('pos.ai_business_alerts'); }, route: '/tenant/ai/business/alerts', icon: 'dot', aiPackageCode: 'ai_business_assistant' },
    { id: 'ai-business-reports', get label() { return t('pos.ai_business_reports'); }, route: '/tenant/ai/business/reports', icon: 'dot', aiPackageCode: 'ai_business_assistant' },
    { id: 'ai-marketing', get label() { return t('pos.ai_marketing_assistant'); }, route: '/tenant/ai/marketing', icon: 'dot', aiPackageCode: 'ai_marketing_assistant' },
    { id: 'ai-marketing-builder', get label() { return t('pos.campaign_builder'); }, route: '/tenant/ai/marketing/builder', icon: 'dot', aiPackageCode: 'ai_marketing_assistant' },
    { id: 'ai-marketing-studio', get label() { return t('pos.message_studio'); }, route: '/tenant/ai/marketing/studio', icon: 'dot', aiPackageCode: 'ai_marketing_assistant' },
    { id: 'ai-marketing-audiences', get label() { return t('pos.audience_builder'); }, route: '/tenant/ai/marketing/audiences', icon: 'dot', aiPackageCode: 'ai_marketing_assistant' },
    { id: 'ai-marketing-results', get label() { return t('pos.campaign_results'); }, route: '/tenant/ai/marketing/results', icon: 'dot', aiPackageCode: 'ai_marketing_assistant' },
    { id: 'ai-money-protection', get label() { return t('pos.ai_money_protection'); }, route: '/tenant/ai/money-protection', icon: 'dot', aiPackageCode: 'ai_fraud_money_protection', permission: 'ai_money_protection.view' },
    { id: 'ai-money-protection-alerts', get label() { return t('pos.money_protection_alerts'); }, route: '/tenant/ai/money-protection/alerts', icon: 'dot', aiPackageCode: 'ai_fraud_money_protection', permission: 'ai_money_protection.view_alerts' },
    { id: 'ai-money-protection-investigations', get label() { return t('pos.money_protection_investigations'); }, route: '/tenant/ai/money-protection/investigations', icon: 'dot', aiPackageCode: 'ai_fraud_money_protection', permission: 'ai_money_protection.view' },
    { id: 'ai-money-protection-rules', get label() { return t('pos.money_protection_rules'); }, route: '/tenant/ai/money-protection/rules', icon: 'dot', aiPackageCode: 'ai_fraud_money_protection', permission: 'ai_money_protection.view' },
    { id: 'ai-money-protection-settings', get label() { return t('pos.money_protection_settings'); }, route: '/tenant/ai/money-protection/settings', icon: 'dot', aiPackageCode: 'ai_fraud_money_protection', permission: 'ai_money_protection.view' },
    { id: 'ai-insights', get label() { return t('pos.ai_customer_insights'); }, route: '/tenant/ai/customer-insights', icon: 'dot', aiPackageCode: 'ai_insights' },
    { id: 'ai-checkout', get label() { return t('pos.ai_checkout_upsell_2'); }, route: '/tenant/ai/checkout-upsell', icon: 'dot', aiPackageCode: 'ai_checkout_upsell_assistant', permission: 'ai_checkout_upsell.view' },
    { id: 'ai-fraud', get label() { return t('pos.ai_fraud_protection'); }, route: '/tenant/ai/fraud-protection', icon: 'dot', aiPackageCode: 'ai_fraud_money_protection' },
    { id: 'ai-inventory', get label() { return t('pos.ai_inventory_assistant'); }, route: '/tenant/ai/inventory', icon: 'dot', aiPackageCode: 'ai_inventory_assistant', permission: 'ai_inventory.view' },
    { id: 'ai-reviews', get label() { return t('pos.ai_review_assistant'); }, route: '/tenant/ai/reviews', icon: 'dot', aiPackageCode: 'ai_review_reputation_assistant' },
    { id: 'ai-voice', get label() { return t('pos.ai_voice_transcription'); }, route: '/tenant/ai/voice-transcription', icon: 'dot', aiPackageCode: 'ai_voice_transcription', permission: 'ai_voice_transcription.view' },
    { id: 'ai-voice-history', get label() { return t('pos.voice_call_history'); }, route: '/tenant/ai/voice-transcription/history', icon: 'dot', aiPackageCode: 'ai_voice_transcription', permission: 'ai_voice_transcription.view_transcripts' },
    { id: 'ai-voice-search', get label() { return t('pos.voice_search'); }, route: '/tenant/ai/voice-transcription/search', icon: 'dot', aiPackageCode: 'ai_voice_transcription', permission: 'ai_voice_transcription.view_transcripts' },
    { id: 'ai-voice-followups', get label() { return t('pos.voice_follow_ups'); }, route: '/tenant/ai/voice-transcription/unresolved', icon: 'dot', aiPackageCode: 'ai_voice_transcription', permission: 'ai_voice_transcription.view' },
    { id: 'ai-voice-settings', get label() { return t('pos.voice_settings'); }, route: '/tenant/ai/voice-transcription/settings', icon: 'dot', aiPackageCode: 'ai_voice_transcription', permission: 'ai_voice_transcription.view' },
    { id: 'ai-receipt', get label() { return t('pos.ai_receipt_scanner'); }, route: '/tenant/ai/receipt-scanner', icon: 'dot', aiPackageCode: 'ai_ocr_receipt_scanner' },
    { id: 'ai-analytics', get label() { return t('pos.ai_analytics_forecasting'); }, route: '/tenant/ai/analytics', icon: 'dot', aiPackageCode: 'ai_analytics_forecasting', permission: 'ai_analytics.view' },
    { id: 'ai-plans', get label() { return t('pos.ai_plans_packages'); }, route: '/tenant/ai/plans', icon: 'dot' },
    { id: 'ai-cust-profile', get label() { return t('pos.customer_profile_ai'); }, route: '/tenant/ai/customer-profile', icon: 'dot' },
    { id: 'ai-cust-search', get label() { return t('pos.customer_search'); }, route: '/tenant/ai/customer-profile/search', icon: 'dot' },
    { id: 'ai-cust-duplicates', get label() { return t('pos.duplicate_review'); }, route: '/tenant/ai/customer-profile/duplicates', icon: 'dot' },
    { id: 'ai-cust-churn', get label() { return t('pos.churn_watch'); }, route: '/tenant/ai/customer-profile/churn', icon: 'dot' },
    { id: 'ai-cust-rebooking', get label() { return t('pos.rebooking'); }, route: '/tenant/ai/customer-profile/rebooking', icon: 'dot' },
    { id: 'ai-cust-recs', get label() { return t('pos.service_recommendations'); }, route: '/tenant/ai/customer-profile/recommendations', icon: 'dot' },
    { id: 'ai-cust-settings', get label() { return t('pos.customer_ai_settings'); }, route: '/tenant/ai/customer-profile/settings', icon: 'dot' },
    { id: 'ai-checkout-upsell', get label() { return t('pos.checkout_upsell_ai'); }, route: '/tenant/ai/checkout-upsell/settings', icon: 'dot', aiPackageCode: 'ai_checkout_upsell_assistant', permission: 'ai_checkout_upsell.view' },
    { id: 'ai-reputation', get label() { return t('pos.review_reputation_ai'); }, route: '/tenant/ai/reputation', icon: 'dot', aiPackageCode: 'ai_review_reputation_assistant' },
    // The real Receipt & Document workspace. Same aiPackageCode as the 'ai-receipt' discovery entry above — the
    // reputation pair ('ai-reviews' discovery + 'ai-reputation' workspace) uses this exact shape. Restored now that
    // AiOcrReceiptModule is registered in app.module and DB-backed (migrations 344 + 359); it was hidden while the
    // module did not exist. Blob preview + malware scan remain NotConnected and are labelled as such in the screen.
    { id: 'ai-ocr-receipt', get label() { return t('pos.receipt_document_ai'); }, route: '/tenant/ai/ocr-receipt', icon: 'dot', aiPackageCode: 'ai_ocr_receipt_scanner' },
    { id: 'ai-reputation-settings', get label() { return t('pos.reputation_ai_settings'); }, route: '/tenant/ai/reputation/settings', icon: 'dot' },
    { id: 'ai-cust-timeline', get label() { return t('pos.customer_timeline'); }, route: '/tenant/ai/customer-profile/timeline', icon: 'dot' },
    { id: 'ai-usage', get label() { return t('pos.ai_usage_limits'); }, route: '/tenant/ai/usage', icon: 'dot', badgeKey: 'aiUsageAlerts' },
  ]},

  { id: 'REPORTS', get section() { return t('pos.reports_2'); }, icon: 'reports', collapsible: true, permission: 'reports.view', items: [
    { id: 'rep-daily', get label() { return t('pos.daily_summary'); }, route: '/reports', icon: 'dot', permission: 'reports.view' },
    { id: 'rep-sales', get label() { return t('pos.sales_reports'); }, route: '/tenant/reports/sales', icon: 'dot' },
    { id: 'rep-appts', get label() { return t('pos.appointment_reports'); }, route: '/tenant/reports/appointments', icon: 'dot' },
    { id: 'rep-techs', get label() { return t('pos.technician_reports'); }, route: '/tenant/reports/technicians', icon: 'dot' },
    { id: 'rep-commission', get label() { return t('pos.commission_reports'); }, route: '/tenant/reports/commission', icon: 'dot' },
    { id: 'rep-payroll', get label() { return t('pos.payroll_reports'); }, route: '/tenant/team/payroll', icon: 'dot', permission: 'payroll.view' },
    { id: 'rep-customers', get label() { return t('pos.customer_reports'); }, route: '/tenant/reports/customers', icon: 'dot' },
    { id: 'rep-services', get label() { return t('pos.service_reports'); }, route: '/tenant/reports/services', icon: 'dot' },
    { id: 'rep-inventory', get label() { return t('pos.inventory_reports'); }, route: '/tenant/reports/inventory', icon: 'dot', permission: 'inventory.reports.view' },
    { id: 'rep-marketing', get label() { return t('pos.marketing_reports'); }, route: '/tenant/reports/marketing', icon: 'dot', permission: 'marketing.view' },
    { id: 'rep-ai', get label() { return t('pos.ai_reports'); }, route: '/tenant/reports/ai', icon: 'dot' },
    { id: 'rep-payments', get label() { return t('pos.payment_reports'); }, route: '/tenant/reports/payments', icon: 'dot' },
    { id: 'rep-tax', get label() { return t('pos.tax_reports'); }, route: '/tenant/reports/tax', icon: 'dot' },
    { id: 'rep-multi', get label() { return t('pos.multi_location_reports'); }, route: '/tenant/reports/multi-location', icon: 'dot', permission: 'owner.branches.compare' },
  ]},

  { id: 'MANAGEMENT', get section() { return t('pos.management_2'); }, icon: 'management', collapsible: true, permission: 'settings.view', items: [
    { id: 'mg-overview', get label() { return t('pos.management_overview'); }, route: '/tenant/management/overview', icon: 'dot' },
    { id: 'mg-profile', get label() { return t('pos.salon_profile'); }, route: '/tenant/management/salon-profile', icon: 'dot' },
    { id: 'mg-locations', get label() { return t('pos.locations'); }, route: '/tenant/management/locations', icon: 'dot', permission: 'locations.view' },
    { id: 'mg-hours', get label() { return t('pos.business_hours_2'); }, route: '/tenant/management/business-hours', icon: 'dot' },
    { id: 'mg-taxtip', get label() { return t('pos.tax_tip_rules'); }, route: '/tenant/management/tax-tip-rules', icon: 'dot' },
    { id: 'mg-booking', get label() { return t('pos.booking_rules'); }, route: '/tenant/management/booking-rules', icon: 'dot' },
    { id: 'mg-queue', get label() { return t('pos.queue_rules'); }, route: '/tenant/management/queue-rules', icon: 'dot' },
    { id: 'mg-checkout', get label() { return t('pos.checkout_rules'); }, route: '/tenant/management/checkout-rules', icon: 'dot' },
    { id: 'mg-cancel', get label() { return t('pos.cancellation_policy_2'); }, route: '/tenant/management/cancellation-policy', icon: 'dot' },
    { id: 'mg-noshow', get label() { return t('pos.no_show_policy_2'); }, route: '/tenant/management/no-show-policy', icon: 'dot' },
    { id: 'mg-membership', get label() { return t('pos.membership_rules'); }, route: '/tenant/management/membership-rules', icon: 'dot' },
    { id: 'mg-loyalty', get label() { return t('pos.loyalty_rules'); }, route: '/tenant/management/loyalty-rules', icon: 'dot' },
    { id: 'mg-autologout', get label() { return t('pos.auto_logout_rules'); }, route: '/tenant/management/auto-logout', icon: 'dot' },
    { id: 'mg-features', get label() { return t('pos.feature_access'); }, route: '/tenant/management/features', icon: 'dot', permission: 'settings.edit' },
    { id: 'mg-setup-health', get label() { return t('hs.title'); }, route: '/tenant/management/setup-health', icon: 'dot', badgeKey: 'setupHealthAlerts' },   // Four-Module Completion Guide §13
  ]},

  { id: 'DEVICES & INTEGRATIONS', get section() { return t('pos.devices_integrations_2'); }, icon: 'devices', collapsible: true, permission: 'settings.view', items: [
    { id: 'dev-overview', get label() { return t('pos.devices_overview'); }, route: '/tenant/devices/overview', icon: 'dot' },
    { id: 'dev-pos', get label() { return t('pos.reception_pos'); }, route: '/tenant/devices/reception-pos', icon: 'dot' },
    { id: 'dev-kiosk', get label() { return t('pos.customer_check_in_kiosk'); }, route: '/tenant/devices/check-in-kiosk', icon: 'dot' },
    { id: 'dev-displays', get label() { return t('pos.customer_displays'); }, route: '/tenant/devices/customer-displays', icon: 'dot' },
    { id: 'dev-terminals', get label() { return t('pos.payment_terminals'); }, route: '/tenant/devices/payment-terminals', icon: 'dot' },
    { id: 'dev-tablets', get label() { return t('pos.ipads_tablets'); }, route: '/tenant/devices/tablets', icon: 'dot' },
    { id: 'dev-receipt', get label() { return t('pos.receipt_devices'); }, route: '/tenant/devices/receipt-devices', icon: 'dot' },
    { id: 'dev-assign', get label() { return t('pos.device_assignments'); }, route: '/tenant/devices/assignments', icon: 'dot' },
    { id: 'dev-health', get label() { return t('pos.device_health'); }, route: '/tenant/devices/health', icon: 'dot' },
    { id: 'dev-logs', get label() { return t('pos.device_logs'); }, route: '/tenant/devices/logs', icon: 'dot' },
    { id: 'int-gateway', get label() { return t('pos.payment_gateway_2'); }, route: '/tenant/integrations/payment-gateway', icon: 'dot', permission: 'settings.edit' },
    { id: 'int-phone', get label() { return t('pos.phone_integration'); }, route: '/tenant/integrations/phone', icon: 'dot' },
    { id: 'int-sms', get label() { return t('pos.sms_integration'); }, route: '/tenant/integrations/sms', icon: 'dot' },
    { id: 'int-email', get label() { return t('pos.email_integration'); }, route: '/tenant/integrations/email', icon: 'dot' },
    { id: 'int-api', get label() { return t('pos.api_webhooks'); }, route: '/tenant/integrations/api-webhooks', icon: 'dot', permission: 'settings.edit' },
    { id: 'int-apps', get label() { return t('pos.connected_apps_2'); }, route: '/tenant/integrations/apps', icon: 'dot' },
  ]},

  { id: 'ACCOUNT', get section() { return t('pos.account_3'); }, icon: 'account', collapsible: true, permission: 'settings.view', items: [
    { id: 'acc-overview', get label() { return t('pos.account_overview'); }, route: '/tenant/account/overview', icon: 'dot' },
    { id: 'acc-subscription', get label() { return t('pos.subscription'); }, route: '/tenant/account/subscription', icon: 'dot', permission: 'subscription.manage' },
    { id: 'acc-ai', get label() { return t('pos.ai_packages'); }, route: '/tenant/ai/plans', icon: 'dot', permission: 'subscription.manage' },
    { id: 'acc-usage', get label() { return t('pos.usage_limits_2'); }, route: '/tenant/account/usage-limits', icon: 'dot', badgeKey: 'aiUsageAlerts' },
    { id: 'acc-billing', get label() { return t('pos.billing'); }, route: '/tenant/account/subscription', icon: 'dot', badgeKey: 'billingAlerts', permission: 'subscription.manage' },
    { id: 'acc-invoices', get label() { return t('pos.invoices'); }, route: '/tenant/account/invoices', icon: 'dot', permission: 'subscription.manage' },
    // Phase 9: 'Users & Roles' merged into Team › Roles & Permissions (one roster); /tenant/account/users-roles redirects there.
    // Access governance (access reviews, high-risk access, dormant accounts, denials) — the owner's security reports.
    { id: 'acc-access-governance', get label() { return t('pos.access_reviews_risk'); }, route: '/tenant/security/access', icon: 'dot', permission: 'security_reports.view' },
    { id: 'acc-security', get label() { return t('pos.security_2fa'); }, route: '/tenant/account/security', icon: 'dot' },
    { id: 'acc-activity', get label() { return t('pos.activity_logs'); }, route: '/tenant/account/activity-logs', icon: 'dot' },
    { id: 'acc-support', get label() { return t('pos.help_support'); }, route: '/tenant/account/support', icon: 'dot', badgeKey: 'supportTickets' },
    { id: 'acc-settings', get label() { return t('pos.settings'); }, route: '/settings', icon: 'dot', permission: 'settings.view' },
  ]},
];

// Existing screens we reuse → routes we must NOT register a FeaturePage for (avoid duplication).
// This set is the SINGLE source of truth: App.tsx registers featureRoutes() with no extra filtering, so any
// route that gains a dedicated screen must be added here (and only here) to stop its FeaturePage registration.
export const EXISTING_ROUTES = new Set<string>([
  '/overview', '/dashboard', '/live-operations', '/check-in', '/booking', '/tech-queue', '/queue', '/serving',
  '/service-done', '/checkout', '/customers', '/nail-showcase', '/technicians', '/technicians/schedule', '/technicians/skill-requests', '/tech-appointments',
  '/services', '/reports', '/cash-drawer', '/cash-handoffs', '/messages', '/follow-ups', '/settings', '/settings/follow-ups',
  '/tenant/overview', '/tenant/dashboard', '/tenant/payments/overview', '/tenant/ai/command-center', '/tenant/ai/platform', '/tenant/ai/platform/settings', '/tenant/ai/copilot', '/tenant/ai/receptionist', '/tenant/ai/receptionist/front-desk', '/tenant/ai/receptionist/follow-ups',
  '/tenant/ai/receptionist/business-setup', '/tenant/ai/receptionist/calendar', '/tenant/ai/receptionist/calls', '/tenant/ai/receptionist/settings', '/tenant/ai/plans', '/tenant/ai/marketing', '/tenant/ai/marketing/builder', '/tenant/ai/marketing/studio',
  '/tenant/ai/marketing/audiences', '/tenant/ai/marketing/results', '/tenant/ai/money-protection', '/tenant/ai/money-protection/alerts', '/tenant/ai/money-protection/investigations', '/tenant/ai/money-protection/rules', '/tenant/ai/money-protection/settings', '/tenant/ai/voice-transcription',
  '/tenant/ai/voice-transcription/history', '/tenant/ai/voice-transcription/search', '/tenant/ai/voice-transcription/unresolved', '/tenant/ai/voice-transcription/settings', '/tenant/ai/queue', '/tenant/management/overview', '/tenant/management/locations', '/tenant/devices/overview',
  '/tenant/devices/logs', '/tenant/inventory', '/tenant/inventory/vendors', '/tenant/integrations/api-webhooks', '/tenant/marketing/campaigns', '/tenant/communications/sms', '/tenant/communications/messaging-setup', '/tenant/team/payroll',
  '/tenant/team/members', '/tenant/team/tips', '/tenant/team/commission', '/tenant/customers/memberships', '/tenant/reports/sales', '/tenant/reports/services', '/tenant/reports/technicians', '/tenant/reports/payments',
  '/tenant/reports/commission', '/tenant/reports/payroll', '/tenant/reports/customers', '/tenant/reports/appointments', '/tenant/reports/tax', '/tenant/payments/transactions', '/tenant/payments/tips', '/tenant/payments/refunds-voids',
  '/tenant/payments/gift-cards', '/tenant/payments/settlements', '/tenant/team/profiles', '/tenant/services/categories', '/tenant/services/pricing', '/tenant/services/packages', '/tenant/team/performance', '/tenant/devices/payment-terminals',
  '/tenant/customers/gift-cards', '/tenant/customers/loyalty', '/tenant/marketing', '/tenant/marketing/promotions', '/tenant/marketing/deals', '/tenant/marketing/reviews', '/tenant/management/salon-profile', '/tenant/management/business-hours', '/tenant/management/auto-logout',
  '/tenant/management/booking-rules', '/tenant/management/no-show-policy', '/tenant/management/cancellation-policy', '/tenant/management/checkout-rules', '/tenant/management/tax-tip-rules', '/tenant/management/loyalty-rules', '/tenant/management/membership-rules', '/tenant/management/queue-rules',
  '/tenant/account/overview', '/tenant/account/support', '/tenant/account/activity-logs', '/tenant/account/security', '/tenant/account/subscription', '/tenant/account/users-roles', '/tenant/account/billing', '/tenant/ai/business',
  '/tenant/ai/inventory', '/tenant/ai/analytics', '/tenant/ai/business/branches', '/tenant/ai/business/alerts', '/tenant/ai/business/reports', '/tenant/ai/customer-profile', '/tenant/ai/customer-profile/duplicates', '/tenant/ai/customer-profile/churn',
  '/tenant/ai/customer-profile/rebooking', '/tenant/ai/customer-profile/recommendations', '/tenant/ai/customer-profile/settings', '/tenant/ai/customer-profile/timeline', '/tenant/ai/customer-profile/search', '/tenant/inventory/alerts', '/tenant/inventory/purchase-orders', '/tenant/products',
  '/tenant/management/features', '/tenant/management/setup-health', '/tenant/ai/usage', '/tenant/communications/notifications', '/tenant/ai/reception-copilot', '/tenant/devices/reception-pos', '/tenant/devices/check-in-kiosk', '/tenant/devices/tablets', '/tenant/devices/receipt-devices',
  '/tenant/devices/assignments', '/tenant/devices/health', '/tenant/marketing/sms', '/tenant/marketing/email', '/tenant/marketing/coupons', '/tenant/communications/reminders', '/tenant/communications/templates', '/tenant/reports/ai',
  '/tenant/communications/ai-receptionist', '/tenant/marketing/win-back', '/tenant/integrations/payment-gateway', '/tenant/marketing/segments', '/tenant/marketing/birthdays', '/tenant/marketing/referrals', '/tenant/communications/phone', '/tenant/integrations/phone',
  '/tenant/communications/email', '/tenant/integrations/email', '/tenant/marketing/social', '/tenant/integrations/apps', '/tenant/payments/deposit-reconciliation', '/tenant/integrations/sms', '/tenant/ai/booking', '/tenant/ai/scheduling',
  '/tenant/ai/customer-insights', '/tenant/ai/checkout-upsell', '/tenant/ai/fraud-protection', '/tenant/ai/reviews', '/tenant/ai/receipt-scanner', '/tenant/team/time-clock', '/tenant/team/turn-queue', '/tenant/team/permissions', '/tenant/reports/multi-location',
  '/tenant/reports/marketing', '/tenant/reports/inventory', '/tenant/payments/split-payments', '/tenant/payments/invoices', '/tenant/payments/expenses', '/tenant/payments/terminals', '/tenant/services/add-ons', '/tenant/services/discounts',
  '/tenant/customers/appointment-history', '/tenant/customers/notes', '/tenant/customers/profiles', '/tenant/customers/retention', '/tenant/customers/saved-cards', '/tenant/account/usage-limits', '/tenant/account/invoices',
  '/tenant/ai/checkout-upsell/settings', '/tenant/ai/reputation', '/tenant/ai/scheduling-optimizer', '/tenant/ai/reputation/settings',
  '/tenant/ai/ocr-receipt', '/tenant/communications/phone-verification', '/tenant/customers/phone-management',
  '/tenant/marketing/display-ads', '/tenant/devices/customer-displays',
  '/tenant/security/access', '/approvals',
  '/community',
]);

// ---- permission resolution: section key + item key(s), ALL required ----
const asList = (p?: NavPermission): string[] => (p == null ? [] : Array.isArray(p) ? p : [p]);
const REQUIRED = new Map<string, string[]>();
for (const s of TENANT_NAV) for (const it of s.items) REQUIRED.set(it.id, [...new Set([...asList(s.permission), ...asList(it.permission)])]);
/** Every key a nav item needs (its section's key + its own). */
export function requiredPermissions(item: { id?: string; permission?: NavPermission }): string[] {
  return (item.id && REQUIRED.get(item.id)) || asList(item.permission);
}

// Flatten all nav routes (for route generation) excluding the existing-screen routes.
export function featureRoutes(): NavItem[] {
  const out: NavItem[] = [];
  for (const s of TENANT_NAV) for (const it of s.items) if (!EXISTING_ROUTES.has(it.route)) out.push(it);
  return out;
}
export function allNavItems(): NavItem[] {
  const out: NavItem[] = [];
  for (const s of TENANT_NAV) for (const it of s.items) out.push(it);
  return out;
}
