import { getApiErrorMessage, type ApiErrorPayload } from '@/lib/api-error-message';

export type ApiResponseErrorKind = 'forbidden' | 'not_found' | 'transient';

export type ApiResponseResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: ApiResponseErrorKind; message: string };

function classifyStatus(status: number): ApiResponseErrorKind {
  if (status === 401 || status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  return 'transient';
}

export type ApiResponseOptions = Readonly<{
  /**
   * Errores que la persona corrige sola (400–499, p. ej. "La contraseña actual no es correcta") sin la
   * referencia de soporte: ahí sólo es ruido. Los fallos del servidor (500+) la conservan siempre.
   */
  plainClientErrors?: boolean;
}>;

export async function readApiResponse<T>(response: Response, fallbackMessage: string, options: ApiResponseOptions = {}): Promise<ApiResponseResult<T>> {
  const data = await response.json().catch(() => ({})) as T & ApiErrorPayload;
  if (response.ok) return { ok: true, data };
  const message = options.plainClientErrors && response.status < 500 ? data.error?.message ?? fallbackMessage : getApiErrorMessage(data, fallbackMessage);
  return { ok: false, kind: classifyStatus(response.status), message };
}

export async function readApiResponseOrThrow<T>(response: Response, fallbackMessage: string, options: ApiResponseOptions = {}): Promise<T> {
  const result = await readApiResponse<T>(response, fallbackMessage, options);
  if (!result.ok) throw new Error(result.message);
  return result.data;
}
