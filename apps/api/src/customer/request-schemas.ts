// request-schemas.ts — BUILD_PLAN Phase 12 (#17): the customer app's account bodies (customer-web customerApi), applied
// with @Body(ValidatedBody(SCHEMA)). Unknown fields are stripped; the customer is always the session's.
import { S, type BodySchema } from '@aipowersalon/permissions';

const str = (max = 200): BodySchema => S.nullable(S.text(max));
const bool: BodySchema = S.nullable(S.boolean());
export const CUSTOMER_JOIN_MEMBERSHIP_BODY: BodySchema = S.object({ planId: str(64), planVersionId: str(64) }, [], { 'x-forbidden': ['status'] });
export const CUSTOMER_HOME_SALON_BODY: BodySchema = S.object({ salonId: str(64) });
export const CUSTOMER_ADDRESS_BODY: BodySchema = S.object({ label: str(80), line1: str(200), line2: str(200), city: str(100), state: str(40), zip: str(20), isDefault: bool });
export const CUSTOMER_GIFT_CLAIM_BODY: BodySchema = S.object({ token: str(512) });
export const CUSTOMER_GIFT_SEND_BODY: BodySchema = S.object({ name: str(200), phone: str(40), email: str(254), message: str(1000) }, [], { 'x-forbidden': ['status', 'balanceCents'] });
export const CUSTOMER_PROFILE_BODY: BodySchema = S.object({ phone: str(40), email: str(254), marketingOptIn: bool, smsOptIn: bool, emailOptIn: bool });
