# SPEC 10 - Solicitudes

> **Estado:** Implementado

> **Depende de:** SPEC 02 (`02-migracion-schema-prisma.md`), SPEC 03 (`03-base-auth-admin.md`), SPEC 07 (`07-pasajeros.md`), SPEC 09 (`09-motor-asignacion.md`)
> **Fecha:** 2026-09-16
> **Objetivo:** Implementar el ciclo de vida completo de una solicitud de taxi (creacion, seleccion de conductor, respuesta, expiracion, finalizacion y consulta), aplicando las Reglas 1, 5, 6, 7, 8 y 10.

## 1. Contexto

Las rutas de archivos son relativas a `backend/`.
Esta entrega corresponde al modulo 7 de `docs/ROADMAP_ENDPOINTS.md`, endpoints #19 a #24 (5 endpoints HTTP + 1 job interno).
Se usan tambien `docs/REGLAS_DE_NEGOCIO.md`, `docs/MODELO_DE_DATOS.md` y `docs/ARQUITECTURA.md` como referencias.
El modelo Prisma existente (`Solicitud`, `Conductor`, `Vehiculo`, `Pasajero`) y las convenciones del backend guian los detalles tecnicos.
La numeracion de specs no coincide con la numeracion de modulos del roadmap.

El modulo 6 (SPEC 09) dejo las siguientes responsabilidades pendientes para este modulo:

- Control de transiciones de estado de la solicitud (SPEC 09 no las valida).
- La transicion a `sin_conductor` cuando no hay candidatos (SPEC 09 solo devuelve `candidatos: []`).
- La reutilizacion por servicio interno de `obtenerCandidatos`, sin exponer admin (SPEC 09 no expone admin).

Ademas, `07-pasajeros.md` dejó una dependencia firme: **crear una solicitud de un pasajero que aun no acepto el aviso de privacidad debe rechazarse**.

Es el modulo mas grande del roadmap; por eso se decidio con el usuario (confirmado) una tabla nueva para la Regla 7/8 y un endpoint dedicado para `sin_conductor`.

## 2. Alcance

**Incluye:**

- `POST /api/solicitudes`, exclusivo de n8n, con validacion de aviso de privacidad (SPEC 07) y Regla 1.
- `POST /api/solicitudes/:id/seleccionar-conductor`, exclusivo de n8n, con reserva temporal (Regla 5) y ventana de 1 minuto (Regla 6).
- `POST /api/solicitudes/:id/responder`, solo el conductor asignado, con aceptacion/rechazo (Regla 7).
- Job interno de expiracion (Regla 8) por `setTimeout` por solicitud + barrido al iniciar el servidor.
- `POST /api/solicitudes/:id/finalizar`, solo el conductor asignado del servicio activo (Regla 10).
- `GET /api/solicitudes/:id`, solo n8n o admin, con detalle de pasajero y conductor asignado.
- `POST /api/solicitudes/:id/sin-conductor`, exclusivo de n8n, para marcar la solicitud sin candidatos.
- Nueva tabla `solicitudes_conductores_rechazados` con su migracion, para excluir en re-busquedas a los conductores que rechazaron o expiraron (Regla 7 y 8).
- Extension de `obtenerCandidatos` (SPEC 09) con una lista de exclusion opcional.
- DTOs estrictos y errores JSON consistentes con la API.
- Pruebas unitarias y HTTP sin base de datos, y pruebas de integracion con base de pruebas separada.
- Documentacion del contrato en el README del backend.

**NO incluye:**

- Tarifario ni dashboard (modulo 8).
- Gestión de jornada ni disponibilidad del conductor fuera de lo necesario para liberar/reservar en el flujo (eso pertenece a `conductores`).
- Notificaciones reales (push, WhatsApp) ni Supabase Realtime: se mantiene el patron de stub de SPEC 06.
- Cancelacion de la solicitud por el pasajero.
- Auditoria/historico de estados mas alla de `solicitudes_conductores_rechazados`.
- Indices geoespaciales ni PostGIS.
- Credenciales n8n para los endpoints del conductor, ni credenciales de conductor para los de n8n.

## 3. Modelo de datos y contratos

### 3.1. Nueva tabla (migracion) — Regla 7/8

Se agrega al schema Prisma el modelo:

| Campo Prisma | Persistencia | Uso |
|---|---|---|
| `id` | String UUID, PK | Identificador |
| `solicitudId` | String, FK unica con `conductorId` → `solicitudes.id` | Solicitud a la que aplica la exclusion |
| `conductorId` | String, FK unica con `solicitudId` → `conductores.id` | Conductor excluido |
| `motivo` | enum `MotivoExclusionSolicitud` (`rechazo` \| `expiracion`) | Por que no vuelve a aparecer |
| `creadoEn` | DateTime, default now() | Momento del rechazo/expiración |

- `@@unique([solicitudId, conductorId])`: un conductor se registra una sola vez por solicitud, aunque rechace en ciclos distintos (un segundo rechazo del mismo conductor es imposible porque ya esta excluido).
- Soft delete **no aplica**: es un registro historico de exclusion, sin borrado logico.
- Se agregan las relaciones inversas en `Solicitud` (`conductoresRechazados`) y `Conductor` (`solicitudesRechazadas`).

