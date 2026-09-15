import {
  QUOTE_REQUEST_STATUSES,
  type QuoteRequestStatus,
} from '@/server/modules/quote-requests/domain';

export const REQUEST_WORKSPACE_VIEWS = ['all', 'mine', 'unassigned'] as const;
export const REQUEST_WORKSPACE_AGES = ['all', '0-1', '2-3', '4-7', '8-14', '15-30', '31+'] as const;
export const REQUEST_WORKSPACE_SORTS = ['newest', 'oldest', 'updated', 'stale'] as const;
export const REQUEST_WORKSPACE_TABS = ['summary', 'quote', 'conversation', 'files', 'activity'] as const;

export type RequestWorkspaceView = (typeof REQUEST_WORKSPACE_VIEWS)[number];
export type RequestWorkspaceAge = (typeof REQUEST_WORKSPACE_AGES)[number];
export type RequestWorkspaceSort = (typeof REQUEST_WORKSPACE_SORTS)[number];
export type RequestWorkspaceTab = (typeof REQUEST_WORKSPACE_TABS)[number];

export const QUOTE_REQUEST_STATUS_LABELS: Record<QuoteRequestStatus, string> = {
  RECIBIDA: 'Recibida',
  EN_REVISION: 'En revisión',
  INFORMACION_REQUERIDA: 'Información requerida',
  EN_ELABORACION: 'En elaboración',
  COTIZACION_DISPONIBLE: 'Cotización disponible',
  EN_NEGOCIACION: 'En negociación',
  PENDIENTE_DE_APROBACION: 'Pendiente de aprobación',
  ACEPTADA: 'Aceptada',
  RECHAZADA: 'Rechazada',
  VENCIDA: 'Vencida',
  CONVERTIDA_EN_PROYECTO: 'Convertida en proyecto',
};

export type RequestWorkspaceQuery = Readonly<{
  view: RequestWorkspaceView;
  query: string;
  stage: QuoteRequestStatus | null;
  assigneeId: string | null;
  age: RequestWorkspaceAge;
  sort: RequestWorkspaceSort;
  page: number;
  tab: RequestWorkspaceTab;
}>;

export type RequestWorkspaceListFilters = Readonly<{
  status?: QuoteRequestStatus;
  assignedToId?: string | null;
  query?: string;
  createdAfter?: Date;
  createdBefore?: Date;
  createdBeforeOrEqual?: Date;
  sort: RequestWorkspaceSort;
  page: number;
  pageSize: number;
}>;

