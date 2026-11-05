// provisioning-core.ts — the ordered provisioning steps and progress mapping. Pure; no I/O. The provider step is where
// a NotConnected provider fails honestly, so the step list makes the failure point explicit.
export const PROVISIONING_STEPS = [
  'load_business_info',
  'load_calendar_setup',
  'generate_knowledge',
  'create_voice_agent',   // <- provider call (Retell). Fails here when not connected.
  'register_webhook',
  'validate_runtime',
  'finalize',
] as const;
export type ProvisioningStep = (typeof PROVISIONING_STEPS)[number];

export const STEP_LABELS: Record<ProvisioningStep, string> = {
  load_business_info: 'Loading business information',
  load_calendar_setup: 'Loading calendar setup',
  generate_knowledge: 'Generating agent knowledge',
  create_voice_agent: 'Creating voice agent',
  register_webhook: 'Connecting call webhook',
  validate_runtime: 'Validating runtime',
  finalize: 'Finalizing',
};

/** Progress (0..100) for a step index (1-based count of completed steps). */
export function progressFor(completedSteps: number): number {
  return Math.min(100, Math.round((completedSteps / PROVISIONING_STEPS.length) * 100));
}
