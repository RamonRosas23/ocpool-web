import { describe, expect, it } from 'vitest';
import { permissionKeysForRoles } from '@/server/auth/permissions';
import type { Actor } from '@/server/auth/types';
import {
  calculateNotificationRetryDelaySeconds,
  canTransitionNotificationDelivery,
  normalizeNotificationEmail,
  notificationRecipientHash,
} from '@/server/modules/notifications/domain';
import { decryptNotificationRecipient, encryptNotificationRecipient } from '@/server/modules/notifications/recipient-crypto';

const encryptionKey = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';

describe('notification delivery contracts', () => {
  it('normalizes and hashes recipients without exposing the address in the fingerprint', () => {
    const normalized = normalizeNotificationEmail('  Ana.LOPEZ@Example.TEST ');

    expect(normalized).toBe('ana.lopez@example.test');
    expect(notificationRecipientHash(normalized)).toMatch(/^[a-f0-9]{64}$/u);
    expect(notificationRecipientHash(normalized)).toBe(notificationRecipientHash('ana.lopez@example.test'));
    expect(() => normalizeNotificationEmail('not-an-email')).toThrow();
    expect(() => normalizeNotificationEmail('ana\n@example.test')).toThrow();
  });

  it('protects the recipient address with authenticated encryption and random IVs', () => {
    const first = encryptNotificationRecipient('ana@example.test', encryptionKey);
    const second = encryptNotificationRecipient('ana@example.test', encryptionKey);

    expect(first).not.toBe(second);
    expect(first).not.toContain('ana@example.test');
    expect(decryptNotificationRecipient(first, encryptionKey)).toBe('ana@example.test');
    expect(() => decryptNotificationRecipient(`${first}x`, encryptionKey)).toThrow();
  });

  it('allows only safe delivery transitions and bounds retry delays', () => {
    expect(canTransitionNotificationDelivery('PENDING', 'PROCESSING')).toBe(true);
    expect(canTransitionNotificationDelivery('PROCESSING', 'SENT')).toBe(true);
    expect(canTransitionNotificationDelivery('PROCESSING', 'PENDING')).toBe(true);
    expect(canTransitionNotificationDelivery('SENT', 'PENDING')).toBe(false);
    expect(canTransitionNotificationDelivery('CANCELLED', 'PENDING')).toBe(false);
    expect(calculateNotificationRetryDelaySeconds(1)).toBe(30);
    expect(calculateNotificationRetryDelaySeconds(5)).toBe(480);
    expect(calculateNotificationRetryDelaySeconds(99)).toBe(3600);
    expect(() => calculateNotificationRetryDelaySeconds(0)).toThrow();
  });

  it('keeps notification permissions separate from customer access', () => {
    const sales: Actor = { userId: '00000000-0000-4000-8000-000000000001', type: 'EMPLOYEE', clientId: null, permissionKeys: permissionKeysForRoles(['sales']), mfaVerified: true };
    const customer: Actor = { userId: '00000000-0000-4000-8000-000000000002', type: 'CUSTOMER', clientId: '00000000-0000-4000-8000-000000000003', permissionKeys: permissionKeysForRoles(['customer']), mfaVerified: false };

    expect(sales.permissionKeys.has('notifications.read')).toBe(true);
    expect(sales.permissionKeys.has('notifications.manage')).toBe(false);
    expect(customer.permissionKeys.has('notifications.read')).toBe(false);
  });
});
