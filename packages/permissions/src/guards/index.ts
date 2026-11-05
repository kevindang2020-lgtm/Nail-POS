// @aipowersalon/permissions/guards — the NestJS guards and the @RequirePermission decorator (Constitution 13 §113: the
// framework-bound half of the package behind its own entry). The root entry is the pure authorization kernel and the
// catalog, which Nest-free code (core specs, workers, packages) can import without dragging @nestjs/core in — a core
// spec that imported the kernel through the old single entry pulled Reflector, and esbuild refused Nest's optional
// dependencies. 36 harness suites failed that way for three commits before anyone ran them.
export * from './tenant-auth.guard';
export * from './role-permission.guard';
export * from './super-admin.guard';
export * from './role-scoped.guards';
export * from './platform-domain.guard';   // Constitution 7 §7: in-plane default deny
export * from './step-up';   // Constitution 7 §8: RequireStepUp
export * from './staff-session.guard';
export * from './signed-in-user.guard';   // Constitution 3/12 §27: a signed-in person's own account routes
export * from './async-export';   // BUILD_PLAN Phase 12 (Constitution 5 §32–33): @AsyncExport — 202 + status URL for a large export
export * from './require-feature';   // BUILD_PLAN Phase 12 (#13): @RequireFeature + FeatureEntitlementGuard
export * from './validated-body';   // BUILD_PLAN Phase 12 (#17): @Body(ValidatedBody(schema))
