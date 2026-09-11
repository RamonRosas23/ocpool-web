/**
 * G0-01 truth table.
 *
 * This fixture is deliberately disconnected from the application runtime. It is
 * the contract that D1/D2 will implement; changing it is a domain decision and
 * requires an ADR, not a silent resolver change.
 */

export const WORKFLOW_ENTITIES = [
  'QUOTE_REQUEST',
  'QUOTE_VERSION',
  'QUOTE_APPROVAL',
  'COMMERCIAL_TERMS',
  'GENERATED_DOCUMENT',
  'QUOTE_PUBLICATION',
  'NOTIFICATION_DELIVERY',
  'QUOTE_ACCEPTANCE',
  'PROJECT',
] as const;

export type WorkflowEntity = (typeof WORKFLOW_ENTITIES)[number];
export type WorkflowActor = 'STAFF' | 'SALES' | 'MANAGER' | 'ADMIN' | 'CUSTOMER' | 'SYSTEM' | 'NONE';
export type CaseKind = 'VALID' | 'INVALID';

export const CURRENT_STATE_INVENTORY = [
  {
    entity: 'QUOTE_REQUEST',
    owner: 'QuoteRequest',
    currentStatuses: ['RECIBIDA', 'EN_REVISION', 'INFORMACION_REQUERIDA', 'EN_ELABORACION', 'COTIZACION_DISPONIBLE', 'EN_NEGOCIACION', 'PENDIENTE_DE_APROBACION', 'ACEPTADA', 'RECHAZADA', 'VENCIDA', 'CONVERTIDA_EN_PROYECTO'],
    reachableBy: ['createQuoteRequest', 'updateQuoteRequestStatus', 'transitionQuoteVersion'],
    targetOwner: 'QUOTE_REQUEST',
  },
  {
    entity: 'QUOTE_VERSION',
    owner: 'QuoteVersion',
    currentStatuses: ['BORRADOR', 'EN_REVISION', 'ENVIADA', 'EN_NEGOCIACION', 'ACEPTADA', 'RECHAZADA', 'VENCIDA'],
    reachableBy: ['createQuoteVersion', 'replaceQuoteDraft', 'transitionQuoteVersion', 'acceptCustomerQuote'],
    targetOwner: 'QUOTE_VERSION',
  },
  {
    entity: 'QUOTE_APPROVAL',
    owner: 'QuoteApproval',
    currentStatuses: ['ABSENT'],
    reachableBy: [],
    targetOwner: 'QUOTE_APPROVAL',
  },
  {
    entity: 'COMMERCIAL_TERMS',
    owner: 'QuoteAcceptance.termsVersion',
    currentStatuses: ['CLIENT_SUPPLIED_STRING'],
    reachableBy: ['portalAcceptancePayload'],
    targetOwner: 'COMMERCIAL_TERMS',
  },
  {
    entity: 'GENERATED_DOCUMENT',
    owner: 'GeneratedDocument',
    currentStatuses: ['PENDING', 'READY', 'FAILED', 'DELETED'],
    reachableBy: ['generateQuotePdf', 'downloadQuotePdf'],
    targetOwner: 'GENERATED_DOCUMENT',
  },
  {
    entity: 'QUOTE_PUBLICATION',
    owner: 'QuoteRequest.status + OutboxEvent',
    currentStatuses: ['ABSENT'],
    reachableBy: ['transitionQuoteVersion'],
    targetOwner: 'QUOTE_PUBLICATION',
  },
  {
    entity: 'NOTIFICATION_DELIVERY',
    owner: 'NotificationDelivery',
    currentStatuses: ['PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED'],
    reachableBy: ['notificationsFanout', 'notificationsWorker'],
    targetOwner: 'NOTIFICATION_DELIVERY',
  },
  {
    entity: 'QUOTE_ACCEPTANCE',
    owner: 'QuoteAcceptance',
    currentStatuses: ['ABSENT', 'RECORDED'],
    reachableBy: ['acceptCustomerQuote'],
    targetOwner: 'QUOTE_ACCEPTANCE',
  },
  {
    entity: 'PROJECT',
    owner: 'QuoteRequest.status.CONVERTIDA_EN_PROYECTO',
    currentStatuses: ['ABSENT'],
    reachableBy: ['updateQuoteRequestStatus'],
    targetOwner: 'PROJECT',
  },
] as const;

export const TARGET_STATES = {
  QUOTE_REQUEST: ['RECIBIDA', 'EN_REVISION', 'INFORMACION_REQUERIDA', 'LISTA_PARA_COTIZAR', 'RECHAZADA', 'CONVERTIDA_EN_PROYECTO'],
  QUOTE_VERSION: ['BORRADOR', 'EN_REVISION', 'LISTA_PARA_PUBLICAR', 'PUBLICADA', 'REEMPLAZADA', 'ACEPTADA', 'RECHAZADA', 'VENCIDA'],
  QUOTE_APPROVAL: ['NOT_REQUIRED', 'REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED'],
  COMMERCIAL_TERMS: ['DRAFT', 'ACTIVE', 'RETIRED'],
  GENERATED_DOCUMENT: ['NOT_CREATED', 'PENDING', 'READY', 'FAILED', 'INVALIDATED'],
  QUOTE_PUBLICATION: ['NOT_PUBLISHED', 'PREPARED', 'PUBLISHED', 'REPLACED', 'CANCELLED'],
  NOTIFICATION_DELIVERY: ['NONE', 'QUEUED', 'SENT', 'FAILED', 'CANCELLED'],
  QUOTE_ACCEPTANCE: ['NOT_ACCEPTED', 'ACCEPTED'],
  PROJECT: ['NOT_CREATED', 'ACTIVE', 'CLOSED'],
} as const satisfies Record<WorkflowEntity, readonly string[]>;

