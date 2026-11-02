// validated-body.ts — BUILD_PLAN Phase 12 (#17): the Nest half of the ONE body-validation mechanism.
//
//   @Post('refund') refund(@Body(ValidatedBody(REFUND_BODY)) b: RefundBody) { … }
//
// The pipe validates the body against a JSON-Schema (../request-schema.ts), STRIPS unknown fields (REFUSES them in strict
// mode — S.strict / { strict: true }, Security Deep Scan §40), REFUSES dangerous
// ones, and answers 400 VALIDATION_FAILED in the standard envelope with the field errors in details.fields
// ([{ path, message }]) — the submitted values are never echoed. `check:validated-bodies` reads `ValidatedBody(` in the
// @Body(...) argument, so a mutating route counts as validated only when it is written this way.
import { BadRequestException, type PipeTransform } from '@nestjs/common';
import { validateBody, type BodySchema, type FieldError } from '../request-schema';

export const VALIDATION_FAILED = 'VALIDATION_FAILED';

/** The 400 the pipe throws — exported so a service validating a nested part the same way answers identically. */
export function validationFailed(errors: FieldError[]): BadRequestException {
  const first = errors[0];
  return new BadRequestException({
    code: VALIDATION_FAILED,
    message: first ? `${first.path} ${first.message}` : 'Some fields are invalid.',
    // field / rule / params of the first error (Vietnamese POS §58, additive): a client words the message itself
    details: { ...(first ? { field: first.path, ...(first.rule ? { rule: first.rule } : {}), ...(first.params ? { params: first.params } : {}) } : {}), fields: errors.slice(0, 50) },
  });
}

export class ValidatedBodyPipe implements PipeTransform {
  constructor(readonly schema: BodySchema, readonly opts: { strict?: boolean } = {}) {}
  transform(value: unknown): unknown {
    const r = validateBody(this.schema, value, this.opts);
    if (!r.ok) throw validationFailed(r.errors);
    return r.value;
  }
}

/** `@Body(ValidatedBody(SCHEMA))` — validate + strip the request body with one JSON-Schema. `{ strict: true }` (or a
 *  schema built with S.strict) refuses unknown fields with 400 instead of stripping them (Security Deep Scan §40). */
export const ValidatedBody = (schema: BodySchema, opts: { strict?: boolean } = {}): ValidatedBodyPipe => new ValidatedBodyPipe(schema, opts);

/** The ValidatedBody pipe a controller handler's @Body carries (Nest's route-argument metadata), or null — so a spec
 *  proves the REAL route is wired, not just that the schema works in isolation. */
export function bodyPipeOf(controller: abstract new (...a: any[]) => unknown, handler: string): ValidatedBodyPipe | null {
  const args: Record<string, { pipes?: unknown[] }> = Reflect.getMetadata('__routeArguments__', controller, handler) ?? {};
  for (const [k, v] of Object.entries(args)) {
    if (!k.startsWith('3:')) continue;   // RouteParamtypes.BODY = 3
    const p = (v.pipes ?? []).find((x) => x instanceof ValidatedBodyPipe);
    if (p) return p as ValidatedBodyPipe;
  }
  return null;
}
