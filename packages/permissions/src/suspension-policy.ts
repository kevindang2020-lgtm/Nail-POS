// suspension-policy.ts — Constitution 7 §18–§19: WHY a tenant is suspended decides WHAT keeps working. "Do not simply
// delete tenant access": a billing suspension should let the owner in to pay; a fraud suspension should freeze money.
// One table, read by the platform (Tenants panel) and by each place that enforces a capability.
export const SUSPENSION_REASON_CODES = ['BILLING', 'SECURITY', 'TERMS', 'FRAUD', 'TENANT_REQUEST', 'PLATFORM_OPERATION', 'OTHER'] as const;
export type SuspensionReasonCode = typeof SUSPENSION_REASON_CODES[number];

export const SUSPENSION_CAPABILITIES = ['employeeLogin', 'customerBooking', 'paymentSettlements', 'scheduledCommunications', 'ownerBillingAccess', 'dataExport'] as const;
export type SuspensionCapability = typeof SUSPENSION_CAPABILITIES[number];
export type SuspensionPolicy = Readonly<Record<SuspensionCapability, boolean>>;

/**
 * §19's six questions, answered per cause. Staff, bookings and customer messages stop for every cause. Money owed to the
 * salon keeps settling except when SECURITY or FRAUD may make it unsafe; the owner keeps billing access and data export
 * except for SECURITY and FRAUD, where the account itself is the problem.
 */
export const SUSPENSION_POLICY: Readonly<Record<SuspensionReasonCode, SuspensionPolicy>> = {
  BILLING:            { employeeLogin: false, customerBooking: false, paymentSettlements: true,  scheduledCommunications: false, ownerBillingAccess: true,  dataExport: true },
  SECURITY:           { employeeLogin: false, customerBooking: false, paymentSettlements: false, scheduledCommunications: false, ownerBillingAccess: false, dataExport: false },
  TERMS:              { employeeLogin: false, customerBooking: false, paymentSettlements: true,  scheduledCommunications: false, ownerBillingAccess: true,  dataExport: true },
  FRAUD:              { employeeLogin: false, customerBooking: false, paymentSettlements: false, scheduledCommunications: false, ownerBillingAccess: false, dataExport: false },
  TENANT_REQUEST:     { employeeLogin: false, customerBooking: false, paymentSettlements: true,  scheduledCommunications: false, ownerBillingAccess: true,  dataExport: true },
  PLATFORM_OPERATION: { employeeLogin: false, customerBooking: false, paymentSettlements: true,  scheduledCommunications: false, ownerBillingAccess: true,  dataExport: true },
  OTHER:              { employeeLogin: false, customerBooking: false, paymentSettlements: true,  scheduledCommunications: false, ownerBillingAccess: true,  dataExport: true },
};

/**
 * What the platform ACTUALLY does for a suspended tenant today, capability by capability (null = not controlled by the
 * platform yet). Where this differs from the policy, the Tenants panel says "not yet enforced" instead of implying it is.
 * Measured Sep 28 2026: sign-in refuses a suspended salon for every role (so the owner cannot reach billing or export);
 * customer booking refuses it (0773495); reminders and end-of-day follow-ups skip it; settlements are not gated; the OWNER
 * gets a billing-only session exactly when the cause allows it, and that session reaches the salon's data exports
 * exactly when the cause allows export. Settlements are paid by the processor straight to the salon's merchant account;
 * holding them (SECURITY / FRAUD) is a processor-side action, so the platform does not gate them (null).
 */
export const EFFECTIVE_WHILE_SUSPENDED: Readonly<Record<SuspensionCapability, boolean | null | 'policy'>> = {
  // 'policy' = the platform follows the table per cause: the owner's billing-only session (0655cf8 + the sign-in wiring)
  employeeLogin: false, customerBooking: false, paymentSettlements: null, scheduledCommunications: false, ownerBillingAccess: 'policy', dataExport: 'policy',
};

/** The policy for a code (unknown / missing code → the most restrictive, SECURITY), with each line's enforcement state. */
export function suspensionPolicyFor(code: string | null | undefined): Array<{ capability: SuspensionCapability; allowed: boolean; effective: boolean | null; enforced: boolean }> {
  const p = SUSPENSION_POLICY[(SUSPENSION_REASON_CODES as readonly string[]).includes(String(code)) ? (code as SuspensionReasonCode) : 'SECURITY'];
  return SUSPENSION_CAPABILITIES.map((capability) => {
    const raw = EFFECTIVE_WHILE_SUSPENDED[capability];
    const effective = raw === 'policy' ? p[capability] : raw;
    return { capability, allowed: p[capability], effective, enforced: effective !== null && effective === p[capability] };
  });
}
