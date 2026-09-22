# SPEC 11 - Tarifario y Dashboard

> **Estado:** Implementado
> **Depende de:** SPEC 02 (`02-migracion-schema-prisma.md`), SPEC 03 (`03-base-auth-admin.md`), SPEC 06 (`06-conductores-vehiculos.md`), SPEC 08 (`08-ubicaciones.md`), SPEC 10 (`10-solicitudes.md`)
> **Fecha:** 2026-09-21
> **Objetivo:** Exponer tarifas aproximadas administradas y las consultas administrativas de mapa, solicitudes activas e indicadores del modulo 8.

## 1. Contexto y alcance de la aprobacion

Este documento corresponde al modulo 8 de `../docs/ROADMAP_ENDPOINTS.md`, items #25 a #29.
Las rutas de archivos son relativas a `backend/`.
La numeracion de specs no coincide con la del roadmap.

Se conserva el estado `Aprobado` establecido por el usuario.
La aprobacion comprende las tarifas simplificadas y las cuatro propuestas confirmadas: bolivianos y fecha de inicio de visualizacion, mapa de todos los conductores no eliminados con estados separados, indicadores de disponibilidad registrada con completadas en `America/La_Paz`, y listados completos con datos minimos.
Tambien comprende las decisiones confirmadas P04 (fecha tarifaria), P06 (relaciones eliminadas) y P09 (sin cache y consistencia por respuesta), detalladas en 3.8.
Las decisiones estan integradas en las secciones siguientes; no hay una politica alternativa de versionado vigente.

Los detalles de DTOs y validacion inicialmente propuestos fueron aprobados explicitamente por el usuario en la revision conjunta registrada en 1.3.
P04, P06 y P09 estan cerrados e incorporados a los contratos; no quedan decisiones de negocio pendientes entre esos puntos.
P10 esta acreditado por la ejecucion autorizada registrada en 1.2.
La revision tecnica del paso 1 esta completada; la verificacion separada con escrituras fue autorizada por el usuario y completada.
La fase documental anterior no implemento codigo. La solicitud posterior del usuario autoriza iniciar la implementacion incremental segun 1.3.

### 1.1. Fuentes y patrones inspeccionados

- `../docs/ROADMAP_ENDPOINTS.md:173-181`: operaciones y permisos del modulo.
- `../docs/REGLAS_DE_NEGOCIO.md:21`: Regla 14, la IA consulta el tarifario y nunca calcula ni inventa precios.
- `../docs/MODELO_DE_DATOS.md:155-166` y `prisma/schema.prisma`: monto decimal exacto y modelo actual de tarifas.
- `../docs/ARQUITECTURA.md:40-46`: carpetas separadas para tarifario y dashboard; este ultimo es lectura transversal.
- `src/middlewares/auth.ts`: `requireN8nOrAdmin` y `requireAdmin` existentes, con precedencias diferentes.
- `src/modules/configuracion/configuracion.schema.ts` y `src/modules/solicitudes/solicitudes.schema.ts`: camelCase, cuerpos estrictos, actualizaciones parciales no vacias y DTOs explicitos.
- `src/modules/conductores/conductores.service.ts`: filtro de conductor no eliminado y vehiculo no eliminado mas reciente; no filtra el borrado del usuario relacionado.
- `src/modules/ubicaciones/ubicaciones.service.ts`: ultima ubicacion por `horaRegistro DESC, id DESC` y `esTemporalmenteValida`, sin escribir al consultar.
- `src/modules/solicitudes/solicitudes.service.ts`: seis estados no terminales y fechas serializadas con `toISOString()`.
- `src/app.ts`: no monta aun rutas de tarifas ni dashboard.

La mencion de historico en el documento externo de datos no exige versionado en este modulo: la decision posterior del usuario conserva el campo `vigenciaDesde` como inicio de visualizacion y permite editar la misma fila.
El roadmap omite `sin_conductor` entre los terminales; este spec conserva el conjunto completo de SPEC 10.
No se modifican los documentos externos ni README en esta revision.

### 1.2. Dependencia SPEC 10 y evidencia P10

SPEC 10 cubre solicitudes y excluye tarifario/dashboard.
Su paso 3 de ampliacion de `obtenerCandidatos(solicitudId, now, excluirIds = [])` pertenece al motor y no se repite aqui.
SPEC 10 figura como `Implementado`, pero mantiene sin marcar el criterio de `npm test` con base separada (`specs/10-solicitudes.md:408`).
README tambien conserva una indicacion de verificacion pendiente en su apartado de siguientes pasos.
La inspeccion de archivos no acredita que las pruebas pasen y la falta de evidencia no demuestra un fallo.

P10 requiere una fase de verificacion **explicitamente autorizada para escrituras** antes de implementar este modulo.
`tests/setup.ts:44-58` valida identidades de bases distintas y despues ejecuta `prisma migrate deploy` en pruebas.
Por tanto, `npm test` no es una comprobacion de solo lectura, aun cuando este spec no agrega migraciones.
La evidencia debe registrar comando, fecha, suites/pruebas pasadas, fallidas y omitidas, y resultado saneado.
Los fallos deben diagnosticarse sin confundir infraestructura con defectos funcionales.
No se cambia el estado o checklist de SPEC 10; la evidencia de la dependencia se registra aqui.

**Evidencia P10 - 2026-09-21 (zona del equipo: UTC-04:00):**

- Autorizacion: el usuario autorizo explicitamente las pruebas de integracion y las migraciones existentes en la base exclusiva de pruebas.
- Comando: `npm test` (`vitest run`), inicio 20:17:46, duracion 445.62 segundos, salida exitosa.
- Suites: 28 aprobadas, 0 fallidas, 0 omitidas. Pruebas: 1125 aprobadas, 0 fallidas, 0 omitidas.
- El setup confirmo `Identidades PostgreSQL separadas verificadas en modo solo lectura` y `Migraciones existentes: deploy completado solo en pruebas`.
- Intento anterior del mismo comando interrumpido por el limite externo de 240 segundos; mostro un fallo en `409 CONFLICT cuando la placa nueva colisiona (activa y soft-delete)` de `tests/conductores.test.ts`, con duracion 5017 ms. No produjo resumen completo y no acredita exito. El fallo no se reprodujo al repetir la suite completa con limite externo de 1200 segundos y sin cambios de codigo; su causa no esta determinada.
- Aviso no bloqueante: Vite advierte sobre sintaxis ESM en la configuracion CommonJS ante un futuro cambio de cargador. No se modifico la configuracion ni se oculto el aviso.
- No se exponen URLs ni credenciales. Esta evidencia acredita la dependencia existente, no la implementacion ni las pruebas futuras de SPEC 11.

### 1.3. Aprobacion tecnica y cierre del paso 1

El 2026-09-21 el usuario aprobo explicitamente el paquete tecnico presentado en la revision conjunta:

- Operaciones, permisos, codigos de respuesta y errores de 3.2 y 3.7, sin modificar autenticacion.
- Descripcion recortada de 1 a 255 caracteres; monto string canonico exacto de dos decimales entre `0.01` y `99999999.99`, sin Number ni redondeo; fecha de calendario valida `YYYY-MM-DD`, segun 3.3.
- Entradas estrictas, PATCH no vacio solo de descripcion/monto, rechazo de campos desconocidos y query no vacia; UUID invalido, inexistente o eliminado como 404.
- DTOs, proyecciones minimas, nulabilidad, ordenes y desempates de 3.3-3.7; instantes UTC, una referencia temporal por respuesta y limites diarios inclusivo/exclusivo en `America/La_Paz`.
- Dashboard con `Cache-Control: no-store` y transaccion de lectura con aislamiento explicito `RepeatableRead` por respuesta. Todas las consultas y relaciones de esa respuesta deben usar la misma transaccion, sin N+1 ni cache. La garantia debe verificarse con pruebas de concurrencia y frescura, no solo mocks.

Esta confirmacion cierra el paso 1 sin reabrir P04/P06/P09 ni repetir P10. No acredita implementacion, build, pruebas ni consistencia efectiva de SPEC 11.
La rama activa es `spec-11-tarifario-dashboard`, creada con autorizacion para conservar este documento sin seguimiento, sin commit ni stash.
El usuario autorizo continuar al paso 2 tras la pausa de revision del paso 1, conforme a `spec-impl`.
Las referencias conservadas a la entrega documental y los rotulos de propuestas en las secciones siguientes describen la fase anterior; los detalles enumerados aqui ya estan aprobados y no requieren otra aprobacion tecnica. La implementacion y README del paso 12 estan autorizados dentro del flujo incremental, sin ampliar el alcance.

### 1.4. Paso 2 - schemas y pruebas unitarias

