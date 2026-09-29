import { mkdir, writeFile } from 'node:fs/promises';
import { renderNotificationTemplate, type NotificationTemplateData, type NotificationTemplateKey } from '../src/server/modules/notifications/templates';

// Vista previa de todos los correos con datos realistas: output/email-previews/index.html.
// PREVIEW_APP_URL permite apuntar el logo a un servidor local (p. ej. http://127.0.0.1:3000).
const appUrl = process.env.PREVIEW_APP_URL ?? 'https://ocpool.com.mx';
const outputDirectory = 'output/email-previews';
const staffPath = '/staff/requests?request=00000000-0000-4000-8000-000000000001';
const portalPath = '/portal?request=00000000-0000-4000-8000-000000000001';

type PreviewCase = Readonly<{ name: string; templateKey: NotificationTemplateKey; path: string; data?: Partial<NotificationTemplateData> }>;

const cases: PreviewCase[] = [
  { name: 'acceso-cliente', templateKey: 'auth.customer.magic_link', path: '/auth/customer/consume-link?token=muestra', data: { expiresMinutes: 1440 } },
  { name: 'restablecer-contrasena', templateKey: 'auth.employee.password_reset', path: '/auth/recovery?token=muestra', data: { expiresMinutes: 15, recipientName: 'Laura Méndez' } },
  { name: 'invitacion-equipo', templateKey: 'auth.employee.invitation', path: '/auth/recovery?token=muestra&invite=1', data: { expiresMinutes: 4320, senderName: 'Ramón Rosas', roleLabel: 'Ventas', recipientName: 'Laura Méndez' } },
  { name: 'solicitud-recibida', templateKey: 'request.received', path: portalPath },
  { name: 'solicitud-recibida-sin-portal', templateKey: 'request.received', path: '/portal/access', data: { actionLabel: 'Solicitar acceso' } },
  { name: 'solicitud-asignada', templateKey: 'request.assigned', path: staffPath, data: { recipientName: 'Laura Méndez' } },
  { name: 'cotizacion-disponible', templateKey: 'quote.version_sent', path: portalPath },
  { name: 'aprobacion-requerida', templateKey: 'quote.approval_requested', path: staffPath, data: { approvalType: 'DISCOUNT', recipientName: 'Ramón Rosas' } },
  { name: 'aprobacion-autorizada', templateKey: 'quote.approval_resolved', path: staffPath, data: { approvalType: 'SPECIAL_CONCEPT', approvalStatus: 'APPROVED', recipientName: 'Laura Méndez' } },
  { name: 'cotizacion-aceptada-equipo', templateKey: 'quote.accepted', path: staffPath, data: { recipientName: 'Laura Méndez' } },
  { name: 'aceptacion-confirmada', templateKey: 'quote.acceptance_confirmed', path: portalPath },
  { name: 'mensaje-cliente', templateKey: 'message.created', path: portalPath },
  { name: 'mensaje-equipo', templateKey: 'message.created', path: staffPath, data: { senderName: 'Ana López', recipientName: 'Laura Méndez' } },
  { name: 'archivo-disponible', templateKey: 'file.available', path: portalPath },
];

const base: Omit<NotificationTemplateData, 'actionUrl'> = {
  appUrl,
  recipientName: 'Ana López',
  folio: 'OCQ-2026-001156',
  versionNumber: 2,
  totalLabel: '687,880.00 MXN',
  senderName: 'Laura Méndez · OCPOOL',
  preview: 'Buen día, Ana. Adjuntamos el plano actualizado con la profundidad que comentamos. Si te parece bien, avanzamos con la cotización final esta semana.',
  fileName: 'Plano de alberca v3.pdf',
};

await mkdir(outputDirectory, { recursive: true });
const links: string[] = [];
for (const preview of cases) {
  const rendered = renderNotificationTemplate({ templateKey: preview.templateKey, templateVersion: 'v1', data: { ...base, ...preview.data, actionUrl: new URL(preview.path, appUrl).toString() } });
  await writeFile(`${outputDirectory}/${preview.name}.html`, rendered.html);
  await writeFile(`${outputDirectory}/${preview.name}.txt`, `Asunto: ${rendered.subject}\n\n${rendered.text}\n`);
  links.push(`<li><a href="${preview.name}.html">${preview.name}</a> — ${rendered.subject}</li>`);
}
await writeFile(`${outputDirectory}/index.html`, `<!doctype html><meta charset="utf-8"><title>Correos OCPOOL</title><ul>${links.join('')}</ul>`);
console.log(`${cases.length} correos en ${outputDirectory}/`);
