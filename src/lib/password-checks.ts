export type PasswordCheck = Readonly<{ key: string; label: string; met: boolean }>;

// Mismas reglas que `passwordSchema` del servidor (12–128 caracteres, al menos una letra y un
// número): se muestran en vivo para que el formulario no falle después de enviarlo.
export function passwordChecks(password: string, confirmation: string): PasswordCheck[] {
  return [
    { key: 'length', label: 'Al menos 12 caracteres', met: password.length >= 12 && password.length <= 128 },
    { key: 'letter', label: 'Incluye una letra', met: /[A-Za-z]/u.test(password) },
    { key: 'digit', label: 'Incluye un número', met: /[0-9]/u.test(password) },
    { key: 'match', label: 'Ambas coinciden', met: password.length > 0 && password === confirmation },
  ];
}

/** Las tres reglas del servidor (sin la confirmación, que sólo vive en el formulario). */
export function meetsPasswordPolicy(password: string): boolean {
  return passwordChecks(password, password).slice(0, 3).every((check) => check.met);
}
