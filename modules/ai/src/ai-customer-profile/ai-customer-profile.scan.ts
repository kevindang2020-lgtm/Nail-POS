// ai-customer-profile.scan.ts — orchestration for the periodic tenant aggregate scan (§39/§40). The DB I/O and the
// distributed lock live in the scheduler; THIS is the pure, testable core: iterate a bounded batch of tenants, isolate
// per-tenant failures (one bad tenant never stops the rest), and never exceed the per-tick cap (fair scheduling, §41).
import type { AiCustomerProfileContext } from './ai-customer-profile.dto';
import { systemContext } from '@aipowersalon/tenant-context';

/** Trusted, server-derived context for the background scan. Not user-initiated: a synthetic system principal with
 *  exactly the read capability the scan needs (customers.view) and no branch scope (whole-tenant aggregate). */
export function buildSystemScanContext(tenantId: string): AiCustomerProfileContext {
  // Was role 'SUPER_ADMIN' — a nightly scan is not a super admin. SYSTEM with exactly the one read capability.
  return systemContext({ tenantId, actor: 'ai-customer-profile-scan', permissions: ['customers.view'] }) as unknown as AiCustomerProfileContext;
}

export interface ScanResult { attempted: number; succeeded: number; failed: number; failures: Array<{ tenantId: string; error: string }>; }

/**
 * Scan up to `cap` tenants, calling `scanOne(tenantId)` for each. Per-tenant errors are caught and recorded so a
 * single failing (or disabled) tenant can't abort the batch. Returns a summary for logging/metrics.
 */
export async function runTenantScan(
  tenantIds: string[],
  scanOne: (tenantId: string) => Promise<unknown>,
  opts: { cap?: number } = {},
): Promise<ScanResult> {
  const cap = Math.max(1, Math.floor(opts.cap ?? 200));
  const batch = tenantIds.slice(0, cap);
  const res: ScanResult = { attempted: batch.length, succeeded: 0, failed: 0, failures: [] };
  for (const tenantId of batch) {
    try { await scanOne(tenantId); res.succeeded++; }
    catch (e: any) { res.failed++; res.failures.push({ tenantId, error: String(e?.message ?? e).slice(0, 200) }); }
  }
  return res;
}
