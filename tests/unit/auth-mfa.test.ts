import { describe, expect, it } from 'vitest';
import {
  createMfaEnrollment,
  generateTotpCode,
  verifyTotpCode,
} from '@/server/auth/mfa';

describe('TOTP MFA policy', () => {
  it('creates an enrollment URI and accepts only a fresh valid code', () => {
    const timestamp = 1_700_000_000_000;
    const enrollment = createMfaEnrollment({
      accountLabel: 'admin@example.test',
      issuer: 'OCPOOL',
    });
    const code = generateTotpCode(enrollment.secret, timestamp);
    const counter = verifyTotpCode(enrollment.secret, code, timestamp);

    expect(enrollment.secret).toMatch(/^[A-Z2-7]+=*$/);
    expect(enrollment.uri).toMatch(/^otpauth:\/\/totp\//);
    expect(code).toMatch(/^\d{6}$/);
    expect(counter).toEqual(expect.any(Number));
    expect(verifyTotpCode(enrollment.secret, '000000', timestamp)).toBeNull();
  });

  it('rejects a code whose time counter was already accepted', () => {
    const timestamp = 1_700_000_000_000;
    const enrollment = createMfaEnrollment({ accountLabel: 'admin@example.test' });
    const code = generateTotpCode(enrollment.secret, timestamp);
    const counter = verifyTotpCode(enrollment.secret, code, timestamp);

    expect(counter).not.toBeNull();
    expect(verifyTotpCode(enrollment.secret, code, timestamp, counter as number)).toBeNull();
  });
});