Migracion: `npx prisma migrate dev --name add_rechazos_e_indice_expiracion`.

En la misma migracion se agrega el indice compuesto `@@index([estado, expiraEn])` a `Solicitud`, para el `barridoInicial` (consulta por `estado = "esperando_respuesta"` y `expiraEn <= now`) y para el dashboard del modulo 8. Con el volumen esperado del MVP no es estrictamente necesario, pero el costo es bajo y evita un escaneo completo si el volumen crece.

**No se agregan otros cambios** a `Solicitud`: sus campos actuales bastan para el ciclo de vida.

### 3.2. Reglas de negocio aplicadas

| Regla | Implementacion |
|---|---|
| 1 (una solicitud activa por pasajero) | Al crear, si el pasajero tiene una solicitud en estado no terminal → `409 SOLICITUD_ACTIVA`. Estados terminales: `finalizada`, `rechazada`, `expirada`, `sin_conductor`. Todo lo demas (`creada`, `buscando`, `conductor_seleccionado`, `esperando_respuesta`, `aceptada`, `en_servicio`) bloquea una nueva vista. |
| 5 (reserva temporal) | Al seleccionar conductor: `conductor.estadoDisponibilidad` → `solicitud_pendiente` y `solicitud.conductorAsignadoId` queda fijado. |
| 6 (1 minuto para responder) | Al seleccionar: `solicitud.expiraEn = now + 60000 ms`. |
| 7 (rechazo excluye solo de esa solicitud) | Al responder con `acepta: false` o al expirar: se inserta `solicitudes_conductores_rechazados` y la solicitud vuelve a `buscando`. El conductor queda `disponible` (se libera), pero `obtenerCandidatos` lo excluye para esa solicitud via `excluirIds`. |
| 8 (expira y nueva busqueda) | El job interno expira solicitudes `esperando_respuesta` con `expiraEn <= now`, inserta la exclusion (motivo `expiracion`) y vuelve a `buscando`. |
| 10 (solo el conductor finaliza) | `finalizar` requiere ser el conductor asignado (`solicitud.conductorAsignado.usuarioId` == `sub` del JWT) y que la solicitud este en `en_servicio`. |
| 11 (jornada al finalizar servicio) | Al finalizar, si `conductor.estadoJornada === "activa"` → disponibilidad `disponible`; si no → `no_disponible`. |

> **Nota sobre el estado inicial:** la solicitud se crea directamente en `buscando`. El estado `creada` del enum no se persiste porque en el flujo real n8n busca candidatos inmediatamente despues de crearla; los pasos intermedios del enum se conservan por fidelidad con el modelo, no como estados observables en el MVP (ver "Registro de rechazos y expiraciones" y §6).

**Estados y transiciones implementadas:**

```
POST /solicitudes                    ─los candidatos─►  (buscando)
buscando
    ├─ seleccionar-conductor  ────────────────────────►  esperando_respuesta (+ expiraEn)
    │      └─ job interno expira_en <= now ─────────────►  buscando (exclusion expiracion)
    │      └─ responder acepta:false ───────────────────►  buscando (exclusion rechazo)
    │      └─ responder acepta:true ────────────────────►  en_servicio
    │      └─ sin-conductor (n8n) ──────────────────────►  sin_conductor
esperando_respuesta
en_servicio
    └─ finalizar (conductor) ──────────────────────────►  finalizada
```

Los estados intermedios `conductor_seleccionado` y `aceptada` existen en el enum `EstadoSolicitud`, pero el MVP **no los persiste como paso separado**: `seleccionar-conductor` pasa directo a `esperando_respuesta` y `responder acepta` pasa directo a `en_servicio` (ver Decisiones).

#### Registro de rechazos y expiraciones

`expirada` y `rechazada` tampoco se persisten como estado de la solicitud en el MVP: al rechazar o expirar, la solicitud vuelve inmediatamente a `buscando`. Para que no haya un hueco de trazabilidad, cada evento queda registrado en `solicitudes_conductores_rechazados`:

| Columna | Valor registrado |
|---|---|
| `solicitudId` | La solicitud afectada |
| `conductorId` | El conductor que rechazo o expiro |
| `motivo` | `rechazo` (respondio `acepta: false`) o `expiracion` (no respondio en 60s) |
| `creadoEn` | Momento del evento (fecha del servidor) |

Este registro es la fuente para reportes ("que solicitudes expiraron o fueron rechazadas, cuando y por quien") y se mantiene incluso cuando la solicitud finalmente llega a `finalizada` o `sin_conductor`. Se referencia en el README.

### 3.3. Autorizacion