export const TARGET_INITIAL_STATES = {
  QUOTE_REQUEST: 'RECIBIDA',
  QUOTE_VERSION: 'BORRADOR',
  QUOTE_APPROVAL: 'NOT_REQUIRED',
  COMMERCIAL_TERMS: 'DRAFT',
  GENERATED_DOCUMENT: 'NOT_CREATED',
  QUOTE_PUBLICATION: 'NOT_PUBLISHED',
  NOTIFICATION_DELIVERY: 'NONE',
  QUOTE_ACCEPTANCE: 'NOT_ACCEPTED',
  PROJECT: 'NOT_CREATED',
} as const satisfies Record<WorkflowEntity, string>;

export type ActionKey =
  | 'claim_request'
  | 'review_request'
  | 'request_information'
  | 'review_customer_response'
  | 'add_first_quote_line'
  | 'submit_quote_for_review'
  | 'resolve_quote_approval'
  | 'retry_quote_document'
  | 'publish_quote'
  | 'retry_delivery'
  | 'create_working_version'
  | 'accept_published_quote'
  | 'clone_expired_version'
  | 'create_project_from_acceptance';

export const ACTION_CATALOG = [
  'claim_request',
  'review_request',
  'request_information',
  'review_customer_response',
  'add_first_quote_line',
  'submit_quote_for_review',
  'resolve_quote_approval',
  'retry_quote_document',
  'publish_quote',
  'retry_delivery',
  'create_working_version',
  'accept_published_quote',
  'clone_expired_version',
  'create_project_from_acceptance',
] as const satisfies readonly ActionKey[];

export const BLOCKER_CATALOG = [
  'MESSAGE_REQUIRED',
  'DOCUMENT_NOT_READY',
  'TERMS_NOT_ACTIVE',
  'PUBLISHED_VERSION_MISMATCH',
  'CLIENT_SCOPE',
  'SEPARATION_OF_DUTIES',
  'IMMUTABLE_VERSION',
  'IDEMPOTENCY_PAYLOAD_MISMATCH',
  'PROJECT_CONTRACT_MISSING',
  'APPROVAL_REQUIRED',
] as const;

export type BlockerKey = (typeof BLOCKER_CATALOG)[number];

export type TargetTransition = Readonly<{
  id: string;
  entity: WorkflowEntity;
  from: string;
  event: string;
  to: string;
  actor: WorkflowActor;
  preconditions: readonly string[];
  auditAction: string;
  outboxEvent: string | null;
  visibleStage: string;
}>;

