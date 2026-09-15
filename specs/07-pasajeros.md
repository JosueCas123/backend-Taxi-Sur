# SPEC 07 - Pasajeros

> **Estado:** Implementado
> **Depende de:** SPEC 02 (`02-migracion-schema-prisma.md`), SPEC 03 (`03-base-auth-admin.md`)
> **Fecha:** 2026-09-15
> **Objetivo:** Permitir a n8n identificar pasajeros por WhatsApp y registrar su primera aceptacion del aviso de privacidad de forma segura e idempotente.

## 1. Contexto

Las rutas de archivos son relativas a `backend/`.
Esta entrega corresponde al modulo 4 de `docs/ROADMAP_ENDPOINTS.md`, endpoints #14 y #15.
Se usan tambien `docs/REGLAS_DE_NEGOCIO.md`, `docs/MODELO_DE_DATOS.md` y `docs/ARQUITECTURA.md` como referencias.
El modelo Prisma existente y las convenciones del backend guian los detalles tecnicos.
La numeracion de specs no coincide con la numeracion de modulos del roadmap.

El pasajero no es un `Usuario`: no tiene rol, PIN ni JWT.
n8n identifica al remitente de WhatsApp y llama al backend; no decide directamente sobre la persistencia.
La exigencia de aceptar el aviso antes de solicitar un taxi proviene del roadmap.
La Regla 1 (una solicitud activa por pasajero) corresponde al futuro modulo de solicitudes.

## 2. Alcance

**Incluye:**

- `POST /api/pasajeros/identificar`, exclusivo para n8n.
- `PATCH /api/pasajeros/:id/aceptar-aviso`, exclusivo para n8n.
- Validacion estricta, DTO explicito y errores JSON consistentes con la API.
- Identificacion segura frente a reintentos y llamadas concurrentes.
- Conservacion de la primera fecha de aceptacion, incluso ante concurrencia.
- Tratamiento explicito de pasajeros eliminados logicamente.
- Pruebas unitarias y HTTP con persistencia en una base de pruebas separada.
- Documentacion del contrato para el consumidor n8n en el README del backend.

**NO incluye:**

- Crear solicitudes ni implementar el bloqueo de solicitudes sin consentimiento.
- Flujos de n8n, conexion con Meta, envio de mensajes o redaccion legal del aviso.
- Versionado del aviso, evidencia adicional del consentimiento o revocacion.
- Listado, edicion, eliminacion o restauracion de pasajeros.
- Crear cuentas en `usuarios`, sesiones o autenticacion propia para pasajeros.
- Nuevas tablas, migraciones, dependencias npm o modificaciones en `docs/`.

## 3. Modelo de datos y contratos

Se reutiliza `Pasajero` de SPEC 02 sin nuevas estructuras persistentes:

| Campo Prisma | Persistencia | Uso |
|---|---|---|
| `id` | UUID, clave primaria | Identificador de recurso para el PATCH |
| `whatsappId` | String unico, columna `whatsapp_id` | Identidad recibida desde Meta |
| `nombre` | String requerido | Nombre capturado al crear |
| `aceptacionAvisoPrivacidad` | DateTime nullable | Primera aceptacion; inicialmente `null` |
| `creadoEn` | DateTime, default actual | Fecha de creacion |
| `eliminadoEn` | DateTime nullable | Borrado logico |

La unicidad de `whatsappId` incluye registros eliminados logicamente.
No se crea otra fila ni se restaura una existente para evadir esa restriccion.

### 3.1. Autorizacion comun

Ambos endpoints requieren un `X-N8N-Token` valido usando el secreto y la comprobacion existentes.
No se aceptan JWT de administradores ni de conductores como autorizacion para estos endpoints.
Se agrega `requireN8n` en `src/middlewares/auth.ts`, reutilizando la autenticacion existente y verificando `req.auth.source`.
No se modifica el comportamiento de las rutas actuales ni se introduce un segundo secreto.

- Credenciales ausentes o invalidas: `401 UNAUTHORIZED`.
- JWT valido sin credencial n8n: `403 FORBIDDEN`.
- Un header n8n incorrecto no se rescata mediante un JWT valido, conforme a la precedencia existente.
- Autorizacion antes de la validacion del recurso y del cuerpo en el controlador.
- El parser JSON global mantiene su comportamiento actual para JSON malformado.
- No registrar tokens ni cuerpos con identificadores personales en logs nuevos.

### 3.2. DTO de respuesta

Ambos endpoints devuelven directamente el mismo `PasajeroDto`, sin campos internos ni relaciones:

```json
{
  "id": "d9428888-122b-4e1f-b85c-61cd3cbb3210",
  "whatsappId": "59170000000",
  "nombre": "Ana Perez",
  "aceptacionAvisoPrivacidad": null,
  "creadoEn": "2026-09-15T12:00:00.000Z"
}
```

Las fechas se serializan como ISO 8601 en UTC.
Despues de aceptar, `aceptacionAvisoPrivacidad` contiene una fecha con ese formato.
No se expone `eliminadoEn` ni se incluye una bandera de creacion.