| Endpoint | Credencial aceptada | Consecuencia de otras |
|---|---|---|
| `POST /api/solicitudes` | n8n (`requireN8n`) | Admin/conductor (JWT): `403`. Sin credencial / token invalido: `401`. |
| `POST /:id/seleccionar-conductor` | n8n | Admin/conductor (JWT): `403`. Sin credencial: `401`. |
| `POST /:id/sin-conductor` | n8n | Admin/conductor (JWT): `403`. Sin credencial: `401`. |
| `GET /:id` | n8n **o** admin (nuevo guard `requireN8nOrAdmin`) | Conductor (JWT): `403`. Sin credencial: `401`. |
| `POST /:id/responder` | Conductor asignado (`requireAuth` + propietario en el servicio) | Admin, n8n u otro conductor: `403`. Sin credencial: `401`. |
| `POST /:id/finalizar` | Conductor asignado (`requireAuth` + propietario en el servicio) | Admin, n8n u otro conductor: `403`. Sin credencial: `401`. |

- La autorizacion ocurre **antes** de validar el recurso y el cuerpo en el controlador.
- Un conductor no registrado/eliminado (JWT) recibe `401` en `requireAuth` como siempre.
- El guard `requireN8nOrAdmin` se agrega en `src/middlewares/auth.ts` reutilizando `requireAuth` y verificando `req.auth.source === "n8n" || req.auth.rol === "admin"`.
- No se registran tokens ni cuerpos en logs nuevos.

### 3.4. DTOs

`SolicitudDto` (respuestas de crear, seleccionar, responder, finalizar y sin-conductor):

```json
{
  "id": "7a1f2c4e-0000-4000-8000-000000000000",
  "pasajeroId": "d9428888-122b-4e1f-b85c-61cd3cbb3210",
  "conductorAsignadoId": null,
  "estado": "buscando",
  "latitudRecogida": -17.7833,
  "longitudRecogida": -63.1821,
  "destino": "Plaza 24 de Septiembre",
  "expiraEn": null,
  "aceptadaEn": null,
  "finalizadaEn": null,
  "creadoEn": "2026-09-16T12:00:00.000Z"
}
```

- `conductorAsignadoId`, `destino`, `expiraEn`, `aceptadaEn`, `finalizadaEn` pueden ser `null`.
- Fechas ISO 8601 en UTC. No se exponen `eliminadoEn` ni `pasajero` (solo el id).
- `latitudRecogida`/`longitudRecogida` son numeros finitos (mismos rangos que en SPEC 08).

`SolicitudDetalleDto` (respuesta de `GET /:id`): el `SolicitudDto` **mas**:

```json
{
  "pasajero": { "id": "d9428888-122b-4e1f-b85c-61cd3cbb3210", "nombre": "Ana Perez" },
  "conductorAsignado": {
    "id": "8e7acf6d-0e5b-4e6a-9f2a-1c2b3d4e5f60",
    "nombreCompleto": "Juan Perez",
    "vehiculo": {
      "placa": "1234ABC",
      "marca": "Toyota",
      "modelo": "Corolla",
      "color": "Blanco",
      "capacidadPasajeros": 4
    }
  }
}
```

- El `vehiculo` es el activo mas reciente (mismo criterio que SPEC 06/09). `conductorAsignado` y su `vehiculo` son `null` cuando no hay conductor asignado.
- **No se incluye el `telefono` del conductor en ningun DTO**: el pasajero no debe recibir directo el numero (regla de producto, ver `ARQUITECTURA.md` — "compartir telefonos" fuera de alcance), y `GET /:id` tambien lo consume n8n, que podria reenviarlo al pasajero sin filtrar. El admin lo obtiene por `GET /api/conductores/:id` (modulo 6).
- No se exponen `usuarioId`, `eliminadoEn` ni datos internos del pasajero.

### 3.5. POST /api/solicitudes — crear (n8n, endpoint #19)

Cuerpo JSON estricto:

```json
{
  "pasajeroId": "d9428888-122b-4e1f-b85c-61cd3cbb3210",
  "latitudRecogida": -17.7833,
  "longitudRecogida": -63.1821,
  "destino": "Plaza 24 de Septiembre"
}
```

| Campo | Validacion |
|---|---|
| `pasajeroId` | UUID valido |
| `latitudRecogida` | `[-90, 90]`, finito |
| `longitudRecogida` | `[-180, 180]`, finito |
| `destino` | opcional; si se envía, string recortado 1–255 |

Comportamiento:

1. UUID de `pasajeroId` invalido → `400 VALIDATION_ERROR`.
2. Pasajero inexistente o eliminado → `404 NOT_FOUND`.
3. Pasajero sin `aceptacionAvisoPrivacidad` → `409 AVISO_NO_ACEPTADO`.
4. Pasajero con solicitud activa (Regla 1) → `409 SOLICITUD_ACTIVA`.
5. Crear la solicitud con `estado: "buscando"` y `conductorAsignadoId = null` → `201` con `SolicitudDto`.

n8n despues consulta `GET /:id/candidatos` (SPEC 09) para presentar a los tres conductores. Si no hay candidatos, n8n llama a `POST /:id/sin-conductor`.

La validacion de la Regla 1 debe ser **atomica**: crear solo si el pasajero no tiene una solicitud activa (puede implementarse con un `create` racionalizado sobre una consulta previa dentro de la misma transaccion; ver Riesgos).

### 3.6. POST /api/solicitudes/:id/seleccionar-conductor — reservar (n8n, endpoint #20)

