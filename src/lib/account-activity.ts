export type AccountActivityEvent = Readonly<{ eventType: string; outcome: string; origin: string | null }>;
export type AccountActivityTone = 'neutral' | 'good' | 'alert';

/**
 * Cómo se lee cada evento de seguridad en "Mi cuenta": en segunda persona y distinguiendo lo que hizo
 * la propia persona de lo que hizo gerencia. Los fallos se marcan para que salten a la vista.
 */
export function accountActivityLabel(event: AccountActivityEvent): { label: string; tone: AccountActivityTone } {
  switch (event.eventType) {
    case 'LOGIN_SUCCESS':
      return { label: 'Iniciaste sesión', tone: 'neutral' };
    case 'LOGIN_FAILURE':
      return { label: 'Intento de entrada con contraseña incorrecta', tone: 'alert' };
    case 'MFA_FAILURE':
      return { label: 'Código de verificación incorrecto al entrar', tone: 'alert' };
    case 'PASSWORD_CHANGED':
      return { label: 'Cambiaste tu contraseña', tone: 'good' };
    case 'PASSWORD_RESET_CONSUMED':
      return { label: 'Creaste tu contraseña con un enlace del correo', tone: 'good' };
    case 'MFA_ENROLLED':
      return { label: 'Activaste la verificación en dos pasos', tone: 'good' };
    case 'MFA_DISABLED':
      return event.origin === 'team'
        ? { label: 'Gerencia quitó tu verificación en dos pasos', tone: 'alert' }
        : { label: 'Desactivaste la verificación en dos pasos', tone: 'alert' };
    case 'SESSION_REVOKED':
      if (event.origin === 'account') return { label: 'Cerraste una sesión en otro equipo', tone: 'neutral' };
      if (event.origin === 'account_others') return { label: 'Cerraste tus sesiones en otros equipos', tone: 'neutral' };
      return { label: 'Cerraste sesión', tone: 'neutral' };
    default:
      return { label: 'Cambio de seguridad en tu cuenta', tone: 'neutral' };
  }
}
