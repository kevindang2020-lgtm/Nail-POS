// account-core.ts — framework-free "change my own password" (spec doc 1 §22: strong password + MFA for Super Admins).
// Order of gates: current password (constant-time verify) → policy (shared validateNewPassword: ≥10 chars, letters+
// numbers, match, not-same-as-current) → step-up TOTP when a CONFIRMED factor exists (same monotonic last_used_step
// replay guard as login/support-access). Only the new scrypt hash is ever stored; callers audit on success.
import { validateNewPassword } from '@aipowersalon/auth';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export class AccountError extends Error {
  constructor(public code: 'invalid_current' | 'policy' | 'mfa_required' | 'invalid_mfa' | 'replayed_mfa' | 'not_found' | 'password_already_set', msg: string) { super(msg); }
}

export interface ChangePasswordDeps {
  loadPasswordHash(userId: string): Promise<string | null>;
  verify(plain: string, hash: string): Promise<boolean>;
  hash(plain: string): Promise<string>;
  setPassword(userId: string, hash: string): Promise<void>;
  /** Confirmed TOTP secret (decrypted) for the user, or null when none. */
  loadConfirmedTotpSecret(userId: string): Promise<string | null>;
  /** Returns the matched step for a valid code, or null. */
  matchTotpStep(secret: string, code: string, atMs: number): number | null;
  /** Monotonic replay guard: persist the step iff it is newer than the last used one; false on replay. */
  markTotpStepUsed(userId: string, step: number): Promise<boolean>;
  now(): number;
}

export interface ChangePasswordInput { currentPassword: string; newPassword: string; confirmPassword: string; mfaCode?: string }

export async function changeOwnPasswordCore(d: ChangePasswordDeps, userId: string, input: ChangePasswordInput): Promise<{ ok: true; stepUp: 'password' | 'password+mfa' }> {
  const stored = await d.loadPasswordHash(userId);
  if (!stored) throw withCode(new AccountError('not_found', 'Account not found.'), 'ACCOUNT_NOT_FOUND');
  if (!input.currentPassword || !(await d.verify(input.currentPassword, stored))) {
    throw withCode(new AccountError('invalid_current', 'Current password is incorrect.'), 'CURRENT_PASSWORD_INCORRECT');
  }
  const v = validateNewPassword(input.newPassword, input.confirmPassword, input.currentPassword);
  if (!v.ok) throw new AccountError('policy', v.error || 'Password does not meet the policy.');
  let stepUp: 'password' | 'password+mfa' = 'password';
  const secret = await d.loadConfirmedTotpSecret(userId);
  if (secret) {
    if (!input.mfaCode) throw withCode(new AccountError('mfa_required', 'Your account has MFA — enter the current code to change your password.'), 'CURRENT_MFA_REQUIRED');
    const step = d.matchTotpStep(secret, String(input.mfaCode), d.now());
    if (step === null) throw withCode(new AccountError('invalid_mfa', 'MFA code confirmation failed.'), 'MFA_CODE_FAILED');
    if (!(await d.markTotpStepUsed(userId, step))) throw withCode(new AccountError('replayed_mfa', 'That MFA code was already used — wait for the next code.'), 'MFA_CODE_REUSED');
    stepUp = 'password+mfa';
  }
  await d.setPassword(userId, await d.hash(input.newPassword));
  return { ok: true, stepUp };
}

/**
 * createOwnPasswordCore — set a FIRST password for an account that has none.
 *
 * Why this exists: `changeOwnPasswordCore` demands the current password, and throws when there is no stored
 * hash. A customer who activated the app by SMS one-time code has NO password — so under the old code they could
 * never create one. The "Create a password to make future sign-ins easier" prompt led nowhere.
 *
 * The security line: this path is reachable ONLY with an authenticated session (the OTP already proved phone
 * possession), and it REFUSES to run when a password already exists. Otherwise it would be an account-takeover
 * primitive — anyone with a session could silently overwrite the real password without knowing it. If a password
 * is already set, the caller must go through changeOwnPasswordCore and prove the current one.
 */
export async function createOwnPasswordCore(
  d: Pick<ChangePasswordDeps, 'loadPasswordHash' | 'hash' | 'setPassword'>,
  userId: string,
  input: { newPassword: string; confirmPassword: string },
): Promise<{ ok: true }> {
  const stored = await d.loadPasswordHash(userId);
  if (stored) {
    // A password already exists — this endpoint must never be a way to bypass knowing it.
    throw withCode(new AccountError('password_already_set', 'A password is already set. Use change password instead.'), 'PASSWORD_ALREADY_SET');
  }
  const v = validateNewPassword(input.newPassword, input.confirmPassword, '');
  if (!v.ok) throw new AccountError('policy', v.error || 'Password does not meet the policy.');
  await d.setPassword(userId, await d.hash(input.newPassword));
  return { ok: true };
}
