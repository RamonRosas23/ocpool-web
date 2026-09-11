/**
 * G0-03 baseline contract.
 *
 * This fixture describes what must be measured before the private experience
 * is redesigned. It is intentionally disconnected from runtime state and does
 * not contain customer data, credentials, or production identifiers.
 */

export const BASELINE_VIEWPORTS = [
  { id: 'mobile', width: 390, height: 844 },
  { id: 'tablet', width: 768, height: 1024 },
  { id: 'desktop', width: 1440, height: 900 },
] as const;

export type BaselineViewportId = (typeof BASELINE_VIEWPORTS)[number]['id'];

export const BASELINE_SURFACES = [
  { id: 'public-request', route: '/', actor: 'anonymous', auth: 'none', priority: 'P0' },
  { id: 'employee-login', route: '/login', actor: 'anonymous', auth: 'none', priority: 'P0' },
  { id: 'customer-access', route: '/portal/access', actor: 'anonymous', auth: 'none', priority: 'P0' },
  { id: 'staff-home', route: '/staff', actor: 'staff', auth: 'required', priority: 'P0' },
  { id: 'staff-requests', route: '/staff/requests', actor: 'staff', auth: 'required', priority: 'P0' },
  { id: 'staff-quotes', route: '/staff/quotes', actor: 'staff', auth: 'required', priority: 'P0' },
  { id: 'staff-notifications', route: '/staff/notifications', actor: 'staff', auth: 'required', priority: 'P1' },
  { id: 'customer-portal', route: '/portal', actor: 'customer', auth: 'required', priority: 'P0' },
] as const;

export type BaselineSurfaceId = (typeof BASELINE_SURFACES)[number]['id'];

export const CURRENT_BASELINE_OBSERVATIONS = [
  {
    surface: 'public-request',
    evidence: 'anonymous-browser-inspection',
    observation: 'The public quote form is reachable and returns a non-authenticating folio; request-to-confirmation timing is now measurable with a synthetic submission, without treating the folio as portal access.',
    severity: 'measurement-gap',
  },
  {
    surface: 'employee-login',
    evidence: 'unauthenticated-browser-inspection',
    observation: 'The entry surface is reachable and explains employee access, but the authenticated next task is not measurable without a valid staff fixture.',
    severity: 'measurement-gap',
  },
  {
    surface: 'customer-access',
    evidence: 'unauthenticated-browser-inspection',
    observation: 'The entry surface distinguishes requesting access from a new quote; the time from access request to portal decision is not measurable without mail delivery and an invited customer fixture.',
    severity: 'measurement-gap',
  },
  {
    surface: 'staff-home',
    evidence: 'unauthenticated-browser-inspection',
    observation: 'The route correctly restricts anonymous access. Authenticated dashboard hierarchy, return paths, and next-task density remain pending.',
    severity: 'measurement-gap',
  },
  {
    surface: 'staff-requests',
    evidence: 'unauthenticated-browser-inspection',
    observation: 'The route correctly restricts anonymous access. The request-to-draft workflow must be measured with a seeded staff session and representative inbox.',
    severity: 'measurement-gap',
  },
  {
    surface: 'staff-quotes',
    evidence: 'unauthenticated-browser-inspection',
    observation: 'The route correctly restricts anonymous access. Builder effort, price-list search, validation, preflight, and publication must be measured with a seeded request.',
    severity: 'measurement-gap',
  },
  {
    surface: 'staff-notifications',
    evidence: 'unauthenticated-browser-inspection',
    observation: 'The route correctly restricts anonymous access. Delivery failure visibility, retry comprehension, and recovery time require a seeded notification fixture.',
    severity: 'measurement-gap',
  },
  {
    surface: 'customer-portal',
    evidence: 'unauthenticated-browser-inspection',
    observation: 'The route correctly restricts anonymous access. Quote comprehension, document access, acceptance, and messaging must be measured with an invited customer fixture.',
    severity: 'measurement-gap',
  },
] as const;

