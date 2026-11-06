# AI Business Assistant — /tenant/ai/business

Guide: AI Business Assistant (dc11a0d9, received Nov 3 2026).

## Built
- Periods Today / Yesterday / This week / month / quarter / year (the server's presets); Refresh with the read time.
- The period's key numbers before any question (net sales, paid tickets, average ticket = net ÷ tickets or N/A, completed appointments),
  from the same endpoints the tools use.
- Composer: multi-line, Enter asks, Shift+Enter is a new line; a failed request offers Try again with the same question and period.
- Answer: Copy answer; "Run again for <period>" when the tab changed after asking.
- "Why did revenue change?" compares with the equivalent previous period (fbf7574); saved questions replay with their own period;
  "Summarize today" is always today.
- Saved questions: search when there are more than six. This session's questions and answers are listed (not stored).

## Built Nov 6 2026 (Kevin: "continue finish all"; migration 828, `ai-business-assistant-extras.ts`)
- Stored, searchable history: every question (and clarification) is kept for the person who asked — nobody else sees it —
  for 365 days (central retention executor), with search, Ask again, delete and a CSV download (formula-safe; no print).
- Custom From–To (at most 366 days) for every question except "why did revenue change" (that compares with the period
  before a named period; a custom range is refused with DATE_RANGE_UNSUPPORTED). Last 7 / 30 days and last month were
  added Nov 5.
- Record search: "find Nguyen" (accent-insensitive), "find 609-555-0101", "ticket 1042" — answered from this salon's own
  records with links to the customer and the ticket; names and phones are NEVER sent to the model; hidden by role
  (customers: pos.customers.view, tickets: pos.checkout.view).
- Profit & expenses: net sales − APPROVED expenses dated in the period, by category, margin, and how many expenses still
  wait for approval (owner.expenses.view + financial view).
- Growth advice: rules over the period's customers, appointments and revenue (no-shows, cancellations, retention, new
  customers, retail), each with its numbers and a link.
- Check Business Data: recorded read-only check (AI package, Sales Report readable, branch time zones, tickets paid at $0,
  expenses waiting > 14 days, history privacy).
- Export of an answer: Copy answer (existing) + the history CSV.
- Tests: `ai-business-assistant-extras.pgtest` (6), POS screen tests (10).
