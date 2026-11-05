// Constitution 12 §270 — the Encryption & Backup Health panel renders real state, and warns in the right places.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EncryptionHealthPanel } from './SecurityScreen';

const base = { available: true as const, rotationOverdue: [], posture: [], events24h: { total: 3, bySeverity: { HIGH: 2, LOW: 1 }, topTypes: [] },
  keys: [{ purpose: 'mfa', env: 'MFA_ENC_KEY', state: 'configured' as const }, { purpose: 'payments', env: 'PAYMENT_ENC_KEY', state: 'configured' as const }, { purpose: 'field', env: 'APP_DATA_ENCRYPTION_KEY', state: 'optional_unset' as const }] };

describe('EncryptionHealthPanel', () => {
  it('counts configured keys, excluding the optional one', () => {
    render(<EncryptionHealthPanel h={base} />);
    expect(screen.getByTestId('encryption-health').textContent).toMatch(/2 of 2 encryption keys configured/);
    expect(screen.queryByTestId('key-fallback')).toBeNull();
  });
  it('names every key running on a fallback — loudly', () => {
    render(<EncryptionHealthPanel h={{ ...base, keys: [...base.keys, { purpose: 'provider', env: 'PROVIDER_VAULT_KEK', state: 'fallback' }] }} />);
    expect(screen.getByTestId('key-fallback').textContent).toMatch(/PROVIDER_VAULT_KEK/);
  });
  it('shows overdue rotation and boot posture warnings', () => {
    render(<EncryptionHealthPanel h={{ ...base, rotationOverdue: ['AUTH_SESSION_SECRET'], posture: [{ variable: 'MEDIA_STORE', problem: 'photos lost on deploy' }] }} />);
    expect(screen.getByTestId('rotation-overdue').textContent).toMatch(/AUTH_SESSION_SECRET/);
    expect(screen.getByTestId('posture-warning').textContent).toMatch(/MEDIA_STORE.*photos lost on deploy/);
  });
  it('shows 24 h security-event counts by severity', () => {
    render(<EncryptionHealthPanel h={base} />);
    expect(screen.getByTestId('encryption-health').textContent).toMatch(/Security events \(24 h\): 3.*high 2.*low 1/);
  });
});
