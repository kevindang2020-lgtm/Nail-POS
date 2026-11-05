// platform-devices.ts — S-A13 (Security Deep Scan §29 / §136): the wire types of the trusted-device requirement for platform
// sign-in — POST /public/security/approve-device (the emailed one-time link) and POST /auth/devices/{id}/approve-platform
// (approve from an already-approved device, step-up). A refused sign-in answers 403 with PlatformDeviceRefusal.

export interface PlatformDeviceApprovalResult { ok: true; message?: string }
export interface PlatformDeviceRefusal {
  ok: false; outcome: 'DEVICE_APPROVAL_REQUIRED' | 'DEVICE_CHECK_UNAVAILABLE'; code: 'DEVICE_APPROVAL_REQUIRED' | 'SERVICE_UNAVAILABLE';
  /** true when the one-time approval link was emailed to the account holder */
  emailed?: boolean; message: string;
}
