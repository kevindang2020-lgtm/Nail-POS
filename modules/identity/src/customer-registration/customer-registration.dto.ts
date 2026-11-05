export interface RegisterRequest { /** the chosen salon location (branch id from the salon list / nearby search) */ salonId?: string; salonCode?: string; firstName: string; lastName: string; email: string; phone?: string; password: string; referralCode?: string }
export interface RegisterResult {
  ok: boolean; message?: string;
  /** Internal: set on success so the service can link the GLOBAL customer identity after the tx commits.
   *  Never surfaced by the controller response. */
  tenantId?: string; customerId?: string;
}
export interface RegisterInput { salonId?: string; salonCode?: string; firstName: string; lastName: string; email: string; phone: string; password: string; referralCode?: string }
