// modules/analytics — the analytics domain (Constitution 13 Phase 6): the ONE public entry point (§97). The API composes the Nest
// module and imports ONLY from here; every other file in this module is internal (§98–99).

export { DashboardModule } from './dashboard/dashboard.module';
export { OverviewModule } from './overview/overview.module';
// joined by --into (owner, ai-business):
export { AiBusinessModule } from './ai-business/ai-business.module';
export { OwnerModule } from './owner/owner.module';
export * from './ai-business/ai-business-brief.dto';
export * from './ai-business/ai-business-revenue.dto';
export * from './ai-business/ai-business.dto';
export * from './owner/owner.dto';
export { KyselyOwnerRepository } from './owner/owner.kysely.repository';   // used by the API today
export { InMemoryOwnerRepository, OwnerContext } from './owner/owner.repository';   // used by the API today
export { OwnerService, type OwnerExpensesPort, type OwnerFinanceCtx } from './owner/owner.service';   // used by the API today (+ finance-wiring)
export { privacySafeBenchmark, MIN_BENCHMARK_COHORT, type Benchmark } from './privacy/benchmark';   // Constitution 7 §107
