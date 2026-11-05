// validation.ts — Constitution 5 G4 / §140: the global request validation pipe (registered as APP_PIPE in app.module).
//
// HONEST SCOPE. Nest's ValidationPipe validates a parameter only when its runtime type is a CLASS. On Oct 4 2026 none
// was: of 2,859 @Body/@Query/@Param arguments across 2,574 handlers, the 1,016 bodies and 392 query objects are
// interfaces or `any` (runtime type Object) and the rest are strings — measured from design:paramtypes on the booted
// app, not assumed. So this pipe changes NOTHING for any existing route; it is the enforcement point for every class
// DTO from here on, and check:mass-assignment guards the untyped bodies meanwhile.
//
// Options (the September decision):
//   whitelist + forbidNonWhitelisted  a property without a validation decorator is refused (400), not silently dropped —
//                                     a client sending `role` or `tenantId` learns at once that it cannot
//   transform: false                  no implicit conversion: '5' stays a string unless a DTO opts in with @Type
//   forbidUnknownValues               an object with no validation metadata at all is refused (class-validator default)
//   validationError target/value off  the 400 never echoes the submitted value (passwords, card data)
// The 400 becomes VALIDATION_FAILED with the messages in details.messages (packages/observability error-envelope).
import { ValidationPipe, type ValidationPipeOptions } from '@nestjs/common';

export const VALIDATION_OPTIONS: Readonly<ValidationPipeOptions> = Object.freeze({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: false,
  forbidUnknownValues: true,
  validationError: { target: false, value: false },
});

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({ ...VALIDATION_OPTIONS, validationError: { ...VALIDATION_OPTIONS.validationError } });
}
