import { decryptSecret, encryptSecret } from '@/server/auth/crypto';

export function encryptNotificationRecipient(normalizedEmail: string, encryptionKey: string): string {
  return encryptSecret(normalizedEmail, encryptionKey);
}

export function decryptNotificationRecipient(ciphertext: string, encryptionKey: string): string {
  return decryptSecret(ciphertext, encryptionKey);
}
