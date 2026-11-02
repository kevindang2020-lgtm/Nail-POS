import { EVENTS } from './realtime-core';
import type { RealtimeEmitter } from './port';
// settings-changed.ts — the ONE definition of "tenant settings changed", for Constitution 9 §246.
//
// settings_updated was registered, versioned, routed to the "settings" screens and subscribed by the owner
// dashboard channel — and emitted by nothing. The earlier objection to wiring it was that "settings" change in
// ~20 places, and emitting from one would make the dashboard look live while missing most changes. Looking
// properly, that count mixed in every settings-LIKE table (skip-line, campaign limits, queue assignment), each of
// which has its own events. The table that holds salon-wide configuration is `tenant_settings`, and it has
// exactly five writers. So the canonical fact is precise: A ROW IN tenant_settings CHANGED.
//
// Every writer calls this after a successful write. A guard test (settings-changed-coverage) fails if any file
// writes tenant_settings without calling it, so a sixth writer cannot silently skip the event.
//
// ids only — the category — and the owner's screens refetch through their guarded routes. Best-effort: a failed
// emit must never fail the settings save that caused it.

export function notifySettingsChanged(rt: RealtimeEmitter | null | undefined, tenantId: string, category: string): void {
  try { rt?.toOwner(tenantId, EVENTS.settingsUpdated, { category }); } catch { /* best-effort: never fail the save */ }
}