export const TARGET_TRANSITIONS: readonly TargetTransition[] = [
  { id: 'request.claim', entity: 'QUOTE_REQUEST', from: 'RECIBIDA', event: 'claimRequest', to: 'EN_REVISION', actor: 'STAFF', preconditions: ['request_is_unassigned_or_actor_can_claim'], auditAction: 'request.claimed', outboxEvent: 'REQUEST.STATUS_CHANGED', visibleStage: 'EN_REVISION' },
  { id: 'request.ask_information', entity: 'QUOTE_REQUEST', from: 'EN_REVISION', event: 'requestInformation', to: 'INFORMACION_REQUERIDA', actor: 'STAFF', preconditions: ['customer_message_is_non_empty', 'customer_scope_is_valid'], auditAction: 'request.information_requested', outboxEvent: 'REQUEST.INFORMATION_REQUIRED', visibleStage: 'INFORMACION_REQUERIDA' },
  { id: 'request.resume_after_customer', entity: 'QUOTE_REQUEST', from: 'INFORMACION_REQUERIDA', event: 'customerResponseReceived', to: 'EN_REVISION', actor: 'SYSTEM', preconditions: ['customer_message_is_visible_to_staff'], auditAction: 'request.customer_response_received', outboxEvent: 'REQUEST.CUSTOMER_RESPONSE', visibleStage: 'EN_REVISION' },
  { id: 'request.qualify', entity: 'QUOTE_REQUEST', from: 'EN_REVISION', event: 'qualifyRequest', to: 'LISTA_PARA_COTIZAR', actor: 'STAFF', preconditions: ['minimum_commercial_information_present'], auditAction: 'request.qualified', outboxEvent: 'REQUEST.STATUS_CHANGED', visibleStage: 'LISTA_PARA_COTIZAR' },
  { id: 'request.reject', entity: 'QUOTE_REQUEST', from: 'EN_REVISION', event: 'rejectRequest', to: 'RECHAZADA', actor: 'STAFF', preconditions: ['reason_is_present'], auditAction: 'request.rejected', outboxEvent: 'REQUEST.STATUS_CHANGED', visibleStage: 'RECHAZADA' },
  { id: 'request.convert_project', entity: 'QUOTE_REQUEST', from: 'LISTA_PARA_COTIZAR', event: 'createProjectFromAcceptance', to: 'CONVERTIDA_EN_PROYECTO', actor: 'STAFF', preconditions: ['accepted_publication_exists', 'project_contract_is_enabled'], auditAction: 'request.converted_to_project', outboxEvent: 'PROJECT.CREATED', visibleStage: 'CONVERTIDA_EN_PROYECTO' },
  { id: 'version.submit_review', entity: 'QUOTE_VERSION', from: 'BORRADOR', event: 'submitQuoteForReview', to: 'EN_REVISION', actor: 'STAFF', preconditions: ['at_least_one_valid_line', 'expected_revision_matches'], auditAction: 'quote.version.submitted', outboxEvent: 'QUOTE.VERSION_SUBMITTED', visibleStage: 'EN_REVISION' },
  { id: 'version.return_draft', entity: 'QUOTE_VERSION', from: 'EN_REVISION', event: 'returnQuoteToDraft', to: 'BORRADOR', actor: 'STAFF', preconditions: ['reason_is_present'], auditAction: 'quote.version.returned_to_draft', outboxEvent: 'QUOTE.VERSION_REOPENED', visibleStage: 'BORRADOR' },
  { id: 'version.ready_publication', entity: 'QUOTE_VERSION', from: 'EN_REVISION', event: 'markReadyForPublication', to: 'LISTA_PARA_PUBLICAR', actor: 'MANAGER', preconditions: ['approval_is_not_required_or_approved', 'content_digest_is_frozen'], auditAction: 'quote.version.ready_for_publication', outboxEvent: 'QUOTE.VERSION_READY', visibleStage: 'LISTA_PARA_PUBLICAR' },
  { id: 'version.publish', entity: 'QUOTE_VERSION', from: 'LISTA_PARA_PUBLICAR', event: 'publishQuote', to: 'PUBLICADA', actor: 'STAFF', preconditions: ['pdf_is_ready', 'active_terms_selected', 'preflight_digest_matches', 'explicit_confirmation'], auditAction: 'quote.published', outboxEvent: 'QUOTE.PUBLISHED', visibleStage: 'PUBLICADA' },
  { id: 'version.replace', entity: 'QUOTE_VERSION', from: 'PUBLICADA', event: 'publishReplacement', to: 'REEMPLAZADA', actor: 'SYSTEM', preconditions: ['replacement_publication_is_successful'], auditAction: 'quote.version.replaced', outboxEvent: 'QUOTE.VERSION_REPLACED', visibleStage: 'REEMPLAZADA' },
  { id: 'version.accept', entity: 'QUOTE_VERSION', from: 'PUBLICADA', event: 'acceptPublishedQuote', to: 'ACEPTADA', actor: 'CUSTOMER', preconditions: ['version_equals_published_pointer', 'pdf_is_ready', 'active_terms_selected', 'customer_scope_is_valid'], auditAction: 'quote.accepted', outboxEvent: 'QUOTE.ACCEPTED', visibleStage: 'ACEPTADA' },
  { id: 'version.reject', entity: 'QUOTE_VERSION', from: 'PUBLICADA', event: 'rejectPublishedQuote', to: 'RECHAZADA', actor: 'CUSTOMER', preconditions: ['reason_is_present', 'customer_scope_is_valid'], auditAction: 'quote.rejected_by_customer', outboxEvent: 'QUOTE.REJECTED', visibleStage: 'RECHAZADA' },
  { id: 'version.expire', entity: 'QUOTE_VERSION', from: 'PUBLICADA', event: 'expirePublishedQuote', to: 'VENCIDA', actor: 'SYSTEM', preconditions: ['validity_date_has_passed'], auditAction: 'quote.expired', outboxEvent: 'QUOTE.EXPIRED', visibleStage: 'VENCIDA' },
  { id: 'approval.request', entity: 'QUOTE_APPROVAL', from: 'NOT_REQUIRED', event: 'requestApproval', to: 'REQUESTED', actor: 'STAFF', preconditions: ['policy_requires_approval', 'requester_is_not_approver'], auditAction: 'quote.approval.requested', outboxEvent: 'QUOTE.APPROVAL_REQUESTED', visibleStage: 'ESPERANDO_APROBACION' },
  { id: 'approval.approve', entity: 'QUOTE_APPROVAL', from: 'REQUESTED', event: 'resolveApproval', to: 'APPROVED', actor: 'MANAGER', preconditions: ['requester_is_not_approver', 'digest_matches'], auditAction: 'quote.approval.approved', outboxEvent: 'QUOTE.APPROVAL_RESOLVED', visibleStage: 'APROBADA' },
  { id: 'approval.reject', entity: 'QUOTE_APPROVAL', from: 'REQUESTED', event: 'resolveApproval', to: 'REJECTED', actor: 'MANAGER', preconditions: ['reason_is_present', 'digest_matches'], auditAction: 'quote.approval.rejected', outboxEvent: 'QUOTE.APPROVAL_RESOLVED', visibleStage: 'REQUIERE_CORRECCION' },
  { id: 'approval.cancel', entity: 'QUOTE_APPROVAL', from: 'REQUESTED', event: 'cancelApproval', to: 'CANCELLED', actor: 'STAFF', preconditions: ['reason_is_present'], auditAction: 'quote.approval.cancelled', outboxEvent: 'QUOTE.APPROVAL_CANCELLED', visibleStage: 'APROBACION_CANCELADA' },
  { id: 'approval.supersede', entity: 'QUOTE_APPROVAL', from: 'REQUESTED', event: 'supersedeApproval', to: 'SUPERSEDED', actor: 'SYSTEM', preconditions: ['working_digest_changed'], auditAction: 'quote.approval.superseded', outboxEvent: 'QUOTE.APPROVAL_SUPERSEDED', visibleStage: 'APROBACION_INVALIDADA' },
  { id: 'terms.activate', entity: 'COMMERCIAL_TERMS', from: 'DRAFT', event: 'activateTerms', to: 'ACTIVE', actor: 'ADMIN', preconditions: ['legal_owner_approved'], auditAction: 'commercial_terms.activated', outboxEvent: null, visibleStage: 'TERMINOS_ACTIVOS' },
  { id: 'terms.retire', entity: 'COMMERCIAL_TERMS', from: 'ACTIVE', event: 'retireTerms', to: 'RETIRED', actor: 'ADMIN', preconditions: ['replacement_terms_are_active'], auditAction: 'commercial_terms.retired', outboxEvent: null, visibleStage: 'TERMINOS_RETIRED' },
  { id: 'document.prepare', entity: 'GENERATED_DOCUMENT', from: 'NOT_CREATED', event: 'prepareQuoteDocument', to: 'PENDING', actor: 'SYSTEM', preconditions: ['version_is_frozen', 'approval_is_resolved'], auditAction: 'quote.document.requested', outboxEvent: 'QUOTE.DOCUMENT_REQUESTED', visibleStage: 'PREPARANDO_DOCUMENTO' },
  { id: 'document.ready', entity: 'GENERATED_DOCUMENT', from: 'PENDING', event: 'completeQuoteDocument', to: 'READY', actor: 'SYSTEM', preconditions: ['private_object_exists', 'sha256_exists', 'snapshot_digest_matches'], auditAction: 'quote.document.ready', outboxEvent: 'QUOTE.DOCUMENT_READY', visibleStage: 'DOCUMENTO_LISTO' },
  { id: 'document.failed', entity: 'GENERATED_DOCUMENT', from: 'PENDING', event: 'failQuoteDocument', to: 'FAILED', actor: 'SYSTEM', preconditions: ['failure_code_is_recorded'], auditAction: 'quote.document.failed', outboxEvent: 'QUOTE.DOCUMENT_FAILED', visibleStage: 'DOCUMENTO_FALLIDO' },
  { id: 'document.retry', entity: 'GENERATED_DOCUMENT', from: 'FAILED', event: 'retryQuoteDocument', to: 'PENDING', actor: 'STAFF', preconditions: ['retry_is_idempotent'], auditAction: 'quote.document.retry_requested', outboxEvent: 'QUOTE.DOCUMENT_REQUESTED', visibleStage: 'PREPARANDO_DOCUMENTO' },
  { id: 'document.invalidate', entity: 'GENERATED_DOCUMENT', from: 'READY', event: 'returnQuoteToDraft', to: 'INVALIDATED', actor: 'SYSTEM', preconditions: ['version_content_changed'], auditAction: 'quote.document.invalidated', outboxEvent: null, visibleStage: 'DOCUMENTO_INVALIDADO' },
  { id: 'publication.prepare', entity: 'QUOTE_PUBLICATION', from: 'NOT_PUBLISHED', event: 'prepareQuotePublication', to: 'PREPARED', actor: 'STAFF', preconditions: ['pdf_is_ready', 'active_terms_selected', 'recipient_snapshot_is_frozen'], auditAction: 'quote.publication.prepared', outboxEvent: null, visibleStage: 'PREPARADA_PARA_PUBLICAR' },
  { id: 'publication.publish', entity: 'QUOTE_PUBLICATION', from: 'PREPARED', event: 'publishQuote', to: 'PUBLISHED', actor: 'STAFF', preconditions: ['explicit_confirmation', 'preflight_digest_matches'], auditAction: 'quote.publication.published', outboxEvent: 'QUOTE.PUBLISHED', visibleStage: 'PUBLICADA' },
  { id: 'publication.replace', entity: 'QUOTE_PUBLICATION', from: 'PUBLISHED', event: 'publishReplacement', to: 'REPLACED', actor: 'SYSTEM', preconditions: ['replacement_publication_is_successful'], auditAction: 'quote.publication.replaced', outboxEvent: 'QUOTE.PUBLICATION_REPLACED', visibleStage: 'REEMPLAZADA' },
  { id: 'publication.cancel', entity: 'QUOTE_PUBLICATION', from: 'PREPARED', event: 'cancelPublication', to: 'CANCELLED', actor: 'STAFF', preconditions: ['reason_is_present'], auditAction: 'quote.publication.cancelled', outboxEvent: null, visibleStage: 'PUBLICACION_CANCELADA' },
  { id: 'delivery.queue', entity: 'NOTIFICATION_DELIVERY', from: 'NONE', event: 'enqueuePublicationNotice', to: 'QUEUED', actor: 'SYSTEM', preconditions: ['publication_is_published', 'recipient_snapshot_is_frozen'], auditAction: 'notification.delivery.queued', outboxEvent: 'NOTIFICATION.QUEUED', visibleStage: 'AVISO_EN_COLA' },
  { id: 'delivery.send', entity: 'NOTIFICATION_DELIVERY', from: 'QUEUED', event: 'deliverPublicationNotice', to: 'SENT', actor: 'SYSTEM', preconditions: ['provider_accepts_message'], auditAction: 'notification.delivery.sent', outboxEvent: null, visibleStage: 'AVISO_ENVIADO' },
  { id: 'delivery.fail', entity: 'NOTIFICATION_DELIVERY', from: 'QUEUED', event: 'failPublicationNotice', to: 'FAILED', actor: 'SYSTEM', preconditions: ['failure_code_is_recorded'], auditAction: 'notification.delivery.failed', outboxEvent: null, visibleStage: 'AVISO_FALLIDO' },
  { id: 'delivery.retry', entity: 'NOTIFICATION_DELIVERY', from: 'FAILED', event: 'retryPublicationNotice', to: 'QUEUED', actor: 'STAFF', preconditions: ['retry_is_idempotent'], auditAction: 'notification.delivery.retried', outboxEvent: null, visibleStage: 'AVISO_EN_COLA' },
  { id: 'delivery.cancel', entity: 'NOTIFICATION_DELIVERY', from: 'QUEUED', event: 'cancelPublicationNotice', to: 'CANCELLED', actor: 'STAFF', preconditions: ['reason_is_present'], auditAction: 'notification.delivery.cancelled', outboxEvent: null, visibleStage: 'AVISO_CANCELADO' },
  { id: 'acceptance.accept', entity: 'QUOTE_ACCEPTANCE', from: 'NOT_ACCEPTED', event: 'acceptPublishedQuote', to: 'ACCEPTED', actor: 'CUSTOMER', preconditions: ['version_equals_published_pointer', 'document_sha256_matches', 'terms_hash_matches', 'idempotency_payload_matches'], auditAction: 'quote.acceptance.recorded', outboxEvent: 'QUOTE.ACCEPTED', visibleStage: 'ACEPTADA' },
  { id: 'project.create', entity: 'PROJECT', from: 'NOT_CREATED', event: 'createProjectFromAcceptance', to: 'ACTIVE', actor: 'STAFF', preconditions: ['accepted_publication_exists', 'project_contract_is_enabled', 'idempotency_payload_matches'], auditAction: 'project.created', outboxEvent: 'PROJECT.CREATED', visibleStage: 'PROYECTO_ACTIVO' },
  { id: 'project.close', entity: 'PROJECT', from: 'ACTIVE', event: 'closeProject', to: 'CLOSED', actor: 'STAFF', preconditions: ['close_reason_is_present'], auditAction: 'project.closed', outboxEvent: 'PROJECT.CLOSED', visibleStage: 'PROYECTO_CERRADO' },
] as const satisfies readonly TargetTransition[];

