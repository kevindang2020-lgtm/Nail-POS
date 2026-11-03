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

## Not built (needs a decision or data that does not exist)
- Branch Data Health Checker (P1): no recorded check yet.
- Fair scorecard per technician hour / operating hour / retention (P2): needs scheduled hours per branch.
- AI explanation of differences (P3) and Growth advisor (P5).
- All-my-salons across separate legal entities (P4): one tenant only; cross-entity needs an ownership model.
