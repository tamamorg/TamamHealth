/**
 * Field-level encryption at rest (AES-256-GCM) for select server-written PHI.
 *
 * SCOPE — read before relying on this. The key (PHI_ENCRYPTION_KEY) is a
 * server-only env var, so `isEncryptionEnabled()` is ALWAYS false in the
 * browser. This platform is offline-first: patient registration and most
 * clinical writes happen in the browser against PouchDB, so this layer is a
 * no-op on the primary write path, and patient demographics (name, national
 * ID, DOB, phone) are not covered by it at all. It therefore is NOT the
 * platform's at-rest control — full-disk/volume encryption is
 * (PHI_AT_REST_STRATEGY=disk-encryption; see docs/GO-LIVE-STEP-BY-STEP.md).
 *
 * This layer is only meaningful in a SERVER-ONLY deployment, as defence in
 * depth for the fields wired through it. Do NOT enable it alongside browser
 * write paths: a browser reading a server-encrypted value has no key and the
 * read throws (EncryptionKeyError).
 *
 * Key management:
 *   - The 32-byte key is supplied as base64 via PHI_ENCRYPTION_KEY and gated by
 *     PHI_ENCRYPTION_ENABLED=true (validated at boot in lib/config-validation.ts).
 *   - Keep the key in your secrets manager (Doppler / AWS Secrets Manager), NOT
 *     in the database or the repo.
 *
 * Format: `enc:v1:<iv-b64>:<authTag-b64>:<ciphertext-b64>`. The `enc:v1:` prefix
 * makes ciphertext self-describing so decrypt() is idempotent and migrations can
 * detect already-encrypted values.
 */
import { createCipheriv, createDecipheriv, randomBytes, type CipherGCMTypes } from 'crypto';

const PREFIX = 'enc:v1:';
const ALGO: CipherGCMTypes = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit nonce, the GCM standard

// @types/node 20.x narrows several crypto params to `Uint8Array<ArrayBufferLike>`
// while Buffer is `Buffer<ArrayBufferLike>`; the two are runtime-identical but
// the compiler treats them as distinct. This alias keeps the casts readable.
type U8 = Uint8Array;

export class EncryptionKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncryptionKeyError';
  }
}

/** Whether field-level encryption is switched on for this deployment. */
export function isEncryptionEnabled(): boolean {
  return process.env.PHI_ENCRYPTION_ENABLED === 'true';
}

function loadKey(): Buffer {
  const b64 = process.env.PHI_ENCRYPTION_KEY || '';
  if (!b64) throw new EncryptionKeyError('PHI_ENCRYPTION_KEY is not set.');
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) throw new EncryptionKeyError('PHI_ENCRYPTION_KEY must decode to 32 bytes (AES-256).');
  return key;
}

/** True if a value is already in our ciphertext envelope. */
export function isEncrypted(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/**
 * Encrypt a plaintext string. Idempotent: an already-encrypted value is
 * returned unchanged so callers/migrations can run repeatedly without
 * double-encrypting. With a key provided explicitly (tests) it ignores env.
 */
export function encryptField(plaintext: string, key: Buffer = loadKey()): string {
  if (isEncrypted(plaintext)) return plaintext;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key as U8, iv as U8);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8') as U8, cipher.final() as U8]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

/**
 * Decrypt a value produced by {@link encryptField}. A value that is not in the
 * ciphertext envelope is returned unchanged (so reads tolerate not-yet-migrated
 * plaintext). Throws on a tampered/auth-failed ciphertext (GCM integrity).
 */
export function decryptField(value: string, key: Buffer = loadKey()): string {
  if (!isEncrypted(value)) return value;
  const [, , ivB64, tagB64, ctB64] = value.split(':');
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('Malformed ciphertext envelope.');
  const decipher = createDecipheriv(ALGO, key as U8, Buffer.from(ivB64, 'base64') as U8);
  decipher.setAuthTag(Buffer.from(tagB64, 'base64') as U8);
  const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64') as U8) as U8, decipher.final() as U8]);
  return pt.toString('utf8');
}

/** Encrypt only when enabled; otherwise return plaintext (no-op deployments). */
export function maybeEncrypt(plaintext: string): string {
  return isEncryptionEnabled() ? encryptField(plaintext) : plaintext;
}

/** Decrypt only when the value looks encrypted; safe to call always. */
export function maybeDecrypt(value: string): string {
  return isEncrypted(value) ? decryptField(value) : value;
}
