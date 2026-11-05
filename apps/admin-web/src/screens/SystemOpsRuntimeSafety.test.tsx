// SystemOpsRuntimeSafety.test — BUILD_PLAN Phase 11: the runtime-safety panel on System Operations.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
vi.mock('../api/superAdminApi', () => ({ superAdminApi: { systemRuntimeSafety: vi.fn() } }));
import { superAdminApi } from '../api/superAdminApi';
import { SystemOpsRuntimeSafety } from './SystemOpsRuntimeSafety';
import type { RuntimeSafety } from '@aipowersalon/api-contracts/platform';

const base = (over: Partial<RuntimeSafety> = {}): RuntimeSafety => ({
  generatedAt: '2026-10-08T12:00:00Z',
  schema: { status: 'ok', latest: '552_tenant_quotas_load_cost.sql', latestAppliedAt: '2026-10-08T11:00:00Z', applied: 546, files: 546, pending: [], unknown: [], mismatches: [], migrationsDir: '/app/apps/api/db/migrations', checkedAt: '2026-10-08T12:00:00Z' },
  breakGlass: { mode: 'off', message: null, problem: null },
  rateLimiter: { enabled: true, store: 'memory', maxPerWindow: 3000, windowMs: 60000, keyedBy: 'location' },
  redis: { configured: false, requiredBecause: [] },
  strandedPayments: { thresholdMinutes: 15, needsReview: 0, unverifiedCards: 0, recent: [] },
  ...over,
});
beforeEach(() => { vi.mocked(superAdminApi.systemRuntimeSafety).mockReset(); });

describe('SystemOpsRuntimeSafety', () => {
  it('all clear: maintenance off, schema up to date, limiter on, no stranded payments', async () => {
    vi.mocked(superAdminApi.systemRuntimeSafety).mockResolvedValue(base() as never);
    render(<SystemOpsRuntimeSafety />);
    expect(await screen.findByTestId('break-glass')).toHaveTextContent('Off');
    expect(screen.getByTestId('schema-version')).toHaveTextContent('Up to date');
    expect(screen.getByTestId('schema-version')).toHaveTextContent('552_tenant_quotas_load_cost.sql');
    expect(screen.getByTestId('rate-limiter')).toHaveTextContent('On (memory)');
    expect(screen.getByText('No stranded card payments.')).toBeTruthy();
    expect(screen.queryByTestId('break-glass-banner')).toBeNull();
  });
  it('break-glass on → a banner above everything; pending + edited migrations are named', async () => {
    vi.mocked(superAdminApi.systemRuntimeSafety).mockResolvedValue(base({
      breakGlass: { mode: 'read_only', message: 'Database restore in progress', problem: null },
      schema: { status: 'pending', latest: '548_trace_context.sql', latestAppliedAt: null, applied: 545, files: 547, pending: ['549_payment_attempt_stranded.sql'], unknown: [], mismatches: ['001_auth_foundation.sql'], migrationsDir: null, checkedAt: '2026-10-08T12:00:00Z' },
    }) as never);
    render(<SystemOpsRuntimeSafety />);
    expect(await screen.findByTestId('break-glass-banner')).toHaveTextContent(/READ-ONLY[\s\S]*Database restore in progress/);
    expect(screen.getByTestId('schema-pending')).toHaveTextContent('549_payment_attempt_stranded.sql');
    expect(screen.getByTestId('schema-mismatches')).toHaveTextContent('001_auth_foundation.sql');
  });
  it('stranded payments are listed with what the processor said', async () => {
    vi.mocked(superAdminApi.systemRuntimeSafety).mockResolvedValue(base({ strandedPayments: { thresholdMinutes: 15, needsReview: 1, unverifiedCards: 0, recent: [
      { id: 'a1', kind: 'split_attempt', tenantId: 't1', tenantName: 'Luxe Nails', ticketId: 'f5490000-0000', amountCents: 4200, status: 'needs_review', resolution: 'provider_approved_unrecorded', createdAt: '2026-10-08T10:00:00Z', strandedAt: '2026-10-08T10:20:00Z' },
    ] } }) as never);
    render(<SystemOpsRuntimeSafety />);
    expect(await screen.findByTestId('stranded-table')).toHaveTextContent(/Luxe Nails[\s\S]*\$42\.00[\s\S]*Charged by the processor, not recorded here/);
    expect(screen.getByTestId('stranded-summary')).toHaveTextContent('1 need review');
  });
  it('§332: a failed read says so — never "no stranded payments"', async () => {
    vi.mocked(superAdminApi.systemRuntimeSafety).mockRejectedValue(new Error('500'));
    render(<SystemOpsRuntimeSafety />);
    expect(await screen.findByTestId('runtime-safety-failed')).toBeTruthy();
    expect(screen.queryByText('No stranded card payments.')).toBeNull();
  });
});
