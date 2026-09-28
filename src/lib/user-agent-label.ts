export type DeviceKind = 'phone' | 'tablet' | 'computer' | 'unknown';
export type DeviceDescription = Readonly<{ label: string; kind: DeviceKind }>;

// El orden importa: Edge, Opera y Samsung Internet también dicen "Chrome" y "Safari", y Chrome dice "Safari".
const BROWSERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bEdg(?:e|A|iOS)?\//u, 'Edge'],
  [/\bOPR\/|\bOpera\b/u, 'Opera'],
  [/\bSamsungBrowser\//u, 'Samsung Internet'],
  [/\bFirefox\/|\bFxiOS\//u, 'Firefox'],
  [/\bCriOS\/|\bChrome\/|\bChromium\//u, 'Chrome'],
  [/\bSafari\//u, 'Safari'],
];

function operatingSystem(userAgent: string): { name: string; kind: DeviceKind } | null {
  if (/\biPhone\b/u.test(userAgent)) return { name: 'iPhone', kind: 'phone' };
  if (/\biPad\b/u.test(userAgent)) return { name: 'iPad', kind: 'tablet' };
  if (/\bAndroid\b/u.test(userAgent)) return /\bMobile\b/u.test(userAgent) ? { name: 'Android', kind: 'phone' } : { name: 'tableta Android', kind: 'tablet' };
  if (/\bWindows\b/u.test(userAgent)) return { name: 'Windows', kind: 'computer' };
  if (/\bCrOS\b/u.test(userAgent)) return { name: 'ChromeOS', kind: 'computer' };
  if (/\bMacintosh\b|\bMac OS X\b/u.test(userAgent)) return { name: 'Mac', kind: 'computer' };
  if (/\bLinux\b/u.test(userAgent)) return { name: 'Linux', kind: 'computer' };
  return null;
}

/**
 * Nombre legible del equipo desde el user agent ("Chrome en Windows", "Safari en iPhone"), para que una
 * persona reconozca sus propias sesiones. No es una huella: sólo lo suficiente para decir "ése soy yo".
 */
export function describeUserAgent(userAgent: string | null | undefined): DeviceDescription {
  const value = userAgent?.trim() ?? '';
  if (!value) return { label: 'Equipo sin identificar', kind: 'unknown' };
  const browser = BROWSERS.find(([pattern]) => pattern.test(value))?.[1] ?? null;
  const system = operatingSystem(value);
  if (browser && system) return { label: `${browser} en ${system.name}`, kind: system.kind };
  if (system) return { label: `Navegador en ${system.name}`, kind: system.kind };
  if (browser) return { label: browser, kind: 'unknown' };
  return { label: 'Equipo sin identificar', kind: 'unknown' };
}
