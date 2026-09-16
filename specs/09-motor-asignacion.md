# SPEC 09 - Motor de asignacion

> **Estado:**  Implementado
> **Depende de:** SPEC 02 (`02-migracion-schema-prisma.md`), SPEC 03 (`03-base-auth-admin.md`), SPEC 04 (`04-configuracion.md`), SPEC 08 (`08-ubicaciones.md`)
> **Fecha:** 2026-09-16
> **Objetivo:** Seleccionar los conductores elegibles mas cercanos al punto de recogida de una solicitud, aplicando las Reglas 2, 3 y 4.

## 1. Contexto

Las rutas de archivos son relativas a `backend/`.
Esta entrega corresponde al modulo 6 de `docs/ROADMAP_ENDPOINTS.md`, endpoint #18.
Se usan tambien `docs/REGLAS_DE_NEGOCIO.md`, `docs/MODELO_DE_DATOS.md` y `docs/ARQUITECTURA.md` como referencias.
El modelo Prisma existente (`Solicitud`, `Conductor`, `UbicacionConductor`, `Vehiculo`, `Configuracion`, creados en SPEC 02) y las convenciones del backend guian los detalles tecnicos.
La numeracion de specs no coincide con la numeracion de modulos del roadmap.

El roadmap describe el endpoint como "el mas logico de negocio condensada" y exige un archivo de servicio propio
(`motor-asignacion.service.ts`), aunque se exponga bajo la ruta de `solicitudes` (`/api/solicitudes/:id/candidatos`).

La Regla 2 define los filtros de elegibilidad: aprobados y no suspendidos, en jornada activa, disponibles, con ubicacion
valida, sin servicio activo y sin otra solicitud pendiente. La Regla 3 limita la busqueda al radio configurable
(`configuracion.radioMaximoBusquedaKm`, default 5). La Regla 4 exige devolver los **tres** conductores mas cercanos.

Este modulo **solo lee y calcula**: no cambia estados de la solicitud (eso pertenece al modulo 7) ni del conductor.

## 2. Alcance

**Incluye:**

- `GET /api/solicitudes/:id/candidatos`, exclusivo de n8n (`requireN8n`).
- Filtros de elegibilidad de la Regla 2 (estado aprobado, jornada activa, disponibilidad `disponible`, ubicacion vigente,
  vehiculo activo presente).
- Filtro de radio de la Regla 3 usando `configuracion.radioMaximoBusquedaKm` (por defecto 5 km).
- Seleccion de los 3 conductores mas cercanos de la Regla 4, ordenados por distancia ascendente.
- Calculo de distancia Haversine en el servicio, sin PostGIS ni consultas crudas.
- Reutilizacion de `esTemporalmenteValida()` de `ubicaciones.service` para la caducidad de la Regla 9.
- DTO estricto y errores JSON consistentes con la API.
- Funcion pura `distanciaKm()` exportada y testeable.
- Pruebas unitarias y HTTP sin base de datos, y pruebas de integracion con base de pruebas separada.
- Documentacion del contrato en el README del backend.
- Spec `09-motor-asignacion.md`.

**NO incluye:**

- El ciclo de vida de la solicitud (crear, seleccionar conductor, responder, finalizar, expirar) — modulo 7.
- Cambiar `estado` de la solicitud a `sin_conductor` cuando no hay candidatos: el endpoint solo informa `candidatos: []`.
- Transiciones de jornada ni disponibilidad del conductor (modulos posteriores).
- Notificaciones ni Supabase Realtime.
- Indices de base de datos, migraciones o dependencias npm.
- Credenciales admin o de conductor sobre este endpoint: es exclusivo de n8n.

## 3. Modelo de datos y contratos

Se reutilizan los modelos de SPEC 02 sin nuevas estructuras persistentes.

### 3.1. Reglas de negocio aplicadas

**Regla 2 (elegibilidad).** Un conductor es candidato solo si TODAS las condiciones se cumplen:

| Condicion | Implementacion |
|---|---|
| aprobado y no suspendido | `Conductor.estado == "aprobado"` |
| en jornada | `Conductor.estadoJornada == "activa"` |
| disponible | `Conductor.estadoDisponibilidad == "disponible"` (este valor ya excluye `solicitud_pendiente` y `en_servicio`, cubriendo "sin servicio activo" y "sin otra solicitud pendiente") |
| con ubicacion valida | Ultima ubicacion (`horaRegistro DESC, id DESC`) con `esValida` persistida `true` **y** `esTemporalmenteValida(horaRegistro, now)` (Regla 9: `now - horaRegistro <= 300000` ms) |
| con vehiculo activo | Existe un `Vehiculo` con `eliminadoEn null` (el mas reciente por `creadoEn`) |
| no eliminado logicamente | `Conductor.eliminadoEn == null` |

**Regla 3 (radio).** Se conservan solo los conductores cuya distancia Haversine al punto de recogida sea
`<= radioMaximoBusquedaKm`. Un valor exactamente igual al radio sigue siendo elegible.

**Regla 4 (top 3).** Los candidatos se ordenan por distancia ascendente y se devuelven como maximo 3.
Si hay menos de 3 elegibles, se devuelven los que existan.

### 3.2. Autorizacion

El endpoint es **exclusivo de n8n** (`requireN8n`, solo header `X-N8N-Token`). Un JWT valido de admin o conductor
recibe `403`; sin credencial o con token invalido, `401`. n8n **no** recibe los datos de la solicitud que crea en
la misma transaccion: el diseno del modulo 7 permitira que n8n cree la solicitud y luego consulte candidatos.

| Credencial | GET /:id/candidatos |
|---|---|
| n8n (token valido) | 200 |
| admin (JWT) | 403 |
| conductor (JWT) | 403 |
| sin credenciales / token invalido | 401 |

La autorizacion ocurre antes de validar el recurso y no se registran tokens ni cuerpos en logs nuevos.

### 3.3. DTO de respuesta

`CandidatosDto` (respuesta 200):

```json
{
  "candidatos": [
    {
      "conductorId": "uuid",
      "nombreCompleto": "Juan Perez",
      "distanciaKm": 2.35,
      "vehiculo": {
        "placa": "1234ABC",
        "marca": "Toyota",
        "modelo": "Corolla",
        "color": "Blanco",
        "capacidadPasajeros": 4
      }
    }
  ]
}
```

- `distanciaKm` se redondea a 2 decimales (el pasajero solo ve una referencia, la distancia exacta no es operativa).
- **Se expone la `placa`** en el listado: el pasajero la ve desde la seleccion de candidatos (Regla 4).
- No se exponen `creadoEn`, `eliminadoEn`, `usuarioId` ni el id del vehiculo.
- Las fechas no aparecen en este DTO (solo hay datos actuales calculados).

### 3.4. GET /api/solicitudes/:id/candidatos

Comportamiento:

1. Un UUID invalido en `:id` responde `404 NOT_FOUND` sin consultar el servicio.
2. La solicitud debe existir y no estar eliminada logicamente; en caso contrario, `404 NOT_FOUND`.
   No se valida el estado de la solicitud: el control de transiciones de estado es responsabilidad del modulo 7.
3. Se lee `configuracion.radioMaximoBusquedaKm` (fila `id = 1`). Si la fila no existe o esta eliminada logicamente,
   se usa el default documentado de `5` km (defensivo: el modulo 1 ya la crea en la primera lectura autenticada).
4. Se consultan los conductores elegibles con su ultima ubicacion y su vehiculo activo mas reciente.
5. Se descartan los que no pasan la Regla 9 y los mas lejanos que el radio.
6. Se ordenan por distancia ascendente, se toman los 3 primeros y se devuelve `200` con `{ candidatos: [...] }`.
   Si no hay ninguno, `{ candidatos: [] }` (la decision de pasar la solicitud a `sin_conductor` es del modulo 7).

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
| 401 | `UNAUTHORIZED` | Credenciales ausentes o invalidas |
| 403 | `FORBIDDEN` | JWT valido sin permiso para el recurso |
| 404 | `NOT_FOUND` | UUID invalido, solicitud inexistente o eliminada |
| 500 | `INTERNAL_ERROR` | Fallo inesperado, sin filtrar SQL, stack ni secretos |