Implementados `src/modules/tarifario/tarifario.schema.ts` y `tests/tarifario.schema.test.ts`; suite registrada en `vitest.unit.config.ts`.
Se cubren POST estricto, PATCH no vacio solo de descripcion/monto, query vacia estricta, UUID de ruta y DTO minimo. El monto se valida como string sin conversion numerica ni redondeo; las fechas se validan con `z.iso.date()`, incluidos dias imposibles y reglas de anos bisiestos.

Evidencia ejecutada el 2026-09-21:

- `npm run build`: exitoso.
- `npm run test:unit`: 18 suites y 942 pruebas aprobadas, cero fallidas/omitidas; 12.06 segundos.
- `npm run test:unit -- tests/tarifario.schema.test.ts`: 1 suite y 140 pruebas aprobadas, cero fallidas/omitidas; 392 ms.
- Aviso no bloqueante existente de Vite sobre configuracion ESM cargada como CommonJS; no se oculto ni modifico la configuracion por este aviso.

No se ejecuto integracion ni migraciones. Esta evidencia valida solo el incremento de schemas y la regresion unitaria disponible; no acredita HTTP, persistencia, fechas de negocio del servicio ni concurrencia de SPEC 11. Los criterios generales de aceptacion permanecen sin marcar.
Paso 2 completado; el usuario autorizo continuar al paso 3 tras la revision del diff.

### 1.5. Paso 3 - servicio de consulta de tarifas

Implementados `src/modules/tarifario/tarifario.service.ts` y `tests/tarifario.service.test.ts`; suite registrada en `vitest.unit.config.ts`.
La lectura devuelve filas no eliminadas con `vigenciaDesde` menor al inicio del dia siguiente en `America/La_Paz` (inicio inclusivo de la fecha de negocio), sin filtros por version, agrupaciones ni descripcion; orden total `descripcion ASC, id ASC`. Los montos Decimal se serializan como string exacto de dos decimales y `vigenciaDesde` como fecha de calendario `YYYY-MM-DD`, en una sola consulta sin N+1.
`America/La_Paz` se resuelve con desplazamiento UTC-4 fijo, sin horario de verano; las funciones puras `fechaDeNegocioEnLaPaz` y `inicioDelDiaSiguienteEnLaPaz` se reutilizaran en el dashboard.

Evidencia ejecutada el 2026-09-21:

- `npm run build`: exitoso.
- `npm run test:unit -- tests/tarifario.service.test.ts`: 1 suite y 12 pruebas aprobadas, cero fallidas/omitidas; 709 ms.
- `npm run test:unit`: 19 suites y 954 pruebas aprobadas, cero fallidas/omitidas; 9.34 segundos.

No se ejecuto integracion ni migraciones; el servicio se probo con `prisma` mockeado, sin puertos. La garantia del recorrido UTC real sobre `@db.Date` y `Decimal` corresponde a la integracion del paso 11.
Paso 3 completado; el usuario autorizo continuar al paso 4 tras la revision del diff.

### 1.6. Paso 4 - creacion y edicion directa de tarifas

Se agregan `crearTarifa` y `actualizarTarifa` en `tarifario.service.ts`, ampliando `tests/tarifario.service.test.ts`.
POST persiste `descripcion`, `monto` (string exacto) y `vigenciaDesde` como `YYYY-MM-DD` a medianoche UTC, aceptando fechas pasadas, de hoy y futuras sin restriccion de negocio; devuelve el DTO de la fila creada. No se valida el formato aqui porque corresponde al schema aprobado.
PATCH exige input ya validado por `actualizarTarifaSchema`: solo `descripcion` y/o `monto`, nunca `vigenciaDesde`. Implementado con `updateMany` filtrado por `id, eliminadoEn: null` dentro de una transaccion, seguido de `findFirst` con el mismo filtro: una fila inexistente o eliminada devuelve `NOT_FOUND` sin escribir, y la exclusion de eliminadas se conserva tambien ante concurrencia; no existe 409 por fecha ni se crea otra fila.
El rechazo de `vigenciaDesde`, cuerpos vacios, UUID invalido, precision y desbordamiento sigue siendo responsabilidad de los schemas aprobados en el paso 2; el controlador y las pruebas HTTP los cubriran en el paso 5.

Evidencia ejecutada el 2026-09-21:

- `npm run build`: exitoso.
- `npm run test:unit -- tests/tarifario.service.test.ts`: 1 suite y 25 pruebas aprobadas, cero fallidas/omitidas; 546 ms.
- `npm run test:unit`: 19 suites y 967 pruebas aprobadas, cero fallidas/omitidas; 12.48 segundos.

No se ejecuto integracion ni migraciones. La exclusion ante concurrencia real y el recorrido `Decimal`/UTC se verificaran en integracion (paso 11).
Paso 4 completado; pausa para revision del diff antes del paso 5 (controlador, router, montaje y pruebas HTTP de tarifas).

### 1.7. Paso 5 - controlador, router, montaje y pruebas HTTP de tarifas

Creados `src/modules/tarifario/tarifario.controller.ts` y `src/modules/tarifario/tarifario.router.ts`; la ruta se monta en `src/app.ts` con `app.use("/api/tarifas", tarifarioRouter)`, y `tests/tarifario.http.test.ts` queda registrada en `vitest.unit.config.ts`.
El router aplica los middlewares existentes `requireN8nOrAdmin` y `requireAdmin` mediante import perezoso, igual que los modulos vecinos, y el controlador valida query/cuerpo/`id` con los schemas aprobados lanzando sobre el `errorHandler` global (400 seguro) o respondiendo 404 sin consultar el servicio ante UUID invalido. La autorizacion precede a la validacion del recurso, query y cuerpo.

Evidencia ejecutada el 2026-09-21:

- `npm run build`: exitoso.
- `npm run test:unit -- tests/tarifario.http.test.ts`: 1 suite y 25 pruebas aprobadas, cero fallidas/omitidas; 1.15 segundos.
- `npm run test:unit`: 20 suites y 992 pruebas aprobadas, cero fallidas/omitidas; 10.03 segundos.

La suite HTTP cubre la matriz completa de 3.2 sobre `/api/tarifas` (n8n/admin GET, admin POST/PATCH, precedencias del header n8n, conductor con 403 y ausentes/invalidos con 401 sin tocar el servicio) y los errores 400 (query no vacia, cuerpo vacio/invalido, `vigenciaDesde` o campos desconocidos en PATCH), 404 (UUID invalido sin consultar servicio e inexistente/eliminada desde el servicio), 401/403/500 seguro, con `prisma` y el servicio mockeados y sin abrir puertos.
No se ejecuto integracion ni migraciones. El recorrido real con `TEST_DATABASE_URL` corresponde al paso 11.
Paso 5 completado; pausa para revision del diff antes del paso 6 (schemas del dashboard).

### 1.8. Paso 6 - schemas del dashboard

Creados `src/modules/dashboard/dashboard.schema.ts` y `tests/dashboard.schema.test.ts`; suite registrada en `vitest.unit.config.ts`.
DTOs minimos y estrictos: `mapaConductorDtoSchema` (id, nombreCompleto, `estado`, `estadoJornada`, `estadoDisponibilidad` con los enums Prisma existentes `EstadoConductor`, `EstadoJornada` y `EstadoDisponibilidad`, vehiculo minimo placa/marca/modelo/color nullable, ubicacion latitud/longitud/horaRegistro nullable y `ultimaUbicacionRegistradaEn` nullable; sin `estadoVisual`), `solicitudActivaDtoSchema` (id, estado reutilizando el `estadoSolicitudSchema` existente de solicitudes sin inventar valores, resumenes `pasajero` y `conductorAsignado` strict nullable, coordenadas de recogida con limites, destino/expiraEn nullable y creadoEn ISO), e `indicadoresDtoSchema` (cuatro enteros no negativos). `dashboardQuerySchema` es una query exclusivamente vacia estricta para las tres rutas, con el mismo patron que tarifas.
La suite cubre todos los valores de los enums Prisma, la igualdad de representacion con `estadoSolicitudSchema.options`, nulabilidad segun 3.4-3.5, rechazo de campos no publicados y de `estadoVisual`, limits GPS, enteros no negativos, query vacia y tipos de query invalidos.

Evidencia ejecutada el 2026-09-21:

- `npm run build`: exitoso.
- `npm run test:unit -- tests/dashboard.schema.test.ts`: 1 suite y 98 pruebas aprobadas, cero fallidas/omitidas; 472 ms.
- `npm run test:unit`: 21 suites y 1090 pruebas aprobadas, cero fallidas/omitidas; 10.29 segundos.

No se ejecuto integracion ni migraciones. Los enums se importaron de `@prisma/client` y de `solicitudes.schema.ts` para conservar la representacion exacta; no se crearon servicio, controlador ni rutas (pasos 7-10).
Paso 6 completado; pausa para revision del diff antes del paso 7 (servicio de mapa de conductores).

