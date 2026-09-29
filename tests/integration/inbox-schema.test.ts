import { describe, expect, it } from 'vitest';
import { getPrisma } from '@/server/db/client';

describe('inbox notifications schema', () => {
  it('keeps one open notification per recipient and group, validates its shape and cascades with its recipient', async () => {
    if (process.env.RUN_DB_TESTS !== '1') throw new Error('Run this suite with npm run test:integration after starting Docker and applying migrations.');

    const prisma = getPrisma();
    const suffix = Date.now().toString();
    const user = await prisma.user.create({ data: { email: `inbox-schema-${suffix}@example.test`, emailNormalized: `inbox-schema-${suffix}@example.test`, displayName: 'Inbox schema', type: 'EMPLOYEE', status: 'ACTIVE' } });
    const base = { recipientId: user.id, kind: 'customer.activity', priority: 'HIGH' as const, groupKey: `activity:schema-${suffix}`, title: 'Aviso de prueba', actionPath: '/staff/requests' };

    try {
      const first = await prisma.inboxNotification.create({ data: base });
      // Un solo aviso abierto por persona y grupo.
      await expect(prisma.inboxNotification.create({ data: base })).rejects.toThrow();
      // Leído ya no cuenta como abierto: la siguiente actividad abre otro.
      await prisma.inboxNotification.update({ where: { id: first.id }, data: { readAt: new Date() } });
      const second = await prisma.inboxNotification.create({ data: base });
      expect(second.id).not.toBe(first.id);
      // Resuelto tampoco cuenta como abierto.
      await prisma.inboxNotification.update({ where: { id: second.id }, data: { resolvedAt: new Date(), resolvedNote: 'Tomada por QA' } });
      await expect(prisma.inboxNotification.create({ data: base })).resolves.toMatchObject({ occurrences: 1, actionRequired: false });
      // Enlaces sólo internos, tipos con formato de catálogo, nota de resolución sólo si está resuelto.
      await expect(prisma.inboxNotification.create({ data: { ...base, groupKey: null, actionPath: 'https://evil.example' } })).rejects.toThrow();
      await expect(prisma.inboxNotification.create({ data: { ...base, groupKey: null, actionPath: '//evil.example' } })).rejects.toThrow();
      await expect(prisma.inboxNotification.create({ data: { ...base, groupKey: null, kind: 'No Es Un Tipo' } })).rejects.toThrow();
      await expect(prisma.inboxNotification.create({ data: { ...base, groupKey: null, resolvedNote: 'Sin fecha' } })).rejects.toThrow();
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
    expect(await prisma.inboxNotification.count({ where: { recipientId: user.id } })).toBe(0);
  });
});
