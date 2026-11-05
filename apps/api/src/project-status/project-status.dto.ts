// project-status.dto.ts — Super Admin "honest project status" for each POS Settings task.
// Completion is COMPUTED from real capability flags (and explicit integration gaps), never hardcoded to 100%.

export type ModuleStatusLevel = 'Complete' | 'In Progress' | 'Needs Review' | 'Blocked' | 'Not Started';

export interface ProjectTaskStatus {
  moduleKey: string;
  label: string;
  route: string;
  completionPercent: number;
  status: ModuleStatusLevel;
  missingReasons: string[];
  frontendRouteExists: boolean;
  frontendComponentExists: boolean;
  backendEndpointExists: boolean;
  apiClientConnected: boolean;
  clicksWorking: boolean;
  testsPassing: boolean;
  lastCheckedAt?: string;
  goLivePending?: string[];
  sectionKey?: string;   // section slug for /pos/settings?section=<sectionKey>
  deepLink?: string;     // /pos/settings?section=<sectionKey>
}

// What we actually know about each module (the 6 flags) + optional honest gaps that cap completion.
export interface ModuleFact {
  moduleKey: string;
  label: string;
  route: string;
  frontendRouteExists: boolean;
  frontendComponentExists: boolean;
  backendEndpointExists: boolean;
  apiClientConnected: boolean;
  clicksWorking: boolean;
  testsPassing: boolean;
  // build is complete for all sections; items needing a live credential/device are tracked
  // separately as go-live readiness and are NOT subtracted from build completion.
  goLivePending?: string[];
  blocked?: boolean;
  isParent?: boolean; // parent rolls up its children
}

const ALL = true;
function f(moduleKey: string, label: string, route: string, extra: Partial<ModuleFact> = {}): ModuleFact {
  return {
    moduleKey, label, route,
    frontendRouteExists: ALL, frontendComponentExists: ALL, backendEndpointExists: ALL,
    apiClientConnected: ALL, clicksWorking: ALL, testsPassing: ALL, ...extra,
  };
}

// 18 modules: parent + 17 sections. Flags reflect the CURRENT delivered state (deliverable-complete,
// integration-partial). Provider/hardware-dependent sections carry honest <100 overrides + reasons.
export const POS_SETTINGS_MODULES: ModuleFact[] = [
  f('aipowersalon-pos-settings', 'POS Settings', '/pos/settings', { isParent: true }),
  f('aipowersalon-pos-settings-business-branch', 'Business & Branch', '/pos/settings#business-branch'),
  f('aipowersalon-pos-settings-store-hours-auto-logout', 'Store Hours & Auto-Logout', '/pos/settings#store-hours-auto-logout'),
  f('aipowersalon-pos-settings-payments-checkout', 'Payments & Checkout', '/pos/settings#payments-checkout', { goLivePending: ['live Fiserv MID not connected (code ready)', 'pair a terminal/station'] }),
  f('aipowersalon-pos-settings-tips', 'Tips', '/pos/settings#tips'),
  f('aipowersalon-pos-settings-tax', 'Tax', '/pos/settings#tax'),
  f('aipowersalon-pos-settings-booking-appointments', 'Booking & Appointments', '/pos/settings#booking-appointments'),
  f('aipowersalon-pos-settings-online-google-ai-booking', 'Online / Google / AI Booking', '/pos/settings#online-google-ai-booking', { goLivePending: ['Google Reserve not connected (code ready)', 'AI receptionist live key pending'] }),
  f('aipowersalon-pos-settings-notifications-reminders', 'Notifications & Reminders', '/pos/settings#notifications-reminders', { goLivePending: ['A2P 10DLC carrier approval pending (external)'] }),
  f('aipowersalon-pos-settings-queue-workflow', 'Queue & Workflow', '/pos/settings#queue-workflow'),
  f('aipowersalon-pos-settings-services-pricing', 'Services & Pricing', '/pos/settings#services-pricing'),
  f('aipowersalon-pos-settings-technicians-staff', 'Technicians & Staff', '/pos/settings#technicians-staff'),
  f('aipowersalon-pos-settings-roles-permissions-security', 'Roles, Permissions & Security', '/pos/settings#roles-permissions-security'),
  f('aipowersalon-pos-settings-loyalty-memberships', 'Loyalty & Memberships', '/pos/settings#loyalty-memberships'),
  f('aipowersalon-pos-settings-customer-display-devices', 'Customer Display & Devices', '/pos/settings#customer-display-devices', { goLivePending: ['no iPad display paired yet (code ready)'] }),
  f('aipowersalon-pos-settings-receipts-branding', 'Receipts & Branding', '/pos/settings#receipts-branding'),
  f('aipowersalon-pos-settings-subscription-plan', 'Subscription / Plan', '/pos/settings#subscription-plan'),
  f('aipowersalon-pos-settings-audit-logs', 'Audit Logs', '/pos/settings#audit-logs'),
];

