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

export async function readApiResponse<T>(response: Response, fallbackMessage: string): Promise<ApiResponseResult<T>> {
  const data = await response.json().catch(() => ({})) as T & ApiErrorPayload;
  if (response.ok) return { ok: true, data };
  return { ok: false, kind: classifyStatus(response.status), message: getApiErrorMessage(data, fallbackMessage) };
}

export async function readApiResponseOrThrow<T>(response: Response, fallbackMessage: string): Promise<T> {
  const result = await readApiResponse<T>(response, fallbackMessage);
  if (!result.ok) throw new Error(result.message);
  return result.data;
}
