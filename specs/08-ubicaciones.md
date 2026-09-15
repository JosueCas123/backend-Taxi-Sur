# SPEC 08 - Ubicaciones

> **Estado:** Implementado
> **Depende de:** SPEC 02 (`02-migracion-schema-prisma.md`), SPEC 03 (`03-base-auth-admin.md`)
> **Fecha:** 2026-09-15
> **Objetivo:** Registrar la posicion GPS de un conductor (solo el propietario aprobado) y consultar su ultima ubicacion (solo admin), aplicando la caducidad de 5 minutos de la Regla 9.

## 1. Contexto

Las rutas de archivos son relativas a `backend/`.
Esta entrega corresponde al modulo 5 de `docs/ROADMAP_ENDPOINTS.md`, endpoints #16 y #17.
Se usan tambien `docs/REGLAS_DE_NEGOCIO.md`, `docs/MODELO_DE_DATOS.md` y `docs/ARQUITECTURA.md` como referencias.
El modelo Prisma existente (`UbicacionConductor`, creado en SPEC 02) y las convenciones del backend guian los detalles tecnicos.
La numeracion de specs no coincide con la numeracion de modulos del roadmap.

La Regla 9 define que un conductor con mas de 5 minutos sin actualizar ubicacion deja de ser elegible.
Este modulo registra el historial de posiciones y aplica esa regla temporal.
Reportar GPS no vuelve al conductor elegible ni modifica su disponibilidad o jornada: esos flujos pertenecen a modulos posteriores.

## 2. Alcance

**Incluye:**

- `POST /api/conductores/:id/ubicacion`, exclusivo del conductor propietario con estado `aprobado`.
- `GET /api/conductores/:id/ubicacion`, exclusivo del admin.
- Validacion estricta de coordenadas, DTO explicito y errores JSON consistentes con la API.
- Caducidad de 5 minutos calculada en el servidor sobre `horaRegistro`, sin depender del cliente.
- Invalidacion persistente de ubicaciones previas vencidas al recibir un reporte nuevo.
- Funcion temporal reutilizable para el futuro motor de asignacion.
- Pruebas unitarias y HTTP sin base de datos, y pruebas de integracion con base de pruebas separada.
- Documentacion del contrato en el README del backend.

**NO incluye:**

- Jornada, disponibilidad ni elegibilidad del conductor (modulos 6 y 7).
- Consulta de ubicaciones por n8n via HTTP: el motor de asignacion usara el servicio interno.
- Registro de ubicaciones por admin.
- Indices de base de datos, migraciones o dependencias npm.
- Job de caducidad en segundo plano: la invalidation se aplica al registrar y al consultar.

## 3. Modelo de datos y contratos

Se reutiliza `UbicacionConductor` de SPEC 02 sin nuevas estructuras persistentes:

| Campo Prisma | Persistencia | Uso |
|---|---|---|
| `id` | BigInt, PK autoincremental | Identificador generado por la base |
| `conductorId` | String, FK a `conductores.id` | Propietario del reporte |
| `latitud` | Float requerido | Coordenada reportada |
| `longitud` | Float requerido | Coordenada reportada |
| `horaRegistro` | DateTime, default `now()` | Reloj del servidor al insertar |
| `esValida` | Boolean, default `true` | Bandera persistida; se combina con la antiguedad |
| `eliminadoEn` | DateTime nullable | Borrado logico |

### 3.1. Regla temporal (Regla 9)

La vigencia se calcula siempre en el servidor comparando `horaRegistro` con el reloj actual:

- `antiguedad = now - horaRegistro`.
- `vigente = antiguedad <= 300000` ms (5 minutos).
- **Exactamente 300000 ms sigue siendo vigente**; a partir de 300001 ms caduca.

La validez efectiva devuelta en el DTO del GET es la **interseccion** de la bandera persistida y la vigencia temporal:

```
esValida_efectiva = esValida_persistida && (now - horaRegistro <= 300000)
```

Un registro reciente con `esValida_persistida = false` se devuelve como no valido: la bandera guardada ya fue invalidada por otra regla y no se revive.

Se implementa como funcion pura exportada `esTemporalmenteValida(horaRegistro, now)` en el servicio, para que el motor de asignacion y el dashboard la reutilicen sin duplicar la logica.

