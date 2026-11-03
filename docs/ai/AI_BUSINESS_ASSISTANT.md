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

## Not built
- A stored, searchable conversation history (needs a table and a retention decision).
- Last 7 / last 30 days, last month and custom ranges (the report presets do not have them yet).
- Record search (customer / phone / invoice), profit and expenses, export, growth advisor, a Check Business Data button.
