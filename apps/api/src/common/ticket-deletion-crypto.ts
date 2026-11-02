// Thin adapter over @aipowersalon/security (Constitution 13 §81): keys from the API's key ring, cipher from the package.
// Exported names and the wire format at rest are unchanged — no importer and no row changes.
import { seal, open } from '@aipowersalon/security';
import { keyFor, keysFor, KEY_SOURCES } from './key-ring';

const FORMAT = { layout: 'prefixed', prefix: 'v1' } as const;
export function encryptDeletionCode(plain: string): string { return seal(keyFor('ticket_deletion'), plain, FORMAT); }
export function decryptDeletionCode(stored: string): string {
  if (!stored || !stored.startsWith('v1:')) return '';
  return open(keysFor('ticket_deletion'), stored, FORMAT);
}

// Configured = the key ring's own env var for this purpose is set (KEY_SOURCES is the one registry of key names).
export function isTicketDeletionKekConfigured(): boolean { return !!process.env[KEY_SOURCES.ticket_deletion.env]; }