## 4. Plan de implementacion

1. Crear `specs/09-motor-asignacion.md` (este documento).
2. Crear `src/modules/motor-asignacion/motor-asignacion.schema.ts` (esquemas `solicitudIdSchema`, `candidatoDtoSchema`,
   `candidatosDtoSchema` con `.strict()`) y `tests/motor-asignacion.schema.test.ts`; incorporar la suite a la lista
   explicita de `vitest.unit.config.ts`.
3. Crear `src/modules/motor-asignacion/motor-asignacion.service.ts` con `distanciaKm()` (Haversine, radio 6371 km)
   exportada y `obtenerCandidatos(solicitudId, now)` usando `esTemporalmenteValida` de
   `src/modules/ubicaciones/ubicaciones.service.ts`; cubrir con `tests/motor-asignacion.service.test.ts` (prisma
   mockeado, reloj controlado con `vi.setSystemTime`, limites 299999/300000/300001 ms y radio exacto); incorporar la
   suite a `vitest.unit.config.ts`.
4. Crear `src/modules/motor-asignacion/motor-asignacion.controller.ts` y `src/modules/motor-asignacion/motor-asignacion.router.ts`
   (ruta `/:id/candidatos` con `requireN8n` lazy); montar el router bajo `/api/solicitudes` en `src/app.ts` con los
   patrones de carga y errores existentes.
5. Agregar `tests/motor-asignacion.http.test.ts` con supertest y servicios mockeados: matriz de permisos (n8n, admin,
   conductor, anonimo), 404 de UUID y de servicio, y 500 seguro; incorporar la suite a `vitest.unit.config.ts`.
6. Agregar `tests/motor-asignacion.test.ts` con cobertura HTTP/integracion real sobre `TEST_DATABASE_URL`: seed de
   configuracion, solicitud y conductores con ubicaciones en distintos radios/estados; verificar orden, top 3, radio,
   caducidad, disponibilidad/jornada/estado y limpieza de registros propios.
7. Actualizar `README.md` con el endpoint, DTO, permisos y reutilizacion de la Regla 9.

Cada paso debe dejar el proyecto compilable y conservar los endpoints existentes.
No abrir puertos al importar `app.ts` ni realizar conexiones a produccion para verificar la spec.

## 5. Criterios de aceptacion

- [x] `GET /api/solicitudes/:id/candidatos` esta montado bajo `/api/solicitudes` y exige token n8n valido.
- [x] n8n recibe `200`; admin y conductor (JWT) reciben `403`; sin credencial o token invalido, `401`.
- [x] UUID invalido y solicitud inexistente o eliminada logicamente responden `404 NOT_FOUND` sin consultar el servicio.
- [x] No se valida el estado de la solicitud: cualquier solicitud existente (no eliminada) permite consultar candidatos.
- [x] Solo son candidatos los conductores `aprobado` + `activa` + `disponible` + no eliminados.
- [x] Se descartan conductores con ultima ubicacion que no cumpla `esTemporalmenteValida` (limite `> 300000` ms)
      o con `esValida` persistida `false`.
