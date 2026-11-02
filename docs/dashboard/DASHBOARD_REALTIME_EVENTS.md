# Dashboard Realtime
The screen subscribes via `useRealtime('dashboard', load)`. Pushed tenant events (payment.completed,
queue.updated, service.started/completed, walk_in.created, appointment.*, technician.clocked_in/out,
inventory.low, message.received, reminder.failed) trigger a scoped refetch of the aggregate + inventory
alerts. `As of <time>` reflects the last successful load; a failed module shows its own error + Retry
without blanking the page.
