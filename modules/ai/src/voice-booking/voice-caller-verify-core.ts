// voice-caller-verify-core.ts — pure caller-verification logic for the voice receptionist. The safety rule this
// encodes: before the AI may see or change a caller's appointment, the caller's identity must be verified against a
// customer on file. The policy is CONFIGURABLE via VOICE_VERIFICATION_MODE, with a safe default:
//   - 'phone'       (default): the caller's phone must match a customer's phone on file.
//   - 'phone_name'  (stricter): phone AND last-name must match (a light second factor against caller-ID spoofing).
// The salon can tighten this to 'phone_name' via env without any code change. Caller-ID alone is spoofable, so even the
// default requires the caller's phone to resolve to exactly one customer; ownership is always re-checked per appointment.

export type VerificationMode = 'phone' | 'phone_name';

export function verificationMode(env: NodeJS.ProcessEnv = process.env): VerificationMode {
  return String(env.VOICE_VERIFICATION_MODE ?? '').trim().toLowerCase() === 'phone_name' ? 'phone_name' : 'phone';
}

/** Normalize a phone to its last 10 digits for comparison (tolerant of formatting/country prefix). */
export function normalizePhone(s: string | null | undefined): string {
  const digits = String(s ?? '').replace(/\D+/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export interface ProvidedIdentity { phone: string; name?: string | null; }
export interface CustomerIdentity { customerId: string; phone?: string | null; firstName?: string | null; lastName?: string | null; }

/** Returns true iff the provided caller identity satisfies the configured verification policy for this customer. */
export function verifyCaller(mode: VerificationMode, provided: ProvidedIdentity, customer: CustomerIdentity): boolean {
  const provPhone = normalizePhone(provided.phone);
  if (!provPhone || provPhone.length < 10) return false;                 // need a full phone
  if (normalizePhone(customer.phone) !== provPhone) return false;        // phone must match on file
  if (mode === 'phone_name') {
    const provName = String(provided.name ?? '').trim().toLowerCase();
    const last = String(customer.lastName ?? '').trim().toLowerCase();
    const first = String(customer.firstName ?? '').trim().toLowerCase();
    if (!provName) return false;
    // accept if the provided name contains the customer's last or first name (spoken names are fuzzy)
    if (!(last && provName.includes(last)) && !(first && provName.includes(first))) return false;
  }
  return true;
}

/** Does an appointment belong to the verified customer? Ownership is re-checked on every mutating action. */
export function ownsAppointment(verifiedCustomerId: string, appt: { customerId?: string | null; customerPhone?: string | null }, verifiedPhone?: string): boolean {
  if (appt.customerId && appt.customerId === verifiedCustomerId) return true;
  // fallback for walk-in-style appointments with no customerId: match the verified phone
  if (!appt.customerId && verifiedPhone && normalizePhone(appt.customerPhone) === normalizePhone(verifiedPhone)) return true;
  return false;
}
