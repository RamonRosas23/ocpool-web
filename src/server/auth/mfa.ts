import { Secret, TOTP } from 'otpauth';
import { decryptSecret, encryptSecret } from '@/server/auth/crypto';

const TOTP_PERIOD_SECONDS = 30;
const TOTP_WINDOW = 1;

export type MfaEnrollment = {
  secret: string;
  uri: string;
};

export function createMfaEnrollment(input: { accountLabel: string; issuer?: string }): MfaEnrollment {
  const secret = new Secret({ size: 20 });
  const totp = new TOTP({
    issuer: input.issuer ?? 'OCPOOL',
    label: input.accountLabel,
    secret,
    algorithm: 'SHA1',
    digits: 6,
    period: TOTP_PERIOD_SECONDS,
  });

  return { secret: secret.base32, uri: totp.toString() };
}

function createTotp(secret: string): TOTP {
  return new TOTP({
    secret: Secret.fromBase32(secret),
    algorithm: 'SHA1',
    digits: 6,
    period: TOTP_PERIOD_SECONDS,
  });
}

export function generateTotpCode(secret: string, timestamp = Date.now()): string {
  return createTotp(secret).generate({ timestamp });
}

export function verifyTotpCode(
  secret: string,
  code: string,
  timestamp = Date.now(),
  lastAcceptedCounter?: number | null,
): number | null {
  if (!/^\d{6}$/.test(code)) return null;

  try {
    const totp = createTotp(secret);
    const delta = totp.validate({ token: code, timestamp, window: TOTP_WINDOW });
    if (delta === null) return null;

    const currentCounter = TOTP.counter({ period: TOTP_PERIOD_SECONDS, timestamp });
    const matchedCounter = currentCounter + delta;
    if (lastAcceptedCounter !== undefined && lastAcceptedCounter !== null && matchedCounter <= lastAcceptedCounter) {
      return null;
    }

    return matchedCounter;
  } catch {
    return null;
  }
}

export function protectMfaSecret(secret: string, encryptionKey: string): string {
  return encryptSecret(secret, encryptionKey);
}

export function unprotectMfaSecret(ciphertext: string, encryptionKey: string): string {
  return decryptSecret(ciphertext, encryptionKey);
}
