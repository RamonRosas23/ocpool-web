export type ApiErrorPayload = {
  error?: {
    message?: string;
    requestId?: string;
  };
};

export function getApiErrorMessage(data: ApiErrorPayload, fallback: string): string {
  const message = data.error?.message ?? fallback;
  const requestId = data.error?.requestId?.trim();
  return requestId ? `${message} Referencia: ${requestId}` : message;
}