### 3.2. Autorizacion

- **POST:** JWT de conductor (via `requireAuth`), cuyo `sub` es `Usuario.id`. El controlador/servicio debe verificar que `conductor.usuarioId == auth.userId` (pertenencia) y que `conductor.estado == "aprobado"`.
- **GET:** JWT de admin (via `requireAdmin`). El motor interno no usa HTTP: llama al servicio directamente.
- n8n no tiene acceso HTTP a ninguno de los dos endpoints.

| Credencial | POST | GET |
|---|---|---|
| conductor propietario `aprobado` | 201 | 403 |
| conductor propietario no aprobado | 403 `CONDUCTOR_NO_APROBADO` | 403 |
| conductor ajeno | 403 | 403 |
| admin | 403 | 200 |
| n8n | 403 | 401 |
| sin credenciales / token invalido | 401 | 401 |

**Nota sobre n8n en el GET:** este GET usa `requireAdmin`, que solo reconoce credenciales JWT Bearer. El token de n8n (header `x-n8n-token`) no es una credencial reconocida para este middleware, asi que cae en `401` (identidad no reconocida), no en `403` (identidad reconocida pero sin permiso). El POST usa un middleware distinto (`requireAuth`) que si reconoce el token de n8n como identidad valida antes de rechazarlo por falta de permiso; por eso alli si es `403`. Se reutiliza `requireAdmin` sin modificar middlewares compartidos con modulos ya implementados.

La autorizacion ocurre antes de validar el recurso y el cuerpo en el controlador.
El parser JSON global mantiene su comportamiento actual para JSON malformado.
No se registran tokens ni cuerpos en logs nuevos.

### 3.3. DTO de respuesta

`UbicacionConductorDto`:

```json
{
  "id": "42",
  "latitud": -17.7833,
  "longitud": -63.1821,
  "horaRegistro": "2026-09-15T14:00:00.000Z",
  "esValida": true
}
```

- `id` es BigInt: se serializa como string decimal (JSON no distingue BigInt de forma segura).
- Las fechas se serializan como ISO 8601 en UTC.
- No se expone `conductorId` ni `eliminadoEn`.

### 3.4. POST /api/conductores/:id/ubicacion

Cuerpo JSON estricto:

```json
{
  "latitud": -17.7833,
  "longitud": -63.1821
}
```

| Campo | Validacion |
|---|---|
| `latitud` | Numero finito en `[-90, 90]` |
| `longitud` | Numero finito en `[-180, 180]` |

Se rechazan claves desconocidas, tipos incorrectos, `NaN`/`Infinity`, arrays, `null`, cuerpos ausentes y cualquier intento del cliente de imponer `horaRegistro`, `esValida`, `conductorId` o `id`.

Comportamiento:

1. Un UUID invalido en `:id` responde `404 NOT_FOUND` sin consultar el servicio.
2. El conductor debe existir y no estar eliminado logicamente; en caso contrario, `404`.
3. Si `auth.userId != conductor.usuarioId`, responder `403 FORBIDDEN` sin revelar datos del conductor ajeno.
4. Si el propietario no esta `aprobado`, responder `403 CONDUCTOR_NO_APROBADO`.
5. En una **transaccion** (`prisma.$transaction`): marcar `esValida = false` en las ubicaciones previas del conductor con `horaRegistro < now - 300000` y `esValida = true`, y luego insertar la fila nueva con `horaRegistro = now` del servidor y `esValida = true`.
6. Responder `201 Created` con el `UbicacionConductorDto` de la fila creada.

La invalidacion y la insercion deben ser atomicas: si la insercion falla, no debe quedar medio historial invalidado de forma aislable.
No se invalidan las ubicaciones recientes ni las de otros conductores.

### 3.5. GET /api/conductores/:id/ubicacion

Comportamiento:

1. Un UUID invalido responde `404 NOT_FOUND` sin consultar el recurso.
2. El conductor debe existir y no estar eliminado logicamente; en caso contrario, `404`.
3. Se busca la ultima ubicacion con `horaRegistro DESC, id DESC`, excluyendo registros con `eliminadoEn`.
4. Si no existe ninguna, `404 NOT_FOUND`.
5. Se devuelve `200` con el `UbicacionConductorDto`; `esValida` se calcula con la regla temporal (seccion 3.1).