### 1.9. Paso 7 - servicio del mapa de conductores

Creados `src/modules/dashboard/dashboard.service.ts` y `tests/dashboard.service.test.ts`; suite registrada en `vitest.unit.config.ts`.
`obtenerConductoresParaMapa(now)` consulta por lote con una sola `findMany` y relaciones embebidas `take: 1` (sin N+1, sin HTTP interno y solo lectura): todos los conductores no eliminados sin filtros de aprobacion, jornada, disponibilidad, vehiculo ni GPS, y sin filtrar por usuario relacionado (P06), ordenados `nombreCompleto ASC, id ASC`. La ultima ubicacion no eliminada se selecciona por `horaRegistro DESC, id DESC` y el vehiculo no eliminado por `creadoEn DESC, id DESC`; `ubicacion` es `null` si falta, tiene `esValida` falsa o caduca, reutilizando `esTemporalmenteValida` de `src/modules/ubicaciones/ubicaciones.service.ts` (Regla 9/SPEC 08) contra la referencia temporal comun, sin recuperar posiciones anteriores; `ultimaUbicacionRegistradaEn` conserva la fecha del ultimo registro no eliminado como campo separado. El DTO se mapea contra `mapaConductorDtoSchema` del paso 6.

Evidencia ejecutada el 2026-09-21:

- `npm run build`: exitoso.
- `npm run test:unit -- tests/dashboard.service.test.ts`: 1 suite y 27 pruebas aprobadas, cero fallidas/omitidas; 364 ms.
- `npm run test:unit`: 22 suites y 1117 pruebas aprobadas, cero fallidas/omitidas; 10.65 segundos.

La suite cubre estados separados de aprobacion/jornada/disponibilidad, P06 (usuario eliminado no excluye; solo `eliminadoEn: null` en el conductor), vehiculo ausente, ubicacion ausente/invalida/caducada con fecha separada conservada, limites 299999/300000/300001 ms, bandera `esValida` falsa, orden estable, consulta unica sin N+1, vacio y fallos de lectura, con `prisma` mockeado y uso real de `esTemporalmenteValida`.
No se ejecuto integracion ni migraciones. La garantia P09 (transaccion `RepeatableRead` por respuesta) y la vigencia real sobre `@db.Date`/Decimal se verificaran en pasos 9-11.
Paso 7 completado; pausa para revision del diff antes del paso 8 (listado de solicitudes activas).

### 1.10. Paso 8 - listado de solicitudes activas

Se agrega `obtenerSolicitudesActivas()` en `src/modules/dashboard/dashboard.service.ts`, ampliando `tests/dashboard.service.test.ts` (50 pruebas en la suite), sin nuevas rutas.
Los seis estados activos se reutilizan desde `ESTADOS_NO_TERMINALES` de `solicitudes.service.ts`, ahora exportada sin alterar el ciclo de vida de SPEC 10; el `where` aplica `eliminadoEn: null` y `estado: { in: ESTADOS_NO_TERMINALES }`, con orden `creadoEn DESC, id DESC` y lectura por lote en una sola `findMany` con relaciones embebidas (`pasajero` y `conductorAsignado` con `eliminadoEn`), sin N+1, sin transiciones ni expiraciones desde GET. P06: la solicitud no eliminada permanece aunque su pasajero/conductor relacionado este eliminado, devolviendo el resumen como `null` sin exponer datos de la relacion; `conductorAsignado` contiene solo `id` y `nombreCompleto`, `pasajero` solo `id` y `nombre`, y `destino`/`expiraEn` son nullable. El DTO se mapea contra `solicitudActivaDtoSchema` del paso 6.

Evidencia ejecutada el 2026-09-21:

- `npm run build`: exitoso (tsc).
- `npm run test:unit -- tests/dashboard.service.test.ts`: 1 suite y 50 pruebas aprobadas, cero fallidas/omitidas; 408 ms.
- `npm run test:unit`: 22 suites y 1140 pruebas aprobadas, cero fallidas/omitidas; 10.53 segundos.

La suite cubre los seis estados activos, la exclusion de los cuatro terminales (incluido `sin_conductor`), solicitud eliminada excluida, pasajero/conductor eliminado con resumen `null` y solicitud visible, sin conductor, destino/expiraEn nulos, orden estable, solo lectura sin escrituras, mas de 25 registros sin truncamiento, ausencia de N+1, vacio y fallos, con `prisma` mockeado.
No se ejecuto integracion ni migraciones. Los resumenes nulos reales y los limites con `TEST_DATABASE_URL` corresponden al paso 11.
Paso 8 completado; pausa para revision del diff antes del paso 9 (indicadores y limites del dia).

### 1.11. Paso 9 - indicadores y mecanismo P09

Se agrega `obtenerIndicadores(now)` en `src/modules/dashboard/dashboard.service.ts` y el mecanismo P09 en las tres lecturas de dashboard: `enLecturaRepeatableRead` envuelve cada respuesta en `prisma.$transaction` con `isolationLevel` explicito `Prisma.TransactionIsolationLevel.RepeatableRead`, de modo que todas las consultas y relaciones de una misma respuesta usan la misma transaccion interactiva sin cache ni HTTP interno; ninguno de estos GET escribe ni abre puertos. El servicio reutiliza `fechaDeNegocioEnLaPaz` de tarifario y exporta `inicioDelDiaEnLaPaz`/`inicioDelDiaSiguienteEnLaPaz` para el intervalo del dia (ejemplo 2026-09-21: desde `2026-09-21T04:00:00.000Z` inclusive hasta `2026-09-22T04:00:00.000Z` exclusive). Los cuatro conteos usan `Promise.all` dentro de la misma transaccion: conductores con `eliminadoEn: null` por `estadoDisponibilidad`, solicitudes no eliminadas en los seis estados `ESTADOS_NO_TERMINALES` y completadas con `estado = finalizada` y `finalizadaEn` dentro del dia. P06 se aplica a conteos: solo se filtra `eliminadoEn`, sin filtros de usuario, pasajero, conductor, aprobacion, jornada, vehiculo ni GPS; `solicitud_pendiente`/`no_disponible` no suman; `finalizadaEn = null` u otro estado con fecha no cuentan como completadas. La suite ampliada a 78 pruebas cubre los cuatro conteos por separado, disponibilidad registrada vs elegibilidad (suspendido disponible cuenta; jornada/GPS/vehiculo no descartan), conductores en servicio como conteo de conductores, seis activos, cuatro terminales incluido `sin_conductor`, limites del dia en `America/La_Paz` (inicio inclusive, instante anterior al siguiente inicio incluido, siguiente inicio exclusive), P06 en conteos, cero sin datos, sin escrituras correctivas y el mecanismo P09 (una unica transaccion `RepeatableRead` por respuesta, mapa y solicitudes activas tambien transaccionales).

Evidencia ejecutada el 2026-09-21:

- `npm run build`: exitoso (tsc).
- `npm run test:unit -- tests/dashboard.service.test.ts`: 1 suite y 78 pruebas aprobadas, cero fallidas/omitidas; 500 ms.
- `npm run test:unit`: 22 suites y 1168 pruebas aprobadas, cero fallidas/omitidas; 10.46 segundos.

La verificacion unitaria acredita la transaccion interactiva con `isolationLevel = RepeatableRead` por respuesta y las consultas exactas sobre el cliente transaccional con prisma mockeado. La prueba real de concurrencia/frescura P09 (escrituras concurrentes detectadas por la instantanea de `RepeatableRead`) requiere PostgreSQL real y se registra como prueba pendiente de integracion en el paso 11, sin marcar ese criterio. No se ejecuto integracion ni migraciones. `Cache-Control: no-store` pertenece al paso 10 (controller/router).
Paso 9 completado; pausa para revision del diff antes del paso 10 (controller, router, montaje y pruebas HTTP del dashboard).

### 1.12. Paso 10 - controller, router, montaje y pruebas HTTP del dashboard

Se crean `src/modules/dashboard/dashboard.controller.ts` y `src/modules/dashboard/dashboard.router.ts`, se monta `dashboardRouter` en `src/app.ts` (`/api/dashboard`) y se agrega `tests/dashboard.http.test.ts` (30 pruebas) registrada en `vitest.unit.config.ts`.
Tres rutas bajo `requireAdmin` reutilizado mediante lazy import y validacion de query exclusivamente vacia con `dashboardQuerySchema` (una query no vacia responde 400 `VALIDATION_ERROR` sin consultar servicio, mismo patron que tarifas): `GET /api/dashboard/conductores-mapa` (200, array), `GET /api/dashboard/solicitudes-activas` (200, array) y `GET /api/dashboard/indicadores` (200, objeto con cuatro conteos). Cada exito responde con `Cache-Control: no-store` (header P09, paso 1.3/3.7) mediante `res.set("Cache-Control", "no-store")`, no solo para tokens; los errores no llevan ese header. Los controladores importan el servicio de forma lazy y derivan `new Date()` por request como referencia temporal comun. No se abren puertos al importar `app.ts`.