### 3.3. POST /api/pasajeros/identificar

Cuerpo JSON estricto:

```json
{
  "whatsappId": "59170000000",
  "nombre": "Ana Perez"
}
```

| Campo | Validacion |
|---|---|
| `whatsappId` | String no vacio compuesto exclusivamente por digitos ASCII (`^[0-9]+$`) |
| `nombre` | String obligatorio; aplicar trim y rechazar si queda vacio |

`whatsappId` representa el `wa_id` de Meta con codigo de pais.
No se convierte a numero, no se normaliza y no se admiten `+`, espacios ni sufijos.
No se intenta validar que el identificador pertenezca realmente a una cuenta de WhatsApp.
`nombre` se exige incluso cuando el pasajero ya existe.
Se rechazan claves desconocidas, tipos incorrectos, cuerpos ausentes, arrays y `null`.

Comportamiento:

1. Buscar por el identificador unico, incluyendo registros con borrado logico.
2. Si existe activo, devolverlo sin cambiar nombre ni aceptacion.
3. Si existe eliminado, responder `409 PASAJERO_ELIMINADO`.
4. Si no existe, crearlo con el nombre validado y aceptacion `null`.
5. Si otra llamada crea el mismo identificador concurrentemente, recuperar el registro ganador y aplicar las mismas reglas de estado.

La respuesta exitosa siempre es `200` con `PasajeroDto`.
Dos identificaciones concurrentes no crean duplicados ni convierten el conflicto esperado de unicidad en un `500`.
Si llegan nombres distintos simultaneamente, se conserva el nombre de la creacion ganadora.
Solo se recuperan conflictos de unicidad esperados; otros errores de persistencia siguen el manejo de errores internos.

### 3.4. PATCH /api/pasajeros/:id/aceptar-aviso

`:id` es `Pasajero.id`, no un identificador de WhatsApp ni de usuario.
El endpoint acepta ausencia de cuerpo o un objeto JSON vacio `{}`.
Se rechazan campos adicionales, arrays y `null` con `400 VALIDATION_ERROR`.
El consumidor no puede enviar una fecha ni establecer la aceptacion durante la identificacion.

Comportamiento:

1. Un UUID invalido responde `404 NOT_FOUND` sin consultar el recurso.
2. Un pasajero inexistente o eliminado logicamente responde `404 NOT_FOUND`.
3. Si la aceptacion es `null`, guardar la fecha actual del servidor mediante una actualizacion condicional que tambien exija `eliminadoEn = null`.
4. Si ya existe una fecha, conservarla sin cambios.
5. Recuperar el pasajero activo y devolver `200` con su `PasajeroDto` actualizado.

La actualizacion debe ser atomica: no basta leer `null` y despues actualizar incondicionalmente.
Dos aceptaciones concurrentes deben devolver la misma primera fecha persistida.
Si al recuperar el resultado el pasajero ya no esta activo, responder `404`.
n8n debe llamar a este endpoint solo despues de recibir la aceptacion explicita del pasajero; identificarlo no implica consentimiento.

### 3.5. Errores