export const DEFAULT_REQUEST_WORKSPACE_QUERY: RequestWorkspaceQuery = Object.freeze({
  view: 'all',
  query: '',
  stage: null,
  assigneeId: null,
  age: 'all',
  sort: 'newest',
  page: 1,
  tab: 'summary',
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DAY_MS = 86_400_000;
const MAX_PAGE = 10_000;
type QueryInput = URLSearchParams | Readonly<Record<string, string | undefined>>;

function readParam(input: QueryInput, key: string): string | undefined {
  return input instanceof URLSearchParams ? input.get(key) ?? undefined : input[key];
}

function isValue<const Values extends readonly string[]>(values: Values, value: string | undefined): value is Values[number] {
  return value !== undefined && (values as readonly string[]).includes(value);
}

function normalizePage(value: string | undefined): number {
  if (!value || !/^\d+$/u.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 && page <= MAX_PAGE ? page : 1;
}

export function normalizeRequestWorkspaceQuery(input: QueryInput = {}): RequestWorkspaceQuery {
  const viewValue = readParam(input, 'view');
  const stageValue = readParam(input, 'stage');
  const assigneeValue = readParam(input, 'assignee');
  const ageValue = readParam(input, 'age');
  const sortValue = readParam(input, 'sort');
  const tabValue = readParam(input, 'tab');
  const query = (readParam(input, 'query') ?? '').trim().slice(0, 100);

  return {
    view: isValue(REQUEST_WORKSPACE_VIEWS, viewValue) ? viewValue : DEFAULT_REQUEST_WORKSPACE_QUERY.view,
    query,
    stage: isValue(QUOTE_REQUEST_STATUSES, stageValue) ? stageValue : null,
    assigneeId: assigneeValue && UUID_PATTERN.test(assigneeValue) ? assigneeValue : null,
    age: isValue(REQUEST_WORKSPACE_AGES, ageValue) ? ageValue : DEFAULT_REQUEST_WORKSPACE_QUERY.age,
    sort: isValue(REQUEST_WORKSPACE_SORTS, sortValue) ? sortValue : DEFAULT_REQUEST_WORKSPACE_QUERY.sort,
    page: normalizePage(readParam(input, 'page')),
    tab: isValue(REQUEST_WORKSPACE_TABS, tabValue) ? tabValue : DEFAULT_REQUEST_WORKSPACE_QUERY.tab,
  };
}

export function serializeRequestWorkspaceQuery(query: RequestWorkspaceQuery): URLSearchParams {
  const normalized = normalizeRequestWorkspaceQuery({
    view: query.view,
    query: query.query,
    stage: query.stage ?? undefined,
    assignee: query.assigneeId ?? undefined,
    age: query.age,
    sort: query.sort,
    page: String(query.page),
    tab: query.tab,
  });
  const params = new URLSearchParams();

  if (normalized.view !== DEFAULT_REQUEST_WORKSPACE_QUERY.view) params.set('view', normalized.view);
  if (normalized.query) params.set('query', normalized.query);
  if (normalized.stage) params.set('stage', normalized.stage);
  if (normalized.assigneeId) params.set('assignee', normalized.assigneeId);
  if (normalized.age !== DEFAULT_REQUEST_WORKSPACE_QUERY.age) params.set('age', normalized.age);
  if (normalized.sort !== DEFAULT_REQUEST_WORKSPACE_QUERY.sort) params.set('sort', normalized.sort);
  if (normalized.page !== DEFAULT_REQUEST_WORKSPACE_QUERY.page) params.set('page', String(normalized.page));
  if (normalized.tab !== DEFAULT_REQUEST_WORKSPACE_QUERY.tab) params.set('tab', normalized.tab);

  return params;
}

function subtractDays(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

export function requestWorkspaceAgeRange(age: RequestWorkspaceAge, now: Date): { createdAfter?: Date; createdBefore?: Date; createdBeforeOrEqual?: Date } {
  if (Number.isNaN(now.getTime())) throw new Error('La fecha de referencia no es válida.');
  switch (age) {
    case '0-1': return { createdAfter: subtractDays(now, 2), createdBefore: now };
    case '2-3': return { createdAfter: subtractDays(now, 4), createdBefore: subtractDays(now, 2) };
    case '4-7': return { createdAfter: subtractDays(now, 8), createdBefore: subtractDays(now, 4) };
    case '8-14': return { createdAfter: subtractDays(now, 15), createdBefore: subtractDays(now, 8) };
    case '15-30': return { createdAfter: subtractDays(now, 31), createdBefore: subtractDays(now, 15) };
    case '31+': return { createdBeforeOrEqual: subtractDays(now, 31) };
    case 'all': return {};
  }
}

export function requestWorkspaceQueryToListFilters(query: RequestWorkspaceQuery, actorUserId: string, now: Date): RequestWorkspaceListFilters {
  if (!UUID_PATTERN.test(actorUserId)) throw new Error('La identidad del operador no es válida.');
  const assignment = query.view === 'mine' ? actorUserId : query.view === 'unassigned' ? null : query.assigneeId ?? undefined;

  return {
    status: query.stage ?? undefined,
    assignedToId: assignment,
    query: query.query || undefined,
    ...requestWorkspaceAgeRange(query.age, now),
    sort: query.sort,
    page: query.page,
    pageSize: 20,
  };
}
