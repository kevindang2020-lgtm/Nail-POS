// retention-executor-core.ts — Constitution 1 §55–57: the pure half of the central retention executor. Reads the ONE policy
// file (apps/api/db/retention-policy.json), validates every entry the executor is asked to run, and decides each table's
// effective rule (a Super Admin retention rule for the table's data class may lengthen/shorten it within its compliance
// floor — never for a 'never' table). No DB, no Nest. Nothing here deletes anything.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type DeletePolicy = 'never' | 'soft_delete' | 'hard_delete_after_days' | 'anonymize_after_days';
export interface RetentionWhere { column: string; in?: string[]; not_in?: string[] }
export interface RetentionTablePolicy {
  retention_class: string; delete_policy: DeletePolicy; days?: number; timestamp_column?: string; executor?: string;
  data_class?: string; where?: RetentionWhere; not_referenced_by?: { table: string; column: string }[];
  anonymize?: { columns: string[] }; legal_basis?: string;
}
export interface RetentionPolicyFile { version: number; classes: Record<string, { description: string; default_policy: DeletePolicy }>; tables: Record<string, RetentionTablePolicy> }

/** Classes whose rows are never deleted, whatever a table entry or a Super Admin rule says (Constitution 1 §55–56). */
export const NEVER_CLASSES = new Set(['financial', 'audit']);
const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;
export const isIdent = (s: unknown): s is string => typeof s === 'string' && IDENT.test(s);

export function policyFilePath(migrationsDir: string, env: NodeJS.ProcessEnv = process.env): string {
  return env.RETENTION_POLICY_FILE || resolve(migrationsDir, '..', 'retention-policy.json');
}
export function loadPolicyFile(path: string): RetentionPolicyFile | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as RetentionPolicyFile;
}

export interface ExecutableRule {
  table: string; retentionClass: string; action: 'delete' | 'anonymize'; days: number; timestampColumn: string;
  dataClass: string; where?: RetentionWhere; notReferencedBy: { table: string; column: string }[]; anonymizeColumns: string[];
  source: 'policy' | 'super_admin_rule';
}

/** Problems that make an entry unsafe to execute — the executor skips (and reports) such an entry instead of guessing. */
export function validateEntry(table: string, p: RetentionTablePolicy): string[] {
  const out: string[] = [];
  if (!isIdent(table)) out.push('table name is not a plain identifier');
  if (NEVER_CLASSES.has(p.retention_class) && p.delete_policy !== 'never') out.push(`class ${p.retention_class} is never deleted`);
  if (p.delete_policy !== 'hard_delete_after_days' && p.delete_policy !== 'anonymize_after_days') out.push(`delete_policy ${p.delete_policy} is not executable`);
  if (!Number.isInteger(p.days) || (p.days as number) < 1) out.push('days must be a positive integer');
  if (!isIdent(p.timestamp_column)) out.push('timestamp_column missing or not an identifier');
  if (p.where && (!isIdent(p.where.column) || (!p.where.in?.length && !p.where.not_in?.length))) out.push('where needs a column and a non-empty in / not_in list');
  for (const r of p.not_referenced_by ?? []) if (!isIdent(r.table) || !isIdent(r.column)) out.push('not_referenced_by entries need identifier table + column');
  if (p.delete_policy === 'anonymize_after_days' && (!p.anonymize?.columns?.length || !p.anonymize.columns.every(isIdent))) out.push('anonymize needs identifier columns');
  return out;
}

/** The entries the central executor owns ('executor': 'central'), each validated. */
export function executableEntries(file: RetentionPolicyFile): { rules: ExecutableRule[]; skipped: { table: string; problems: string[] }[] } {
  const rules: ExecutableRule[] = []; const skipped: { table: string; problems: string[] }[] = [];
  for (const [table, p] of Object.entries(file.tables ?? {})) {
    if (p.executor !== 'central') continue;
    const problems = validateEntry(table, p);
    if (problems.length) { skipped.push({ table, problems }); continue; }
    rules.push({
      table, retentionClass: p.retention_class, action: p.delete_policy === 'anonymize_after_days' ? 'anonymize' : 'delete', days: p.days as number,
      timestampColumn: p.timestamp_column as string, dataClass: p.data_class || table, where: p.where, notReferencedBy: p.not_referenced_by ?? [],
      anonymizeColumns: p.anonymize?.columns ?? [], source: 'policy',
    });
  }
  return { rules, skipped };
}

/** A Super Admin rule (data_retention_rules, versioned, floor-validated) for the table's data class replaces the policy's
 *  days when its action matches what the executor would do; a rule asking for a different action is ignored (reported). */
export function applySuperAdminRule(rule: ExecutableRule, saRule: { retentionDays: number; action: string } | null): { rule: ExecutableRule; note?: string } {
  if (!saRule) return { rule };
  const want = rule.action === 'anonymize' ? 'anonymize' : 'delete';
  if (String(saRule.action) !== want) return { rule, note: `Super Admin rule action '${saRule.action}' differs from the policy's '${want}' — policy days kept` };
  if (!Number.isInteger(saRule.retentionDays) || saRule.retentionDays < 1) return { rule, note: 'Super Admin rule days invalid — policy days kept' };
  return { rule: { ...rule, days: saRule.retentionDays, source: 'super_admin_rule' } };
}

export function cutoffFor(nowMs: number, days: number): string { return new Date(nowMs - days * 86_400_000).toISOString(); }

export type ExecutorMode = 'on' | 'dry_run' | 'off';
/** RETENTION_EXECUTOR: on (default) | dry_run (compute, write nothing) | off. Never in tests. */
export function executorMode(env: NodeJS.ProcessEnv = process.env): ExecutorMode {
  if (env.NODE_ENV === 'test') return 'off';
  const v = String(env.RETENTION_EXECUTOR ?? 'on').trim().toLowerCase();
  return v === 'off' || v === '0' || v === 'false' ? 'off' : v === 'dry_run' || v === 'dry-run' ? 'dry_run' : 'on';
}
