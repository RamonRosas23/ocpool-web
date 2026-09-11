import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { encryptSecret, fingerprintToken, hashPassword } from '../src/server/auth/crypto.js';
import { PERMISSION_CATALOG } from '../src/server/auth/constants.js';
import { createMfaEnrollment, verifyTotpCode } from '../src/server/auth/mfa.js';
import { readServerEnv } from '../src/server/env.js';

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function assertTty(): void {
  if (!input.isTTY || !output.isTTY) {
    throw new Error('El alta administrativa requiere una terminal interactiva.');
  }
}

async function readHidden(prompt: string): Promise<string> {
  assertTty();
  output.write(prompt);
  input.setRawMode?.(true);
  input.resume();

  return new Promise((resolve, reject) => {
    let value = '';
    const onData = (chunk: Buffer | string) => {
      const text = chunk.toString();
      for (const character of text) {
        if (character === '\u0003') {
          cleanup();
          reject(new Error('Operación cancelada.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          cleanup();
          output.write('\n');
          resolve(value);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        value += character;
      }
    };
    const cleanup = () => {
      input.off('data', onData);
      input.setRawMode?.(false);
      input.pause();
    };
    input.on('data', onData);
  });
}

async function readTotpCode(): Promise<string> {
  const reader = createInterface({ input, output });
  try {
    return (await reader.question('Código TOTP de seis dígitos: ')).trim();
  } finally {
    reader.close();
  }
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEV_ADMIN_BOOTSTRAP !== '1') {
    throw new Error('El alta administrativa solo se permite con NODE_ENV=production.');
  }

  const env = readServerEnv();
  assertTty();
  let prisma: PrismaClient | undefined;

  try {
    const ask = async (prompt: string): Promise<string> => {
      const reader = createInterface({ input, output });
      try {
        return await reader.question(prompt);
      } finally {
        reader.close();
      }
    };

    const email = normalizeEmail(await ask('Correo del administrador: '));
    const displayName = (await ask('Nombre completo: ')).trim();
    if (!email || !displayName) throw new Error('Correo y nombre son obligatorios.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) throw new Error('El correo no es válido.');
    if (displayName.length > 180) throw new Error('El nombre excede 180 caracteres.');

    const password = await readHidden('Contraseña nueva (mínimo 12 caracteres): ');
    const confirmation = await readHidden('Repite la contraseña: ');
    if (password.length < 12) throw new Error('La contraseña administrativa debe tener al menos 12 caracteres.');
    if (password !== confirmation) throw new Error('Las contraseñas no coinciden.');

    const enrollment = createMfaEnrollment({ accountLabel: email });
    output.write('\nConfigura esta cuenta en tu aplicación autenticadora antes de continuar.\n');
    output.write(`URI TOTP (úsala para generar el QR): ${enrollment.uri}\n`);
    output.write(`Clave TOTP de respaldo: ${enrollment.secret}\n\n`);

    let mfaCounter: number | null = null;
    for (let attempt = 1; attempt <= 3 && mfaCounter === null; attempt += 1) {
      const code = await readTotpCode();
      mfaCounter = verifyTotpCode(enrollment.secret, code);
      if (mfaCounter === null && attempt < 3) output.write('Código inválido o vencido; inténtalo de nuevo.\n');
    }
    if (mfaCounter === null) throw new Error('No se pudo verificar el MFA; no se creó ninguna cuenta.');

    const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
    prisma = new PrismaClient({ adapter });
    const passwordHash = await hashPassword(password);
    const mfaSecretCiphertext = encryptSecret(enrollment.secret, env.MFA_ENCRYPTION_KEY);

    const created = await prisma.$transaction(async (transaction) => {
      const existing = await transaction.user.findUnique({ where: { emailNormalized: email }, select: { id: true } });
      if (existing) throw new Error('Ya existe un usuario con ese correo; no se modificó.');

      const role = await transaction.role.findUnique({
        where: { key: 'admin' },
        include: { permissions: { include: { permission: { select: { key: true } } } } },
      });
      if (!role) throw new Error('No existe el rol admin; no se creó ninguna cuenta. Detente y revisa la configuración de identidad.');
      const permissionKeys = new Set(role.permissions.map(({ permission }) => permission.key));
      if (permissionKeys.size !== PERMISSION_CATALOG.length || PERMISSION_CATALOG.some(({ key }) => !permissionKeys.has(key))) {
        throw new Error('El rol admin no tiene el catálogo completo de permisos; no se creó ninguna cuenta.');
      }

      const user = await transaction.user.create({
        data: {
          email,
          emailNormalized: email,
          displayName,
          type: 'EMPLOYEE',
          status: 'ACTIVE',
          passwordHash,
          mfaRequired: true,
          mfaSecretCiphertext,
          mfaEnrolledAt: new Date(),
          mfaLastAcceptedCounter: mfaCounter,
          roles: { create: { roleId: role.id } },
        },
        select: { id: true },
      });

      await transaction.authEvent.create({
        data: {
          userId: user.id,
          eventType: 'MFA_ENROLLED',
          outcome: 'SUCCESS',
          identifierHash: fingerprintToken(email),
          userAgent: 'ocpool-admin-bootstrap',
          metadata: { source: 'bootstrap' },
        },
      });
      return user;
    });

    output.write(`\nAdministrador creado correctamente: ${email}\n`);
    output.write('MFA verificado y rol admin asignado. La clave TOTP no se volverá a mostrar.\n');
    output.write(`ID interno: ${created.id}\n`);
  } finally {
    await prisma?.$disconnect();
  }
}

const isEntrypoint = process.argv[1]
  && fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase();

if (isEntrypoint) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'No se pudo completar el alta.';
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  });
}