Cobertura de la matriz 3.2 para las tres rutas, con prisma (`usuario.findUnique`) y servicio mockeados y sin base/puertos: JWT admin valido 200 con `Cache-Control: no-store`; conductor valido 403 `FORBIDDEN` sin consultar servicio; solo n8n valido 401 `UNAUTHORIZED`; anonimo 401; n8n invalido mas JWT admin valido responde 200 (requireAdmin ignora el header n8n y exige Bearer de admin activo); n8n valido mas JWT conductor valido 403; JWT invalido 401; usuario eliminado 401; query no vacia 400 `VALIDATION_ERROR`; fallo inesperado 500 `INTERNAL_ERROR` generico sin SQL/stack/URLs/secretos.

Evidencia ejecutada el 2026-09-21:

- `npm run build`: exitoso (tsc).
- `npm run test:unit -- tests/dashboard.http.test.ts`: 1 suite y 30 pruebas aprobadas, cero fallidas/omitidas; 1.28 segundos.
- `npm run test:unit`: 23 suites y 1198 pruebas aprobadas, cero fallidas/omitidas; 12.18 segundos.

No se ejecuto integracion ni migraciones. `Cache-Control: no-store` queda verificado a nivel HTTP unitario; la concurrencia/frescura real del mecanismo P09 sigue registrada como prueba pendiente del paso 11.
Paso 10 completado; pausa para revision del diff antes del paso 11 (integracion autorizada con `TEST_DATABASE_URL`).

### 1.13. Paso 11 - integracion autorizada con `TEST_DATABASE_URL` exclusiva

Se agregan `tests/tarifario.test.ts` (14 pruebas) y `tests/dashboard.test.ts` (21 pruebas), que corren bajo `vitest.config.ts` con `globalSetup` que valida identidades separadas read-only de `DATABASE_URL` y `TEST_DATABASE_URL` (via `tests/database-safety.ts`), ejecuta `prisma migrate deploy` solo sobre la base de pruebas, inyecta `adminTestDatabaseUrl` y usa `fileParallelism: false`. Cada suite usa un prefijo propio (`sp11-tar` / `sp11-dash`), realiza limpieza previa determinista por prefijo en dependencias/entidades y `afterAll` que elimina solo los registros propios por ids registrados, con conteos finales en cero; nunca hay limpieza global. Se importan `app` y el `prisma` real; no se abren puertos.

Tarifario (14): POST acepta fechas pasadas, de hoy y futuras en `America/La_Paz` (P04) con 201 y DTO valido; persiste montos `Decimal(10,2)` exactos `0.01` y `99999999.99` sin perdida ni redondeo (respuesta en string y `.toFixed(2)` en la fila); rechaza `0.00`, `100000000.00` y numeros JSON con 400 sin crear filas; GET incluye pasadas y de hoy, excluye la futura y las eliminadas con orden estable (`descripcion` asc); PATCH edita descripcion y monto conservando id, `vigenciaDesde` y campos omitidos sin crear otra fila; una tarifa ya vigente no produce 409 por su fecha; 404 para UUID invalido, inexistente y eliminada; 400 para cuerpo vacio, solo `vigenciaDesde`, campos desconocidos y montos invalidos sin escritura; permisos reales sobre usuarios reales: GET n8n y admin 200, conductor 403, anonimo 401; POST/PATCH solo admin (n8n valido 401, conductor 403) sin escribir; DTOs y errores no exponen secretos ni campos internos; fallo real de base produce 500 generico.

Dashboard (21): mapa y activas devuelven mas de 25 registros sin truncamiento (>=32 y >=30 propios) con ids unicos, DTOs estrictos y orden estable incluidas los empates (mapa `nombreCompleto` asc/`id` asc; activas `creadoEn` desc/`id` desc con ids controlados); activas incluyen los seis estados y excluyen los cuatro terminales y las eliminadas; P06 en mapa (conductor no eliminado con usuario eliminado permanece; conductor eliminado queda fuera y no cuenta) y en activas (pasajero o conductor eliminado dejan la solicitud visible con el resumen `null`); vehiculo `null` sin registro; ubicacion y `ultimaUbicacionRegistradaEn` nulas sin ubicaciones; GPS real sobre `esTemporalmenteValida` (fresca de 30 s valida; `300000` y `300001` ms ya vencidas al momento de leer, bandera `esValida: false` y ubicaciones eliminadas sin efecto ni recuperacion de anteriores; la frontera exacta de 299999/300000 con reloj mockeado queda acreditada en unitarias); indicadores por deltas sobre disponibilidad registrada (suspendido disponible cuenta sin GPS, jornada ni vehiculo; `en_servicio` suma solo conductores; `no_disponible`/`solicitud_pendiente` no suman; P06 en conteos); completadas del dia con estado `finalizada` y `finalizadaEn` en el dia de `America/La_Paz` (inicio inclusive, siguiente inicio exclusive con las mismas funciones exportadas, `null` y otro estado con fecha excluidos); permisos reales, `Cache-Control: no-store` en los 200 y query no vacia 400 en las tres rutas.

P09 acreditado en integracion: la respuesta de `indicadores` abre una transaccion real `RepeatableRead` sobre la base de pruebas (intercepcion del cliente real que observa `isolationLevel = "RepeatableRead"` y delega la transaccion original); PostgreSQL real mantiene la instantanea (una transaccion `RepeatableRead` no ve el `commit` concurrente) y detecta la escritura concurrente con codigo `40001` (serialization failure); GETs concurrentes bajo escrituras concurrentes de disponibilidad responden consistentes sin errores. La garantia es la instantanea del mecanismo elegido por respuesta, no solo un reloj comun ni el aislamiento por defecto; sigue sin exigirse igualdad entre endpoints consultados en momentos distintos. Ningun GET escribe ni transiciona.

Evidencia ejecutada el 2026-09-21:

- `npm run build`: exitoso (tsc).
- `npm run test:unit`: 23 suites y 1198 pruebas aprobadas, cero fallidas/omitidas; 11.28 segundos.
- `npm run test -- tests/tarifario.test.ts tests/dashboard.test.ts`: 2 suites y 35 pruebas aprobadas, cero fallidas/omitidas; 139.32 segundos, con identidades PostgreSQL separadas verificadas en modo solo lectura y migraciones existentes aplicadas solo en pruebas (`prisma migrate deploy`).

Paso 11 completado; pausa para revision del diff antes del paso 12 (README de la futura entrega de implementacion).

## 2. Alcance

**Incluye:**

- Consulta de tarifas vigentes por n8n y administrador, con un monto aproximado en Bs por descripcion registrada.
- Creacion y edicion directa de descripcion y monto por administrador, sin historial de versiones.
- Uso del campo existente `vigenciaDesde` para indicar desde que fecha se muestra una tarifa en `America/La_Paz`; POST acepta pasado/hoy/futuro y PATCH conserva la fecha inmutable.
- Mapa administrativo de todos los conductores no eliminados, aunque su usuario este eliminado, con aprobacion, jornada y disponibilidad separadas.
- Listado administrativo de solicitudes activas segun SPEC 10, no eliminadas aunque sus relaciones esten eliminadas; resumen de pasajero/conductor eliminado como `null`.
- Cuatro indicadores: conductores disponibles, conductores en servicio, solicitudes activas y completadas del dia en `America/La_Paz`.
- Listados sin paginacion ni truncamiento a 25, con los datos minimos necesarios para el dashboard.
- Dashboard sin cache y con instantanea consistente dentro de cada respuesta, sin garantia de igualdad entre endpoints consultados en momentos distintos.
- Para la futura implementacion: modulos `tarifario` y `dashboard`, validaciones/DTOs, permisos existentes y pruebas de schema, servicio, HTTP e integracion autorizada.

**NO incluye:**

- Versionado de tarifas, identidad por concepto, rangos de precios o garantia de precio final.
- Campos nuevos, campo moneda, tablas, indices, migraciones nuevas o cambios al modelo actual.
- Calculo automatico de precios, tarifas por kilometro, pagos o conversion de monedas.
- Frontend, renderizado del mapa, app del conductor ni flujos n8n.
- Gestion manual de jornada/disponibilidad, asignacion manual o nuevos roles.
- Reimplementar solicitudes, el motor o el paso 3 de SPEC 10.
- Analitica avanzada, reportes de rechazo/expiracion, exportaciones o historicos GPS.
- WebSockets, Realtime, notificaciones o infraestructura de polling.
- Endpoint de eliminacion/restauracion de tarifas.
- Edicion de README, codigo u otros documentos en esta entrega documental.

## 3. Modelo de datos y contratos

### 3.1. Persistencia conservada