export const TARGET_OWNERSHIP = [
  { entity: 'QUOTE_REQUEST', truth: 'intake_and_qualification', source: 'QuoteRequest', editableBy: ['STAFF', 'SALES', 'MANAGER', 'ADMIN'], customerVisible: true },
  { entity: 'QUOTE_VERSION', truth: 'working_and_published_snapshots', source: 'QuoteVersion', editableBy: ['STAFF', 'SALES', 'MANAGER', 'ADMIN'], customerVisible: false },
  { entity: 'QUOTE_APPROVAL', truth: 'approval_for_exact_digest', source: 'QuoteApproval', editableBy: ['MANAGER', 'ADMIN'], customerVisible: false },
  { entity: 'COMMERCIAL_TERMS', truth: 'approved_immutable_terms', source: 'CommercialTermsVersion', editableBy: ['ADMIN'], customerVisible: true },
  { entity: 'GENERATED_DOCUMENT', truth: 'verifiable_private_document', source: 'GeneratedDocument', editableBy: ['SYSTEM', 'STAFF', 'MANAGER', 'ADMIN'], customerVisible: true },
  { entity: 'QUOTE_PUBLICATION', truth: 'deliberate_customer_publication', source: 'QuotePublication', editableBy: ['STAFF', 'MANAGER', 'ADMIN'], customerVisible: true },
  { entity: 'NOTIFICATION_DELIVERY', truth: 'provider_delivery_state', source: 'NotificationDelivery', editableBy: ['SYSTEM', 'MANAGER', 'ADMIN'], customerVisible: false },
  { entity: 'QUOTE_ACCEPTANCE', truth: 'customer_decision_on_published_version', source: 'QuoteAcceptance', editableBy: ['CUSTOMER', 'SYSTEM'], customerVisible: true },
  { entity: 'PROJECT', truth: 'commercial_handoff', source: 'Project', editableBy: ['STAFF', 'MANAGER', 'ADMIN'], customerVisible: false },
] as const satisfies readonly Readonly<{ entity: WorkflowEntity; truth: string; source: string; editableBy: readonly WorkflowActor[]; customerVisible: boolean }>[];

