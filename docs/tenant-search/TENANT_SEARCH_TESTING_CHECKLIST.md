# Tenant Search — Testing Checklist

## Automated (passing)
- `pos-search-core.spec.ts` — 23/23 (access, groups, validation, routing).
- `pos-search-isolation.spec.ts` — 8/8 (tenant/location scope derived from session; no escalation/injection).
- API typecheck 0 errors. pos-web typecheck 0, vite build OK.

## Manual (maps to spec §19)
1–12. Customer (full/partial/phone/email), appointment, queue, ticket, receipt, technician, service searches return current-tenant data.
13–14. Results group by category; exact matches rank first (CASE ordering in repo).
15. Clicking a result opens the correct POS screen.
16–18. Current-location default; OWNER/MANAGER all-locations; receptionist cannot search other locations.
19–24. Tenant A cannot find Tenant B customers/appointments/technicians/transactions; manual tenantId/locationId rejected/ignored.
25–27. Receptionist can't see owner-only groups; technician limited; forbidden roles blocked.
28–30. Logout (recent keyed per user); tenant/branch switch reloads; no cross-tenant cache (no shared cache key).
31. Injection attempts fail (parameterized ILIKE, escaped % _).
33–35. No web/external/other-salon results; no raw card/gateway secrets.
