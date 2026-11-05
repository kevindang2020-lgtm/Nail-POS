/**
 * branch-create-core.ts — pure, DB-free validation + normalization for the controlled Add Branch command (§28/§40).
 *
 * The service runs this first; if it fails the command is rejected before any DB work. The repository then re-checks
 * tenant existence and name/address uniqueness INSIDE the insert transaction (so there is no time-of-check/time-of-use
 * race), and writes the audit event. Keeping validation pure means it is unit-tested without a database.
 */

export interface CreateBranchInput {
  tenantId?: unknown; name?: unknown; address?: unknown; city?: unknown; state?: unknown; zip?: unknown;
  phone?: unknown; latitude?: unknown; longitude?: unknown; managerName?: unknown; managerEmail?: unknown; managerPhone?: unknown;
  managerUserId?: unknown; timezone?: unknown; openingStatus?: unknown;
}

export interface NormalizedBranch {
  tenantId: string; name: string;
  address: string | null; city: string | null; state: string | null; zip: string | null; phone: string | null;
  latitude: number | null; longitude: number | null;
  managerName: string | null; managerEmail: string | null; managerPhone: string | null; managerUserId: string | null;
  timezone: string | null; status: string; verificationStatus: string;
}

export type CreateBranchValidation = { ok: true; value: NormalizedBranch } | { ok: false; errors: string[] };

const str = (v: unknown): string => (v == null ? '' : String(v)).trim();
const orNull = (v: unknown): string | null => { const s = str(v); return s === '' ? null : s; };
const numOrNull = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Opening status → operational lifecycle status. Only an explicit 'active' opens the branch immediately; everything
// else (planned/opening/draft/blank) starts pre-operational as 'pending' so it flows through onboarding.
function lifecycleStatus(opening: string): string {
  return opening.toLowerCase() === 'active' ? 'active' : 'pending';
}

export function validateCreateBranch(input: CreateBranchInput | undefined): CreateBranchValidation {
  const i = input || {};
  const errors: string[] = [];

  const tenantId = str(i.tenantId);
  if (!tenantId) errors.push('A parent tenant is required.');

  const name = str(i.name);
  if (name.length < 2) errors.push('A branch name of at least 2 characters is required.');

  const managerEmail = orNull(i.managerEmail);
  if (managerEmail && !EMAIL.test(managerEmail)) errors.push('Manager email is not a valid email address.');

  const timezone = orNull(i.timezone);
  if (timezone && !timezone.includes('/')) errors.push('Timezone must be an IANA name like America/New_York.');

  const latitude = numOrNull(i.latitude);
  if (i.latitude != null && String(i.latitude).trim() !== '' && latitude === null) errors.push('Latitude must be a valid number.');
  else if (latitude !== null && (latitude < -90 || latitude > 90)) errors.push('Latitude must be between -90 and 90 degrees.');

  const longitude = numOrNull(i.longitude);
  if (i.longitude != null && String(i.longitude).trim() !== '' && longitude === null) errors.push('Longitude must be a valid number.');
  else if (longitude !== null && (longitude < -180 || longitude > 180)) errors.push('Longitude must be between -180 and 180 degrees.');

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      tenantId, name,
      address: orNull(i.address), city: orNull(i.city), state: orNull(i.state), zip: orNull(i.zip), phone: orNull(i.phone),
      latitude, longitude,
      managerName: orNull(i.managerName), managerEmail, managerPhone: orNull(i.managerPhone), managerUserId: orNull(i.managerUserId),
      timezone, status: lifecycleStatus(str(i.openingStatus)), verificationStatus: 'draft',
    },
  };
}
