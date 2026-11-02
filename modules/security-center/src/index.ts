// modules/security-center — the security-center domain (Constitution 13 Phase 6): the ONE public entry point (§97). The API composes the Nest
// module and imports ONLY from here; every other file in this module is internal (§98–99).

export { SECURITY_EVENT_TYPES, SecurityEvents } from './security-events/security-events';   // used by the API today