export const BASELINE_SCENARIOS = [
  { id: 'new-request', actor: 'anonymous', start: '/#cotizacion', end: 'folio-visible', targetMetric: 'public_request_to_confirmation', fixture: 'new quote request with no existing identity' },
  { id: 'waiting-for-customer', actor: 'sales', start: '/staff/requests', end: 'information-requested', targetMetric: 'request_to_next_task', fixture: 'request in EN_REVISION' },
  { id: 'draft-quote', actor: 'sales', start: '/staff/quotes', end: 'draft-saved', targetMetric: 'request_to_draft', fixture: 'qualified request plus active price list' },
  { id: 'publish-quote', actor: 'sales', start: '/staff/quotes', end: 'published', targetMetric: 'publish_quote', fixture: 'ready working version with valid document and delivery preflight' },
  { id: 'approval-required', actor: 'manager', start: '/staff/quotes', end: 'approval-resolved', targetMetric: 'draft_to_approval_resolution', fixture: 'working version whose policy requires approval' },
  { id: 'pdf-failed', actor: 'sales', start: '/staff/quotes', end: 'document-retry-available', targetMetric: 'document_failure_to_recovery', fixture: 'frozen version with deterministic document failure' },
  { id: 'delivery-failed', actor: 'sales', start: '/staff/notifications', end: 'delivery-retry-available', targetMetric: 'delivery_failure_to_recovery', fixture: 'published quote with recoverable notification failure' },
  { id: 'new-working-version', actor: 'sales', start: '/staff/quotes', end: 'published-version-retained', targetMetric: 'published_to_new_working', fixture: 'published V1 plus editable V2' },
  { id: 'expired-version', actor: 'customer', start: '/portal', end: 'expired-state-understood', targetMetric: 'expired_quote_to_next_step', fixture: 'published quote beyond validity date' },
  { id: 'accepted-quote', actor: 'customer', start: '/portal', end: 'acceptance-recorded', targetMetric: 'portal_access_to_decision', fixture: 'ready published quote with active terms and invited customer' },
] as const;

export type BaselineScenarioId = (typeof BASELINE_SCENARIOS)[number]['id'];

