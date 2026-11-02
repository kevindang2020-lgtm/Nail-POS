import { AI_RECEPTIONIST_AGENT } from '../ai-lifecycles';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English
// ai-agent-core.ts — pure logic for AI Front Desk agents. Validation, the status machine, and defaults. No I/O.
// Statuses beyond draft/archived are provider-gated: a config-only agent cannot become 'ready'/'live' until a
// provider (Retell) account is connected, so createDraft always yields 'draft' and the reachable transitions here
// stop short of provisioning. This keeps the honest boundary — no fake "Live".

export type AgentStatus = 'draft' | 'ready' | 'live' | 'paused' | 'error' | 'archived';
export type CallType = 'inbound' | 'outbound' | 'both';

export interface AgentConfigInput {
  name?: string; branchId?: string | null; callType?: string; language?: string;
  useCase?: string; greeting?: string; behavior?: string;
}
export interface AgentConfig {
  name: string; branchId: string | null; callType: CallType; language: string;
  useCase: string | null; greeting: string | null; behavior: string | null;
}

export class AgentValidationError extends Error { constructor(msg: string) { super(msg); this.name = 'AgentValidationError'; } }

export const DEFAULT_GREETING = 'Thank you for calling {{business_name}}. This is {{agent_name}}, your AI receptionist. How may I help you today?';
export const DEFAULT_BEHAVIOR = [
  'Sound warm, natural, capable, and brief — like a skilled nail-salon receptionist, not a robot.',
  'Ask one clear question at a time and let the caller interrupt.',
  'Confirm names, phone numbers, dates, times, services, and technicians.',
  'Never claim a booking succeeded before the booking tool confirms it; never invent availability, prices, or technicians.',
  'Verify the caller before rescheduling or canceling; repeat final details before ending the call.',
  'Allow one clarification or recovery attempt on misunderstandings, then transfer to staff or create a callback request.',
  'If the customer explicitly asks for a person, transfer or create a callback immediately.',
  'Hand off complaints, refunds, disputes, payment, and medical or safety questions to a human.',
  'Do not give medical, legal, or financial advice; do not collect full payment card details; keep customer data private.',
].join('\n');

const CALL_TYPES: CallType[] = ['inbound', 'outbound', 'both'];

/** Validate + normalize a create/update payload into a full config. Throws AgentValidationError on bad input. */
export function normalizeAgentConfig(input: AgentConfigInput, existing?: AgentConfig): AgentConfig {
  const name = (input.name ?? existing?.name ?? '').trim();
  if (!name) throw withCode(new AgentValidationError('Agent name is required.'), 'AGENT_NAME_REQUIRED');
  if (name.length > 80) throw withCode(new AgentValidationError('Agent name is too long.'), 'AGENT_NAME_TOO_LONG');
  const callType = (input.callType ?? existing?.callType ?? 'inbound') as CallType;
  if (!CALL_TYPES.includes(callType)) throw new AgentValidationError('Invalid call type.');
  // Kevin (Oct 28 2026): the AI receptionist speaks English only — any other language asked for (or stored earlier) is English
  const language = 'en';
  const clamp = (v: string | null | undefined, n: number) => { const s = (v ?? '').trim(); return s ? s.slice(0, n) : null; };
  return {
    name,
    branchId: input.branchId !== undefined ? (input.branchId || null) : (existing?.branchId ?? null),
    callType,
    language,
    useCase: input.useCase !== undefined ? clamp(input.useCase, 200) : (existing?.useCase ?? null),
    greeting: input.greeting !== undefined ? clamp(input.greeting, 600) : (existing?.greeting ?? null),
    behavior: input.behavior !== undefined ? clamp(input.behavior, 4000) : (existing?.behavior ?? null),
  };
}

/** Allowed status transitions for the config-only lifecycle (no provider provisioning here). */
export function canTransitionAgent(from: AgentStatus, to: AgentStatus): boolean {
  // BUILD_PLAN Phase 12 (#27): the ONE table is the ai_receptionist_agent machine (ai-lifecycles.ts). 'ready' is reached
  // through provider provisioning only. AI Front Desk guide (Oct 31 2026): this plain status route used to allow ready → LIVE
  // with no routing evidence, owner approval or salon activation, and to pause/archive a live agent while the salon stayed
  // activated. Every move into or out of 'live', and out of 'archived' (restore), now happens only in front-desk-center.ts.
  if (to === 'ready' || to === 'live' || from === 'live' || from === 'archived') return false;
  return AI_RECEPTIONIST_AGENT.can(from, to);
}
