export type ApiErrorPayload = {
  error?: {
    message?: string;
    requestId?: string;
  };
};

export function getApiErrorMessage(data: ApiErrorPayload, fallback: string): string {
  const message = data.error?.message ?? fallback;
  const requestId = data.error?.requestId?.trim();
  // UX audit fix: this helper is shared by staff AND customer-facing surfaces (e.g.
  // ClientFilesPanel.tsx). A bare "Referencia: {uuid}" reads as unexplained internal noise to a
  // non-technical customer; spelling out what the reference is for costs nothing for staff either.
  return requestId ? `${message} Si necesitas ayuda, menciona esta referencia: ${requestId}` : message;
}
