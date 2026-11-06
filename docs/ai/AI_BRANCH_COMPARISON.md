# AI Branch Comparison — /tenant/ai/business/branches

Guide: AI Branch Comparison (3d6c2863, received Nov 3 2026). API: `GET /pos/ai-business/branches/compare`
(`preset` | `from`+`to`, `q`, `includeInactive`, `page`, `pageSize` 10/25/50). Numbers: the canonical Sales Report and booking
overview, read one AUTHORIZED branch at a time (OwnerService.listAuthorizedBranches); tenant never widened.

## Built
- Every authorized branch (the 20-branch cap is gone), sorted by name, searched by name, paged on the server; inactive branches hidden
  unless "Show inactive" is ticked (the count of hidden ones is shown).
- Presets today / yesterday / week / month / quarter / year and a custom From–To (at most 366 days).
- KPI strip of whole-salon totals over every matching branch; ratios computed from the totals; "Read <time>" and Refresh.
- N/A instead of 0 % / $0.00 when a ratio has no denominator; average ticket = net ÷ paid tickets (it was gross ÷ tickets while the
  other columns were net). Revenue columns hidden without financial permission.
- A row opens that branch's figures (tickets, cancelled %, no-show %) with the Sales Report link.
- The AI Business Assistant and saved branch reports read every branch (`all: true`), not the first page.

## Built Nov 6 2026 (Kevin: "continue finish all"; migration 827, `branch-insights.ts`)
- P1 Branch Data Health Checker ("Check Branch Data"): read-only, recorded (ai_business_health_runs area 'branches'), reused
  within 30 s — branch time zones, opening hours, shifts never clocked out (> 16 h), sales at inactive branches, tenant
  isolation, no side effects.
- P2 fair scorecard: net sales per worked technician hour (time-clock shifts; an open shift counts at most 12 h), per opening
  hour (each location's hours over the period, closed days and effective dates honoured) and returning-customer rate, each
  ranked (#), so a small or short-hours branch is not ranked down for its size. N/A where the hours are not set.
- P3 "Explain the difference": the measured bridge between two branches — volume (ticket count at B's average ticket) +
  average ticket = the whole difference — plus completion, no-shows, hours and returning customers; it says plainly these
  are measured differences, not causes. Rendered in the screen language (EN / VI).
- P5 growth advisor: rules over the scorecard (low yield per technician hour vs the salon median, high no-shows, low return
  rate, missing opening hours), each with its numbers and a link to where to act.
- Tests: `branch-insights.pgtest` (5), POS screen tests.

## Not built
- All-my-salons across separate legal entities (P4): one login belongs to one salon (tenant); comparing several salons
  needs an owner identity that spans tenants. That is a platform ownership decision, not a screen — recorded in
  docs/DECISIONS_2026-11-06.md.
