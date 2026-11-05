// provider-ports.ts — the MANAGEMENT/PROVISIONING seam (create agent, buy/assign number). Distinct from the runtime
// port in voice-provider.port.ts (VoiceProviderPort: webhook verification + tool-call handling during a live call).
// These ports cover provisioning operations the pre-existing runtime port does not. Named *ProvisioningPort to avoid
// colliding with the runtime VoiceProviderPort.
// (Original note) The seam between the AI Receptionist and its external providers (Retell for the voice agent,
// Twilio for telephony). Two things live here:
//   1. The port interfaces a live adapter must implement (createAgent, purchaseNumber, ...). These define the exact
//      operations the provisioning flow, phone setup, and test console will call.
//   2. Honest NotConnected defaults. No live adapter ships in this build (the Retell/Twilio accounts don't exist
//      yet), so the default providers report their true status derived from real credential presence and throw a
//      clear ProviderNotConnectedError on any action. Nothing is faked: there is no simulated "connected" or
//      simulated provisioning progress. When the accounts and a live adapter exist, resolve*Provider() returns the
//      real adapter and the same call sites work unchanged.

import type { ProviderState } from '@aipowersalon/api-contracts/tenant';
export type { ProviderState };   // owned by packages/api-contracts (Constitution 13 §13)
import { TwilioTelephonyProvider } from './twilio-telephony.provider';
import { RetellVoiceProvider } from './retell-voice.provider';

export interface ProviderStatus { state: ProviderState; provider: string; detail: string }

export class ProviderNotConnectedError extends Error {
  constructor(public readonly provider: string, public readonly reason: string) {
    super(`${provider} is not connected: ${reason}`);
    this.name = 'ProviderNotConnectedError';
  }
}

// ---- Voice provider (Retell) ----
export interface CreateVoiceAgentInput { name: string; language: string; greeting: string; behavior: string; knowledge: string; tools: string[] }
export interface VoiceAgentHandle { providerAgentId: string }
export interface VoiceProvisioningPort {
  status(): ProviderStatus;
  createAgent(input: CreateVoiceAgentInput): Promise<VoiceAgentHandle>;
  updateAgent(providerAgentId: string, input: Partial<CreateVoiceAgentInput>): Promise<VoiceAgentHandle>;
  deleteAgent(providerAgentId: string): Promise<void>;
  registerWebhook(providerAgentId: string, url: string): Promise<void>;
}

// ---- Telephony provider (Twilio) ----
export interface AvailableNumber { phoneNumber: string; locality: string | null; capabilities: { voice: boolean; sms: boolean } }
export interface PurchasedNumber { phoneNumber: string; providerNumberId: string }
export interface TelephonyProvisioningPort {
  status(): ProviderStatus;
  searchNumbers(opts: { areaCode?: string; tollFree?: boolean }): Promise<AvailableNumber[]>;
  purchaseNumber(phoneNumber: string): Promise<PurchasedNumber>;
  assignNumber(providerNumberId: string, providerAgentId: string): Promise<void>;
  releaseNumber(providerNumberId: string): Promise<void>;
}

// ---- Honest NotConnected defaults ----
class NotConnectedVoiceProvider implements VoiceProvisioningPort {
  constructor(private readonly reason: string) {}
  status(): ProviderStatus { return { state: 'not_connected', provider: 'retell', detail: this.reason }; }
  private nope(): never { throw new ProviderNotConnectedError('retell', this.reason); }
  async createAgent(): Promise<VoiceAgentHandle> { this.nope(); }
  async updateAgent(): Promise<VoiceAgentHandle> { this.nope(); }
  async deleteAgent(): Promise<void> { this.nope(); }
  async registerWebhook(): Promise<void> { this.nope(); }
}

class NotConnectedTelephonyProvider implements TelephonyProvisioningPort {
  constructor(private readonly reason: string) {}
  status(): ProviderStatus { return { state: 'not_connected', provider: 'twilio', detail: this.reason }; }
  private nope(): never { throw new ProviderNotConnectedError('twilio', this.reason); }
  async searchNumbers(): Promise<AvailableNumber[]> { this.nope(); }
  async purchaseNumber(): Promise<PurchasedNumber> { this.nope(); }
  async assignNumber(): Promise<void> { this.nope(); }
  async releaseNumber(): Promise<void> { this.nope(); }
}

/**
 * Resolve the voice provider from the environment. Today this always returns the NotConnected default (no live Retell
 * adapter ships in this build), but the reason it reports is derived from real credential presence, so the UI shows an
 * accurate, specific state. When a live adapter is introduced, it is constructed here when credentials are present.
 */
export function resolveVoiceProvider(env: NodeJS.ProcessEnv = process.env): VoiceProvisioningPort {
  const key = env.RETELL_API_KEY && String(env.RETELL_API_KEY).trim();
  if (key) {
    return new RetellVoiceProvider({ apiKey: key, defaultVoiceId: env.RETELL_DEFAULT_VOICE_ID, webhookUrl: env.AI_RECEPTIONIST_VOICE_WEBHOOK_URL ?? null });
  }
  return new NotConnectedVoiceProvider('RETELL_API_KEY is not configured.');
}

export function resolveTelephonyProvider(env: NodeJS.ProcessEnv = process.env): TelephonyProvisioningPort {
  const sid = env.TWILIO_ACCOUNT_SID && String(env.TWILIO_ACCOUNT_SID).trim();
  const token = env.TWILIO_AUTH_TOKEN && String(env.TWILIO_AUTH_TOKEN).trim();
  if (sid && token) {
    return new TwilioTelephonyProvider({ accountSid: sid, authToken: token, voiceWebhookUrl: env.AI_RECEPTIONIST_VOICE_WEBHOOK_URL ?? null });
  }
  return new NotConnectedTelephonyProvider('TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are not configured.');
}
