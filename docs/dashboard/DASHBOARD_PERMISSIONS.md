# Dashboard Permissions
- View: `pos.dashboard.view` (OWNER/MANAGER/FRONT_DESK per role map). Inventory Alerts: `inventory.view`.
- Quick Actions route to flows guarded by their own permissions: booking.create, walkin.create,
  queue.assign, service.start, checkout.process, communications.send, cash_drawer.open.
- AI Insights require an active AI package (client gate + server AI-access gate). Receptionists do not see
  commission/payroll; technician earnings remain permission-gated in the underlying reports.
Backend authorization is the source of truth; hidden buttons are never the only guard.