No se introducen nuevas estructuras persistentes ni se modifican las existentes.

| Modelo/campo existente | Tipo o uso |
|---|---|
| `Tarifa.id` | String UUID, identidad de la fila |
| `Tarifa.descripcion` | String requerido, sin restriccion de unicidad |
| `Tarifa.monto` | Decimal(10,2), un monto aproximado, nunca Float |
| `Tarifa.vigenciaDesde` | DateTime con persistencia SQL Date, inicio de visualizacion |
| `Tarifa.creadoEn` | DateTime, valor inicial del servidor |
| `Tarifa.eliminadoEn` | DateTime nullable, borrado logico existente |
| `Conductor` | Identidad, aprobacion, jornada y disponibilidad |
| `Vehiculo` | Datos del vehiculo relacionado |
| `UbicacionConductor` | Coordenadas, `horaRegistro`, `esValida`, borrado logico |
| `Solicitud` | Estado, relaciones y fechas, incluida `finalizadaEn` |

La moneda es una convencion del contrato: todos los montos estan expresados en bolivianos (Bs).
No se agrega `moneda` a persistencia ni a los DTOs propuestos.
Cada fila se identifica por `id`; no se infieren conceptos ni relaciones entre filas por su descripcion.
No se elige una version ganadora ni se agrupan filas por fecha o descripcion.
No se agrega unicidad ni se deduplican silenciosamente datos existentes.
El indice `[estado, expiraEn]` de `Solicitud` ya existe; no garantiza optimizacion de toda consulta nueva.
La tabla de rechazos de SPEC 10 no es necesaria para estos cuatro indicadores.

### 3.2. Operaciones y permisos

Los accesos provienen del roadmap y reutilizan la autenticacion actual sin modificarla.
El detalle de `PATCH /:id`, codigos de exito y DTOs es una propuesta tecnica concreta conforme a los modulos existentes.

| Operacion | Middleware existente | Exito propuesto |
|---|---|---|
| `GET /api/tarifas` | `requireN8nOrAdmin` | 200, array de tarifas vigentes |
| `POST /api/tarifas` | `requireAdmin` | 201, tarifa creada |
| `PATCH /api/tarifas/:id` | `requireAdmin` | 200, tarifa actualizada |
| `GET /api/dashboard/conductores-mapa` | `requireAdmin` | 200, array de conductores |
| `GET /api/dashboard/solicitudes-activas` | `requireAdmin` | 200, array de solicitudes |
| `GET /api/dashboard/indicadores` | `requireAdmin` | 200, objeto con cuatro conteos |

El item 26 del roadmap agrupa POST y PATCH; son dos operaciones HTTP, no una sola.

**Matriz derivada del middleware actual:**

| Credencial | GET tarifas | Escritura tarifas y todo dashboard |
|---|---|---|
| JWT admin activo valido, sin header n8n | Permitido | Permitido |
| JWT conductor activo valido, sin header n8n | 403 `FORBIDDEN` | 403 `FORBIDDEN` |
| Solo `X-N8N-Token` valido | Permitido | 401 `UNAUTHORIZED` |
| Sin credencial, o JWT invalido/expirado/usuario eliminado sin header n8n valido | 401 `UNAUTHORIZED` | 401 `UNAUTHORIZED` |
| Header n8n no vacio invalido + JWT admin valido | 401 `UNAUTHORIZED` | Permitido |
| Header n8n valido + JWT conductor valido | Permitido como n8n | 403 `FORBIDDEN` |

`requireN8nOrAdmin` prioriza el header n8n no vacio; uno incorrecto no se rescata con JWT valido.
`requireAdmin` ignora el header n8n y exige Bearer de admin activo.
Un fallo de persistencia al autenticar devuelve 500 seguro, no acceso.
La autorizacion precede a validar recurso, query y cuerpo en los controladores; se conserva el parser JSON global existente.

### 3.3. Tarifas simples

**Reglas aprobadas:**

- Un monto aproximado por descripcion, expresado en Bs; no es un rango ni un precio final garantizado.
- El administrador crea y edita directamente descripcion y monto en la misma fila, tambien si ya se muestra.
- `vigenciaDesde` indica desde que fecha se muestra; una fila futura no aparece antes de esa fecha.
- P04: la fecha de negocio tarifaria usa `America/La_Paz`; POST acepta fechas pasadas, de hoy y futuras. PATCH solo permite descripcion/monto; `vigenciaDesde` es inmutable.
- Editar no crea otra fila ni conserva una version anterior.
- IA/n8n consulta los valores registrados y los comunica como aproximados; nunca los inventa ni calcula.
- Si no hay referencia registrada, no se comunica un precio sustituto. Los flujos n8n quedan fuera del alcance de implementacion/verificacion de este spec.

**Contrato tecnico propuesto para revision:**

- GET devuelve todas las filas no eliminadas con `vigenciaDesde <= fechaDeNegocio` de `America/La_Paz`, inicio inclusivo, sin fecha de fin ni dependencia de la zona local del servidor.
- Respuesta sin referencias: `200 []`; sin valores por defecto, calculados o inventados.
- POST exige `descripcion`, `monto` y `vigenciaDesde`.
- PATCH exige un objeto no vacio con `descripcion` y/o `monto`; los omitidos se conservan. Rechaza `vigenciaDesde`, incluso si coincide con la fecha guardada, conforme a la inmutabilidad confirmada en P04.
- `descripcion`: string recortado, de 1 a 255 caracteres, siguiendo el patron de textos del repo.
- `monto`: string decimal canonico de dos decimales, positivo, de `0.01` a `99999999.99`, compatible con Decimal(10,2). El minimo positivo es propuesta de validacion, no limite impuesto por el schema de base.
- Rechazar numeros JSON, notacion exponencial, signo, separador coma, ceros iniciales salvo `0.xx`, espacios, cero, negativos, exceso de precision y desbordamiento. No redondear para aceptar entrada invalida.
- Validar formato y rango con representacion exacta. Mantener Decimal/string durante entrada, persistencia y salida, sin conversion a Float/Number.
- `vigenciaDesde`: fecha de calendario valida `YYYY-MM-DD`, no un instante ni fecha normalizada silenciosamente. POST acepta fechas pasadas, de hoy y futuras respecto de `America/La_Paz`; PATCH no acepta este campo.
- Cuerpos estrictos: no aceptar `id`, `creadoEn`, `eliminadoEn`, moneda, conceptos ni campos desconocidos.
- `:id` es `Tarifa.id`; UUID invalido, inexistente o eliminado devuelve 404. La escritura debe excluir filas eliminadas tambien ante concurrencia.
- No existe un 409 por tarifa ya vigente ni una restriccion de editar solo futuras.

DTO propuesto `TarifaDto`, comun a GET/POST/PATCH (GET devuelve array):

```json
{
  "id": "7a1f2c4e-0000-4000-8000-000000000000",
  "descripcion": "Referencia centro a terminal",
  "monto": "15.00",
  "vigenciaDesde": "2026-09-21"
}
```

El importe del ejemplo es ilustrativo, no una tarifa para sembrar o usar como fallback.
No se expone historial, moneda, fechas internas ni un segundo monto.
La aproximacion y la unidad Bs son semantica de todo el contrato, no campos nuevos.

### 3.4. Mapa de conductores

**Aprobado:** todos los conductores no eliminados, incluidos pendientes, rechazados, suspendidos y con jornada finalizada.
No se filtra por elegibilidad, GPS, vehiculo, aprobacion o jornada.
P06 confirma que el conductor no eliminado permanece en mapa y conteos aunque su usuario relacionado este eliminado; no se agrega ese filtro.
`estado`, `estadoJornada` y `estadoDisponibilidad` se exponen separados con los enums existentes.
No se calcula un `estadoVisual`, badges ni prioridades nuevas en backend.

Seleccionar la ultima ubicacion no eliminada por `horaRegistro DESC, id DESC`.
Su vigencia efectiva reutiliza `esValida && esTemporalmenteValida(horaRegistro, referencia)` de SPEC 08.
Si falta, esta invalidada o caducada, `ubicacion` es `null`; no se busca una posicion anterior vigente para sustituirla.
Exactamente 300000 ms sigue vigente y 300001 ms caduca.
No se cambia la politica temporal del helper ni se invalida persistencia desde GET.

**DTO minimo propuesto para revision:**

```json
{
  "id": "8e7acf6d-0e5b-4e6a-9f2a-1c2b3d4e5f60",
  "nombreCompleto": "Juan Perez",
  "estado": "suspendido",
  "estadoJornada": "finalizada",
  "estadoDisponibilidad": "disponible",
  "vehiculo": { "placa": "1234ABC", "marca": "Toyota", "modelo": "Corolla", "color": "Blanco" },
  "ubicacion": { "latitud": -17.7833, "longitud": -63.1821, "horaRegistro": "2026-09-21T14:00:00.000Z" },
  "ultimaUbicacionRegistradaEn": "2026-09-21T14:00:00.000Z"
}
```