- [x] Se descartan conductores sin vehiculo activo y se expone el vehiculo mas reciente (con `placa`).
- [x] `distanciaKm` usa Haversine y redondea a 2 decimales.
- [x] Solo se devuelven conductores con `distancia <= radioMaximoBusquedaKm` (exactamente igual al radio es elegible).
- [x] Se devuelven como maximo 3 candidatos ordenados por distancia ascendente.
- [x] Sin candidatos elegibles, `200` con `{ candidatos: [] }`.
- [x] `distanciaKm()` esta exportada y es pura (misma entrada, misma salida).
- [x] Errores inesperados de persistencia reciben `500` generico sin detalles internos.
- [x] La autenticacion y los endpoints de modulos anteriores conservan su comportamiento.
- [x] `npm run build` termina correctamente.
- [x] `npm run test:unit` incluye las suites de motor-asignacion (schema, servicio y HTTP) y termina correctamente.
- [x] `npm test` termina correctamente con `TEST_DATABASE_URL` separada y cubre seed, filtros y limpieza.
- [x] README documenta el contrato del endpoint, sus permisos y la reutilizacion de la Regla 9.
- [x] No se agregan migraciones, tablas, indices, dependencias npm ni cambios en documentos externos a `backend/`.

## 6. Decisiones tomadas y descartadas

**Confirmadas con el usuario:**

- El endpoint es exclusivo de n8n (`requireN8n`); admin y conductor quedan fuera por HTTP. El servicio interno se
  reutilizara por el modulo 7 sin exponer admin.
- No se valida el estado de la solicitud: solo existencia. El control de transiciones de estado es del modulo 7.
- El DTO del candidato expone `placa`: el pasajero la ve desde el listado de candidatos (Regla 4).
- Sin candidatos: `200` con `{ candidatos: [] }`; la transicion a `sin_conductor` pertenece al modulo 7.

**Detalles del contrato propuestos en este borrador para revision:**

- Haversine con radio terrestre de 6371 km, distancia en km redondeada a 2 decimales.
- Limite del radio inclusivo: `distancia <= radioMaximoBusquedaKm`.
- Regla 9 reutilizada exclusivamente via `esTemporalmenteValida` para no duplicar logica de caducidad.
- `estadoDisponibilidad == "disponible"` se asume suficiente para cubrir "sin servicio activo" y "sin otra solicitud
  pendiente" (los enums `solicitud_pendiente` y `en_servicio` ya representan esos bloqueos).
- Si `configuracion` no existe o esta eliminada, se usa el default `5` km en lugar de fallar la peticion.
- Consulta con `findMany` y relaciones `take: 1` (ultima ubicacion y vehiculo mas reciente); el filtrado por distancia
  se hace en memoria por la baja cardinalidad esperada en el MVP. PostGIS/indices geoespaciales quedan diferidos.
- Orden de la ultima ubicacion como `horaRegistro DESC, id DESC`, excluyendo registros con `eliminadoEn` (consistente
  con SPEC 08).

## 7. Riesgos

| Riesgo | Mitigacion |
|---|---|
| Duplicar la Regla 9 en dos servicios | `esTemporalmenteValida` compartida desde `ubicaciones.service` |
| Consulta pesada al crecer el numero de conductores | Recuperar solo candidatos by estado/jornada/disponibilidad; PostGIS e indices diferidos si el rendimiento lo exige |
| Coordenadas invalidas en el punto de recogida | El schema de `Solicitud` las exige; Haversine valida rangos con aritmetica defensiva |
| Vehiculo sin datos (conductor registrado sin auto) | El registro (SPEC 06) crea vehiculo en la misma transaccion; aun asi se excluye al conductor sin vehiculo activo |
| Confundir listado de candidatos con asignacion | Este endpoint no escribe: la reserva/estado de la solicitud es del modulo 7 |
| Datos del vehiculo (incluida la placa) visibles antes de la asignacion | Decision de producto: el pasajero elige al conductor por marca/modelo/color/placa en el listado (Regla 4) |

## 8. Que NO se implementa en esta spec

- Creacion de solicitudes, seleccion de conductor, respuesta, finalizacion o expiracion (modulo 7).
- Transicion de estados de solicitud ni de conductor.
- Asignacion o reserva de conductores (modulo 7).
- Indices de base de datos, migraciones, PostGIS o jobs en segundo plano.
- Acceso del endpoint para admin o conductor.
- Cambios en los documentos de referencia fuera del backend.