Cuerpo JSON estricto:

```json
{ "conductorId": "8e7acf6d-0e5b-4e6a-9f2a-1c2b3d4e5f60" }
```

Comportamiento:

1. UUID invalido en `:id` o `conductorId` → `404` (para `:id`) / `400 VALIDATION_ERROR` (para `conductorId` no UUID).
2. Solicitud inexistente o eliminada → `404 NOT_FOUND`.
3. Solicitud no en `buscando` → `409 ESTADO_INVALIDO`.
4. Conductor no candidato elegible (se reutiliza `obtenerCandidatos(solicitudId, now, [])` internamente y se verifica que `conductorId` este en la lista) → `409 CANDIDATO_INVALIDO`.
5. Reserva atomica: `conductor.estadoDisponibilidad` → `solicitud_pendiente` (solo si el conductor sigue elegible, para evitar condiciones de carrera) y `solicitud` → `conductorAsignadoId`, `estado: "esperando_respuesta"`, `expiraEn = now + 60000`.
6. Se agenda el `setTimeout` de expiracion (Regla 8). → `200` con `SolicitudDto`.

Si en el paso 5 el conductor ya no esta `disponible` (lo perdio otra solicitud), se responde `409 CANDIDATO_INVALIDO` sin reservar.

### 3.7. POST /api/solicitudes/:id/responder — aceptar o rechazar (conductor, endpoint #21)

Cuerpo JSON estricto:

```json
{ "acepta": true }
```

| Campo | Validacion |
|---|---|
| `acepta` | booleano estricto (`true`/`false`, no strings) |

Comportamiento:

1. UUID invalido en `:id` → `404` sin consultar el servicio.
2. Autenticacion `requireAuth`: sin credencial o token invalido → `401`. Admin o n8n → `403` (el servicio no se llama con identidad no-conductor).
3. Cargar la solicitud (incluido el `usuarioId` del conductor asignado). Si no existe o esta eliminada → `404 NOT_FOUND`.
4. Si el conductor autenticado no es el asignado (el `usuarioId` de la solicitud no coincide con el `sub` del JWT) → `403 FORBIDDEN` sin revelar ningun dato del recurso. No es posible verificar la propiedad sin haber cargado la solicitud primero: el paso 3 antecede al 4 para que una solicitud inexistente no distinga el 403 de un `404`.
5. Solicitud no en `esperando_respuesta` → `409 ESTADO_INVALIDO` (si el job ya la expiró o el estado cambio, la actualizacion condicional no aplica).
6. `acepta: true` → `estado: "en_servicio"`, `aceptadaEn = now`, `expiraEn = null`, cancelar timeout; `conductor.estadoDisponibilidad` → `en_servicio`. Se llama al stub `notificarPasajero` con los datos del vehiculo (ver 3.9). → `200` con `SolicitudDto`.
7. `acepta: false` → insertar `solicitudes_conductores_rechazados` (motivo `rechazo`), liberar conductor (`disponible`), solicitud → `buscando`, `conductorAsignadoId = null`, `expiraEn = null`, cancelar timeout. → `200` con `SolicitudDto`.

La transicion debe ser condicional y atomica (exigir `estado: "esperando_respuesta"` en el update) para no sobrescribir una expiracion concurrente.

### 3.8. Job interno — expiracion (Regla 8, "endpoint" #22)

No es HTTP. Se implementa como:

- `programarExpiracion(solicitudId, expiraEn)`: `setTimeout` de `expiraEn - now` ms con `.unref()`; al dispararse ejecuta `expirarSiVencida(solicitudId)`.
- `expirarSiVencida(solicitudId)`: actualizacion condicional de solicitudes `esperando_respuesta` con `eliminadoEn null` **y** `expiraEn <= now` → `buscando`, `conductorAsignadoId null`, `expiraEn null`; e inserta la exclusion (motivo `expiracion`) y libera al conductor (`disponible`). Si la actualizacion no afecta filas (ya cambio de estado), no hace nada (idempotente). Al expirar una solicitud se registra `console.info('[job-expiracion] Solicitud ${solicitudId} expirada (motivo: job interno)')` para facilitar el debugging.
- `cancelarExpiracion(solicitudId)`: se invoca al responder (acepta/rechaza) y al finalizar, para no agendar callbacks obsoletos.
- `barridoInicial()`: al arrancar `src/server.ts`, tras conectar con PostgreSQL, expira las solicitudes `esperando_respuesta` ya vencidas y reprograma las pendientes (`setTimeout` restante) para recuperar reinicios del proceso.

Concurrencia: la actualizacion condicional garantiza que ninguna solicitud se expire dos veces.

Limite: `expiraEn <= now` (exactamente 1 minuto vence). El limite es inclusivo por consistencia con SPEC 08/09.

### 3.9. Notificacion al pasajero (stub, igual que SPEC 06)

`src/modules/solicitudes/notificaciones.ts`:

```ts
// TODO (post-MVP): enviar al pasajero datos del vehiculo del conductor que acepto.
// Por ahora no persiste nada ni falla el endpoint si "falla".
function notificarPasajero(pasajeroId: string, datos: { solicitudId: string; conductorNombre: string; placa: string }) {
  console.log(`[stub] Notificar a pasajero ${pasajeroId}: solicitud ${datos.solicitudId}, conductor ${datos.conductorNombre}, placa ${datos.placa}`);
}
```

No se crea tabla `notificaciones` ni migracion asociada. El aviso de **solicitud nueva** al conductor (ventana de 60s) sigue siendo responsabilidad de Supabase Realtime segun `specs/driver-app/ESPECIFICACION.md`; este modulo no lo implementa.

### 3.10. POST /api/solicitudes/:id/finalizar — finalizar servicio (conductor, endpoint #23)

Sin cuerpo (acepta ausencia de cuerpo o `{}`; se rechazan campos adicionales, arrays y `null` con `400`).

Comportamiento:

1. UUID invalido → `404` sin consultar.
2. `requireAuth`: `401` sin credencial; `403` para admin/n8n.
3. Cargar la solicitud (incluido el `usuarioId` del conductor asignado). Si no existe o esta eliminada → `404 NOT_FOUND`.
4. Si el conductor autenticado no es el asignado (el `usuarioId` de la solicitud no coincide con el `sub` del JWT) → `403 FORBIDDEN` sin revelar ningun dato del recurso. No es posible verificar la propiedad sin haber cargado la solicitud primero: el paso 3 antecede al 4 para que una solicitud inexistente no distinga el 403 de un `404`.
5. Solicitud no en `en_servicio` → `409 ESTADO_INVALIDO`.
6. Actualizacion condicional → `estado: "finalizada"`, `finalizadaEn = now`; liberar conductor: si `estadoJornada === "activa"` → `disponible`, si no → `no_disponible`. → `200` con `SolicitudDto`.

### 3.11. POST /api/solicitudes/:id/sin-conductor — sin candidatos (n8n, endpoint adicional)

Sin cuerpo (como `finalizar`). n8n lo llama cuando `GET /:id/candidatos` devuelve `candidatos: []`.

Comportamiento:

1. UUID invalido → `404` sin consultar.
2. `requireN8n`: `401` sin credencial; `403` para admin/conductor.
3. Solicitud inexistente o eliminada → `404`.
4. Solicitud no en `buscando` → `409 ESTADO_INVALIDO`.
5. Actualizacion condicional exigiendo `estado: "buscando"` y `eliminadoEn: null` → `estado: "sin_conductor"`, ademas de `conductorAsignadoId: null` y `expiraEn: null` (defensivo: desde `buscando` ya deberian estar vacios). → `200` con `SolicitudDto`.

### 3.12. GET /api/solicitudes/:id — estado actual (n8n, admin, endpoint #24)

Comportamiento:

1. UUID invalido → `404` sin consultar.
2. `requireN8nOrAdmin`: `401` sin credencial; conductor JWT → `403`.
3. Solicitud inexistente o eliminada → `404`.
4. → `200` con `SolicitudDetalleDto` (pasajero, conductor asignado con su vehiculo activo; sin telefono — ver 3.4).

### 3.13. Errores

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
| 403 | `FORBIDDEN` | Identidad valida sin permiso para el recurso |
| 404 | `NOT_FOUND` | UUID invalido, solicitud inexistente o eliminada, pasajero inexistente o eliminado |
| 409 | `SOLICITUD_ACTIVA` | El pasajero ya tiene una solicitud activa (Regla 1) |
| 409 | `AVISO_NO_ACEPTADO` | El pasajero no acepto el aviso de privacidad (dependencia SPEC 07) |
| 409 | `ESTADO_INVALIDO` | Transicion no permitida desde el estado actual de la solicitud |
| 409 | `CANDIDATO_INVALIDO` | El conductor no es candidato elegible (Regla 2/3/4) o ya no esta disponible |
| 500 | `INTERNAL_ERROR` | Fallo inesperado, sin filtrar SQL, stack ni secretos |

### 3.14. Flujo de notificacion a n8n (polling de GET /:id)

n8n no queda "suscrito" a los cambios de estado: consulta `GET /api/solicitudes/:id` de forma periodica mientras la solicitud este activa (estados `buscando`, `esperando_respuesta`, `en_servicio`), con un intervalo sugerido de ~5 segundos. El job interno (Regla 8) garantiza que `esperando_respuesta` siempre termina a los 60 segundos, asi que el polling siempre converge:

| n8n ve en GET /:id... | Accion de n8n |
|---|---|
| `buscando` (tras rechazo o expiracion) | Consultar `GET /:id/candidatos` y ofrecer los nuevos candidatos (la tabla de rechazos excluye a quien rechazo/expirio). |
| `en_servicio` | Informar al pasajero los datos del vehiculo del conductor asignado (placa, marca, modelo, color) desde el detalle. |
| `sin_conductor` | Informar que no hay conductores disponibles y ofrecer el telefono del centro de atencion (Modulo 1). |
| `finalizada` | Cerrar el hilo conversacional. |