`vehiculo` es nullable: se propone el no eliminado mas reciente por `creadoEn DESC, id DESC`, con desempate estable sobre el patron de SPEC 06.
`ultimaUbicacionRegistradaEn` conserva la fecha de la ultima ubicacion no eliminada aunque `ubicacion` sea `null`; sin registro, tambien es `null`.
Se omiten telefono, cedula, usuarioId, credenciales, id del registro GPS y datos administrativos innecesarios.
Los instantes usan ISO 8601 UTC, como los DTOs actuales.

### 3.5. Solicitudes activas

Se conserva la definicion de SPEC 10 tanto en listado como en conteo:

- Activos: `creada`, `buscando`, `conductor_seleccionado`, `esperando_respuesta`, `aceptada`, `en_servicio`.
- Terminales excluidos: `finalizada`, `rechazada`, `expirada`, `sin_conductor`.

No limitar a los tres estados mas frecuentes ni inferir transiciones por una fecha vencida.
GET no expira solicitudes ni repara sus datos.
Se excluye `Solicitud.eliminadoEn != null`. P06 confirma que una solicitud no eliminada permanece en listado y conteos aunque su pasajero o conductor relacionado este eliminado, respetando los filtros de estado y fecha de cada consulta.
El resumen del pasajero o conductor eliminado se devuelve como `null`, sin excluir la solicitud ni exponer los datos de esa relacion.

DTO minimo propuesto para revision, proyectado de `SolicitudDetalleDto` sin modificar ese contrato existente:

```json
{
  "id": "7a1f2c4e-0000-4000-8000-000000000000",
  "estado": "buscando",
  "pasajero": { "id": "d9428888-122b-4e1f-b85c-61cd3cbb3210", "nombre": "Ana Perez" },
  "conductorAsignado": null,
  "latitudRecogida": -17.7833,
  "longitudRecogida": -63.1821,
  "destino": "Terminal",
  "expiraEn": null,
  "creadoEn": "2026-09-21T14:00:00.000Z"
}
```

`conductorAsignado`, cuando exista y no este eliminado, contiene solo `id` y `nombreCompleto`; si falta o esta eliminado, es `null`.
`destino` y `expiraEn` son nullable, con los tipos de SPEC 10.
`pasajero` es nullable: si esta eliminado, su resumen es `null`, sin ocultar la solicitud, conforme a P06.
No se exponen telefonos, WhatsApp, cedula, usuarioId, credenciales, historial de rechazos ni fechas redundantes de finalizacion.
El detalle completo existente sigue disponible por su endpoint propio.

### 3.6. Indicadores y tiempo

**Aprobado:** disponibilidad registrada, no elegibilidad para recibir solicitudes.
No se llama al motor ni se aplican sus filtros, radio, top 3 o GPS.
Solo completadas lleva filtro del dia; mapa, disponibles, en servicio y activas no se limitan a hoy.

| Campo propuesto | Definicion |
|---|---|
| `conductoresDisponibles` | Conductores no eliminados con `estadoDisponibilidad = disponible` |
| `conductoresEnServicio` | Conductores no eliminados con `estadoDisponibilidad = en_servicio`, no cantidad de solicitudes |
| `solicitudesActivas` | Solicitudes no eliminadas en los seis estados de 3.5 |
| `solicitudesCompletadasHoy` | Solicitudes no eliminadas con `estado = finalizada` y `finalizadaEn` dentro del dia de `America/La_Paz` |

P06: los conductores no eliminados cuentan aunque su usuario este eliminado. Las solicitudes no eliminadas cuentan aunque su pasajero/conductor relacionado este eliminado; el borrado de esas relaciones solo oculta sus resumenes en el listado. Se mantienen los mismos universos de mapa/listado y conteos, con los filtros propios de cada indicador.
Un suspendido con disponibilidad registrada `disponible` cuenta si pertenece al universo acordado.
`solicitud_pendiente` y `no_disponible` no suman en ninguno de los dos conteos de disponibilidad.
Estos indicadores no resuelven la gestion manual de jornada/disponibilidad, fuera de alcance.

**Detalles tecnicos propuestos para revision:**

- Cuatro enteros no negativos en un objeto; sin datos, todos cero.
- Completadas exige estado y fecha: `finalizadaEn = null` no cuenta; otro estado con fecha tampoco cuenta.
- Dia como intervalo `[inicio del dia, inicio del siguiente dia)` en `America/La_Paz`, con limites convertidos a UTC, no zona local del servidor.
- Ejemplo del dia 2026-09-21: desde `2026-09-21T04:00:00.000Z` inclusive hasta `2026-09-22T04:00:00.000Z` exclusive.
- No se agregan filtros de coherencia con `creadoEn` o `aceptadaEn` ni correcciones automaticas: se cuenta segun estado y pertenencia de `finalizadaEn` al intervalo.
- Una referencia temporal comun por peticion para vigencia GPS y limites diarios. Ademas, P09 exige una instantanea consistente de datos dentro de cada respuesta de dashboard; el reloj comun por si solo no la garantiza.
- `finalizada_en` se persiste como `TIMESTAMP(3)` sin zona; el servicio usa `Date` y `toISOString()`. En verificacion autorizada se debe acreditar el recorrido escritura/lectura UTC antes de dar por probados los limites diarios, sin reinterpretar la columna como hora local.

```json
{
  "conductoresDisponibles": 0,
  "conductoresEnServicio": 0,
  "solicitudesActivas": 0,
  "solicitudesCompletadasHoy": 0
}
```

### 3.7. Convenciones, listados y errores

**Aprobado:** listados completos sin paginacion ni truncamiento a 25.
No se asume un maximo real de 25 conductores.
Un `take: 1` para escoger ultima ubicacion o vehiculo no es un limite del listado principal.
Si el volumen requiere paginacion en el futuro, se definira aparte, no se introducira silenciosamente aqui.

**Propuestas tecnicas para revision conforme a patrones existentes:**

- Arrays planos, `200 []` para listados vacios.
- Orden total: tarifas por `descripcion ASC, id ASC`; mapa por `nombreCompleto ASC, id ASC`; solicitudes por `creadoEn DESC, id DESC`.
- Sin filtros HTTP opcionales ni parametros de paginacion en esta entrega; query no vacia devuelve `400 VALIDATION_ERROR`, siguiendo validacion estricta.
- DTOs explicitos y estrictos, seleccionando solo campos necesarios; no serializar modelos completos.
- Actualizaciones parciales no vacias; campos omitidos permanecen intactos.
- Consultas por lote o relaciones, sin HTTP interno ni N+1 por conductor/solicitud.
- Respuesta de errores existente: `{ "error": { "code": "...", "message": "..." } }`.

| HTTP | Codigo | Caso |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Cuerpo/query invalido, desconocido o vacio donde se exige entrada |
| 401 | `UNAUTHORIZED` | Credenciales ausentes/invalidas segun matriz 3.2 |
| 403 | `FORBIDDEN` | JWT reconocido sin permiso segun matriz 3.2 |
| 404 | `NOT_FOUND` | PATCH con UUID invalido, tarifa inexistente o eliminada; UUID invalido no consulta servicio |
| 500 | `INTERNAL_ERROR` | Fallo inesperado, sin SQL, stack, URLs, tokens ni secretos |

No se agrega un conflicto de unicidad o de version a tarifas.
P09 confirma dashboard sin cache y una instantanea consistente dentro de cada respuesta, incluidos los cuatro conteos de indicadores y las relaciones de los listados. No se promete igualdad entre endpoints consultados en momentos distintos.
Mecanismo tecnico aprobado en 1.3: respuestas `Cache-Control: no-store` y transaccion de lectura `RepeatableRead` por respuesta, incluyendo todas sus consultas y relaciones. Ni un reloj comun ni una transaccion con aislamiento por defecto bastan por si solos para acreditar la instantanea; su verificacion con concurrencia sigue pendiente.

### 3.8. Decisiones y evidencia pendiente

Se conservan los IDs originales para trazabilidad; no representan diez decisiones abiertas.
P01/P02 quedan cerrados por tarifas simples y edicion directa; P03 por Bs sin campo moneda; P05 por SPEC 10; P07 por disponibilidad registrada; P08 por `America/La_Paz` para completadas.
P04/P06/P09 quedan cerrados por confirmacion del usuario y se integran en contratos, plan, criterios y riesgos. P10 esta acreditado en 1.2 tras la autorizacion explicita para la fase con escrituras.