export const BASELINE_METRICS = [
  {
    id: 'public_request_to_confirmation',
    name: 'Solicitud pública → confirmación con folio',
    startEvent: 'request.form_started',
    endEvent: 'request.confirmed',
    unit: 'seconds',
    dimensions: ['actor', 'surface', 'viewport'],
    target: 'PENDING_PRODUCT_TARGET',
  },
  {
    id: 'request_to_next_task',
    name: 'Tiempo hasta la siguiente tarea',
    startEvent: 'workflow.surface_viewed',
    endEvent: 'workflow.next_task_completed',
    unit: 'seconds',
    dimensions: ['actor', 'surface', 'requestState', 'viewport'],
    target: 'PENDING_PRODUCT_TARGET',
  },
  {
    id: 'request_to_draft',
    name: 'Solicitud calificada → primer borrador guardado',
    startEvent: 'request.qualified',
    endEvent: 'quote.draft_saved',
    unit: 'seconds',
    dimensions: ['actor', 'priceList', 'lineCountBucket', 'viewport'],
    target: 'PENDING_PRODUCT_TARGET',
  },
  {
    id: 'add_ten_concepts',
    name: 'Tiempo para agregar diez conceptos',
    startEvent: 'quote.builder_started',
    endEvent: 'quote.ten_lines_saved',
    unit: 'seconds',
    dimensions: ['actor', 'catalogSearchMode', 'priceList', 'viewport'],
    target: 'PENDING_PRODUCT_TARGET',
  },
  {
    id: 'publish_quote',
    name: 'Borrador listo → publicación confirmada',
    startEvent: 'quote.preflight_opened',
    endEvent: 'quote.published',
    unit: 'seconds',
    dimensions: ['actor', 'approvalRequired', 'documentState', 'viewport'],
    target: 'PENDING_PRODUCT_TARGET',
  },
  {
    id: 'draft_to_approval_resolution',
    name: 'Borrador → resolución de aprobación',
    startEvent: 'quote.draft_saved',
    endEvent: 'quote.approval_resolved',
    unit: 'seconds',
    dimensions: ['actor', 'approvalState', 'viewport'],
    target: 'PENDING_PRODUCT_TARGET',
  },
  {
    id: 'document_failure_to_recovery',
    name: 'Fallo de PDF → recuperación disponible',
    startEvent: 'document.generation_failed',
    endEvent: 'document.generation_recovered',
    unit: 'seconds',
    dimensions: ['actor', 'failureCode', 'viewport'],
    target: 'PENDING_PRODUCT_TARGET',
  },
  {
    id: 'delivery_failure_to_recovery',
    name: 'Fallo de entrega → recuperación disponible',
    startEvent: 'notification.delivery_failed',
    endEvent: 'notification.delivery_recovered',
    unit: 'seconds',
    dimensions: ['actor', 'channel', 'errorCode', 'viewport'],
    target: 'PENDING_PRODUCT_TARGET',
  },
  {
    id: 'published_to_new_working',
    name: 'Versión publicada → nueva versión de trabajo',
    startEvent: 'quote.published',
    endEvent: 'quote.new_working_version_created',
    unit: 'seconds',
    dimensions: ['actor', 'previousVersionCount', 'viewport'],
    target: 'PENDING_PRODUCT_TARGET',
  },
  {
    id: 'expired_quote_to_next_step',
    name: 'Cotización vencida → siguiente paso comprendido',
    startEvent: 'portal.expired_viewed',
    endEvent: 'portal.next_step_selected',
    unit: 'seconds',
    dimensions: ['customerType', 'quoteState', 'viewport'],
    target: 'PENDING_PRODUCT_TARGET',
  },
  {
    id: 'portal_access_to_decision',
    name: 'Acceso del cliente → decisión sobre cotización',
    startEvent: 'portal.access_granted',
    endEvent: 'quote.accepted_or_rejected',
    unit: 'seconds',
    dimensions: ['customerType', 'quoteState', 'viewport'],
    target: 'PENDING_PRODUCT_TARGET',
  },
  {
    id: 'workflow_errors',
    name: 'Errores recuperables por tarea',
    startEvent: 'workflow.task_started',
    endEvent: 'workflow.task_completed',
    unit: 'count',
    dimensions: ['actor', 'surface', 'errorCode', 'viewport'],
    target: 'PENDING_PRODUCT_TARGET',
  },
  {
    id: 'workflow_abandonment',
    name: 'Abandono antes de la siguiente tarea',
    startEvent: 'workflow.task_started',
    endEvent: 'workflow.task_completed_or_abandoned',
    unit: 'rate',
    dimensions: ['actor', 'surface', 'lastVisibleStep', 'viewport'],
    target: 'PENDING_PRODUCT_TARGET',
  },
] as const;

export const BASELINE_EVENT_RULES = {
  eventNamePattern: /^[a-z][a-z0-9_.]+$/u,
  requiredFields: ['eventName', 'occurredAt', 'sessionId', 'surface', 'actorType', 'viewport', 'schemaVersion'],
  forbiddenFields: ['email', 'phone', 'name', 'messageBody', 'token', 'storageKey', 'ipAddress', 'userAgent'],
  retention: 'PENDING_PRIVACY_DECISION',
} as const;

export const REPRESENTATIVE_VOLUME_PROFILES = [
  { id: 'request-inbox', aggregate: 'quote_requests', count: 10_000, purpose: 'pagination, filters, sorting, empty/error states' },
  { id: 'catalog', aggregate: 'catalog_items', count: 5_000, purpose: 'search, price-list selection, keyboard navigation' },
  { id: 'versions', aggregate: 'quote_versions_per_request', count: 100, purpose: 'history, working/published separation, projection performance' },
  { id: 'document-lines', aggregate: 'quote_lines_per_document', count: 100, purpose: 'builder density, totals, PDF pagination and review' },
] as const;

