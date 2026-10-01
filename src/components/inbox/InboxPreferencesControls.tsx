'use client';

import { Monitor, MonitorOff, MonitorUp, Volume2, VolumeX } from 'lucide-react';
import { useInbox } from './InboxProvider';

export default function InboxPreferencesControls({ variant = 'account' }: Readonly<{ variant?: 'account' | 'compact' }>) {
  const inbox = useInbox();
  if (!inbox) return null;
  const disabled = !inbox.preferencesReady;
  const isError = inbox.preferenceMessage?.startsWith('No fue posible') ?? false;

  return <div className={`inbox-pref-settings${variant === 'compact' ? ' inbox-pref-settings--compact' : ''}`}>
    <div className="inbox-pref-settings__channels" role="group" aria-label="Avisos en pantalla">
      <button type="button" className="inbox-pref" aria-pressed={inbox.preferences.sound} disabled={disabled} onClick={() => void inbox.setSound(!inbox.preferences.sound)}>
        {inbox.preferences.sound ? <Volume2 size={16} aria-hidden="true" /> : <VolumeX size={16} aria-hidden="true" />}
        Sonido
      </button>
      {inbox.desktop === 'default' && <button type="button" className="inbox-pref" disabled={disabled} onClick={() => void inbox.setDesktop(true)}><MonitorUp size={16} aria-hidden="true" />Activar alertas de escritorio</button>}
      {inbox.desktop === 'granted' && <button type="button" className="inbox-pref" aria-pressed={inbox.preferences.desktop} disabled={disabled} onClick={() => void inbox.setDesktop(!inbox.preferences.desktop)}><Monitor size={16} aria-hidden="true" />Alertas de escritorio</button>}
      {inbox.desktop === 'denied' && <span className="inbox-pref inbox-pref--note"><MonitorOff size={16} aria-hidden="true" />Escritorio bloqueado en el navegador</span>}
    </div>
    <fieldset className="inbox-pref-settings__email" disabled={disabled}>
      <legend>Correo para mensajes y archivos</legend>
      <label><input type="radio" name={`inbox-activity-email-${inbox.surface}`} value="DIGEST" checked={inbox.preferences.activityEmail === 'DIGEST'} onChange={() => void inbox.setActivityEmail('DIGEST')} />Resumen si no lo leo</label>
      <label><input type="radio" name={`inbox-activity-email-${inbox.surface}`} value="OFF" checked={inbox.preferences.activityEmail === 'OFF'} onChange={() => void inbox.setActivityEmail('OFF')} />No enviar</label>
    </fieldset>
    {inbox.preferenceMessage && <p className="inbox-pref-settings__message" role={isError ? 'alert' : 'status'} aria-live={isError ? 'assertive' : 'polite'}>{inbox.preferenceMessage}</p>}
  </div>;
}
