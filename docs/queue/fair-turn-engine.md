# Fair Turn Engine

The Fair Turn Engine decides which **eligible** technician gets the next walk-in, and says why. It is not a separate
queue: it runs inside the existing AI queue assignment module and writes to the existing queue tables. The turn ledger
in the workforce module is its only writer.

## Where the code lives

| Concern | File |
| --- | --- |
| Pure rules: units, modes, rotation order, joins, breaks, declines, the board view | `modules/workforce/src/turn-queue/turn-core.ts` |
| The ONE writer of turn state and turn events (per-branch advisory lock, idempotent) | `modules/workforce/src/turn-queue/turn-ledger.ts` |
| Fairness and the explanation timeline | `modules/workforce/src/turn-queue/turn-fairness.ts` |
| Board, health, history, fairness, reports, rules, Technician App reads | `modules/workforce/src/turn-queue/turn-queue.service.ts` |
| The staged ranking (eligibility, then constraints, then rotation, then preferences, then tie-break) | `modules/ai/src/ai-queue-assignment/fair-turn-engine.ts` |
| Settings: `assignment_mode` and `turn_policy`, on the ONE versioned settings source | `modules/ai/src/ai-queue-assignment/ai-queue-assignment-settings.ts` |
| Schema | migrations `600`–`603` (`apps/api/db/migrations`) |

## Modes

- **Assignment mode.** Each branch can override the salon default.
  - `AUTOMATIC`: the auto-run assigns.
  - `RECOMMEND_AND_CONFIRM` (the default): staff confirm the pick.
  - `MANUAL`: staff choose, and the engine still explains.

  `AUTOMATIC` and the old `auto_enabled` switch are kept consistent. A contradiction is refused with
  `TURN_POLICY_INVALID`.
- **Fairness mode** (`rotation_policy`). The fairness modes are:
  - `traditional_weighted_rotation` (the default)
  - `lowest_turn_units`
  - `workload_balanced`
  - `hybrid_fairness`
  - `manual_order`

  The five legacy policies keep the older scoring path. A fairness mode with no turn port falls back to scoring.

## Pipeline

The ranking runs in stages, and every stage can be explained:

1. **Hard eligibility.** The existing gate checks branch, clock, skill, capacity, break, block, appointment protection,
   station and lock. The turn rules add three more: not in rotation, manager hold, and declined by this guest.
2. **Business constraint.** On automatic runs only, a technician who has hit `maxConsecutiveAutomaticAssignments` drops
   back. This never applies when she is the only eligible technician.
3. **Fairness order.** This is the mode's key. Ties break deterministically, in this order:
   1. lowest burden
   2. longest ready wait
   3. earliest position
   4. technician id

   Nothing is random.
4. **Soft preferences.** A requested technician comes first, but never past a hard rule. Under
   `PREFERRED_TECHNICIAN_FIRST`, the preferred or previous technician comes first.
5. **Skips.** Everyone ranked ahead of the pick gets a `SKIP` event with its reason. Their position is preserved.

AI is not the turn authority. Nothing in the pipeline calls a model.

## Turn credit

Turns are counted in hundredths: `100` = 1.0 turn.

- **On assignment,** the units are provisional and the technician moves to the back. In traditional mode she moves back
  only once her pending units reach a full turn (the half-turn policy).
- **At Service Done,** the units are credited (`TURN_CREDIT`), once.
- **On cancel or unassign,** a `CORRECTION` event restores the position and the pending units.