export const LEGACY_STATUS_MAPPINGS = [
  { entity: 'QUOTE_REQUEST', legacyStatus: 'EN_ELABORACION', targetOwner: 'QUOTE_VERSION', targetMeaning: 'working_version_exists', forbiddenMeaning: 'published_quote' },
  { entity: 'QUOTE_REQUEST', legacyStatus: 'COTIZACION_DISPONIBLE', targetOwner: 'QUOTE_PUBLICATION', targetMeaning: 'derived_only_when_publication_exists', forbiddenMeaning: 'request_lifecycle_state' },
  { entity: 'QUOTE_REQUEST', legacyStatus: 'EN_NEGOCIACION', targetOwner: 'QUOTE_REQUEST + conversation', targetMeaning: 'change_request_or_conversation', forbiddenMeaning: 'quote_version_state_copy' },
  { entity: 'QUOTE_REQUEST', legacyStatus: 'PENDIENTE_DE_APROBACION', targetOwner: 'QUOTE_APPROVAL', targetMeaning: 'legacy_acceptance_bridge_only', forbiddenMeaning: 'discount_approval' },
  { entity: 'QUOTE_REQUEST', legacyStatus: 'ACEPTADA', targetOwner: 'QUOTE_ACCEPTANCE', targetMeaning: 'derived_from_exact_acceptance', forbiddenMeaning: 'implicit_customer_acceptance' },
  { entity: 'QUOTE_REQUEST', legacyStatus: 'VENCIDA', targetOwner: 'QUOTE_VERSION', targetMeaning: 'published_version_expired', forbiddenMeaning: 'block_new_working_version' },
  { entity: 'QUOTE_VERSION', legacyStatus: 'ENVIADA', targetOwner: 'QUOTE_PUBLICATION', targetMeaning: 'legacy_sent_mapping_requires_reconciliation', forbiddenMeaning: 'pdf_ready_proof' },
] as const;

export const INVARIANT_CATALOG = [
  { id: 'working_published_distinct', statement: 'workingVersionId and publishedVersionId have different meanings and are never substituted.' },
  { id: 'published_only_portal', statement: 'The portal starts from an intentional publication, never from an editable status.' },
  { id: 'snapshot_everywhere', statement: 'Staff, portal, PDF and acceptance use the same immutable commercial snapshot.' },
  { id: 'pdf_before_publication', statement: 'A verified private PDF and matching preflight precede publication and notification.' },
  { id: 'server_owned_actions', statement: 'The server projects legal actions and blockers; the UI is not a state-machine authority.' },
  { id: 'terms_server_owned', statement: 'The server selects active immutable terms and stores their hash with acceptance.' },
  { id: 'approval_exact_digest', statement: 'Approval belongs to the exact version/revision/digest and cannot approve a changed payload.' },
  { id: 'idempotency_payload_bound', statement: 'A reused idempotency key with another payload is rejected.' },
  { id: 'customer_scope', statement: 'Every customer read/mutation proves customer type, client scope and portal.self.read.' },
  { id: 'expiry_is_cloneable', statement: 'Expiry closes a published version but never blocks a new working version.' },
  { id: 'approval_not_request_status', statement: 'PENDIENTE_DE_APROBACION is never reused as discount approval or acceptance proof.' },
] as const;

