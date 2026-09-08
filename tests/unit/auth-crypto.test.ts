import { describe, expect, it } from 'vitest';
import {
  compareToken,
  decryptSecret,
  encryptSecret,
  fingerprintToken,
  generateOpaqueToken,
  hashPassword,
  verifyPassword,
} from '@/server/auth/crypto';

const encryptionKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

describe('authentication cryptography', () => {
  it('hashes employee passwords with Argon2id and verifies them', async () => {
    const password = 'Correct Horse Battery Staple!123';
    const passwordHash = await hashPassword(password);

    expect(passwordHash).toMatch(/^\$argon2id\$/);
    expect(passwordHash).not.toContain(password);
    await expect(verifyPassword(passwordHash, password)).resolves.toBe(true);
    await expect(verifyPassword(passwordHash, 'incorrect-password')).resolves.toBe(false);
  });

  it('generates opaque tokens and compares only their fingerprints', () => {
    const token = generateOpaqueToken();
    const fingerprint = fingerprintToken(token);

    expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(compareToken(token, fingerprint)).toBe(true);
    expect(compareToken(`${token}x`, fingerprint)).toBe(false);
    expect(fingerprintToken(token)).toBe(fingerprint);
  });

  it('encrypts MFA secrets with authenticated encryption and random IVs', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const firstCiphertext = encryptSecret(secret, encryptionKey);
    const secondCiphertext = encryptSecret(secret, encryptionKey);

    expect(firstCiphertext).not.toBe(secondCiphertext);
    expect(decryptSecret(firstCiphertext, encryptionKey)).toBe(secret);
    expect(decryptSecret(secondCiphertext, encryptionKey)).toBe(secret);

    const [version, iv, authTag, data] = firstCiphertext.split('.');
    const tamperedTag = `${authTag[0] === 'A' ? 'B' : 'A'}${authTag.slice(1)}`;
    const tampered = [version, iv, tamperedTag, data].join('.');
    expect(() => decryptSecret(tampered, encryptionKey)).toThrow();
  });
});
