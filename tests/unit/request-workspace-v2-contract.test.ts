import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { shouldResetUploadIdempotencyKey } from '@/lib/private-file-upload';
import { getOrCreateMessageIdempotencyKey } from '@/lib/message-idempotency';
import { getOrCreateIdempotencyKey } from '@/lib/idempotency-key';
import { getApiErrorMessage } from '@/lib/api-error-message';
import { requestWorkspaceScrollStorageKey } from '@/lib/request-workspace-scroll';
import { getRequestWorkspacePrimaryAction } from '@/lib/request-workspace-primary-action';
import { nextRovingTabIndex } from '@/components/private/ui/a11y';
import { readApiResponse, readApiResponseOrThrow } from '@/lib/api-response-error';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const projectRoot = process.cwd();
const readProjectFile = (relativePath: string) => readFileSync(join(projectRoot, relativePath), 'utf8');

describe('request workspace V2 route contract', () => {
  it('keeps the legacy inbox as the fail-closed fallback', () => {
    const page = readProjectFile('src/app/staff/requests/page.tsx');

    expect(page).toContain('readCommercialV2Flags');
    expect(page).toContain('commercialWorkspaceV2');
    expect(page).toContain('requestWorkspaceV2');
    expect(page).toContain('RequestWorkspaceV2Panel');
    expect(page).toContain('StaffRequestsPanel');
  });

  it('keeps queue state in the shared URL contract and opens a deep request route', () => {
    const panel = readProjectFile('src/components/RequestWorkspaceV2Panel.tsx');

    expect(panel).toContain('normalizeRequestWorkspaceQuery');
    expect(panel).toContain('serializeRequestWorkspaceQuery');
    expect(panel).toContain("/api/staff/quote-requests?");
    expect(panel).toContain("/staff/requests/${encodeURIComponent(item.id)}");
    expect(panel).toContain('router.replace');
    expect(panel).toContain('PrivateSurfaceRoot');
  });

  it('exposes assignee filtering through the protected staff directory', () => {
    const panel = readProjectFile('src/components/RequestWorkspaceV2Panel.tsx');

    expect(panel).toContain('/api/staff/quote-requests/assignees');
    expect(panel).toContain('label="Responsable"');
    expect(panel).toContain('assigneeId');
  });

  it('keeps the legacy quote entry as a flag-protected compatibility redirect', () => {
    const quotesPage = readProjectFile('src/app/staff/quotes/page.tsx');

    expect(quotesPage).toContain('readCommercialV2Flags');
    expect(quotesPage).toContain('redirect');
    expect(quotesPage).toContain('/staff/requests/');
    expect(quotesPage).toContain("tab: 'quote'");
    expect(quotesPage).toContain('normalizeRequestWorkspaceQuery');
    expect(quotesPage).toContain('serializeRequestWorkspaceQuery');
    expect(quotesPage).toContain('StaffQuotesPanel');
  });

  it('keeps staff intake explicit about dedupe and consent', () => {
    const route = readProjectFile('src/app/api/staff/quote-requests/route.ts');
    const matchesRoute = readProjectFile('src/app/api/staff/quote-requests/matches/route.ts');

    expect(route).toContain('createStaffQuoteRequest');
    expect(route).toContain('contactMatchId');
    expect(route).toContain('confirmNewContact');
    expect(route).toContain('consent');
    expect(matchesRoute).toContain('findStaffQuoteRequestMatches');
  });

  it('protects the staff intake page and keeps the dedupe decision visible', () => {
    const page = readProjectFile('src/app/staff/requests/new/page.tsx');
    const panel = readProjectFile('src/components/StaffRequestCreateV2Panel.tsx');

    expect(page).toContain('readCommercialV2Flags');
    expect(page).toContain('notFound');
    expect(panel).toContain('/api/staff/quote-requests/matches');
    expect(panel).toContain('/api/staff/quote-requests');
    expect(panel).toContain('contactMatchId');
    expect(panel).toContain('confirmNewContact');
    expect(panel).toContain('consent');
    expect(panel).toContain('router.replace');
  });

  it('defines the deep route as a private workspace surface', () => {
    const detailPage = readProjectFile('src/app/staff/requests/[requestId]/page.tsx');
    const detailPanel = readProjectFile('src/components/RequestWorkspaceDetailV2.tsx');

    expect(detailPage).toContain('RequestWorkspaceDetailV2');
    expect(detailPanel).toContain("/api/staff/quote-requests/");
    expect(detailPanel).toContain('normalizeRequestWorkspaceQuery');
    expect(detailPanel).toContain('PrivateSurfaceRoot');
  });

  it('keeps expediente sections URL-driven and reuses protected panels lazily', () => {
    const detailPanel = readProjectFile('src/components/RequestWorkspaceDetailV2.tsx');

    expect(detailPanel).toContain('REQUEST_WORKSPACE_TABS');
    expect(detailPanel).toContain('role="tablist"');
    expect(detailPanel).toContain('aria-selected');
    expect(detailPanel).toContain('StaffMessagingPanel');
    expect(detailPanel).toContain('StaffFilesPanel');
    expect(detailPanel).toContain('/api/staff/capabilities');
    expect(detailPanel).toContain('/api/staff/quotes/');
    expect(detailPanel).toContain('statusHistory');
  });

  it('exposes explicit take, reassignment and review actions in the deep workspace', () => {
    const actions = readProjectFile('src/components/RequestWorkspaceActionsV2.tsx');
    const takeRoute = readProjectFile('src/app/api/staff/quote-requests/[id]/take/route.ts');

    expect(actions).toContain('request.take');
    expect(actions).toContain('request.reassign');
    expect(actions).toContain('availableStatusTransitions');
    expect(actions).toContain('Tomar solicitud');
    expect(takeRoute).toContain('takeQuoteRequest');
  });

  it('keeps profile editing behind the staff API and audit contract', () => {
    const route = readProjectFile('src/app/api/staff/quote-requests/[id]/route.ts');
    const service = readProjectFile('src/server/modules/quote-requests/staff-service.ts');
    const panel = readProjectFile('src/components/RequestWorkspaceEditV2.tsx');

    expect(route).toContain('PATCH');
    expect(route).toContain('updateStaffQuoteRequest');
    expect(panel).toContain('Guardar cambios');
    expect(panel).toContain('Cambiar correo o teléfono');
    expect(service).toContain('quote_request.updated');
    expect(service).toContain('changedFields');
    expect(service).toContain('before');
    expect(service).toContain('after');
  });

  it('keeps information requests as a single server-owned intent', () => {
    const actions = readProjectFile('src/components/RequestWorkspaceActionsV2.tsx');
    const service = readProjectFile('src/server/modules/quote-requests/staff-service.ts');
    const route = readProjectFile('src/app/api/staff/quote-requests/[id]/request-information/route.ts');

    expect(actions).toContain('Solicitar información');
    expect(actions).toContain('request.information');
    expect(actions).toContain('missingFields');
    expect(route).toContain('requestInformationQuoteRequest');
    expect(route).toContain('idempotencyKey');
    expect(service).toContain('quote_request.information_requested');
    expect(service).toContain('INFORMACION_REQUERIDA');
  });

  it('rotates a rejected upload reservation without breaking safe retries', () => {
    expect(shouldResetUploadIdempotencyKey('complete', 400)).toBe(true);
    expect(shouldResetUploadIdempotencyKey('storage', 400)).toBe(false);
    expect(shouldResetUploadIdempotencyKey('complete', 409)).toBe(false);
  });

  it('keeps portal message pagination available after a successful send', () => {
    const thread = readProjectFile('src/components/ClientMessagingThread.tsx');

    expect(thread.match(/setNextCursor\(null\)/g)).toHaveLength(1);
    expect(thread).toContain('setMessages((current) => current.some((message) => message.id === data.id) ? current : [...current, data])');
  });

  it('keeps client file uploads recoverable with visible progress', () => {
    const panel = readProjectFile('src/components/ClientFilesPanel.tsx');

    expect(panel).toContain('shouldResetUploadIdempotencyKey');
    expect(panel).toContain('XMLHttpRequest');
    expect(panel).toContain('Reintentar carga');
    expect(panel).toContain('uploadProgress');
  });

  it('keeps shared select menus bounded and scrollable for large directories', () => {
    const privateUi = readProjectFile('src/components/private/ui/private-ui.css');

    expect(privateUi).toContain('.private-select__viewport { max-height:');
    expect(privateUi).toContain('overflow-y: auto');
  });

  it('keeps embedded legacy actions within the private touch target contract', () => {
    const privateUi = readProjectFile('src/components/private/ui/private-ui.css');

    expect(privateUi).toContain('.private-ui-scope .staff-button');
    expect(privateUi).toContain('.private-ui-scope .staff-file__action');
    expect(privateUi).toContain('.private-ui-scope .client-file__action');
    expect(privateUi).toContain('min-height: 44px');
  });

  it('retains a message idempotency key across an explicit retry', () => {
    const firstKey = getOrCreateMessageIdempotencyKey(null, 'staff-request-123', () => 'generated');
    const retryKey = getOrCreateMessageIdempotencyKey(firstKey, 'staff-request-123', () => 'different');

    expect(firstKey).toBe('staff-request-123-generated');
    expect(retryKey).toBe(firstKey);
  });

  it('preserves the server request reference in recoverable UI errors', () => {
    expect(getApiErrorMessage({ error: { message: 'No se pudo guardar.', requestId: 'req-123' } }, 'Error genérico.')).toBe('No se pudo guardar. Si necesitas ayuda, menciona esta referencia: req-123');
    expect(getApiErrorMessage({ error: { message: 'No se pudo guardar.' } }, 'Error genérico.')).toBe('No se pudo guardar.');
  });

  it('wires both composers to retain the key until the message succeeds', () => {
    const staff = readProjectFile('src/components/StaffMessagingPanel.tsx');
    const client = readProjectFile('src/components/ClientMessagingThread.tsx');

    expect(staff).toContain('sendIdempotencyKey');
    expect(staff).toContain('getOrCreateMessageIdempotencyKey');
    expect(client).toContain('sendIdempotencyKey');
    expect(client).toContain('getOrCreateMessageIdempotencyKey');
  });

  it('collapses secondary expediente actions outside the summary tab', () => {
    const detail = readProjectFile('src/components/RequestWorkspaceDetailV2.tsx');
    const actions = readProjectFile('src/components/RequestWorkspaceActionsV2.tsx');

    expect(detail).toContain("compact={query.tab !== 'summary'}");
    expect(actions).toContain('compact?: boolean');
    expect(actions).toContain('Ver acciones');
    expect(actions).toContain('aria-expanded={expanded}');
  });

  it('scopes queue scroll restoration to the active URL query', () => {
    expect(requestWorkspaceScrollStorageKey('query=cliente&page=2')).toBe('ocpool:request-workspace-scroll:query=cliente&page=2');
    expect(requestWorkspaceScrollStorageKey('')).toBe('ocpool:request-workspace-scroll:default');

    const panel = readProjectFile('src/components/RequestWorkspaceV2Panel.tsx');
    expect(panel).toContain('sessionStorage');
    expect(panel).toContain('window.scrollTo');
  });

  it('selects one server-authorized primary expediente action without inventing transitions', () => {
    expect(getRequestWorkspacePrimaryAction({
      availableActions: ['request.status:EN_REVISION', 'request.take'],
      availableStatusTransitions: ['EN_REVISION'],
      hasMissingInformation: false,
      capabilities: { requestsAssign: true, requestsStatusUpdate: true, messagingSend: true },
    })).toMatchObject({ key: 'request.take', kind: 'take', label: 'Tomar solicitud' });

    expect(getRequestWorkspacePrimaryAction({
      availableActions: ['request.status:INFORMACION_REQUERIDA', 'request.status:EN_ELABORACION', 'request.information'],
      availableStatusTransitions: ['EN_ELABORACION'],
      hasMissingInformation: true,
      capabilities: { requestsAssign: false, requestsStatusUpdate: true, messagingSend: true },
    })).toMatchObject({ key: 'request.information', kind: 'information', label: 'Solicitar información' });

    expect(getRequestWorkspacePrimaryAction({
      availableActions: ['request.status:EN_ELABORACION'],
      availableStatusTransitions: ['EN_ELABORACION'],
      hasMissingInformation: false,
      capabilities: { requestsAssign: false, requestsStatusUpdate: true, messagingSend: false },
    })).toMatchObject({ key: 'request.status:EN_ELABORACION', kind: 'status', targetStatus: 'EN_ELABORACION' });

    expect(getRequestWorkspacePrimaryAction({
      availableActions: ['quote.open'],
      availableStatusTransitions: [],
      hasMissingInformation: false,
      capabilities: { requestsAssign: false, requestsStatusUpdate: false, messagingSend: false },
    })).toMatchObject({ key: 'quote.open', kind: 'quote', label: 'Abrir constructor' });
  });

  it('composes one contextual detail header with an accessible secondary action menu', () => {
    const detail = readProjectFile('src/components/RequestWorkspaceDetailV2.tsx');
    const header = readProjectFile('src/components/RequestWorkspaceHeaderV2.tsx');
    const actions = readProjectFile('src/components/RequestWorkspaceActionsV2.tsx');
    const menu = readProjectFile('src/components/private/ui/PrivateMenu.tsx');

    expect(detail).toContain('RequestWorkspaceHeaderV2');
    expect(detail).toContain('getRequestWorkspacePrimaryAction');
    expect(detail).toContain('secondaryActions');
    expect(detail).toContain('actionsRef');
    expect(header).toContain('PrivateMenu');
    expect(menu).toContain('aria-haspopup="menu"');
    expect(menu).toContain('role="menuitem"');
    expect(header).toContain('Siguiente actor');
    expect(header).toContain('Atención');
    expect(actions).toContain('RequestWorkspaceActionsHandle');
    expect(actions).toContain('primaryActionKey !==');
    expect(actions).toContain('id="request-workspace-v2-actions"');
  });

  it('expands and focuses form-based secondary actions from the header menu', () => {
    const detail = readProjectFile('src/components/RequestWorkspaceDetailV2.tsx');
    const actions = readProjectFile('src/components/RequestWorkspaceActionsV2.tsx');

    expect(detail).toContain("kind: 'reassign'");
    expect(actions).toContain("action.kind === 'reassign'");
    expect(actions).toContain("request-workspace-v2-assignee");
    expect(actions).toContain('requestAnimationFrame');
  });

  it('does not request the assignee directory without assignment permission', () => {
    const panel = readProjectFile('src/components/RequestWorkspaceV2Panel.tsx');

    expect(panel).toContain('requestsAssign');
    expect(panel).toContain('if (!canAssign || !canReadGlobal)');
    expect(panel).toContain('requestsReadGlobal');
    expect(panel).toContain('query.view !== defaultView');
  });

  it('keeps the activity timeline paginated instead of loading an unbounded history', () => {
    const service = readProjectFile('src/server/modules/quote-requests/staff-service.ts');
    const route = readProjectFile('src/app/api/staff/quote-requests/[id]/activity/route.ts');
    const detailPanel = readProjectFile('src/components/RequestWorkspaceDetailV2.tsx');

    expect(service).toContain('listStaffQuoteRequestActivity');
    expect(service).toContain('activityNextCursor');
    expect(route).toContain('listStaffQuoteRequestActivity');
    expect(detailPanel).toContain('Ver actividad anterior');
    expect(readProjectFile('README.md')).toContain('/api/staff/quote-requests/:id/activity');
  });

  it('keeps the formal request workspace IDOR matrix linked to the server scope contract', () => {
    const matrix = readProjectFile('docs/ocpool-commercial-v2/request-workspace-idor-matrix.md');
    const scope = readProjectFile('src/server/auth/request-scope.ts');
    const staffService = readProjectFile('src/server/modules/quote-requests/staff-service.ts');

    expect(matrix).toContain('requests.read.global');
    expect(matrix).toContain('404 NOT_FOUND');
    expect(matrix).toContain('403 FORBIDDEN');
    expect(matrix).toContain('Mensajería y notas');
    expect(matrix).toContain('Archivos');
    expect(matrix).toContain('Aprobaciones');
    expect(matrix).toContain('PDF y documento');
    expect(scope).toContain('staffRequestReadScopeWhere');
    expect(scope).toContain('requireStaffRequestReadScope');
    expect(staffService).toContain('assertStaffAssigneeFilterScope');
  });

  it('shares one canonical quote request status label dictionary across staff and portal surfaces', () => {
    const catalog = readProjectFile('src/lib/labels.ts');
    const lib = readProjectFile('src/lib/request-workspace-query.ts');
    const clientPortal = readProjectFile('src/components/ClientPortalPanel.tsx');
    const staffRequests = readProjectFile('src/components/StaffRequestsPanel.tsx');
    const staffDashboard = readProjectFile('src/components/StaffDashboardPanel.tsx');
    const detail = readProjectFile('src/components/RequestWorkspaceDetailV2.tsx');
    const queuePanel = readProjectFile('src/components/RequestWorkspaceV2Panel.tsx');

    expect(catalog).toContain('QUOTE_REQUEST_STATUS_LABELS');
    expect(catalog).toContain('CONVERTIDA_EN_PROYECTO');
    expect(lib).toContain("export { QUOTE_REQUEST_STATUS_LABELS } from '@/lib/labels'");

    for (const file of [clientPortal, staffRequests, staffDashboard, detail, queuePanel]) {
      expect(file).toContain('QUOTE_REQUEST_STATUS_LABELS');
      expect(file).not.toContain("ENVIADA: 'Enviada'");
    }
  });

  it('labels every quote version status, including ACEPTADA, without leaking the raw code (U1-05 parte 2)', () => {
    const catalog = readProjectFile('src/lib/labels.ts');
    expect(catalog).toContain('QUOTE_VERSION_STATUS_LABELS');
    expect(catalog).toContain("ACEPTADA: 'Aceptada'");

    const quotesPanel = readProjectFile('src/components/StaffQuotesPanel.tsx');
    expect(quotesPanel).toContain('QUOTE_VERSION_STATUS_LABELS');
    expect(quotesPanel).not.toContain("BORRADOR: 'Borrador'");
  });

  it('shares one canonical file status/category label helper between staff and portal file panels', () => {
    const catalog = readProjectFile('src/lib/labels.ts');
    expect(catalog).toContain('export function fileStatusLabel(');
    expect(catalog).toContain('export function fileCategoryLabel(');

    const staffFiles = readProjectFile('src/components/StaffFilesPanel.tsx');
    const clientFiles = readProjectFile('src/components/ClientFilesPanel.tsx');
    for (const file of [staffFiles, clientFiles]) {
      expect(file).toContain('fileStatusLabel');
      expect(file).not.toContain("if (file.status === 'PENDING_SCAN') return 'En validación'");
    }
  });

  it('shares one generic idempotency-key helper across messages, uploads and staff creation', () => {
    const firstKey = getOrCreateIdempotencyKey(null, 'staff-create', () => 'generated');
    expect(firstKey).toBe('staff-create-generated');
    expect(getOrCreateIdempotencyKey(firstKey, 'staff-create', () => 'different')).toBe(firstKey);
    expect(getOrCreateMessageIdempotencyKey(null, 'staff-request-123', () => 'generated')).toBe('staff-request-123-generated');

    for (const file of [
      readProjectFile('src/components/RequestWorkspaceActionsV2.tsx'),
      readProjectFile('src/components/StaffRequestCreateV2Panel.tsx'),
      readProjectFile('src/components/StaffFilesPanel.tsx'),
      readProjectFile('src/components/ClientFilesPanel.tsx'),
    ]) {
      expect(file).toContain('getOrCreateIdempotencyKey');
      expect(file).not.toContain('crypto.randomUUID()');
    }
  });

  it('shares one roving-tabindex calculation across button tabs and link tabs', () => {
    expect(nextRovingTabIndex('ArrowRight', 0, 2)).toBe(1);
    expect(nextRovingTabIndex('ArrowRight', 1, 2)).toBe(0);
    expect(nextRovingTabIndex('ArrowLeft', 0, 2)).toBe(1);
    expect(nextRovingTabIndex('Home', 1, 5)).toBe(0);
    expect(nextRovingTabIndex('End', 0, 5)).toBe(4);
    expect(nextRovingTabIndex('Enter', 0, 2)).toBeNull();
    expect(nextRovingTabIndex('ArrowRight', -1, 2)).toBeNull();
    expect(nextRovingTabIndex('ArrowRight', 0, 1)).toBeNull();

    for (const file of [
      readProjectFile('src/components/StaffFilesPanel.tsx'),
      readProjectFile('src/components/StaffMessagingPanel.tsx'),
      readProjectFile('src/components/RequestWorkspaceDetailV2.tsx'),
    ]) {
      expect(file).toContain('nextRovingTabIndex');
    }
  });

  it('classifies workspace fetch failures as forbidden, not-found or transient by HTTP status', async () => {
    const forbidden = await readApiResponse(jsonResponse(403, { error: { message: 'Sin permisos.' } }), 'fallback');
    expect(forbidden).toMatchObject({ ok: false, kind: 'forbidden', message: 'Sin permisos.' });

    const unauthenticated = await readApiResponse(jsonResponse(401, { error: { message: 'No autenticado.' } }), 'fallback');
    expect(unauthenticated).toMatchObject({ ok: false, kind: 'forbidden' });

    const notFound = await readApiResponse(jsonResponse(404, {}), 'No encontrado.');
    expect(notFound).toMatchObject({ ok: false, kind: 'not_found', message: 'No encontrado.' });

    const serverError = await readApiResponse(jsonResponse(500, {}), 'fallback');
    expect(serverError).toMatchObject({ ok: false, kind: 'transient' });

    const success = await readApiResponse<{ items: unknown[] }>(jsonResponse(200, { items: [] }), 'fallback');
    expect(success).toEqual({ ok: true, data: { items: [] } });

    await expect(readApiResponseOrThrow(jsonResponse(404, {}), 'No encontrado.')).rejects.toThrow('No encontrado.');

    for (const file of [
      readProjectFile('src/components/RequestWorkspaceDetailV2.tsx'),
      readProjectFile('src/components/RequestWorkspaceV2Panel.tsx'),
    ]) {
      expect(file).toContain('readApiResponse');
    }
  });

  it('shares one backend idempotency-key schema across messaging, files and information requests', () => {
    const shared = readProjectFile('src/server/http/idempotency.ts');
    expect(shared).toContain('IDEMPOTENCY_KEY_PATTERN');
    expect(shared).toContain('idempotencyKeySchema');

    for (const file of [
      readProjectFile('src/server/modules/messaging/http.ts'),
      readProjectFile('src/server/modules/private-files/http.ts'),
      readProjectFile('src/app/api/staff/quote-requests/[id]/request-information/route.ts'),
    ]) {
      expect(file).toContain('idempotencyKeySchema');
      expect(file).not.toContain('IDEMPOTENCY_KEY_PATTERN =');
    }
  });
});
