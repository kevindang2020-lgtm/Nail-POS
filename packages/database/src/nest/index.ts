// @aipowersalon/database/nest — the NestJS module behind its own entry (Constitution 13 §113): the root entry is the
// typed schema, the handles, the pool factory and the INET helper, which Nest-free code (core specs, workers, packages)
// imports without dragging @nestjs/common in.
export { DatabaseModule } from '../database.module';
export * from './idempotency';   // Constitution 5 §61–66: @Idempotent() on money / once-only routes
