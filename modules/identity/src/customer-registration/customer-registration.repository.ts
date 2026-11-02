import type { RegisterInput, RegisterResult } from './customer-registration.dto';

export interface CustomerRegistrationDataPort {
  register(input: RegisterInput): Promise<RegisterResult>;
}

// DB-less fallback: registration needs Postgres (creates a user + customer), so it is unavailable without a DB handle.
export class InMemoryCustomerRegistrationRepository implements CustomerRegistrationDataPort {
  async register(): Promise<RegisterResult> { return { ok: false, message: 'Registration is unavailable right now.' }; }
}
