import { getApiErrorMessage, type ApiErrorPayload } from '@/lib/api-error-message';

export type RequestWorkspaceErrorKind = 'forbidden' | 'not_found' | 'transient';

export type RequestWorkspaceResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: RequestWorkspaceErrorKind; message: string };

function classifyStatus(status: number): RequestWorkspaceErrorKind {
  if (status === 401 || status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  return 'transient';
}

export async function readRequestWorkspaceResponse<T>(response: Response, fallbackMessage: string): Promise<RequestWorkspaceResult<T>> {
  const data = await response.json().catch(() => ({})) as T & ApiErrorPayload;
  if (response.ok) return { ok: true, data };
  return { ok: false, kind: classifyStatus(response.status), message: getApiErrorMessage(data, fallbackMessage) };
}

export async function readRequestWorkspaceResponseOrThrow<T>(response: Response, fallbackMessage: string): Promise<T> {
  const result = await readRequestWorkspaceResponse<T>(response, fallbackMessage);
  if (!result.ok) throw new Error(result.message);
  return result.data;
}
