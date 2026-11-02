/**
 * super-admin-tenants.dto.ts
 * ---------------------------------------------------------------------------
 * Request/response contract for the Super Admin Tenants API.
 *
 * Endpoints (all behind the `super-admin` guard — CROSS-TENANT, never scoped()):
 *   GET   /super-admin/tenants/state            -> TenantsStateResponse
 *   POST  /super-admin/tenants                  CreateTenantRequest  -> TenantMutationResponse
 *   POST  /super-admin/tenants/:id/suspend      SuspendTenantRequest -> TenantMutationResponse
 *   POST  /super-admin/tenants/:id/reactivate   (no body)            -> TenantMutationResponse
 *   POST  /super-admin/tenants/:id/reset-owner-password              -> ResetOwnerPasswordResponse
 *   POST  /super-admin/tenants/import           ImportTenantsRequest -> ImportTenantsResponse
 *   GET   /super-admin/tenants/:id/audit        -> TenantAuditResponse
 *
 * The frontend (aipowersalon-super-admin-tenants.html) never sends tenantId for
 * scoping — Super Admin reads across all tenants. Keep these interfaces free of
 * framework decorators; the repo-side controller may re-declare them as classes
 * with class-validator. The shapes below are the source of truth either way.
 */

import type {
  TenantsState,
  TenantViewRow,
  TabKey,
  TenantFilter,
} from './super-admin-tenants-core';

/* ------------------------------- GET state ------------------------------- */

export interface TenantsStateQuery {
  tab?: TabKey;
  q?: string;
  plan?: string;
  ai?: string;
  state?: string;
  pay?: string;
  setup?: '' | 'complete' | 'incomplete';
  page?: number;
  pageSize?: number;
}

export type TenantsStateResponse = TenantsState;

export function queryToFilter(q: TenantsStateQuery): TenantFilter {
  return {
    q: q.q,
    plan: q.plan,
    ai: q.ai,
    state: q.state,
    pay: q.pay,
    setup: q.setup,
  };
}

/* ------------------------------- Mutations ------------------------------- */

export interface CreateTenantRequest {
  legalName?: string;
  displayName: string;
  tenantCode?: string;
  /** screen sends `code`; treated as tenantCode. */
  code?: string;
  slug?: string;
  /** flat owner fields (programmatic callers) … */
  ownerName?: string;
  ownerEmail?: string;
  ownerPhone?: string;
  /** … or nested owner object (the screen's create modal). */
  owner?: { firstName?: string; lastName?: string; email?: string; phone?: string };
  branch?: {
    name?: string; address?: string; city?: string; state?: string; zip?: string; phone?: string;
  };
  plan: string;
  planTier?: string;
  aiPackage?: string;
  paymentProcessor?: string;
  fiservMid?: string;
  status?: string;
  state?: string;
  city?: string;
  initialCommissionPercent?: number;
}

/** Canonical fields the service/core operate on, regardless of input shape. */
export interface NormalizedCreate {
  displayName: string;
  legalName?: string;
  tenantCode?: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone?: string;
  plan: string;
  aiPackage?: string;
  state?: string;
  city?: string;
  initialCommissionPercent?: number;
}

/** Accepts both the flat and the screen's nested create payloads. */
export function normalizeCreateRequest(req: CreateTenantRequest): NormalizedCreate {
  const ownerName =
    req.ownerName ||
    [req.owner?.firstName, req.owner?.lastName].filter(Boolean).join(' ').trim();
  return {
    displayName: req.displayName,
    legalName: req.legalName,
    tenantCode: (req.tenantCode || req.code)?.trim() ? (req.tenantCode || req.code)!.trim().toUpperCase() : undefined,
    ownerName,
    ownerEmail: req.ownerEmail || req.owner?.email || '',
    ownerPhone: req.ownerPhone || req.owner?.phone,
    plan: req.plan,
    aiPackage: req.aiPackage,
    state: req.state || req.branch?.state,
    city: req.city || req.branch?.city,
    initialCommissionPercent: req.initialCommissionPercent ?? (req.owner as any)?.initialCommissionPercent ? Number(req.initialCommissionPercent ?? (req.owner as any)?.initialCommissionPercent) : 50,
  };
}

export interface SuspendTenantRequest {
  reason: string;
}

export interface TenantMutationResponse {
  ok: boolean;
  tenant?: TenantViewRow;
  /** Present when ok=false; safe to surface in the modal. */
  errors?: string[];
}

/* --------------------------- Owner password reset --------------------------- */

export interface ResetOwnerPasswordResponse {
  ok: boolean;
  /**
   * Security Deep Scan C2 (Oct 23 2026): the temporary password is SENT to the owner (email / SMS) and never returned —
   * the Super Admin sees only which channel and a masked destination. (It used to be returned here "shown once".)
   */
  delivery?: 'email' | 'sms';
  sentTo?: string;
  expiresAt?: string;
  /** REASON_REQUIRED | RESOURCE_NOT_FOUND | PLATFORM_ACCOUNT_TARGET | CANNOT_DELIVER | DELIVERY_FAILED */
  code?: string;
  errors?: string[];
}

/* ------------------------------- Bulk import ------------------------------- */

export interface ImportTenantRow {
  displayName: string;
  ownerEmail: string;
  ownerName?: string;
  plan?: string;
  state?: string;
}

export interface ImportTenantsRequest {
  rows: ImportTenantRow[];
}

export interface ImportTenantsResponse {
  ok: boolean;
  created: number;
  skipped: number;
  rowErrors: Array<{ index: number; errors: string[] }>;
}

/* --------------------------------- Audit --------------------------------- */

export interface TenantAuditRecord {
  id: string;
  actionType: string;
  actorName: string;
  actorRole: string;
  createdAt: string; // ISO
  ip?: string;
  summary: string;
}

export interface TenantAuditResponse {
  tenantId: string;
  tenantName: string;
  entries: TenantAuditRecord[];
}

/* ------------------------------ Support mode ------------------------------ */