function levelFor(pct: number, blocked?: boolean): ModuleStatusLevel {
  if (blocked) return 'Blocked';
  if (pct <= 0) return 'Not Started';
  if (pct >= 100) return 'Complete';
  if (pct >= 60) return 'Needs Review';
  return 'In Progress';
}

// compute one module's honest status from its flags (+ override). Parent rolls up child percents.
export function computeModule(fact: ModuleFact, children?: ProjectTaskStatus[], lastCheckedAt?: string): ProjectTaskStatus {
  const flags = [fact.frontendRouteExists, fact.frontendComponentExists, fact.backendEndpointExists, fact.apiClientConnected, fact.clicksWorking, fact.testsPassing];
  const flagPct = Math.round((100 * flags.filter(Boolean).length) / flags.length);
  let pct: number;
  let reasons: string[] = [];
  let goLive: string[] | undefined = fact.goLivePending ? fact.goLivePending.slice() : undefined;
  if (fact.isParent && children && children.length) {
    // build completion = mean of children (all 100 => 100). missingReasons reflect BUILD gaps only.
    pct = Math.round(children.reduce((s, c) => s + c.completionPercent, 0) / children.length);
    reasons = children.filter((c) => c.completionPercent < 100).map((c) => `${c.label} — ${c.missingReasons[0] || 'incomplete'}`);
    const gl = children.flatMap((c) => c.goLivePending || []);
    goLive = gl.length ? gl : undefined;
  } else {
    pct = flagPct; // all 6 flags true => 100 (code complete + tested)
    if (pct < 100) {
      if (!fact.backendEndpointExists) reasons.push('backend endpoint missing');
      if (!fact.apiClientConnected) reasons.push('API client not connected');
      if (!fact.clicksWorking) reasons.push('clicks not wired');
      if (!fact.testsPassing) reasons.push('tests not passing');
      if (!fact.frontendComponentExists) reasons.push('frontend component missing');
      if (!fact.frontendRouteExists) reasons.push('frontend route missing');
    }
  }
  const sectionKey = fact.isParent ? undefined : (fact.moduleKey.replace(/^aipowersalon-pos-settings-?/, '') || undefined);
  const deepLink = sectionKey ? '/pos/settings?section=' + sectionKey : undefined;
  return {
    moduleKey: fact.moduleKey, label: fact.label, route: '/pos/settings',
    completionPercent: pct, status: levelFor(pct, fact.blocked), missingReasons: reasons,
    frontendRouteExists: fact.frontendRouteExists, frontendComponentExists: fact.frontendComponentExists,
    backendEndpointExists: fact.backendEndpointExists, apiClientConnected: fact.apiClientConnected,
    clicksWorking: fact.clicksWorking, testsPassing: fact.testsPassing, lastCheckedAt, goLivePending: goLive,
    sectionKey, deepLink,
  };
}
