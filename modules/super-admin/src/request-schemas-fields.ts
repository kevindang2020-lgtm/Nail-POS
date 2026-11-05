// request-schemas-fields.ts — BUILD_PLAN Phase 12 (#17): the super-admin request-schema field builders (see request-schemas.ts).
import { S, type BodySchema } from '@aipowersalon/permissions';

export { S, type BodySchema };
/** a nullable string up to `max` characters */
export const str = (max = 200): BodySchema => S.nullable(S.text(max));
/** a string or a number (a handler that String()/Number()-coerces it) — or null */
export const scalar = (max = 200): BodySchema => ({ type: ['string', 'number', 'null'], maxLength: max });
/** an id (uuid or a legacy slug / code) — handlers resolve and 404 themselves */
export const id: BodySchema = S.nullable(S.text(128));
/** a boolean, or null */
export const bool: BodySchema = S.nullable(S.boolean());
/** a boolean a form may send as 'true' / 1 — handlers test it with !! / === true / Boolean() */
export const flag: BodySchema = { type: ['boolean', 'string', 'number', 'null'], maxLength: 8 };
/** a finite number, or null */
export const num: BodySchema = S.nullable(S.number());
/** a number a client may send as a numeric string (the handler Number()-coerces it) */
export const numish: BodySchema = { type: ['number', 'string', 'null'], maxLength: 32 };
/** an integer, or null */
export const int: BodySchema = S.nullable(S.integer());
/** integer cents ≥ 0, or null */
export const cents: BodySchema = S.nullable(S.integer({ minimum: 0 }));
/** integer cents a client may send as a numeric string (the handler Number()-/Math.round()-coerces it) */
export const centsish: BodySchema = { type: ['integer', 'string', 'null'], maxLength: 16 };
/** a date or date-time string (YYYY-MM-DD / ISO), or null */
export const when: BodySchema = S.nullable(S.text(40));
/** a list of strings */
export const strs = (max = 200, items = 500): BodySchema => S.nullable(S.array(S.text(max), { maxItems: items }));
/** a list of ids */
export const ids = (items = 500): BodySchema => strs(128, items);
/** a stored JSON blob kept whole (settings, metadata, config) — the handler / service validates its inner shape */
export const blob: BodySchema = S.nullable(S.freeObject());
/** any JSON value kept whole (a stored settings value whose shape varies by key) */
export const anyValue: BodySchema = S.any();
/** an object of the given properties — unknown fields stripped */
export const obj = (props: Record<string, BodySchema>, required: string[] = [], extra: Omit<BodySchema, 'type'> = {}): BodySchema => S.object(props, required, extra);
/** a money / settlement body: a status or a captured / settled figure may not be set by the client */
export const MONEY_FORBIDDEN: readonly string[] = ['status', 'state', 'paymentStatus', 'settledCents', 'capturedCents', 'refundedCents', 'paidCents'];
export const money = (props: Record<string, BodySchema>, required: string[] = []): BodySchema => S.object(props, required, { 'x-forbidden': MONEY_FORBIDDEN.filter((k) => !(k in props)) });
/** `{ reason }` — the confirm / revoke / dismiss bodies */
export const REASON_BODY: BodySchema = obj({ reason: str(2000), note: str(2000) });
/** an empty body — the route reads no field, but a client may send `{}` or a stray field (stripped) */
export const EMPTY_BODY: BodySchema = obj({});

