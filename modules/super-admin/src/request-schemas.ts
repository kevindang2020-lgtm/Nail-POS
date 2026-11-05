// request-schemas.ts — BUILD_PLAN Phase 12 (#17): the super-admin module's request-body schemas, applied with
// @Body(ValidatedBody(SCHEMA)). The shared field builders live here; the schemas themselves are split by area into
// request-schemas-<area>.ts (re-exported below). Every schema was written from the handler (the fields it reads) and
// from the admin-web call that sends the body today (apps/admin-web/src/api/* + screens) — every body a client sends
// today passes intact; unknown fields are STRIPPED; dangerous ones (undeclared tenantId / permissions / platformRole,
// a `status` on a money row) are refused; a bad field is a 400 VALIDATION_FAILED naming its path.
export * from './request-schemas-fields';
export * from './request-schemas-ai';
export * from './request-schemas-audit';
export * from './request-schemas-billing';
export * from './request-schemas-catalog';
export * from './request-schemas-finance';
export * from './request-schemas-onboarding';
export * from './request-schemas-ops';
export * from './request-schemas-oversight';
export * from './request-schemas-platform';
export * from './request-schemas-programs';
export * from './request-schemas-leads';
export * from './super-admin-tenants/request-schemas-tenants';
export * from './request-schemas-workforce';
