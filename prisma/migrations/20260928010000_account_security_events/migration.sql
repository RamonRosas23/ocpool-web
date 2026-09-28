-- Mi cuenta: eventos de seguridad del propio empleado (cambio de contraseña y verificación en dos
-- pasos desactivada). MFA_ENROLLED ya existía.
ALTER TYPE "AuthEventType" ADD VALUE IF NOT EXISTS 'PASSWORD_CHANGED';
ALTER TYPE "AuthEventType" ADD VALUE IF NOT EXISTS 'MFA_DISABLED';