export const BASELINE_DATA_RULES = [
  'Use generated identifiers and synthetic MXN values only.',
  'Never copy production email addresses, names, phone numbers, message bodies, tokens, storage keys, or IP addresses.',
  'Keep fixture relationships valid: request → client → contact → versions → document/publication/acceptance.',
  'Make every scenario resettable and idempotent before each measurement run.',
  'Record browser, viewport, commit, seed version, and environment without recording customer identity.',
] as const;

export const BASELINE_MEASUREMENT_REQUIRED_FIELDS = [
  'schemaVersion',
  'metricId',
  'scenarioId',
  'actorType',
  'surface',
  'viewport',
  'seedVersion',
  'commit',
  'startedAt',
  'endedAt',
  'durationMs',
  'errorCount',
  'abandoned',
] as const;

export type BaselineMeasurementRecord = {
  schemaVersion: 1;
  metricId: BaselineMetricId;
  scenarioId: BaselineScenarioId;
  actorType: 'ANONYMOUS' | 'SALES' | 'MANAGER' | 'CUSTOMER';
  surface: BaselineSurfaceId;
  viewport: BaselineViewportId;
  seedVersion: string;
  commit: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  errorCount: number;
  abandoned: boolean;
};

export type BaselineMetricId = (typeof BASELINE_METRICS)[number]['id'];

const BASELINE_FORBIDDEN_KEYS = new Set<string>(BASELINE_EVENT_RULES.forbiddenFields);

export function validateBaselineMeasurementRecord(input: unknown): string[] {
  const errors: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ['record must be an object'];

  const record = input as Record<string, unknown>;
  const walk = (value: unknown, path: string) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${path}[${index}]`));
      return;
    }
    for (const [key, nested] of Object.entries(value)) {
      if (BASELINE_FORBIDDEN_KEYS.has(key)) errors.push(`forbidden field: ${path ? `${path}.` : ''}${key}`);
      walk(nested, `${path ? `${path}.` : ''}${key}`);
    }
  };
  walk(record, '');

  for (const field of BASELINE_MEASUREMENT_REQUIRED_FIELDS) if (!(field in record)) errors.push(`missing field: ${field}`);
  if (record.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!BASELINE_METRICS.some((metric) => metric.id === record.metricId)) errors.push('metricId is not in the baseline dictionary');
  if (!BASELINE_SCENARIOS.some((scenario) => scenario.id === record.scenarioId)) errors.push('scenarioId is not in the baseline matrix');
  if (!BASELINE_SURFACES.some((surface) => surface.id === record.surface)) errors.push('surface is not in the baseline matrix');
  if (!BASELINE_VIEWPORTS.some((viewport) => viewport.id === record.viewport)) errors.push('viewport is not in the baseline matrix');
  for (const field of ['seedVersion', 'commit', 'startedAt', 'endedAt']) if (typeof record[field] !== 'string' || record[field] === '') errors.push(`${field} must be a non-empty string`);
  const startedAt = typeof record.startedAt === 'string' ? Date.parse(record.startedAt) : Number.NaN;
  const endedAt = typeof record.endedAt === 'string' ? Date.parse(record.endedAt) : Number.NaN;
  if (typeof record.startedAt === 'string' && Number.isNaN(startedAt)) errors.push('startedAt must be an ISO date');
  if (typeof record.endedAt === 'string' && Number.isNaN(endedAt)) errors.push('endedAt must be an ISO date');
  if (Number.isFinite(startedAt) && Number.isFinite(endedAt) && endedAt < startedAt) errors.push('endedAt must be after startedAt');
  if (typeof record.durationMs !== 'number' || !Number.isFinite(record.durationMs) || record.durationMs < 0) errors.push('durationMs must be a non-negative finite number');
  if (typeof record.errorCount !== 'number' || !Number.isInteger(record.errorCount) || record.errorCount < 0) errors.push('errorCount must be a non-negative integer');
  if (typeof record.abandoned !== 'boolean') errors.push('abandoned must be boolean');
  return [...new Set(errors)];
}