Mantener el formato existente:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Entrada invalida"
  }
}
```

| HTTP | Codigo | Situacion |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Cuerpo que no cumple el contrato |
| 401 | `UNAUTHORIZED` | Credenciales ausentes o invalidas |
| 403 | `FORBIDDEN` | Identidad JWT valida sin autorizacion n8n |
| 404 | `NOT_FOUND` | UUID invalido, pasajero inexistente o eliminado en aceptar-aviso |
| 409 | `PASAJERO_ELIMINADO` | Identificar un WhatsApp asociado a un pasajero eliminado |
| 500 | `INTERNAL_ERROR` | Fallo inesperado, sin filtrar SQL, stack ni secretos |

## 4. Plan de implementacion

1. Agregar `requireN8n` en `src/middlewares/auth.ts` y cubrir sus permisos en `tests/auth-middleware.test.ts`, conservando los contratos existentes.
2. Crear `src/modules/pasajeros/pasajeros.schema.ts` y `tests/pasajeros.schema.test.ts`; incorporar la suite a la lista explicita de `vitest.unit.config.ts`.
3. Crear `src/modules/pasajeros/pasajeros.service.ts` con seleccion explicita del DTO e identificacion resistente a conflictos concurrentes de unicidad.
4. Completar el servicio con aceptacion condicional y recuperacion del resultado persistido, sin sobrescribir fechas previas.
5. Crear `src/modules/pasajeros/pasajeros.controller.ts` y `src/modules/pasajeros/pasajeros.router.ts`; montar `/api/pasajeros` en `src/app.ts` con los patrones de carga y errores existentes.
6. Agregar `tests/pasajeros.test.ts` con cobertura HTTP, persistencia y concurrencia; reutilizar la infraestructura de base separada y limpiar solamente los registros propios de las pruebas.
7. Actualizar `README.md` con los dos endpoints, ejemplos camelCase, autenticacion n8n y la dependencia pendiente del modulo de solicitudes.

Cada paso debe dejar el proyecto compilable y conservar los endpoints existentes.
No abrir puertos al importar `app.ts` ni realizar conexiones a produccion para verificar la spec.

## 5. Criterios de aceptacion

- [x] Ambos endpoints estan montados y aceptan un `X-N8N-Token` valido.
- [x] Sin credenciales o con token invalido responden `401`.
- [x] Un JWT valido de admin o conductor, sin token n8n, recibe `403` en ambos endpoints.
- [x] Un token n8n incorrecto junto a un JWT valido recibe `401`.
- [x] Identificar un WhatsApp nuevo devuelve `200`, crea una unica fila y deja la aceptacion en `null`.
- [x] Identificar un pasajero existente devuelve el mismo id sin modificar su nombre ni su aceptacion.
- [x] Identificaciones simultaneas del mismo WhatsApp devuelven el mismo id con `200` y dejan una sola fila.
- [x] Identificar un pasajero eliminado devuelve `409 PASAJERO_ELIMINADO` sin restaurarlo ni duplicarlo.
- [x] La identificacion rechaza campos faltantes, desconocidos, tipos incorrectos, nombre vacio y formatos WhatsApp con signos, espacios o sufijos.
- [x] El nombre se guarda sin espacios exteriores y sigue siendo obligatorio para pasajeros existentes.
- [x] Aceptar el aviso por primera vez persiste una fecha del servidor y devuelve `200` con esa fecha.
- [x] Repetir la aceptacion conserva exactamente la fecha original.
- [x] Aceptaciones concurrentes devuelven la misma fecha persistida.
- [x] UUID invalido, pasajero inexistente y pasajero eliminado reciben `404` al aceptar el aviso.
- [x] El PATCH acepta cuerpo ausente o `{}` y rechaza fechas enviadas por el cliente, campos adicionales, arrays y `null`.
- [x] Los DTO contienen solo los campos especificados y serializan fechas en UTC.
- [x] Errores inesperados de persistencia reciben `500` generico sin detalles internos.
- [x] La autenticacion y los endpoints de modulos anteriores conservan su comportamiento.
- [x] `npm run build` termina correctamente.
- [x] `npm run test:unit` incluye las validaciones de pasajeros y termina correctamente.
- [x] `npm test` termina correctamente con `TEST_DATABASE_URL` separada y cubre los escenarios HTTP y concurrentes descritos.
- [x] README documenta que crear solicitudes sin aceptacion debera rechazarse en el modulo 7; este modulo no afirma implementar ese bloqueo.
- [x] No se agregan migraciones, tablas, dependencias npm ni cambios en documentos externos a `backend/`.

## 6. Decisiones tomadas y descartadas

**Confirmadas con el usuario:**

- Usar camelCase en JSON, consistente con la API existente, aunque el roadmap mencione nombres SQL en snake_case.
- Recibir el `wa_id` de Meta como cadena de digitos con codigo de pais, sin `+`, espacios ni sufijos.
- Exigir nombre en cada identificacion y conservar el nombre original si ya existe.
- Rechazar con `409` la identificacion de pasajeros eliminados, sin restauracion automatica.
- Responder `200` tanto al crear como al recuperar; no diferenciar mediante `201`.
- Conservar la primera fecha de aceptacion para soportar reintentos de n8n.

**Detalles del contrato propuestos en este borrador para revision:**

- Acceso exclusivo n8n, conforme a la columna de consumidor del roadmap.
- DTO directo con id, WhatsApp, nombre, aceptacion y fecha de creacion.
- PATCH sin datos de entrada, permitiendo `{}` por comodidad del consumidor.
- Validacion del UUID como `404`, consistente con el modulo de conductores.
- Guardar solo la fecha de consentimiento prevista en el esquema; no ampliar a versionado o evidencia adicional.
- Reutilizar la autenticacion y persistencia actuales sin nuevas dependencias.

## 7. Riesgos

| Riesgo | Mitigacion |
|---|---|
| Reintentos y mensajes simultaneos de n8n | Unicidad en base de datos y recuperacion del registro ganador |
| Sobrescribir la primera aceptacion por concurrencia | Escritura condicional sobre aceptacion null |
| Recuperar pasajeros eliminados por accidente | Consultar su estado y no realizar restauraciones implicitas |
| Exponer datos a JWT no autorizados | Guard exclusivo n8n y pruebas por tipo de credencial |
| Confundir identificacion con consentimiento | Creacion con aceptacion null y PATCH separado |
| Considerar completo el bloqueo de solicitudes | Documentar su implementacion obligatoria en el modulo 7 |
| Tratar una fecha como evidencia legal completa | Mantener el alcance tecnico del MVP sin afirmar cumplimiento legal |
| Ejecutar integracion contra datos reales | Reutilizar la proteccion existente de TEST_DATABASE_URL separada |

## 8. Que NO se implementa en esta spec

- Solicitudes, elegibilidad, asignacion de conductores o tarifas.
- El flujo conversacional o la integracion con WhatsApp Cloud API.
- Administracion, restauracion o eliminacion de pasajeros.
- Avisos versionados, revocacion, auditoria legal o evidencia adicional del consentimiento.
- Cambios en los documentos de referencia fuera del backend.
