// ai-queue-assignment.tokens.ts — BUILD_PLAN Phase 6: Nest injection tokens shared by the AI queue-assignment modules
// (the core module, the tenant routes and the ops module). A file of its own so the ops module can import the tokens
// without importing the module that imports it (no file-level cycle).

/** The ONE settings source (`QueueAssignmentSettingsPort`): KyselyQueueAssignmentSettings with an OutboxWriter, or the
 *  in-memory one without a database. Every reader — engine, auto-run, detection, jobs, screens — injects this. */
export const QUEUE_ASSIGNMENT_SETTINGS = 'QUEUE_ASSIGNMENT_SETTINGS';

/** The board recommender seam the queue domain consumes (`@aipowersalon/queue` exports the same string as
 *  QUEUE_RECOMMENDER). Spelled here as the literal so this module does not need the queue's dist to bind it. */
export const QUEUE_RECOMMENDER_TOKEN = 'QUEUE_RECOMMENDER';