Alternativas no implementadas en este modulo y diferidas como mejora post-MVP: webhook del backend hacia n8n cuando cambia el estado, y suscripcion de n8n a Supabase Realtime sobre la tabla `solicitudes`. El roadmap (#24, "lo consulta n8n") respalda el polling como mecanismo del MVP.

## 4. Plan de implementacion

1. Crear `specs/10-solicitudes.md` (este documento).
2. Migracion: agregar `MotivoExclusionSolicitud` y `SolicitudConductorRechazado` a `prisma/schema.prisma` con sus relaciones, y el indice `@@index([estado, expiraEn])` en `Solicitud`; correr `npx prisma migrate dev --name add_rechazos_e_indice_expiracion` y `npx prisma generate`.
3. Extender `src/modules/motor-asignacion/motor-asignacion.service.ts`: `obtenerCandidatos(solicitudId, now, excluirIds)` (tercer parametro opcional, default `[]`) que descarte esos conductores desde el where o en memoria; actualizar `tests/motor-asignacion.service.test.ts` y `tests/motor-asignacion.test.ts` con casos de exclusion.
4. Agregar `requireN8nOrAdmin` en `src/middlewares/auth.ts` y cubrirlo en `tests/auth-middleware.test.ts`.
5. Crear `src/modules/solicitudes/solicitudes.schema.ts` (inputs y DTOs con `.strict()`) y `tests/solicitudes.schema.test.ts`; incorporar la suite a la lista explicita de `vitest.unit.config.ts`.
6. Crear `src/modules/solicitudes/solicitudes.service.ts` (crear, seleccionar, responder, finalizar, sin-conductor, obtener) reutilizando `obtenerCandidatos` y `esTemporalmenteValida`; cubrir con `tests/solicitudes.service.test.ts` (prisma mockeado, `vi.setSystemTime` para ventana del minuto y limites de `expiraEn`, transiciones condicionales, Regla 1, exclusiones) y `tests/solicitudes.job.test.ts` (fake timers: programar, expirar, cancelar, idempotencia); incorporar las suites a `vitest.unit.config.ts`.
7. Crear `src/modules/solicitudes/notificaciones.ts` (stub `notificarPasajero`).
8. Crear `src/modules/solicitudes/solicitudes.controller.ts` y `src/modules/solicitudes/solicitudes.router.ts` (rutas con guards lazy); montar el router bajo `/api/solicitudes` en `src/app.ts` junto al existente de motor, sin romper `GET /:id/candidatos`.
9. Conectar el job en `src/server.ts`: tras `prisma.$connect()`, llamar el `barridoInicial()` y dejar que el servicio agende `setTimeout`s; los timers son `.unref()` para no bloquear el cierre.
10. Agregar `tests/solicitudes.http.test.ts` con supertest y servicios mockeados: matriz de permisos por endpoint (n8n, admin, conductor asignado, otro conductor, anonimo), 404 de UUID/recurso, 409 de estado/aviso/regla-1/candidato y 500 seguro; incorporar la suite a `vitest.unit.config.ts`.
11. Agregar `tests/solicitudes.test.ts` con cobertura real sobre `TEST_DATABASE_URL`: seed de configuracion, pasajero con/ sin aviso, conductores con ubicaciones, y cobertura del ciclo feliz (crear → candidatos → seleccionar → responder acepta → finalizar), la rama de rechazo (re-busqueda excluye al conductor), la expiracion por job, `sin_conductor`, Regla 1, aviso no aceptado y permisos; limpiar solo los registros propios (`spec10-<UUID>`).
12. Actualizar `README.md` con la seccion "Solicitudes (SPEC 10)" y el checklist de `docs/ROADMAP_ENDPOINTS.md` (solo el item 7 del resumen de progreso, si el flujo del repo lo permite en la misma entrega).

Cada paso debe dejar el proyecto compilable y conservar los endpoints existentes.
No abrir puertos al importar `app.ts` ni realizar conexiones a produccion para verificar la spec.

## 5. Criterios de aceptacion

- [x] Migracion `add_rechazos_e_indice_expiracion` aplicable (desarrollo y pruebas) con tabla `solicitudes_conductores_rechazados`, FK a `solicitudes` y `conductores`, `@@unique([solicitudId, conductorId])` y el indice `@@index([estado, expiraEn])` en `Solicitud`.
- [x] `obtenerCandidatos` acepta una lista de exclusion opcional y no devuelve a los conductores excluidos; sin la lista, mantiene el comportamiento de SPEC 09.
- [x] `POST /api/solicitudes` exige token n8n (401 sin credencial, 403 con JWT admin/conductor).
- [x] Crear una solicitud valida devuelve `201` con `SolicitudDto` en estado `buscando` y sin conductor asignado.
- [x] Crear con pasajero sin aviso aceptado devuelve `409 AVISO_NO_ACEPTADO`.
- [x] Crear cuando el pasajero ya tiene una solicitud activa devuelve `409 SOLICITUD_ACTIVA` y no genera fila nueva.
- [x] Pasajero inexistente o eliminado devuelve `404 NOT_FOUND`.
- [x] `POST /:id/seleccionar-conductor` exige token n8n y reserva al conductor (`disponible` → `solicitud_pendiente`), fija `conductorAsignadoId`, pasa a `esperando_respuesta` y setea `expiraEn = now + 60000`.
- [x] Seleccionar un conductor que no esta entre los candidatos actuales devuelve `409 CANDIDATO_INVALIDO` sin reservar.
- [x] Seleccionar sobre una solicitud que no esta en `buscando` devuelve `409 ESTADO_INVALIDO`.
- [x] `POST /:id/responder` solo lo acepta el conductor asignado; admin, n8n y otro conductor reciben `403`.
- [x] En `responder` (y `finalizar`) la solicitud se carga **antes** de verificar la propiedad: recurso inexistente/eliminado → `404`, y solo despues, conductor distinto del asignado → `403` sin revelar datos.
- [x] Responder `acepta: true` pasa a `en_servicio`, fija `aceptadaEn`, limpia `expiraEn`, pone al conductor `en_servicio` y llama al stub de notificacion.
- [x] Responder `acepta: false` registra `solicitudes_conductores_rechazados` (motivo `rechazo`), libera al conductor (`disponible`), y la solicitud vuelve a `buscando` con `conductorAsignadoId null` y `expiraEn null`.
- [x] El conductor rechazado no vuelve a aparecer en una re-busqueda de la misma solicitud (Regla 7).
- [x] El job interno expira solicitudes `esperando_respuesta` con `expiraEn <= now`, registra la exclusion (motivo `expiracion`), libera al conductor y vuelve a `buscando`; es idempotente ante doble ejecucion.
- [x] Responder/finalizar cancelan el timeout pendiente de la solicitud.
- [x] El barrido inicial expira las solicitudes ya vencidas tras un reinicio y reprograma las pendientes.
- [x] `POST /:id/finalizar` solo lo acepta el conductor asignado del servicio `en_servicio`; otros reciben `403`; transicion desde otro estado recibe `409 ESTADO_INVALIDO`.
- [x] En `finalizar`, igual que en `responder`, la solicitud se carga antes de verificar la propiedad: recurso inexistente/eliminado → `404`, y solo despues, conductor distinto del asignado → `403` sin revelar datos.
- [x] Finalizar pasa a `finalizada`, fija `finalizadaEn` y libera al conductor (`disponible` si jornada `activa`, `no_disponible` en caso contrario).
- [x] `POST /:id/sin-conductor` exige token n8n, solo desde `buscando`, pasa a `sin_conductor` y limpia `conductorAsignadoId` y `expiraEn`.
- [x] `GET /:id` lo aceptan n8n y admin; conductor JWT recibe `403`; devuelve `SolicitudDetalleDto` con pasajero y conductor asignado (vehiculo activo) o `null`, **sin `telefono`**.
- [x] UUID invalido responde `404` sin consultar el servicio en todos los endpoints de recurso.
- [x] Los DTOs son estrictos (Zod `.strict()`) y serializan fechas en UTC.
- [x] Errores inesperados de persistencia reciben `500` generico sin detalles internos.
- [x] La autenticacion y los endpoints de modulos anteriores conservan su comportamiento (`GET /:id/candidatos` incluido).
- [x] `npm run build` termina correctamente.
- [x] `npm run test:unit` incluye las suites de solicitudes (schema, servicio, job, HTTP) y del motor con exclusion, y termina correctamente.
- [ ] `npm test` termina correctamente con `TEST_DATABASE_URL` separada y cubre el ciclo de vida, las ramas alternativas y la limpieza de registros propios.
- [x] El spec y el README documentan el polling de n8n sobre `GET /:id` (intervalo sugerido ~5s) como mecanismo para enterarse de aceptacion/rechazo/expiracion.
- [x] El spec y el README documentan que los eventos `rechazo`/`expiracion` se registran en `solicitudes_conductores_rechazados` como fuente de trazabilidad/reportes.
- [x] README documenta el contrato de cada endpoint, sus permisos, el job de expiracion, la ausencia de `telefono` en el detalle y la dependencia de `solicitudes_conductores_rechazados`.

## 6. Decisiones tomadas y descartadas

**Confirmadas con el usuario (objetivos de esta spec):**

- Regla 7/8 con tabla nueva `solicitudes_conductores_rechazados`: la re-busqueda de la misma solicitud excluye a los conductores que rechazaron o expiraron, sin afectar solicitudes futuras.
- `sin_conductor` se activa con un endpoint dedicado de n8n (`POST /:id/sin-conductor`), no de forma automatica al crear.
- El job interno #22 usa `setTimeout` por solicitud (`.unref()`) mas un barrido al iniciar, sin libreria de cron.
- Se sigue el flujo spec-driven (spec → implementacion → tests → PR) como en los modulos previos.
- **`telefono` se elimina del `SolicitudDetalleDto`** (opcion A): el pasajero no debe recibir el numero, y como `GET /:id` tambien lo consume n8n, dejar el campo obligaria a filtrarlo en cada flujo. El admin lo obtiene por el modulo de conductores (`GET /api/conductores/:id`).
- **n8n se entera de los cambios de estado por polling** de `GET /:id` (intervalo ~5s), respaldado por el roadmap (#24, "lo consulta n8n"). El job interno garantiza que la ventana de 60 segundos siempre termina, asi el polling converge.

**Detalles del contrato propuestos en este borrador para revision:**

- `POST /api/solicitudes` responde `201` con la solicitud en `buscando`; n8n consulta candidatos despues (no se acopla la creacion con la busqueda).
- Los estados intermedios `creada`, `conductor_seleccionado`, `aceptada` y `rechazada` **no** se persisten como paso separado en el MVP (el enum los conserva para fidelidad del modelo). `seleccionar-conductor` pasa directo a `esperando_respuesta`; `responder acepta` pasa directo a `en_servicio`; el rechazo libera directo a `buscando`.
- Limite de expiracion inclusivo (`expiraEn <= now`), consistente con SPEC 08/09.
- La validacion de la Regla 1 y de la exclusion se resuelven con actualizaciones/creaciones condicionales (transaccion) para evitar condiciones de carrera entre n8n y el job.
- El conductor que rechaza queda `disponible` (se libera) y excluido solo para esa solicitud; no se le bloquea la disponibilidad global.
- `GET /:id` no acepta conductor (aunque sea el asignado): el roadmap lo limita a n8n y admin; la app del conductor recibe su solicitud activa por los canales que definira el spec del dashboard/driver-app. *Punto abierto a revision: si se quiere permitir que el conductor asignado consulte su propia solicitud, ajustar el guard a n8n-o-admin-o-propietario.*
- El job no crea el estado `rechazada` ni persiste un paso intermedio antes de volver a `buscando`; los eventos de rechazo/expiracion quedan registrados en `solicitudes_conductores_rechazados` (§3.2).

**Descartadas en esta revision:**

- Webhook del backend hacia n8n y suscripcion de n8n a Supabase Realtime para los cambios de estado: mas inmediatos, pero agregan infraestructura y fragilidad; el polling de `GET /:id` basta para el MVP y esta respaldado por el roadmap.
- `telefono` condicional por rol (solo admin) en `SolicitudDetalleDto`: flexible pero exige serializacion condicional; se prefirio no exponer el campo en absoluto.

## 7. Riesgos

| Riesgo | Mitigacion |
|---|---|
| Condiciones de carrera entre n8n (seleccionar), la app (responder) y el job (expirar) | Actualizaciones condicionales (where sobre `estado`/`expiraEn`) dentro de `prisma.$transaction`; idempotencia del job |
| Crear dos solicitudes activas del mismo pasajero casi a la vez (Regla 1) | Validacion + creacion condicional en una sola operacion; si el motor deja un flanco, el schema no protege y se documenta la limitacion |
| Duplicar exclusiones al reaparecer el timing del job | `@@unique([solicitudId, conductorId])` en la tabla de rechazos |
| Timeouts de expiracion obsoletos tras un reinicio del proceso | `barridoInicial()` al arrancar + `clearTimeout` al responder/finalizar |
| Un conductor reservado por dos solicitudes | Reserva con `updateMany` condicional sobre `disponible`; si pierde la carrera, `CANDIDATO_INVALIDO` |
| Exponer solicitudes de terceros a conductores | Validacion de propietario por `usuarioId` en el servicio + matriz de permisos en los tests; en `responder`/`finalizar` el recurso se carga antes que la propiedad (inexistente → `404`, ajena → `403`) |
| Filtrar el `telefono` del conductor hacia n8n/pasajero | `telefono` eliminado del `SolicitudDetalleDto`; el admin usa el modulo de conductores |
| n8n sin visibilidad de los cambios de estado (aceptacion/rechazo/expiracion) | Polling documentado de `GET /:id` cada ~5s; el job garantiza que la ventana de 60s termina |
| Consulta de expiracion lenta (`estado = esperando_respuesta` y `expiraEn <= now`) | Indice `@@index([estado, expiraEn])` en la migracion |
| Olvidar liberar al conductor en alguna rama | Cada transicion terminal libera disponibilidad; tests de integracion verifican el estado final del conductor |

## 8. Que NO se implementa en esta spec

- Notificaciones reales (push/WhatsApp) ni Supabase Realtime para el aviso de solicitud nueva.
- Webhook del backend hacia n8n ni suscripcion Realtime de n8n a los cambios de estado: n8n consulta `GET /:id` por polling (ver 3.14).
- Persistir `expirada` o `rechazada` como estado observable de la solicitud: se registran como eventos en `solicitudes_conductores_rechazados`.
- Tarifario ni dashboard (modulo 8); gestion de jornada/disponibilidad manual del conductor (modulos de `conductores`).
- Cancelacion por el pasajero, historial/auditoria de estados, reintentos automaticos de busqueda mas alla de la nueva `buscando`.
- Indices geoespaciales, PostGIS, cron global o procesamiento multi-proceso del job.
- Cambios en los documentos de referencia fuera de `backend/`.
- Permiso del conductor para listar o consultar solicitudes ajenas; el acceso del conductor a "sus" solicitudes se define en el spec del dashboard/driver-app.