### 3.6. Errores

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
| 403 | `FORBIDDEN` | JWT valido sin permiso para el recurso |
| 403 | `CONDUCTOR_NO_APROBADO` | Propietario en estado `pendiente`/`rechazado`/`suspendido` |
| 404 | `NOT_FOUND` | UUID invalido, conductor inexistente o eliminado, o sin ubicaciones |
| 500 | `INTERNAL_ERROR` | Fallo inesperado, sin filtrar SQL, stack ni secretos |

## 4. Plan de implementacion

1. Crear `src/modules/ubicaciones/ubicaciones.schema.ts` (entrada de coordenadas, esquema de `:id` y `ubicacionDtoSchema`) y `tests/ubicaciones.schema.test.ts`; incorporar ambas suites a la lista explicita de `vitest.unit.config.ts`.
2. Crear `src/modules/ubicaciones/ubicaciones.service.ts` con la funcion `esTemporalmenteValida(horaRegistro, now)` exportada y reutilizable.
3. Completar el servicio con `registrarUbicacion(conductorId, input, auth)` (validacion de conductor, transaccion de invalidacion + insercion) y `obtenerUltimaUbicacion(conductorId, now)` (busqueda y calculo de validez); cubrir con `tests/ubicaciones.service.test.ts` usando prisma mockeado, reloj controlado (`vi.setSystemTime`) y los limites 299999/300000/300001 ms; incorporar la suite a `vitest.unit.config.ts`.
4. Crear `src/modules/ubicaciones/ubicaciones.controller.ts` y `src/modules/ubicaciones/ubicaciones.router.ts` (rutas `/:id/ubicacion` con `requireAuth`/`requireAdmin` lazy); montar el router bajo `/api/conductores` en `src/app.ts` con los patrones de carga y errores existentes.
5. Agregar `tests/ubicaciones.http.test.ts` con supertest y servicios mockeados: matriz de permisos (propietario, ajeno, admin, n8n, anonimo), 404 de UUID y de servicio, y 500 seguro; incorporar la suite a `vitest.unit.config.ts`.
6. Agregar `tests/ubicaciones.test.ts` con cobertura HTTP/integracion real sobre `TEST_DATABASE_URL`: persistencia, invalidacion de previas vencidas, conservacion de recientes, aislamiento entre conductores y concurrencia; limpiar solamente los registros propios de las pruebas.
7. Actualizar `README.md` con los dos endpoints, ejemplos camelCase, permisos, caducidad y el uso interno del motor.

Cada paso debe dejar el proyecto compilable y conservar los endpoints existentes.
No abrir puertos al importar `app.ts` ni realizar conexiones a produccion para verificar la spec.

## 5. Criterios de aceptacion

- [x] `POST /api/conductores/:id/ubicacion` esta montado y exige JWT valido.
- [x] El conductor propietario `aprobado` recibe `201` con el `UbicacionConductorDto` y se inserta una fila con `horaRegistro` del servidor.
- [x] Un conductor ajeno recibe `403` sin revelar datos del conductor destino.
- [x] El propietario `pendiente`, `rechazado` o `suspendido` recibe `403 CONDUCTOR_NO_APROBADO`.
- [x] Admin y n8n reciben `403` en el POST; sin credenciales o token invalido, `401`.
- [x] En el GET, n8n (token `x-n8n-token`) recibe `401`, no `403`, porque `requireAdmin` solo reconoce credenciales JWT Bearer (ver nota de la seccion 3.2).
- [x] El POST rechaza coordenadas fuera de rango, no finitas, tipos incorrectos, campos desconocidos, arrays, `null` y cualquier `horaRegistro`/`esValida`/`conductorId` enviado por el cliente.
- [x] Al registrar, las ubicaciones previas del mismo conductor con `horaRegistro < now - 300000` pasan a `esValida = false` y las recientes se conservan, todo en la misma transaccion.
- [x] `GET /api/conductores/:id/ubicacion` esta montado y exige admin: un conductor recibe `403`.
- [x] El GET devuelve la ultima ubicacion (desempate por `id`), ignorando registros eliminados logicamente.
- [x] El GET devuelve `esValida: false` con antiguedad `> 300000` ms aunque la bandera persistida sea `true`, y `true` con exactamente `300000` ms.
- [x] Conductor sin ubicaciones, inexistente o eliminado, y UUID invalido reciben `404` sin consultar el servicio.
- [x] `id` se serializa como string decimal y las fechas como ISO 8601 en UTC.
- [x] `esTemporalmenteValida` esta exportada y reutilizable por el motor de asignacion.
- [x] Errores inesperados de persistencia reciben `500` generico sin detalles internos.
- [x] La autenticacion y los endpoints de modulos anteriores conservan su comportamiento.
- [x] `npm run build` termina correctamente.
- [x] `npm run test:unit` incluye las suites de ubicaciones (schema, servicio y HTTP) y termina correctamente.
- [x] `npm test` termina correctamente con `TEST_DATABASE_URL` separada y cubre persistencia, invalidacion y concurrencia.
- [x] README documenta el contrato de los dos endpoints y que el motor interno no los expone por HTTP.
- [x] No se agregan migraciones, tablas, indices, dependencias npm ni cambios en documentos externos a `backend/`.

