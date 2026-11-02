// Thin adapter over @aipowersalon/security (Constitution 13 §81): keys from the API's key ring, cipher from the package.
// Exported names and the wire format at rest are unchanged — no importer and no row changes.
import { seal, openWith } from '@aipowersalon/security';

// Key: APP_DATA_ENCRYPTION_KEY (32 bytes, hex or base64). Honest behavior when unset: encryptField returns null —
// callers store nothing rather than plaintext; decryptField returns null for anything it cannot open.
const FORMAT = { layout: 'prefixed', prefix: 'v1' } as const;
function loadKey(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const raw = (env.APP_DATA_ENCRYPTION_KEY || '').trim();
  if (!raw) return null;
  try {
    const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    return buf.length === 32 ? buf : null;
  } catch { return null; }
}
export function encryptField(plain: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const key = loadKey(env);
  return key ? seal(key, plain, FORMAT) : null;
}
export function decryptField(stored: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const key = loadKey(env);
  if (!key) return null;
  try { return openWith(key, stored, FORMAT); } catch { return null; }
}
