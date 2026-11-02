// Nest-free service (the module provides it via a useFactory that passes the repo positionally, so no DI decorators are
// needed here) — this keeps the registration validation unit-testable.
import type { CustomerRegistrationDataPort } from './customer-registration.repository';
import type { RegisterRequest, RegisterResult } from './customer-registration.dto';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Structural port for the global identity service (one-way coupling — see CustomersService). */
export interface IdentityLinkLike {
  ensureLinked(c: { tenantId: string; customerId: string; firstName?: string | null; lastName?: string | null; fullName?: string | null; phoneRaw?: string | null; email?: string | null }, source?: 'realtime' | 'reconciliation' | 'activation' | 'import'): Promise<unknown>;
}

export class CustomerRegistrationService {
  constructor(private readonly repo: CustomerRegistrationDataPort, private readonly identity?: IdentityLinkLike) {}

  async register(body: RegisterRequest): Promise<RegisterResult> {
    const salonCode = String(body?.salonCode ?? '').trim();
    const salonId = String(body?.salonId ?? '').trim();
    const firstName = String(body?.firstName ?? '').trim();
    const lastName = String(body?.lastName ?? '').trim();
    const email = String(body?.email ?? '').trim().toLowerCase();
    const phone = String(body?.phone ?? '').trim();
    const password = String(body?.password ?? '');
    // The customer CHOOSES their salon — from the salon list or the nearby search (salonId), or with a salon code. Never
    // guessed: the developer tree (Sep 28) signed a salon-less customer up at the platform's oldest active salon (another
    // business's customer list). It becomes their default salon, which they can change later.
    if (!salonId && !salonCode) return { ok: false, message: 'Choose your salon.' };
    if (!firstName || !lastName) return { ok: false, message: 'Enter your first and last name.' };
    if (!EMAIL_RE.test(email)) return { ok: false, message: 'Enter a valid email address.' };
    if (password.length < 8) return { ok: false, message: 'Password must be at least 8 characters.' };
    const result = await this.repo.register({ salonId: salonId || undefined, salonCode: salonCode || undefined, firstName, lastName, email, phone, password });
    // §7/§8: the Customer App is a creation site like any other — resolve-or-create the global identity, best
    // effort, after the registration transaction has committed. Never fails the signup.
    if (result.ok && result.tenantId && result.customerId && this.identity) {
      try {
        await this.identity.ensureLinked({
          tenantId: result.tenantId, customerId: result.customerId,
          firstName, lastName, fullName: `${firstName} ${lastName}`.trim(), phoneRaw: phone || null, email,
        }, 'realtime');
      } catch { /* never blocks registration */ }
    }
    return { ok: result.ok, message: result.message };          // ids stay internal
  }
}