export type LifecycleFacts = Readonly<{
  requestStatus: string;
  workingVersion: 'NONE' | 'V1' | 'V2';
  publishedVersion: 'NONE' | 'V1' | 'V2';
  approval: string;
  document: string;
  publication: string;
  delivery: string;
  terms: 'ACTIVE' | 'MISSING' | 'NOT_APPLICABLE';
  message: 'NONE' | 'DRAFT' | 'SENT' | 'RECEIVED';
  actor: WorkflowActor;
  customerScope: 'OWN' | 'OTHER' | 'NONE';
}>;

export type TruthCase = Readonly<{
  id: string;
  kind: CaseKind;
  description: string;
  facts: LifecycleFacts;
  expected: Readonly<{
    stage: string;
    actorExpected: WorkflowActor;
    primaryAction: ActionKey | null;
    blockers: readonly BlockerKey[];
    visiblePublishedVersion: 'NONE' | 'V1' | 'V2';
    canAccept: boolean;
    effects: readonly string[];
  }>;
}>;

export const TRUTH_CASES: readonly TruthCase[] = [
  { id: 'request-new', kind: 'VALID', description: 'A new unassigned request is ready for staff ownership.', facts: { requestStatus: 'RECIBIDA', workingVersion: 'NONE', publishedVersion: 'NONE', approval: 'NOT_REQUIRED', document: 'NOT_CREATED', publication: 'NOT_PUBLISHED', delivery: 'NONE', terms: 'NOT_APPLICABLE', message: 'NONE', actor: 'STAFF', customerScope: 'NONE' }, expected: { stage: 'NUEVA_SOLICITUD', actorExpected: 'STAFF', primaryAction: 'claim_request', blockers: [], visiblePublishedVersion: 'NONE', canAccept: false, effects: ['audit', 'request_status'] } },
  { id: 'request-information', kind: 'VALID', description: 'Staff asks for missing information with a message in the same action.', facts: { requestStatus: 'EN_REVISION', workingVersion: 'NONE', publishedVersion: 'NONE', approval: 'NOT_REQUIRED', document: 'NOT_CREATED', publication: 'NOT_PUBLISHED', delivery: 'NONE', terms: 'NOT_APPLICABLE', message: 'DRAFT', actor: 'STAFF', customerScope: 'NONE' }, expected: { stage: 'INFORMACION_INCOMPLETA', actorExpected: 'STAFF', primaryAction: 'request_information', blockers: [], visiblePublishedVersion: 'NONE', canAccept: false, effects: ['audit', 'outbox', 'request_status'] } },
  { id: 'customer-waiting', kind: 'VALID', description: 'The information request is sent and staff waits for the customer.', facts: { requestStatus: 'INFORMACION_REQUERIDA', workingVersion: 'NONE', publishedVersion: 'NONE', approval: 'NOT_REQUIRED', document: 'NOT_CREATED', publication: 'NOT_PUBLISHED', delivery: 'SENT', terms: 'NOT_APPLICABLE', message: 'SENT', actor: 'CUSTOMER', customerScope: 'OWN' }, expected: { stage: 'ESPERANDO_CLIENTE', actorExpected: 'CUSTOMER', primaryAction: null, blockers: [], visiblePublishedVersion: 'NONE', canAccept: false, effects: ['audit'] } },
  { id: 'customer-response', kind: 'VALID', description: 'A customer response returns the request to staff review.', facts: { requestStatus: 'INFORMACION_REQUERIDA', workingVersion: 'NONE', publishedVersion: 'NONE', approval: 'NOT_REQUIRED', document: 'NOT_CREATED', publication: 'NOT_PUBLISHED', delivery: 'SENT', terms: 'NOT_APPLICABLE', message: 'RECEIVED', actor: 'STAFF', customerScope: 'NONE' }, expected: { stage: 'RESPUESTA_RECIBIDA', actorExpected: 'STAFF', primaryAction: 'review_customer_response', blockers: [], visiblePublishedVersion: 'NONE', canAccept: false, effects: ['audit', 'request_status'] } },
  { id: 'request-ready-for-quote', kind: 'VALID', description: 'A qualified request has no working version yet.', facts: { requestStatus: 'LISTA_PARA_COTIZAR', workingVersion: 'NONE', publishedVersion: 'NONE', approval: 'NOT_REQUIRED', document: 'NOT_CREATED', publication: 'NOT_PUBLISHED', delivery: 'NONE', terms: 'NOT_APPLICABLE', message: 'NONE', actor: 'STAFF', customerScope: 'NONE' }, expected: { stage: 'PREPARAR_PROPUESTA', actorExpected: 'STAFF', primaryAction: 'add_first_quote_line', blockers: [], visiblePublishedVersion: 'NONE', canAccept: false, effects: ['audit'] } },
  { id: 'quote-draft', kind: 'VALID', description: 'A valid draft is ready to enter review.', facts: { requestStatus: 'LISTA_PARA_COTIZAR', workingVersion: 'V1', publishedVersion: 'NONE', approval: 'NOT_REQUIRED', document: 'NOT_CREATED', publication: 'NOT_PUBLISHED', delivery: 'NONE', terms: 'NOT_APPLICABLE', message: 'NONE', actor: 'STAFF', customerScope: 'NONE' }, expected: { stage: 'BORRADOR_GUARDADO', actorExpected: 'STAFF', primaryAction: 'submit_quote_for_review', blockers: [], visiblePublishedVersion: 'NONE', canAccept: false, effects: ['audit'] } },
  { id: 'approval-waiting', kind: 'VALID', description: 'An exact digest requires manager approval.', facts: { requestStatus: 'LISTA_PARA_COTIZAR', workingVersion: 'V1', publishedVersion: 'NONE', approval: 'REQUESTED', document: 'NOT_CREATED', publication: 'NOT_PUBLISHED', delivery: 'NONE', terms: 'NOT_APPLICABLE', message: 'NONE', actor: 'MANAGER', customerScope: 'NONE' }, expected: { stage: 'ESPERANDO_APROBACION', actorExpected: 'MANAGER', primaryAction: 'resolve_quote_approval', blockers: [], visiblePublishedVersion: 'NONE', canAccept: false, effects: ['audit', 'outbox'] } },
  { id: 'document-failed', kind: 'VALID', description: 'A frozen approved version has a recoverable document failure.', facts: { requestStatus: 'LISTA_PARA_COTIZAR', workingVersion: 'V1', publishedVersion: 'NONE', approval: 'APPROVED', document: 'FAILED', publication: 'NOT_PUBLISHED', delivery: 'NONE', terms: 'ACTIVE', message: 'NONE', actor: 'STAFF', customerScope: 'NONE' }, expected: { stage: 'DOCUMENTO_REQUIERE_ATENCION', actorExpected: 'STAFF', primaryAction: 'retry_quote_document', blockers: [], visiblePublishedVersion: 'NONE', canAccept: false, effects: ['audit', 'outbox'] } },
  { id: 'ready-to-publish', kind: 'VALID', description: 'The exact PDF, terms and recipient preflight are ready.', facts: { requestStatus: 'LISTA_PARA_COTIZAR', workingVersion: 'V1', publishedVersion: 'NONE', approval: 'NOT_REQUIRED', document: 'READY', publication: 'PREPARED', delivery: 'NONE', terms: 'ACTIVE', message: 'NONE', actor: 'STAFF', customerScope: 'NONE' }, expected: { stage: 'LISTA_PARA_PUBLICAR', actorExpected: 'STAFF', primaryAction: 'publish_quote', blockers: [], visiblePublishedVersion: 'NONE', canAccept: false, effects: ['audit'] } },
  { id: 'published-delivery-queued', kind: 'VALID', description: 'Publication is complete and notification delivery is queued separately.', facts: { requestStatus: 'LISTA_PARA_COTIZAR', workingVersion: 'V1', publishedVersion: 'V1', approval: 'NOT_REQUIRED', document: 'READY', publication: 'PUBLISHED', delivery: 'QUEUED', terms: 'ACTIVE', message: 'NONE', actor: 'SYSTEM', customerScope: 'NONE' }, expected: { stage: 'PROPUESTA_PUBLICADA', actorExpected: 'SYSTEM', primaryAction: null, blockers: [], visiblePublishedVersion: 'V1', canAccept: true, effects: ['audit', 'outbox', 'delivery'] } },
  { id: 'delivery-failed', kind: 'VALID', description: 'A delivery failure does not unpublish the proposal.', facts: { requestStatus: 'LISTA_PARA_COTIZAR', workingVersion: 'NONE', publishedVersion: 'V1', approval: 'NOT_REQUIRED', document: 'READY', publication: 'PUBLISHED', delivery: 'FAILED', terms: 'ACTIVE', message: 'NONE', actor: 'STAFF', customerScope: 'NONE' }, expected: { stage: 'AVISO_FALLIDO', actorExpected: 'STAFF', primaryAction: 'retry_delivery', blockers: [], visiblePublishedVersion: 'V1', canAccept: true, effects: ['audit'] } },
  { id: 'new-working-keeps-published', kind: 'VALID', description: 'A new working version does not remove the last published version.', facts: { requestStatus: 'LISTA_PARA_COTIZAR', workingVersion: 'V2', publishedVersion: 'V1', approval: 'NOT_REQUIRED', document: 'NOT_CREATED', publication: 'PUBLISHED', delivery: 'SENT', terms: 'ACTIVE', message: 'NONE', actor: 'STAFF', customerScope: 'NONE' }, expected: { stage: 'REVISANDO_CAMBIOS', actorExpected: 'STAFF', primaryAction: 'create_working_version', blockers: [], visiblePublishedVersion: 'V1', canAccept: true, effects: ['audit'] } },
  { id: 'customer-change-request', kind: 'VALID', description: 'Customer asks for a change against the published version.', facts: { requestStatus: 'LISTA_PARA_COTIZAR', workingVersion: 'NONE', publishedVersion: 'V1', approval: 'NOT_REQUIRED', document: 'READY', publication: 'PUBLISHED', delivery: 'SENT', terms: 'ACTIVE', message: 'RECEIVED', actor: 'STAFF', customerScope: 'NONE' }, expected: { stage: 'CAMBIOS_SOLICITADOS', actorExpected: 'STAFF', primaryAction: 'create_working_version', blockers: [], visiblePublishedVersion: 'V1', canAccept: true, effects: ['audit', 'outbox'] } },
  { id: 'published-decision', kind: 'VALID', description: 'The customer sees the exact published proposal and may decide.', facts: { requestStatus: 'LISTA_PARA_COTIZAR', workingVersion: 'NONE', publishedVersion: 'V1', approval: 'NOT_REQUIRED', document: 'READY', publication: 'PUBLISHED', delivery: 'SENT', terms: 'ACTIVE', message: 'NONE', actor: 'CUSTOMER', customerScope: 'OWN' }, expected: { stage: 'ESPERANDO_DECISION', actorExpected: 'CUSTOMER', primaryAction: 'accept_published_quote', blockers: [], visiblePublishedVersion: 'V1', canAccept: true, effects: ['audit'] } },
  { id: 'expired-version', kind: 'VALID', description: 'An expired publication can be cloned without reopening its evidence.', facts: { requestStatus: 'LISTA_PARA_COTIZAR', workingVersion: 'NONE', publishedVersion: 'V1', approval: 'NOT_REQUIRED', document: 'READY', publication: 'PUBLISHED', delivery: 'SENT', terms: 'ACTIVE', message: 'NONE', actor: 'STAFF', customerScope: 'NONE' }, expected: { stage: 'PROPUESTA_VENCIDA', actorExpected: 'STAFF', primaryAction: 'clone_expired_version', blockers: [], visiblePublishedVersion: 'V1', canAccept: false, effects: ['audit'] } },
  { id: 'accepted-handoff', kind: 'VALID', description: 'An accepted exact publication can start a real project handoff.', facts: { requestStatus: 'LISTA_PARA_COTIZAR', workingVersion: 'NONE', publishedVersion: 'V1', approval: 'NOT_REQUIRED', document: 'READY', publication: 'PUBLISHED', delivery: 'SENT', terms: 'ACTIVE', message: 'NONE', actor: 'STAFF', customerScope: 'NONE' }, expected: { stage: 'ACEPTADA', actorExpected: 'STAFF', primaryAction: 'create_project_from_acceptance', blockers: [], visiblePublishedVersion: 'V1', canAccept: false, effects: ['audit', 'outbox'] } },
  { id: 'missing-message', kind: 'INVALID', description: 'Information cannot be requested with an empty message.', facts: { requestStatus: 'EN_REVISION', workingVersion: 'NONE', publishedVersion: 'NONE', approval: 'NOT_REQUIRED', document: 'NOT_CREATED', publication: 'NOT_PUBLISHED', delivery: 'NONE', terms: 'NOT_APPLICABLE', message: 'NONE', actor: 'STAFF', customerScope: 'NONE' }, expected: { stage: 'INFORMACION_INCOMPLETA', actorExpected: 'STAFF', primaryAction: null, blockers: ['MESSAGE_REQUIRED'], visiblePublishedVersion: 'NONE', canAccept: false, effects: ['diagnostic'] } },
  { id: 'publish-without-document', kind: 'INVALID', description: 'A publication cannot proceed while its document is not ready.', facts: { requestStatus: 'LISTA_PARA_COTIZAR', workingVersion: 'V1', publishedVersion: 'NONE', approval: 'NOT_REQUIRED', document: 'PENDING', publication: 'NOT_PUBLISHED', delivery: 'NONE', terms: 'ACTIVE', message: 'NONE', actor: 'STAFF', customerScope: 'NONE' }, expected: { stage: 'PREPARANDO_DOCUMENTO', actorExpected: 'SYSTEM', primaryAction: 'retry_quote_document', blockers: ['DOCUMENT_NOT_READY'], visiblePublishedVersion: 'NONE', canAccept: false, effects: ['diagnostic'] } },
  { id: 'approval-separation', kind: 'INVALID', description: 'The requester cannot approve the same exact digest.', facts: { requestStatus: 'LISTA_PARA_COTIZAR', workingVersion: 'V1', publishedVersion: 'NONE', approval: 'REQUESTED', document: 'NOT_CREATED', publication: 'NOT_PUBLISHED', delivery: 'NONE', terms: 'NOT_APPLICABLE', message: 'NONE', actor: 'STAFF', customerScope: 'NONE' }, expected: { stage: 'ESPERANDO_APROBACION', actorExpected: 'MANAGER', primaryAction: null, blockers: ['SEPARATION_OF_DUTIES'], visiblePublishedVersion: 'NONE', canAccept: false, effects: ['diagnostic'] } },
  { id: 'foreign-customer', kind: 'INVALID', description: 'A customer from another client cannot read or accept this publication.', facts: { requestStatus: 'LISTA_PARA_COTIZAR', workingVersion: 'NONE', publishedVersion: 'V1', approval: 'NOT_REQUIRED', document: 'READY', publication: 'PUBLISHED', delivery: 'SENT', terms: 'ACTIVE', message: 'NONE', actor: 'CUSTOMER', customerScope: 'OTHER' }, expected: { stage: 'NO_DISPONIBLE', actorExpected: 'NONE', primaryAction: null, blockers: ['CLIENT_SCOPE'], visiblePublishedVersion: 'NONE', canAccept: false, effects: ['diagnostic'] } },
  { id: 'stale-acceptance', kind: 'INVALID', description: 'Acceptance of a replaced or working version is rejected.', facts: { requestStatus: 'LISTA_PARA_COTIZAR', workingVersion: 'V2', publishedVersion: 'V1', approval: 'NOT_REQUIRED', document: 'READY', publication: 'PREPARED', delivery: 'NONE', terms: 'ACTIVE', message: 'NONE', actor: 'CUSTOMER', customerScope: 'OWN' }, expected: { stage: 'PROPUESTA_NO_PUBLICADA', actorExpected: 'CUSTOMER', primaryAction: null, blockers: ['PUBLISHED_VERSION_MISMATCH'], visiblePublishedVersion: 'V1', canAccept: false, effects: ['diagnostic'] } },
  { id: 'changed-idempotency-payload', kind: 'INVALID', description: 'Reusing an idempotency key with another payload is rejected.', facts: { requestStatus: 'LISTA_PARA_COTIZAR', workingVersion: 'NONE', publishedVersion: 'V1', approval: 'NOT_REQUIRED', document: 'READY', publication: 'PUBLISHED', delivery: 'SENT', terms: 'ACTIVE', message: 'NONE', actor: 'CUSTOMER', customerScope: 'OWN' }, expected: { stage: 'ESPERANDO_DECISION', actorExpected: 'CUSTOMER', primaryAction: null, blockers: ['IDEMPOTENCY_PAYLOAD_MISMATCH'], visiblePublishedVersion: 'V1', canAccept: false, effects: ['diagnostic'] } },
] as const satisfies readonly TruthCase[];

export const ALL_CURRENT_STATUS_VALUES = CURRENT_STATE_INVENTORY.flatMap((entry) => entry.currentStatuses);

