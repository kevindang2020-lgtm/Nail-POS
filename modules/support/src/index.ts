// modules/support — the support domain (Constitution 13 Phase 6): the ONE public entry point (§97). The API composes the Nest
// module and imports ONLY from here; every other file in this module is internal (§98–99).

export { HelpModule } from './help/help.module';
export { SupportSessionsService } from './help/support-sessions.service';   // used by the API today
export { SupportTicketsService } from './help/support-tickets.service';   // used by the API today
