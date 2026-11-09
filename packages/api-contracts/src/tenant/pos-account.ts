// pos-account — the POS Account screen's overview (developer merge Sep 2026). OWNED HERE (Constitution 13 §13).
// Realm: tenant. Declaration file: types only.
// Every value is REAL (read from the tenant's own records) or null = "no source connected yet". The developer's first
// version returned a fixed sample (a fictional owner, salon, card, branches and backups) for every salon; that is gone.
export type PosAccountOverview = {
  profile: {
    email: string | null;
    phone: string | null;
    loyaltyId: string | null;      // the tenant code
    language: string | null;       // WP-A: 'English' / 'Tiếng Việt' — the user's own choice, else the salon's default POS language
    memberSince: string | null;    // ISO
    lastLogin: string | null;      // ISO
    ownerTitle: string | null;     // the signed-in user's role, humanised
  };
  business: {
    name: string | null;
    branch: string | null;
    address: string | null;
    phone: string | null;
    timezone: string | null;
    display: string | null;
    receipts: string | null;
  };
  security: {
    passwordChanged: string | null;   // ISO
    loginAlerts: boolean | null;      // no setting exists yet -> null
    trustedDevices: string | null;    // the screen uses the real session count; no device registry -> null
  };
  billing: {
    plan: string | null;
    /** tenant_subscriptions.status (Account guide Nov 9 2026 §14: the billing KPI reads the authoritative row, not the settings template) */
    status?: string | null;
    renewal: string | null;           // ISO date of the current period's end
    renewalShort: string | null;
    method: string | null;            // card details live with the processor, never here -> null
    expires: string | null;
    fee: string | null;               // formatted monthly price
    locations: string | null;         // "<active branches>" (no plan limit recorded)
    users: string | null;             // "<active users>"
    features: string[];               // [] until plans carry a feature list
  };
  role: {
    level: string | null;
    scope: string | null;
    branches: { name: string; sub: string; role: string; access: string; status: string }[];
    totals: { users: number; admins: number; managers: number; staff: number };
  };
  backup: { last: string | null; status: string | null; next: string | null };   // no backup telemetry source -> null
  notifications: { l: string; d: string }[];   // the preference categories (labels, not data)
  /** Account Overview guide (Nov 9 2026) §14: storage from tenant_storage_usage + the resolved storage quota. null = no
   *  source answered (the screen shows "—"); storageLimitBytes null with a source of 'none' = no limit is set. Never AI tokens. */
  usage?: { storageBytesUsed: number | null; storageLimitBytes: number | null; storageLimitSource: string | null; storageUpdatedAt: string | null };
};
