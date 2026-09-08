# Fase 8 — PDF comercial y aceptación digital

## Objetivo

Entregar al cliente una propuesta comercial descargable, visualmente cuidada y reproducible desde el snapshot de una versión enviada; después permitir una aceptación explícita dentro del portal, con evidencia técnica auditable y sin afirmar por sí sola equivalencia con una firma electrónica avanzada o un contrato jurídico.

## Alcance

- Generación server-side de PDF comercial para una `QuoteVersion` enviada o posterior.
- Documento determinista: folio, versión, cliente, alcance, líneas snapshot, cantidades, precios, descuentos, impuestos, total, moneda, vigencia, condiciones y versión de plantilla.
- Artefacto privado, inmutable y asociado de forma relacional a `QuoteVersion`; hash SHA-256 de bytes y tamaño verificados antes de marcarlo disponible.
- Descarga autorizada desde portal y staff mediante URL efímera; nunca se entrega un borrador ni se expone storage key.
- Aceptación explícita de la versión vigente desde portal, con confirmación de identidad de sesión, texto de consentimiento, nombre escrito, timestamp, hash del PDF aceptado y metadatos de contexto minimizados.
- Idempotencia y concurrencia: dos clics o dos pestañas no pueden crear dos aceptaciones ni aceptar una versión histórica.
- Historial inmutable de evidencia; una versión aceptada no puede editarse, regenerarse con contenido distinto ni volver a transicionar.

## Decisiones arquitectónicas

1. Se agrega `GeneratedDocument` separado de `FileAttachment`; el PDF no es un upload de usuario y no requiere `uploadedById`.
2. `GeneratedDocument` referencia `QuoteVersion` y `StorageObject`, con unicidad por versión/tipo, estado `PENDING`, `READY` o `FAILED`, hash, tamaño y `templateVersion`.
3. Se reutiliza `PrivateStorage` para conservar bucket privado, URLs efímeras y cleanup físico; la autorización se resuelve por servicio y scope compuesto.
4. El renderer usará `pdf-lib`, que es JavaScript puro, funciona en Node sin dependencias nativas y permite dibujar texto, vectores, imágenes e incorporar fuentes. La plantilla será código versionado, no HTML confiado del cliente.
5. La evidencia de aceptación será `QuoteAcceptance`, única por `quoteVersionId`, relacionada con solicitud+cliente mediante FK compuesto y con snapshot del hash/identidad de documento.
6. La aceptación actualiza `QuoteVersion` y `QuoteRequest` dentro de una única transacción con locks; el cliente sólo puede aceptar `ENVIADA`/`EN_NEGOCIACION`, vigente y disponible.
7. La solicitud de cambio seguirá siendo mensajería; no se crea una mutación informal de precios desde el portal.
8. La aceptación se presenta como evidencia comercial de intención y recepción dentro de OCPOOL. Revisión jurídica posterior definirá si debe complementarse con firma electrónica avanzada, términos específicos o proveedor externo.

## Contratos y permisos

- Agregar capacidades explícitas: `quotes.pdf.read`, `quotes.pdf.generate` y `quotes.accept`.
- Cliente: `quotes.pdf.read` y `quotes.accept` sobre sus expedientes; no genera documentos ni decide versiones.
- Sales/manager/admin: lectura PDF según `quotes.read`; generación sólo en capacidad operativa definida; nunca aceptar en nombre del cliente salvo un flujo jurídico posterior explícito.
- APIs con Zod estricto, same-origin en mutaciones, `no-store`, UUID validado, errores públicos genéricos y ausencia de keys/hashes internos en respuestas.

## Estados

### Documento

`PENDING` → `READY` | `FAILED`; `READY` es inmutable. Un hash o tamaño discrepante invalida la entrega y conserva auditoría del fallo sin exponer detalles al usuario.

### Aceptación

Una sola evidencia por versión. La operación requiere:

- sesión CUSTOMER activa y `clientId` coincidente;
- versión vigente, `ENVIADA` o `EN_NEGOCIACION`;
- fecha `validUntil` ausente o no vencida;
- PDF `READY` con hash coincidente;
- confirmación explícita y nombre escrito normalizado;
- idempotency key limitada y fingerprint persistido, sin guardar la clave cruda.

La transacción cambia la versión a `ACEPTADA`, la solicitud a `ACEPTADA`, registra historial, auditoría y Outbox. Una carrera posterior recibe el mismo resultado idempotente o conflicto seguro; jamás crea una aceptación duplicada.

## UI/UX

- Portal: acción primaria `Descargar propuesta PDF` y acción `Aceptar propuesta` sólo cuando la versión es elegible.
- Antes de aceptar: resumen de versión/total/vigencia, checkbox de confirmación, nombre escrito, aviso de alcance legal y confirmación final.
- Después: estado claro `Aceptada`, fecha, versión y referencia de evidencia; sin botones de editar/aceptar repetidos.
- Estados de documento: preparando, disponible, error recuperable y no disponible por versión.
- Staff: enlace de descarga en cotización/inbox, estado PDF y evidencia de aceptación sin mostrar datos sensibles de contexto.
- Axe, teclado, focus visible, reduced motion, responsive y no overflow.

## Seguridad y privacidad

- Nunca aceptar por folio, URL, correo, nombre escrito o checkbox aislado; la sesión y el scope backend son obligatorios.
- No usar `quoteId` como autenticación; no confiar en `versionNumber` enviado por el navegador.
- No aceptar una versión que deje de ser current, que esté vencida, que no tenga PDF listo o cuyo hash no coincida.
- IP y user-agent no se guardan crudos; si se requiere contexto, se almacenan fingerprints con finalidad documentada y retención definida.
- El PDF no incluye notas internas, claves, IDs de cliente internos, tokens ni información del scanner.

## Criterios de aceptación de la fase

1. El PDF renderizado desde un snapshot permanece idéntico aunque cambie el catálogo o la cotización posterior.
2. La descarga sólo funciona para el cliente/empleado autorizado y nunca para otra solicitud.
3. La aceptación es transaccional, idempotente, auditable, inmutable y bloquea ediciones posteriores.
4. Los estados incompletos/error no filtran stack traces ni detalles internos.
5. La plantilla se renderiza y revisa visualmente en PNG; extracción de texto y metadata confirman folio, versión, hash y ausencia de placeholders.
6. Unitarias, integración, API, E2E portal/staff, Axe, responsive, typecheck, lint, build, audit y diff check quedan verdes.
