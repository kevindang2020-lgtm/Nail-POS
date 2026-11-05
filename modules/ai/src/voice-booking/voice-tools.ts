// voice-tools.ts — the tool catalog the AI voice agent is allowed to call, provider-agnostic.
//
// These are the ONLY actions the receptionist can take. Each maps to a Voice Booking Gateway method (which reuses the
// canonical booking/customer services). The catalog is data, not hard-coded logic: a provider adapter renders it into
// that provider's function/tool format (Retell custom functions, Vapi tools, etc.). Read tools are live now (Phase 1a).
// WRITE tools are declared here for completeness but are gated OFF until the write path is wired and confirmed — the
// agent must never believe it can book/cancel before that path exists and is guarded (confirm-before-write).

export interface VoiceToolParam { name: string; type: 'string' | 'number' | 'boolean'; required: boolean; description: string; }
export interface VoiceToolDef {
  name: string;
  description: string;
  params: VoiceToolParam[];
  /** 'read' = safe lookup; 'write' = mutates real data (create/reschedule/cancel/handoff). */
  kind: 'read' | 'write';
  /** When false the tool is declared but not yet exposed to the agent (write path not wired / not confirmed). */
  enabled: boolean;
}

export const VOICE_TOOLS: VoiceToolDef[] = [
  {
    name: 'get_services',
    kind: 'read', enabled: true,
    description: 'List the salon services that can be booked, with duration and price. Use to answer "what do you offer" and to resolve a service the caller names.',
    params: [],
  },
  {
    name: 'get_technicians',
    kind: 'read', enabled: true,
    description: 'List technicians the caller can request. Optionally filter to those who perform a given service.',
    params: [
      { name: 'service_id', type: 'string', required: false, description: 'Restrict to technicians who perform this service.' },
    ],
  },
  {
    name: 'get_availability',
    kind: 'read', enabled: true,
    description: 'Get REAL open appointment times for a service on a date, optionally for a preferred technician. Only offer times this returns; if it is empty, tell the caller there is no availability and offer another day.',
    params: [
      { name: 'service_id', type: 'string', required: true, description: 'The service to book.' },
      { name: 'date', type: 'string', required: true, description: 'The date, YYYY-MM-DD.' },
      { name: 'technician_id', type: 'string', required: false, description: 'A preferred technician, if the caller asked for one.' },
      // Round 2 H: honoured only while write tools are on (a hold is a write).
      { name: 'hold', type: 'boolean', required: false, description: 'True when the caller is ready to book: the best option is held for this call while they confirm, so nobody else can take it.' },
    ],
  },
  {
    // BUILD_PLAN Phase 5: the receptionist answers "any specials?" from the ONE deals domain — only deals live right now
    // and offered on the phone channel, with their terms. It never promises a price: the register applies a deal.
    name: 'get_deals',
    kind: 'read', enabled: true,
    description: 'List the salon\'s current specials and coupons (title, what it takes off, terms, end date). Mention a deal only as returned; say the discount is applied at checkout and terms apply. Never invent a deal or a price.',
    params: [],
  },
  // ---- WRITE tools (behind VOICE_WRITE_TOOLS_ENABLED). Reschedule/cancel/search require caller verification and act
  //      only on the verified caller's OWN appointments. ----
  {
    name: 'verify_caller',
    kind: 'write', enabled: true,
    description: 'Verify the caller against a customer on file by phone (and name, if the salon requires it) before looking up, changing, or cancelling any appointment. Confirm the phone with the caller first.',
    params: [
      { name: 'phone', type: 'string', required: true, description: 'The caller\'s phone number (confirm it aloud first).' },
      { name: 'name', type: 'string', required: false, description: 'The caller\'s name (required only if the salon uses phone+name verification).' },
    ],
  },
  {
    name: 'search_appointments',
    kind: 'write', enabled: true,
    description: 'List the verified caller\'s upcoming appointments so they can pick one to change or cancel. Verifies by phone first.',
    params: [
      { name: 'phone', type: 'string', required: true, description: 'The caller\'s phone number.' },
      { name: 'name', type: 'string', required: false, description: 'The caller\'s name (if required).' },
    ],
  },
  {
    name: 'lookup_or_create_customer',
    kind: 'write', enabled: true,
    description: 'Find a customer by phone, or create one. Creating a profile REQUIRES the caller\'s explicit consent — ask "may I save your details?" and pass consent=true only if they agree.',
    params: [
      { name: 'phone', type: 'string', required: true, description: 'Caller phone number.' },
      { name: 'customer_name', type: 'string', required: false, description: 'Caller name.' },
      { name: 'consent', type: 'boolean', required: false, description: 'True only if the caller agreed to save their details.' },
    ],
  },
  {
    name: 'create_appointment',
    kind: 'write', enabled: true,
    description: 'Book an appointment. MUST be called only after get_availability returned this exact slot AND the caller verbally confirmed the service, date, time, and technician. Pass confirmed=true only after that verbal confirmation.',
    params: [
      { name: 'service_id', type: 'string', required: true, description: 'The confirmed service.' },
      { name: 'date', type: 'string', required: true, description: 'YYYY-MM-DD.' },
      { name: 'start_time', type: 'string', required: true, description: 'HH:MM, must be a slot get_availability returned.' },
      { name: 'technician_id', type: 'string', required: false, description: 'The confirmed technician (optional = any available).' },
      { name: 'customer_name', type: 'string', required: true, description: 'The caller\'s name for the appointment.' },
      { name: 'customer_phone', type: 'string', required: false, description: 'The caller\'s phone number.' },
      { name: 'confirmed', type: 'boolean', required: true, description: 'True only after the caller verbally confirmed all details.' },
    ],
  },
  {
    // Round 2 H: hold the exact time the caller picked while they confirm (the salon's hold time, a few minutes). One hold
    // per call — holding another time moves it; booking converts it; the call ending releases it.
    name: 'hold_slot',
    kind: 'write', enabled: true,
    description: 'Hold one time get_availability returned while the caller confirms details, so nobody else books it. One hold per call; holding another time moves it. Booking it with create_appointment uses the hold.',
    params: [
      { name: 'service_id', type: 'string', required: true, description: 'The service to hold time for.' },
      { name: 'date', type: 'string', required: true, description: 'YYYY-MM-DD.' },
      { name: 'start_time', type: 'string', required: true, description: 'HH:MM, a slot get_availability returned.' },
      { name: 'technician_id', type: 'string', required: false, description: 'The technician, if the caller chose one (optional = any available).' },
    ],
  },
  {
    name: 'release_hold',
    kind: 'write', enabled: true,
    description: 'Release the time held for this call when the caller decides not to book it.',
    params: [],
  },
  {
    name: 'reschedule_appointment',
    kind: 'write', enabled: true,
    description: 'Move the verified caller\'s appointment to a new time (atomic — never cancel-then-rebook). Verify the caller by phone first, confirm which appointment, and pass confirmed=true only after they confirm the new time.',
    params: [
      { name: 'phone', type: 'string', required: true, description: 'The caller\'s phone (for verification).' },
      { name: 'name', type: 'string', required: false, description: 'The caller\'s name (if required).' },
      { name: 'appointment_id', type: 'string', required: true, description: 'From search_appointments — must be the caller\'s own.' },
      { name: 'date', type: 'string', required: false, description: 'New date, YYYY-MM-DD (defaults to same day).' },
      { name: 'start_time', type: 'string', required: true, description: 'New time, HH:MM (from get_availability).' },
      { name: 'confirmed', type: 'boolean', required: true, description: 'True only after the caller confirmed the change.' },
    ],
  },
  {
    name: 'cancel_appointment',
    kind: 'write', enabled: true,
    description: 'Cancel the verified caller\'s appointment. Verify by phone first, confirm which appointment, and pass confirmed=true only after they explicitly confirm the cancellation.',
    params: [
      { name: 'phone', type: 'string', required: true, description: 'The caller\'s phone (for verification).' },
      { name: 'name', type: 'string', required: false, description: 'The caller\'s name (if required).' },
      { name: 'appointment_id', type: 'string', required: true, description: 'From search_appointments — must be the caller\'s own.' },
      { name: 'confirmed', type: 'boolean', required: true, description: 'True only after the caller explicitly confirmed.' },
      { name: 'reason', type: 'string', required: false, description: 'Optional cancellation reason.' },
    ],
  },
  {
    name: 'handoff_to_front_desk',
    kind: 'write', enabled: true,
    description: 'When the caller asks for a person, is upset, disputes a charge, or the request is out of scope, hand off to the front desk. Never guess an answer the tools cannot support.',
    params: [
      { name: 'reason', type: 'string', required: false, description: 'Short reason for the handoff.' },
    ],
  },
];

/** Whether write tools are exposed at all. Off by default — even a valid key can't book until ops flips this on. */
export function voiceWriteToolsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.VOICE_WRITE_TOOLS_ENABLED ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/** Tools currently exposed to the agent. Write tools appear only when VOICE_WRITE_TOOLS_ENABLED is on. */
export function enabledVoiceTools(env: NodeJS.ProcessEnv = process.env): VoiceToolDef[] {
  const writeOn = voiceWriteToolsEnabled(env);
  return VOICE_TOOLS.filter((t) => t.enabled && (t.kind === 'read' || writeOn));
}