| ID | Estado | Decision o evidencia requerida |
|---|---|---|
| P04 | Confirmado por el usuario | Tarifas usan `America/La_Paz`; POST acepta fechas pasadas, de hoy y futuras; PATCH solo descripcion/monto y `vigenciaDesde` inmutable. |
| P06 | Confirmado por el usuario | Conductores no eliminados permanecen en mapa/conteos aunque su usuario este eliminado. Solicitudes no eliminadas permanecen en listado/conteos aunque pasajero/conductor relacionado este eliminado; el resumen de la relacion eliminada es `null`. Se conservan los filtros propios de estado/fecha. |
| P09 | Confirmado por el usuario | Dashboard sin cache, con instantanea consistente dentro de cada respuesta y sin garantia de igualdad entre endpoints consultados en momentos distintos. Header `Cache-Control: no-store` y transaccion de lectura `RepeatableRead` por respuesta aprobados en 1.3; verificacion pendiente. |
| P10 | Acreditado | `npm test` autorizado el 2026-09-21: 28 suites y 1125 pruebas aprobadas, sin fallos ni omisiones, con identidades separadas verificadas y migraciones existentes aplicadas solo en pruebas. Ver 1.2. |

Los nombres de DTOs, ordenes, rangos/formato de validacion y proyecciones de 3.2-3.7 fueron aprobados explicitamente en la revision conjunta de 1.3.
Esta aprobacion tecnica es adicional a P04/P06/P09 y no acredita implementacion ni pruebas.
P10 no bloquea ya la implementacion; su evidencia no sustituye las verificaciones futuras del modulo.

## 4. Plan de implementacion

La solicitud posterior del usuario habilita este plan incremental. Los pasos 1 a 11 estan completados segun 1.3-1.13; el paso 12 permanece pendiente.
P10 ya esta acreditado y P04/P06/P09 estan confirmados; no requieren nuevas respuestas.
Se conserva la pausa para revision del diff tras cada paso, sin commits automaticos.
Cada incremento debe conservar el proyecto compilable y los endpoints existentes.

1. Revisar las propuestas tecnicas sin reabrir P04/P06/P09 y consultar la evidencia P10 ya registrada en 1.2. No repetir el paso 3 de SPEC 10 ni cambiar su checklist por inspeccion.
2. Crear `src/modules/tarifario/tarifario.schema.ts` con inputs y DTOs acordados; agregar `tests/tarifario.schema.test.ts` e incluir la suite unitaria en `vitest.unit.config.ts`.
3. Crear `src/modules/tarifario/tarifario.service.ts` y `tests/tarifario.service.test.ts`: lectura por fecha de inicio inclusiva en `America/La_Paz`, borrado logico, montos exactos y orden total, sin agrupacion por versiones.
4. Agregar creacion y edicion directa con pruebas separadas de POST pasado/hoy/futuro y PATCH solo descripcion/monto, rechazo de `vigenciaDesde`, conservacion de fecha y campos omitidos, y exclusion de eliminadas al escribir. No modificar schema ni crear migraciones.
5. Crear `tarifario.controller.ts` y `tarifario.router.ts` en la misma carpeta, montar en `src/app.ts` y cubrir matriz de permisos/errores en `tests/tarifario.http.test.ts`; incorporar la suite unitaria.
6. Crear `src/modules/dashboard/dashboard.schema.ts` y `tests/dashboard.schema.test.ts` con DTOs minimos, queries estrictas y enums existentes; incorporar la suite unitaria.
7. Crear `src/modules/dashboard/dashboard.service.ts` y `tests/dashboard.service.test.ts` para mapa; reutilizar vigencia GPS, estados separados y ubicacion nullable; mantener todos los conductores no eliminados aunque su usuario este eliminado. Incorporar la suite unitaria.
8. Agregar listado de solicitudes activas, manteniendo los seis estados de SPEC 10 y solicitudes no eliminadas aunque sus relaciones esten eliminadas, con resumen de pasajero/conductor eliminado como `null`. Si se comparte la constante interna, limitar el cambio a esa reutilizacion sin alterar el ciclo de vida.
9. Agregar los cuatro indicadores y limites del dia en `America/La_Paz`, aplicando P06 tambien a conteos. Elegir y verificar un mecanismo que garantice P09 en cada respuesta de dashboard: sin cache e instantanea consistente, sin exigir igualdad entre endpoints consultados en momentos distintos. Cubrir nulos, estados discordantes, disponibilidad distinta de elegibilidad y relaciones eliminadas, sin escrituras correctivas desde GET.
10. Crear `dashboard.controller.ts` y `dashboard.router.ts`, montar en `src/app.ts` y cubrir cada ruta en `tests/dashboard.http.test.ts`; incorporar la suite unitaria.
11. Agregar `tests/tarifario.test.ts` y `tests/dashboard.test.ts` para integracion autorizada con `TEST_DATABASE_URL` exclusiva, fixtures identificados y limpieza solo de registros propios. Cubrir decimales persistidos, fechas P04, relaciones eliminadas P06, recorrido UTC, limites GPS, mas de 25 registros y concurrencia/frescura P09 por respuesta, sin exigir igualdad entre consultas en momentos distintos.
12. En la futura entrega de implementacion, documentar en README los contratos finales, permisos, aproximacion/Bs, fecha de visualizacion y limites de consistencia. README no cambia en esta revision.

Los archivos anteriores son destinos propuestos, no archivos creados en esta fase.
No se agregan dependencias npm ni cambios en documentos externos.
No abrir puertos al importar `app.ts`, escribir en produccion ni ejecutar verificaciones con escrituras sin autorizacion.

## 5. Criterios de aceptacion

Solo estan acreditados la revision tecnica conjunta y P10. Los criterios de implementacion y ejecucion de SPEC 11 permanecen sin verificar.
P04/P06/P09 y los detalles tecnicos de 3.2-3.7 estan aprobados; esa aprobacion no sustituye la evidencia futura de implementacion y pruebas.

- [x] Las propuestas tecnicas se han revisado conjuntamente sin reabrir las decisiones aprobadas, incluidas P04/P06/P09 ya incorporadas al contrato. Evidencia: aprobacion explicita del usuario el 2026-09-21, registrada en 1.3; paso 1 completado.
- [x] P10 registra comando, fecha, suites/pruebas pasadas, fallidas y omitidas, y resultado saneado en base exclusiva validada, reconociendo las migraciones existentes ejecutadas por el setup. Evidencia: 1.2, `npm test` del 2026-09-21, 28 suites y 1125 pruebas aprobadas.
- [x] GET tarifas admite n8n/admin y las otras cinco operaciones solo admin, con todos los casos y precedencias de 3.2, sin modificar autenticacion existente.
- [x] GET tarifas devuelve todas las filas no eliminadas desde su fecha inclusive segun el dia en `America/La_Paz`, sin futuras, versiones ganadoras, agrupaciones ni precios por defecto; vacio devuelve `200 []`. Se cubre el cambio de dia sin depender de la zona local del servidor.
- [x] El contrato entrega un unico monto aproximado en Bs por fila y documenta que no es precio garantizado; no calcula ni inventa importes.
- [x] POST valido devuelve 201; PATCH valido devuelve 200 y edita directamente descripcion/monto de una tarifa que ya se muestra, conservando id y campos omitidos, sin crear otra fila.
- [x] PATCH rechaza cuerpo vacio/campos desconocidos y devuelve 404 para UUID invalido, inexistente o eliminado; una tarifa ya vigente no produce 409 por su fecha.
- [x] P04: POST acepta fechas pasadas, de hoy y futuras en `America/La_Paz`; PATCH solo permite descripcion/monto, rechaza `vigenciaDesde` incluso si no cambia su valor y conserva la fecha persistida, sin restringir la edicion a filas futuras.
- [x] El monto conserva string de dos decimales y Decimal exacto en persistencia; prueba `0.01` y `99999999.99`, y rechaza cero, negativos, `100000000.00`, numeros JSON, formato invalido y precision extra sin redondeo conforme al contrato revisado.
- [x] No se modifican modelos, campos, tablas, indices ni migraciones; no se agrega moneda, conceptos, rangos o historial de tarifas.
- [x] El mapa incluye todos los conductores no eliminados aunque su usuario este eliminado, en todos los estados de aprobacion/jornada/disponibilidad, con tres campos separados y sin estado visual implicito.
- [x] Ubicacion ausente, invalidada o caducada devuelve `null`; no se recupera una ubicacion anterior para sustituirla. La fecha separada conserva el ultimo registro no eliminado cuando existe.
- [x] La vigencia GPS reutiliza `esTemporalmenteValida`; se cubren 299999, 300000 y 300001 ms, bandera falsa y ubicaciones eliminadas.
- [x] Listado y conteo de activas incluyen los seis estados de SPEC 10 y excluyen los cuatro terminales, incluido `sin_conductor`, sin disparar transiciones desde GET.
- [x] Indicadores cuentan conductores por disponibilidad registrada, no solicitudes ni candidatos; se cubren suspendidos disponibles, jornada finalizada, GPS vencido, falta de vehiculo, reservados y eliminados conforme al universo acordado.
- [x] P06: un conductor no eliminado permanece en mapa y conteos de disponibilidad aunque su usuario este eliminado; un conductor eliminado queda fuera de esos universos. Se prueba cada caso por separado.
- [x] P06: una solicitud no eliminada permanece en listado/conteos segun sus filtros de estado/fecha aunque pasajero/conductor relacionado este eliminado; cada resumen eliminado es `null`. Se prueban ambas relaciones por separado, solicitudes eliminadas excluidas y su efecto tanto en activas como en completadas del dia.
- [x] Completadas usa estado `finalizada` y `finalizadaEn` en el dia de `America/La_Paz`; prueba inicio exacto, instante anterior al siguiente inicio, siguiente inicio excluido, fecha nula y otros estados con fecha.
- [x] Integracion acredita el recorrido UTC de `TIMESTAMP(3)` y los limites del dia sin depender de la zona local del servidor ni efectuar reparaciones de datos.
- [x] Los listados devuelven mas de 25 registros sin truncamiento ni paginacion; se cubren orden estable con empates, vacios y query invalida.
- [x] P09: cada endpoint de dashboard responde sin cache y desde una instantanea consistente dentro de su respuesta, incluidos relaciones y cuatro conteos cuando corresponda; pruebas de concurrencia/frescura acreditan la garantia del mecanismo elegido, no solo un reloj comun o aislamiento por defecto. No se exige igualdad entre endpoints consultados en momentos distintos.
- [x] Los GET no escriben ni disparan transiciones de solicitud, jornada, disponibilidad o ubicacion.
- [x] DTOs y errores no exponen credenciales, hashes, telefonos, cedulas, WhatsApp, SQL, stack ni campos internos fuera del contrato.
- [x] `npm run build` termina correctamente en la futura verificacion.
- [x] `npm run test:unit` incluye las nuevas suites y termina correctamente en la futura verificacion.
- [x] `npm test` termina correctamente en fase autorizada con base exclusiva y limpieza solo de fixtures propios.
- [x] Los endpoints existentes, incluido `GET /api/solicitudes/:id/candidatos`, conservan su comportamiento.
- [x] La futura documentacion de implementacion en README coincide con los contratos finales y sus limitaciones.

