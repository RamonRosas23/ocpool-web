import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Algorithm, hash, verify } from '@node-rs/argon2';
import { AUTH_POLICY } from '@/server/auth/constants';

const AES_ALGORITHM = 'aes-256-gcm';

export async function hashPassword(password: string): Promise<string> {
  if (password.length === 0) throw new Error('Password cannot be empty.');

  return hash(password, {
    algorithm: Algorithm.Argon2id,
    memoryCost: AUTH_POLICY.password.memoryCostKiB,
    timeCost: AUTH_POLICY.password.timeCost,
    parallelism: AUTH_POLICY.password.parallelism,
    outputLen: AUTH_POLICY.password.outputLength,
  });
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  if (!passwordHash || !password) return false;

  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

export function generateOpaqueToken(): string {
  return randomBytes(AUTH_POLICY.opaqueTokenBytes).toString('base64url');
}

export function fingerprintToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

export function compareToken(rawToken: string, storedFingerprint: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(storedFingerprint)) return false;

  const actual = Buffer.from(fingerprintToken(rawToken), 'hex');
  const expected = Buffer.from(storedFingerprint, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function decodeEncryptionKey(encodedKey: string): Buffer {
  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encodedKey) {
    throw new Error('Invalid AES-256-GCM encryption key.');
  }
  return key;
}

export function encryptSecret(plaintext: string, encodedKey: string): string {
  const key = decodeEncryptionKey(encodedKey);
  const iv = randomBytes(AUTH_POLICY.encryption.ivBytes);
  const cipher = createCipheriv(AES_ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    'v1',
    iv.toString('base64url'),
    authTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptSecret(encodedCiphertext: string, encodedKey: string): string {
  const [version, encodedIv, encodedAuthTag, encodedData] = encodedCiphertext.split('.');
  if (version !== 'v1' || !encodedIv || !encodedAuthTag || !encodedData) {
    throw new Error('Invalid encrypted secret.');
  }

  const key = decodeEncryptionKey(encodedKey);
  const iv = Buffer.from(encodedIv, 'base64url');
  const authTag = Buffer.from(encodedAuthTag, 'base64url');
  const ciphertext = Buffer.from(encodedData, 'base64url');
  if (iv.length !== AUTH_POLICY.encryption.ivBytes || authTag.length !== 16) {
    throw new Error('Invalid encrypted secret.');
  }

  const decipher = createDecipheriv(AES_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
