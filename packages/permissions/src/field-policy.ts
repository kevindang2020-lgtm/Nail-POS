// field-policy.ts — Constitution 7 §82 "Support Data Minimization … use field-level permissions", §43 "do not casually
// expose customer names / phone numbers / private notes". A platform response is minimised field by field for a caller
// who lacks the permission a sensitive field class needs. A PLATFORM_SUPER_ADMIN (every key) sees everything, so nothing
// changes for today's Super Admins; a narrower role (SUPPORT, ONBOARDING, …) sees these fields masked.
export type SensitiveFieldClass = 'compensation' | 'bank' | 'customerContact' | 'privateNotes';

/** The permission each class needs (the owning control-plane domain). */
export const FIELD_CLASS_PERMISSION: Readonly<Record<SensitiveFieldClass, string>> = {
  compensation: 'super_admin.payments.view',        // pay rates, commission, payroll, earnings
  bank: 'super_admin.payments.manage',              // bank / routing / payout account details
  customerContact: 'super_admin.customers.view',    // a CUSTOMER's phone / email
  privateNotes: 'super_admin.customers.manage',     // private / internal notes
};

/** Key → class. Matched on the exact property name (case-insensitive), so ordinary fields are never caught by accident. */
const CLASS_OF_KEY: Readonly<Record<string, SensitiveFieldClass>> = Object.fromEntries([
  ...['commission', 'commissionrate', 'commission_rate', 'commissionpercent', 'commission_percent', 'payrate', 'pay_rate', 'hourlyrate', 'hourly_rate',
      'salary', 'wage', 'wages', 'payroll', 'payrolltotal', 'payroll_total', 'compensation', 'earnings', 'earningscents', 'earnings_cents', 'netpay', 'net_pay',
      'grosspay', 'gross_pay', 'revenuesharepercent', 'revenue_share_percent'].map((k) => [k, 'compensation' as const]),
  ...['bankaccount', 'bank_account', 'bankaccountnumber', 'bank_account_number', 'accountnumber', 'account_number', 'routingnumber', 'routing_number',
      'iban', 'swift', 'bic', 'payoutaccount', 'payout_account', 'depositaccount', 'deposit_account', 'bankname', 'bank_name'].map((k) => [k, 'bank' as const]),
  ...['customerphone', 'customer_phone', 'customeremail', 'customer_email', 'customername', 'customer_name', 'customerfullname', 'customer_full_name']
      .map((k) => [k, 'customerContact' as const]),
  ...['privatenote', 'privatenotes', 'private_note', 'private_notes', 'internalnote', 'internalnotes', 'internal_note', 'internal_notes', 'staffnotes', 'staff_notes']
      .map((k) => [k, 'privateNotes' as const]),
]);
export const classOfField = (key: string): SensitiveFieldClass | null => CLASS_OF_KEY[String(key).toLowerCase()] ?? null;

export const MASK = '••• hidden (needs permission)';
/** The classes this caller may NOT see (empty = no minimisation, the fast path). */
export function hiddenClasses(permissions: readonly string[] | undefined): SensitiveFieldClass[] {
  const p = new Set(permissions ?? []);
  return (Object.keys(FIELD_CLASS_PERMISSION) as SensitiveFieldClass[]).filter((c) => !p.has(FIELD_CLASS_PERMISSION[c]));
}

/** Minimise a JSON value for a caller: every property whose class is hidden is replaced by MASK (null stays null). */
export function minimizeFields<T>(value: T, hidden: readonly SensitiveFieldClass[], depth = 0): T {
  if (!hidden.length || value === null || typeof value !== 'object' || depth > 12) return value;
  if (Array.isArray(value)) return value.map((v) => minimizeFields(v, hidden, depth + 1)) as any;
  if (value instanceof Date) return value;
  // N-19: a file download's body (bytes, or Nest's StreamableFile around them) carries no fields — rebuilding it from
  // Object.entries turned an export's bytes into `{"0":80,"1":75,…}` for a Super Admin with any hidden field class
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer || typeof (value as { getStream?: unknown }).getStream === 'function') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const c = classOfField(k);
    out[k] = c && hidden.includes(c) ? (v === null || v === undefined ? v : MASK) : minimizeFields(v, hidden, depth + 1);
  }
  return out as T;
}
