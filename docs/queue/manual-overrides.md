# Manual overrides

- **Assigning someone other than the recommended technician.** The Fair Turn Engine is consulted. If the reason is
  missing, the API answers `400 MANUAL_OVERRIDE_REASON_REQUIRED`. The POS Queue drawer then asks for a reason inline,
  from `TURN_OVERRIDE_REASONS`.
  - The `MANUAL_ASSIGN` event records the reason, the recommended technician and the skips.
  - The skipped technicians keep their place.
  - Manual assignments count as a turn under `manualAssignmentTurnPolicy` (`COUNT_AS_TURN`).
- **Manager actions.** The actions are on `POS → Team → Turn Queue`, served by `/pos/turn-queue/*`:
  - set next or move to back (`REORDER`)
  - hold or release
  - adjust turns (`ADJUST`, in hundredths)
  - join

  Every action needs a reason, and every action is an event. Permissions:

  | Key | Roles |
  | --- | --- |
  | `turn_queue.reorder` | managers |
  | `turn_queue.hold` | managers |
  | `turn_queue.adjust` | managers |
  | `turn_queue.settings.manage` | managers; owners hold all keys |
  | `turn_queue.read` | front desk |
  | `turn_queue.join` | front desk |
  | `turn_queue.assign` | front desk |
- **Correcting a mistake.** Unassigning, cancelling or reassigning writes a `CORRECTION` event. It restores the
  position and the pending units if nothing has changed since. History is never edited. The database refuses UPDATE
  and DELETE on `technician_turn_events`.
