// access-requests.ts — the roles a signed-in salon user may request (GET me/access-requests/roles, batch 8 decision 6).
// Types only — the ONE definition, read by the API and the POS.
export type RequestableRoleState = 'available' | 'held' | 'open_request' | 'not_requestable';
export interface RequestableRole { role: string; highRisk: boolean; state: RequestableRoleState }
export interface RequestableRolesResponse { roles: RequestableRole[] }
