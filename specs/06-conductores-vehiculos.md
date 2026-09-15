# SPEC 06 — Conductores y vehiculos

> **Estado:** Implementado
> **Depende de:** SPEC 03 (`03-base-auth-admin.md`), SPEC 05 (`05-conductor-auth.md`)
> **Fecha:** 2026-09-11
> **Objetivo:** Permitir el primer registro publico de un conductor junto con su vehiculo y habilitar a un administrador a gestionar conductores y sus vehiculos.

## 1. Contexto

Las rutas son relativas a `backend/`.
Esta entrega corresponde al modulo 3 de `docs/ROADMAP_ENDPOINTS.md` (endpoints #6 a #13: 8 endpoints HTTP).
El esquema de SPEC 02 ya contiene `Usuario`, `Conductor` y `Vehiculo`; no se agregan tablas ni migraciones.
La Regla 12 se implementa solo como cambio de estado; el bloqueo de jornada/disponibilidad corresponde a modulos futuros.
La Regla 13 se cumple restringiendo el PATCH de vehiculo a administradores.

## 2. Alcance

**Incluye:**

- `POST /api/conductores` (publico) — crea `usuario` + `conductor` + `vehiculo` en una transaccion.
- `GET /api/conductores` (admin) — listado con filtro opcional `?estado=`.
- `GET /api/conductores/:id` (admin, conductor propietario o interno) — detalle con vehiculo.
- `PATCH /api/conductores/:id/aprobar`, `.../rechazar`, `.../suspender`, `.../reactivar` (admin) — transiciones de estado estrictas, con stub de notificacion en aprobar/rechazar.
- `PATCH /api/conductores/:id/vehiculo` (admin) — actualizacion parcial del vehiculo.
- `src/modules/conductores/notificaciones.ts` como punto de integracion sin efecto real.
- Middlewares `requireAuth`/`requireAdmin` de SPEC 03 reutilizados, esquemas Zod estrictos, errores JSON y pruebas HTTP con persistencia contra PostgreSQL separado.

**NO incluye:**

- Jornadas, disponibilidad, ubicaciones ni motor de asignacion.
- Notificaciones reales (WhatsApp, push, tabla de notificaciones) ni integracion n8n de notificaciones.
- Paginacion del listado, soft delete ni restauracion de conductores o vehiculos.
- Pasajeros, solicitudes, tarifario, dashboard ni otros modulos del roadmap.
- Despliegue de produccion o cambios en documentos fuera de `backend/`.

## 3. Modelo de datos y contratos

Se reutilizan `Usuario`, `Conductor` y `Vehiculo` de SPEC 02 sin nuevas estructuras persistentes.
El identificador de recurso en `/api/conductores/:id` es **`Conductor.id`** (UUID).
El JWT de conductor de SPEC 05 tiene `sub` = `Usuario.id`, por lo que el conductor que consulta su propio perfil se resuelve buscando su `Conductor` por `usuarioId`.
La relacion `Conductor` -> `Vehiculo` es 1:N en el esquema; el MVP asume un unico vehiculo activo por conductor y toma siempre el mas reciente con `eliminadoEn = null`.

DTO `VehiculoDto`:
- `id`: string (UUID).
- `placa`, `marca`, `modelo`, `color`: strings.
- `capacidadPasajeros`: entero.

DTO `ConductorDetalleDto`:
- `id`: string (UUID, `Conductor.id`).
- `usuarioId`: string (UUID, `Usuario.id`).
- `telefono`: string.
- `nombreCompleto`, `cedulaIdentidad`: strings.
- `estado`, `estadoJornada`, `estadoDisponibilidad`: strings de los enums Prisma.
- `creadoEn`: fecha ISO 8601 serializada en UTC.
- `vehiculo`: `VehiculoDto` o `null`.

DTO `ListadoConductorDto` (respuesta del listado): igual al detalle sin `usuarioId`.

El respaldo del filtro y la validacion de estados usan los enums de Prisma directamente (`pendiente`, `aprobado`, `rechazado`, `suspendido`).

### POST /api/conductores (registro publico)

- Sin autenticacion. Body JSON estricto con todos los campos requeridos (Zod `.strict()`):

| Campo | Validacion |
|---|---|
| `telefono` | String recortado de 1 a 30 caracteres; sin formato telefonico estricto. |
| `pin` | Exactamente 4 a 6 digitos numericos (`/^\d{4,6}$/`). |
| `nombreCompleto` | String recortado de 1 a 100 caracteres. |
| `cedulaIdentidad` | String recortado de 1 a 50 caracteres; sin formato estricto. |
| `vehiculo.placa` | String recortado de 1 a 30 caracteres. |
| `vehiculo.marca` | String recortado de 1 a 30 caracteres. |
| `vehiculo.modelo` | String recortado de 1 a 30 caracteres. |
| `vehiculo.color` | String recortado de 1 a 30 caracteres. |
| `vehiculo.capacidadPasajeros` | Numero entero entre 1 y 100, sin coercion de strings. |

- Hashea el `pin` con bcrypt costo 12 en `usuarios.hashContrasena` (mismo campo y costo que SPEC 03/05).
- Crea en una sola transaccion `prisma.$transaction`: `usuario` (rol `conductor`, `telefono`, `hashContrasena`), `conductor` (`pendiente` / `no_iniciada` / `no_disponible`) y `vehiculo`.
- Si falla cualquier parte de la transaccion, no quedan filas huerfanas.
- Respuesta 201 con `ConductorDetalleDto`.
- 409 `CONFLICT` si `telefono` o `placa` ya existen (tambien si existen en filas eliminadas), con mensaje que identifica cual campo causo el conflicto:
  - `"El telefono ya esta registrado"`.
  - `"La placa ya esta registrada"`.
- El `P2002` se captura alrededor de `await prisma.$transaction(...)`, despues del rollback; si `meta.target` no distingue la columna, se determina con consultas de existencia de telefono en `usuarios` y placa en `vehiculos` mediante el cliente principal, incluyendo filas eliminadas. Nunca se consulta sobre la transaccion abortada.
- Body incompleto, campos desconocidos, tipos invalidos o restricciones fuera de rango devuelven 400 sin consultar ni escribir.

### GET /api/conductores (listado admin)

- Requiere `requireAdmin`. El token n8n por si solo no autoriza esta ruta (SPEC 03).
- Filtro opcional `?estado=` con `z.enum(["pendiente", "aprobado", "rechazado", "suspendido"])`; valor invalido → 400.
- Sin paginacion. Excluye conductores con `eliminadoEn != null`.
- Devuelve 200 con `ListadoConductorDto[]` ordenado por `creadoEn` ascendente; `vehiculo` es el activo mas reciente o `null`.

### GET /api/conductores/:id (detalle)

- Requiere `requireAuth` (JWT de usuario activo de cualquier rol, o token n8n interno).
- `:id` que no es UUID valido → 404 sin consultar la base.
- Conductor inexistente o eliminado → 404 `NOT_FOUND`.
- Si el autenticado es conductor (JWT con rol `conductor`): 200 solo cuando `conductor.usuarioId === req.auth.userId`; en caso contrario 403 `FORBIDDEN`.
- Admin y acceso interno n8n → 200 con `ConductorDetalleDto`.

### PATCH transiciones de estado (admin)

Rutas: `PATCH /api/conductores/:id/aprobar`, `.../rechazar`, `.../suspender`, `.../reactivar`.

- Requieren `requireAdmin`. Sin body.
- Transiciones estrictas:

| Ruta | Transicion | Notificacion |
|---|---|---|
| `aprobar` | `pendiente` -> `aprobado` | stub |
| `rechazar` | `pendiente` -> `rechazado` | stub |
| `suspender` (Regla 12) | `aprobado` -> `suspendido` | no |
| `reactivar` | `suspendido` -> `aprobado` | no |

- Conductor inexistente o eliminado, o `:id` no UUID → 404.
- Estado actual distinto del esperado → 409 `INVALID_STATE_TRANSITION` con mensaje que indica el estado actual.
- Respuesta 200 con `ConductorDetalleDto` actualizado.
- `aprobar`/`rechazar` invocan `notificarConductor()` tras el cambio con exito; el stub no bloquea ni hace fallar el endpoint.

### PATCH /api/conductores/:id/vehiculo (admin, Regla 13)

- Requiere `requireAdmin`. Body estricto con al menos uno de los campos opcionales; se actualiza solo lo enviado:

| Campo | Validacion |
|---|---|
| `placa`, `marca`, `modelo`, `color` | String recortado de 1 a 30 caracteres. |
| `capacidadPasajeros` | Numero entero entre 1 y 100. |

- Aplica sobre el vehiculo activo mas reciente del conductor. Sin vehiculo activo → 404 `NOT_FOUND` `"Vehiculo no encontrado"`.
- Conductor inexistente o eliminado, o `:id` no UUID → 404.
- Si la nueva `placa` colisiona con otra → 409 `CONFLICT` `"La placa ya esta registrada"`.
- Respuesta 200 con `ConductorDetalleDto` actualizado.

### Errores y codigos

- Reutiliza `{ "error": { "code": "<codigo estable>", "message": "<mensaje seguro>" } }`.
- 400 `VALIDATION_ERROR`; 401 `UNAUTHORIZED`; 403 `FORBIDDEN`; 404 `NOT_FOUND`; 500 `INTERNAL_ERROR`.
- Nuevos codigos: `CONFLICT` (telefono/placa duplicados) y `INVALID_STATE_TRANSITION` (transicion invalida).
- Un error interno no expone SQL, stack, URL de conexion ni secretos.
- Un `P2023` de cast de UUID se traduce a 404 (se valida el formato antes de consultar).

## 4. Archivos previstos

| Ruta | Responsabilidad |
|---|---|
| `src/modules/conductores/conductores.schema.ts` | Esquemas Zod del registro, PATCH de vehiculo, filtro de estado y DTOs. |
| `src/modules/conductores/conductores.service.ts` | Registro transaccional, listado, detalle, transiciones y actualizacion de vehiculo. |
| `src/modules/conductores/notificaciones.ts` | `notificarConductor()` sin efecto real, documentado como integracion futura. |
| `src/modules/conductores/conductores.controller.ts` | Validacion, control de pertenencia y respuestas HTTP. |
| `src/modules/conductores/conductores.router.ts` | Rutas con `requireAuth`/`requireAdmin` de importacion lazy. |
| `src/app.ts` | Montar `/api/conductores`. |
| `tests/conductores.test.ts` | Registro, permisos, transiciones, vehiculo, duplicados y errores. |
| `README.md` | Contratos del modulo y ejemplos reproducibles. |

Se reutilizan `src/config/prisma.ts`, `src/middlewares/auth.ts`, el manejador de errores y el entorno de pruebas de SPEC 03 sin duplicarlos.
No se requieren dependencias adicionales respecto de SPEC 05.

## 5. Plan de implementacion

1. Verificar que build, health y pruebas de SPEC 03/04/05 estan en verde. Incorporar los esquemas Zod y DTOs con sus pruebas unitarias sin cambiar rutas existentes.
2. Implementar el registro transaccional con manejo de `P2002` (telefono vs placa) y ausencia de huerfanos ante fallo. Verificar exito, 409 por cada campo y consistencia con pruebas de servicio.
3. Conectar el controlador y la ruta `POST /conductores` (publico). Probar 201, 409, 400 y fallo de base de datos por HTTP.
4. Implementar el listado admin con filtro de estado. Probar 401/403, filtro valido e invalido, exclusion de eliminados e inclusion del vehiculo.
5. Implementar el detalle con control de pertenencia. Probar admin, conductor propietario, conductor ajeno (403), inexistente/eliminado/:id no UUID (404) y acceso interno n8n.
6. Implementar las cuatro transiciones con stub de notificacion. Probar transiciones validas, transiciones invalidas (409), permisos, 404 y habilidades del stub.
7. Implementar el PATCH de vehiculo parcial. Probar parcialidad, conservacion de omitidos, placa duplicada (409), 400 por body invalido, permisos y 404 sin vehiculo activo.
8. Actualizar README con los contratos del modulo y ejecutar build + suite completa contra PostgreSQL separado.

Cada paso mantiene el servidor ejecutable y las pruebas anteriores en verde; los cambios grandes se dividen en incrementos funcionales, no en capas incompletas.

## 6. Criterios de aceptacion

- [x] `npm run build` termina sin errores; `npm test` pasa con las pruebas de SPEC 03/04/05 y las nuevas.
- [x] `POST /api/conductores` publico crea en una transaccion `usuario` (rol `conductor`, telefono unico, PIN hasheado con bcrypt costo 12 verificable), `conductor` (`pendiente` / `no_iniciada` / `no_disponible`) y `vehiculo`; responde 201 con `ConductorDetalleDto`.
- [x] Un fallo simulado dentro de la transaccion no deja `usuario` ni `conductor` huerfano.
- [x] `POST` con telefono o placa ya registrados (incluso eliminados) devuelve 409 `CONFLICT` y el mensaje identifica cual campo conflicto; con ambos, identifica al menos uno.
- [x] Body incompleto, campos desconocidos, tipos invalidos, pin que no sea numerico de 4 a 6 digitos, o capacidad fuera de 1 a 100 devuelven 400 sin escritura ni consulta.
- [x] `GET /api/conductores` sin JWT valido devuelve 401; con JWT de conductor devuelve 403; con solo token n8n vuelve 401 y no lista.
- [x] El listado devuelve `ListadoConductorDto[]` con el vehiculo activo, ordenado por `creadoEn` ascendente y excluyendo eliminados.
- [x] `?estado=` con valor ajeno al enum devuelve 400; cada valor del enum filtra correctamente.
- [x] `GET /api/conductores/:id` devuelve 200 para admin, conductor propietario y token n8n interno; 403 para conductor ajeno; 404 para inexistente, eliminado o `:id` no UUID.
- [x] `aprobar`/`rechazar` solo desde `pendiente`; `suspender` solo desde `aprobado`; `reactivar` solo desde `suspendido`. Cualquier otra transicion devuelve 409 `INVALID_STATE_TRANSITION` con el estado actual.
- [x] `aprobar`/`rechazar` invocan `notificarConductor()` sin efectos reales ni fallo del endpoint.
- [x] Las transiciones requieren admin: 401 sin JWT, 403 con JWT no admin; conductor inexistente o eliminado → 404.
- [x] `PATCH /api/conductores/:id/vehiculo` actualiza solo lo enviado, conserva los omitidos y devuelve 200 con el detalle actualizado.
- [x] `PATCH .../vehiculo` con placa duplicada devuelve 409; body vacio o invalido devuelve 400; JWT de conductor devuelve 403; conductor sin vehiculo activo devuelve 404.
- [x] `:id` no UUID se maneja como 404 en todos los endpoints de conductor sin consultar la base.
- [x] Las pruebas exigen `TEST_DATABASE_URL` sin fallback a `DATABASE_URL`, rechazan el destino de desarrollo y limpian solo registros propios con UUIDs.
- [x] No se agregan tablas, columnas ni migraciones.

## 7. Decisiones tomadas y descartadas

- **Si: `:id` = `Conductor.id`.** El recurso es el conductor; el registro devuelve su id para que la app lo conserve. El perfil propio se resuelve por `usuarioId`.
- **Si: transiciones de estado estrictas con 409.** Evita cambios accidentales y la respuesta indica el estado actual sin adivinar.
- **Si: notificacion stub.** No hay infraestructura real (push, tabla ni WhatsApp) y crear una tabla excederia el modulo; `notificarConductor()` es el punto de integracion futuro.
- **Si: PIN numerico de 4 a 6 digitos.** Cubre el ejemplo del roadmap (`1234`) y el PIN de 6 digitos de SPEC 05; ambos escenarios quedan dentro del dominio valido.
- **Si: listado con vehiculo y sin paginacion.** Suficiente para el admin en el MVP; la paginacion queda como ampliacion futura.
- **Si: GET `:id` admite token n8n interno.** El detalle es un recurso interno y el token n8n ya es una credencial interna de confianza de SPEC 03.
- **Si: `:id` no UUID → 404.** Un id mal formado no puede referenciar un conductor y evita 500 por cast de Postgres.
- **Si: bcrypt costo 12.** Consistente con SPEC 03 y SPEC 05.
- **No: migraciones ni tabla de notificaciones.** El esquema vigente soporta el modulo completo.
- **No: paginacion, soft delete de conductores/vehiculos, jornada, disponibilidad ni bloqueo operativo de la Regla 12.** Pertenecen a modulos futuros.
- **No: transiciones `pendiente` -> `suspendido`, `rechazado` -> `aprobado` ni `aprobado` -> `rechazado`.** Fuera del flujo de estados definido en las reglas de negocio.

## 8. Riesgos identificados

| Riesgo | Mitigacion |
|---|---|
| Carrera entre dos registros con el mismo telefono o placa. | `prisma.$transaction` + manejo de `P2002`; mensaje decidido por `meta.target` o consultas de existencia. |
| Relacion vehiculo 1:N con conductores multi-vehiculo. | El modulo toma el activo mas reciente; el MVP asume un vehiculo y se documenta. |
| `meta.target` de P2002 no distingue la columna. | Fallback: consultar existencia de telefono en `usuarios` y placa en `vehiculos`. |
| Confundir `Conductor.id` con `Usuario.id` en la autenticacion. | Resolucion explicita por `usuarioId` en el perfil propio; contrato documentado. |
| Error de cast de UUID en Postgres. | Validar formato UUID antes de consultar; `:id` no UUID → 404. |
| Conductor sin vehiculo activo por datos previos. | `PATCH .../vehiculo` y DTOs lo manejan con 404 y `vehiculo: null` respectivamente. |

## 9. Que NO forma parte de esta especificacion

- Jornada, disponibilidad, ubicaciones ni bloqueo operativo de la Regla 12 (modulos futuros).
- Notificaciones reales por WhatsApp o push, y la tabla que pudieran requerir.
- Paginacion, borrado o restauracion de conductores o vehiculos.
- Pasajeros, solicitudes, tarifario, dashboard ni cualquier otro modulo del roadmap.
- Despliegue de produccion con datos de prueba.