## 6. Decisiones tomadas y descartadas

**Confirmadas con el usuario:**

- `POST` solo para el conductor propietario `aprobado`; `GET` solo para admin; el motor de asignacion usa el servicio interno, sin acceso HTTP para n8n.
- Reportar GPS no exige jornada activa (sus endpoints aun no existen) ni vuelve al conductor elegible. La elegibilidad se filtra en el motor (modulo 6).
- Al registrar, invalidar en persistencia las ubicaciones vencidas del conductor; sin cron ni escrituras en el GET.
- Todo reporte valido responde `201 Created`.
- Conductor sin ubicaciones o UUID invalido: `404`.
- El DTO expone `id` como string decimal (BigInt no es seguro de serializar directamente).
- Propietario no aprobado: `403 CONDUCTOR_NO_APROBADO`.

**Detalles del contrato propuestos en este borrador para revision:**

- Regla temporal con limite estricto: `<= 300000` ms vigente, `> 300000` caducado.
- Validez efectiva = interseccion de la bandera persistida y la vigencia temporal; un registro reciente con bandera `false` no se revive.
- Orden "ultima" como `horaRegistro DESC, id DESC`, excluyendo borrado logico.
- Funcion pura `esTemporalmenteValida` reutilizable por el motor, evitando dos implementaciones de la Regla 9.
- Transaccion unica para invalidacion + insercion.
- Reutilizar `requireAuth` y `requireAdmin` existentes; la verificacion de pertenencia y estado se hace en el servicio.
- En el GET (admin), n8n recibe `401` y no `403`: `requireAdmin` solo reconoce JWT Bearer, por lo que el token `x-n8n-token` cae en identidad no reconocida. No se modifica `requireAdmin`.
- Soft delete consultado explicitamente, sin indices nuevos ni migraciones.

## 7. Riesgos

| Riesgo | Mitigacion |
|---|---|
| Dos implementaciones divergentes de la Regla 9 (ubicaciones vs motor) | Funcion pura `esTemporalmenteValida` compartida |
| Reportes simultaneos del mismo conductor | Insercion secuencial en transaccion; orden por `id` como desempate |
| Cliente imponiendo hora o validez | Rechazo del cuerpo; `horaRegistro` y `esValida` solo los define el servidor |
| Conductor eliminado logicamente recibiendo reportes | Validacion de `eliminadoEn` antes de insertar |
| Exponer posiciones de conductores ajenos | Verificacion de pertenencia antes de devolver cualquier dato |
| Volumen alto de filas sin indice | Indice diferido al motor/dashboard si el rendimiento lo exige; no optimizar prematuramente |
| Confundir reporte GPS con disponibilidad | Este modulo solo registra posicion; elegibilidad es responsabilidad del modulo 6 |

## 8. Que NO se implementa en esta spec

- Jornada, disponibilidad, elegibilidad ni seleccion de conductores (modulo 6).
- Solicitudes o notificaciones (modulo 7).
- Consulta de ubicaciones por HTTP para n8n.
- Registro, edicion o eliminacion de ubicaciones por admin.
- Indices de base de datos, migraciones o jobs de caducidad en segundo plano.
- Cambios en los documentos de referencia fuera del backend.