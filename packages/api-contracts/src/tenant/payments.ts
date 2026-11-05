// payments.ts — wire contract (Constitution 13 §13, §15). Realm: tenant.

export type GatewayStatus = 'not_configured' | 'pending' | 'active' | 'error' | 'disabled' | 'paused';
export interface MaskedPaymentGateway {
  processorType: string;
  environment: 'sandbox' | 'production';
  merchantIdMasked: string;
  status: GatewayStatus;
  setupRequired: boolean;
  onboardingStatus: string;              // merchant-application / underwriting status (not a secret)
  /** CardPointe Integrated Terminal (Bolt, P2PE): whether the base URL + Authorization key are stored, and the base
   *  (not a secret). The key itself never leaves the backend. */
  terminalConfigured?: boolean;
  terminalBaseUrl?: string | null;
  /** Tap to Pay (migration 704): the salon-default CommerceHub merchant id for Tap to Pay, masked; never a credential. */
  tapToPayMerchantIdMasked?: string;
  tapToPayConfigured?: boolean;
}