## 6. Decisiones tomadas y descartadas

**Confirmadas por el usuario:**

- Tarifas simples: descripcion y un monto aproximado en Bs, sin rango ni precio garantizado.
- Administrador crea y edita descripcion/monto directamente; no hay historial ni restricciones por versiones futuras.
- Se conserva todo el modelo actual, incluido `vigenciaDesde` como inicio de visualizacion, sin campo moneda ni nuevas estructuras persistentes.
- P04: tarifas usan `America/La_Paz`; POST acepta fechas pasadas, de hoy y futuras; PATCH solo descripcion/monto y fecha inmutable.
- IA/n8n solo consulta y comunica referencias aproximadas; si no existe referencia, informa que no dispone de ella. Flujos n8n fuera del alcance.
- Mapa de todos los conductores no eliminados, estados separados y ubicacion invalida/vencida como `null`.
- P06: conductores no eliminados permanecen en mapa/conteos aunque su usuario este eliminado; solicitudes no eliminadas permanecen en listado/conteos aunque sus relaciones esten eliminadas, con resumen de pasajero/conductor eliminado como `null` y conservando los filtros propios de estado/fecha.
- Indicadores de disponibilidad registrada, no elegibilidad; completadas del dia en `America/La_Paz`.
- Listados completos sin paginacion ni truncamiento a 25 y datos minimos necesarios.
- P09: dashboard sin cache, instantanea consistente dentro de cada respuesta y sin garantia de igualdad entre endpoints consultados en momentos distintos.
- Mantener un solo spec y el encabezado `Aprobado`; esta tarea solo consolida documentacion, sin implementar, ejecutar pruebas/migraciones, crear ramas o commits.

**Reutilizacion respaldada por el repositorio:**

- Autenticacion existente y sus precedencias, Decimal exacto, estados SPEC 10 y vigencia GPS SPEC 08.
- DTOs camelCase, campos seleccionados explicitamente, fechas de instantes UTC y errores JSON seguros.
- SPEC 10 y su ampliacion del motor no se sustituyen ni se repiten.

**Descartado:**

- Versionado, nuevos conceptos, seleccion de version ganadora, unicidad `(concepto, vigenciaDesde)` y migracion de datos para ese modelo.
- PATCH limitado a futuras, 409 por editar una tarifa vigente y proteccion de una carrera de inicio de version que ya no corresponde a la politica aprobada.
- Modificar `vigenciaDesde` por PATCH, rechazar POST solo por fecha pasada o usar la zona local del servidor para el dia tarifario.
- Float/Number para dinero, redondeo silencioso, moneda persistida, precios calculados o garantizados.
- Filtros de elegibilidad en mapa/indicadores, truncamiento a 25 y estado visual incompleto calculado en backend.
- Excluir conductores no eliminados por usuario eliminado o solicitudes no eliminadas por relaciones eliminadas; exponer resumenes de pasajero/conductor eliminado en esas solicitudes.
- Cache de dashboard, respuestas internamente inconsistentes o promesas de igualdad entre endpoints consultados en momentos distintos.
- Cambiar terminales de SPEC 10 para acomodar el roadmap o acreditar P10 por inspeccion.

P04/P06/P09 estan confirmados y cerrados documentalmente; P10 fue autorizado explicitamente y acreditado en 1.2. Esta verificacion no acredita implementacion de SPEC 11.
Los detalles tecnicos cuentan con aprobacion explicita del usuario registrada en 1.3, no inferida por su presencia en este documento.

## 7. Riesgos

| Riesgo | Tratamiento |
|---|---|
| Comunicar una referencia como precio final | Semantica explicita de monto aproximado en Bs; IA no calcula ni inventa; flujos n8n fuera de esta entrega |
| Perder el valor anterior al editar | Consecuencia aceptada de edicion directa sin historial; no prometer reconstruccion historica |
| Filas con descripcion repetida | El modelo no impone unicidad; no inferir versiones, agrupar, deduplicar ni agregar restricciones implicitamente |
| Errores monetarios | Decimal/string exactos y validacion de formato/rango sin Float ni redondeo silencioso |
| Fecha tarifaria ambigua o tarifa ocultada al moverla | P04 confirmado: dia en `America/La_Paz`, POST pasado/hoy/futuro y fecha inmutable en PATCH; probar limites de dia y rechazo del campo sin reabrir descripcion/monto |
| Posicion vieja presentada como actual | Ultimo registro no eliminado, bandera y vigencia efectiva, ubicacion nullable y fecha separada |
| Confundir disponible con elegible | Definiciones separadas; no aplicar motor, aprobacion, jornada, GPS o vehiculo al conteo |
| Datos relacionados eliminados expuestos o universos de conteo divergentes | P06 confirmado: mantener conductor no eliminado aunque usuario eliminado y solicitud no eliminada aunque relaciones eliminadas; resumen de pasajero/conductor eliminado como `null`. Aplicar los mismos universos y filtros propios, sin exigir igualdad entre consultas en momentos distintos |
| Conteos diarios desplazados | Zona aprobada, limites inclusivo/exclusivo UTC y verificacion autorizada del recorrido real de timestamps |
| Lecturas concurrentes incoherentes o datos cacheados obsoletos | P09 confirmado: sin cache e instantanea consistente por respuesta, no entre endpoints consultados en momentos distintos. Seleccionar y probar el mecanismo tecnico; reloj comun y aislamiento por defecto no acreditan por si solos la garantia |
| Crecimiento de listados completos | Seleccion minima, consultas sin N+1 y orden estable; no truncar ni introducir paginacion/indices sin nuevo acuerdo |
| Ejecutar migraciones o acreditar dependencia sin permiso/evidencia | P10 en fase autorizada con bases distintas y resultado saneado; ninguna checklist se marca por inspeccion |
| Ampliar alcance para suplir jornada, frontend o reportes | Mantener exclusiones y planificar esas necesidades aparte |

## 8. Que NO se implementa en esta spec

- Frontend, app movil, renderizado del mapa, flujos n8n o transporte en tiempo real.
- Gestion manual de jornada/disponibilidad, asignacion manual o reimplementacion del motor/solicitudes.
- Calculo de tarifas, pagos, conversion de monedas, analitica avanzada o historicos GPS.
- Versionado de tarifas, conceptos nuevos, rangos, precio garantizado, campo moneda o nuevas tablas/indices/migraciones.
- Eliminacion/restauracion de tarifas por API ni cambios a documentos externos al backend.
- No se implementa codigo ni modifica README en esta entrega. La fase separada autorizada de pruebas/migraciones acredita solo P10; la implementacion futura requiere una solicitud separada.
