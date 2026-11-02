# Tenant POS Search API

## GET /pos/search
Guards: `TenantAuthGuard`, `RolePermissionGuard('global_search.use')`. Tenant/branch from session.

Query params: `q` (>=2 chars), `limit` (per-group, max 10), `locationScope=all` (OWNER/MANAGER only).
**`tenantId`/`branchId` are never accepted.**

Response (safe shape):
```json
{
  "ok": true,
  "query": "sophia",
  "scope": { "tenant": "current", "location": "current" },
  "groups": {
    "customers": [{ "id": "...", "type": "customer", "title": "Sophia Nguyen", "subtitle": "(856) 555-0148", "badge": "active" }],
    "appointments": [], "queue": [], "tickets": [], "receipts": [], "technicians": [], "services": []
  },
  "counts": { "customers": 1, "appointments": 0, "queue": 0, "tickets": 0, "receipts": 0, "technicians": 0, "services": 0 },
  "totalCount": 1,
  "requestId": "uuid"
}
```

## POST /pos/search/open
Body `{ resultType, entityId, q }`. Writes a `pos_search_result_opened` audit row (audit on open, not per keystroke).

Groups & matched fields: customers (name/phone/email), appointments (customer/status/time), queue
(customer/status), tickets (ticket #/customer), receipts (receipt #), technicians (name/email/phone),
services (name). Phone is normalized to digits; matching is case-insensitive and parameterized.
