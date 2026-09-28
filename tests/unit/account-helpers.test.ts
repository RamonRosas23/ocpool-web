import { describe, expect, it } from 'vitest';
import { accountActivityLabel } from '@/lib/account-activity';
import { meetsPasswordPolicy, passwordChecks } from '@/lib/password-checks';
import { describeUserAgent } from '@/lib/user-agent-label';

describe('describeUserAgent', () => {
  it('names the browser and the device the way a person recognises them', () => {
    expect(describeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36')).toEqual({ label: 'Chrome en Windows', kind: 'computer' });
    expect(describeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0')).toEqual({ label: 'Edge en Windows', kind: 'computer' });
    expect(describeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toEqual({ label: 'Safari en iPhone', kind: 'phone' });
    expect(describeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1')).toEqual({ label: 'Chrome en iPhone', kind: 'phone' });
    expect(describeUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15')).toEqual({ label: 'Safari en Mac', kind: 'computer' });
    expect(describeUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36')).toEqual({ label: 'Chrome en Android', kind: 'phone' });
    expect(describeUserAgent('Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0 Safari/537.36')).toEqual({ label: 'Samsung Internet en tableta Android', kind: 'tablet' });
    expect(describeUserAgent('Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0')).toEqual({ label: 'Firefox en Linux', kind: 'computer' });
  });

  it('falls back to something honest when the agent is missing or not a browser', () => {
    expect(describeUserAgent(null)).toEqual({ label: 'Equipo sin identificar', kind: 'unknown' });
    expect(describeUserAgent('   ')).toEqual({ label: 'Equipo sin identificar', kind: 'unknown' });
    expect(describeUserAgent('curl/8.4.0')).toEqual({ label: 'Equipo sin identificar', kind: 'unknown' });
    expect(describeUserAgent('Mozilla/5.0 (Windows NT 10.0) SomeEmbeddedClient/1.0')).toEqual({ label: 'Navegador en Windows', kind: 'computer' });
  });
});

describe('accountActivityLabel', () => {
  it('speaks to the person and tells apart what management did', () => {
    expect(accountActivityLabel({ eventType: 'LOGIN_SUCCESS', outcome: 'SUCCESS', origin: null })).toEqual({ label: 'Iniciaste sesión', tone: 'neutral' });
    expect(accountActivityLabel({ eventType: 'LOGIN_FAILURE', outcome: 'FAILURE', origin: null }).tone).toBe('alert');
    expect(accountActivityLabel({ eventType: 'MFA_DISABLED', outcome: 'SUCCESS', origin: 'team' }).label).toBe('Gerencia quitó tu verificación en dos pasos');
    expect(accountActivityLabel({ eventType: 'MFA_DISABLED', outcome: 'SUCCESS', origin: 'account' }).label).toBe('Desactivaste la verificación en dos pasos');
    expect(accountActivityLabel({ eventType: 'SESSION_REVOKED', outcome: 'SUCCESS', origin: 'account_others' }).label).toBe('Cerraste tus sesiones en otros equipos');
    expect(accountActivityLabel({ eventType: 'SESSION_REVOKED', outcome: 'SUCCESS', origin: null }).label).toBe('Cerraste sesión');
    expect(accountActivityLabel({ eventType: 'MFA_ENROLLED', outcome: 'SUCCESS', origin: null }).tone).toBe('good');
  });
});

describe('passwordChecks', () => {
  it('mirrors the server policy and confirms both entries match', () => {
    expect(passwordChecks('corta1', 'corta1').map((check) => check.met)).toEqual([false, true, true, true]);
    expect(passwordChecks('solo-letras-largas', 'solo-letras-largas').map((check) => check.met)).toEqual([true, true, false, true]);
    expect(passwordChecks('Valida-2026-segura', 'Valida-2026-segurA').map((check) => check.met)).toEqual([true, true, true, false]);
    expect(meetsPasswordPolicy('Valida-2026-segura')).toBe(true);
    expect(meetsPasswordPolicy('123456789012')).toBe(false);
  });
});
