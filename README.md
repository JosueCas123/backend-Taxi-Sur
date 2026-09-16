# Backend — Radio Taxi MVP

API REST en Node.js + Express 5 + TypeScript + Prisma 7 + PostgreSQL. Es la única fuente de
verdad del sistema: n8n (agente IA), la app del conductor y el dashboard admin consumen
esta API. Ver reglas de negocio en [`../docs/REGLAS_DE_NEGOCIO.md`](../docs/REGLAS_DE_NEGOCIO.md)
y los specs de cada módulo en [`specs/`](specs/) antes de implementarlo.

## Requisitos previos

- Node.js 20+ (probado con v24.20.0) y npm.
- PostgreSQL 15+ o un proyecto de Supabase.
- Git.

## 1. Configuración del entorno

1. Copia `.env.example` a `.env` y completa los valores reales.

```bash
cp .env.example .env
```

2. Variables utilizadas:

| Variable | Uso |
|---|---|
| `DATABASE_URL` | Conexión PostgreSQL de desarrollo (Prisma CLI/runtime). |
| `TEST_DATABASE_URL` | Conexión a otra base PostgreSQL exclusiva para pruebas. Requerida por `npm test`. |
| `PORT` | Puerto HTTP del servidor (por defecto `3000`). |
| `NODE_ENV` | `development` o `test`. |
| `JWT_SECRET` | Clave de firma de los JWT (HS256). No debe quedar en los placeholders de ejemplo. |
| `JWT_EXPIRES_IN` | Duración del token. Fijada en `8h`. |
| `N8N_API_TOKEN` | Secreto compartido para las llamadas internas de n8n. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_PHONE` | Credenciales del primer administrador; solo las lee `npm run admin:create`. |

`TEST_DATABASE_PASSWORD` se documenta como referencia; ninguna parte del código la consume ni
la interpola en la URL.

**NUNCA subas el `.env` real a git.** La validación de entorno rechaza los secretos marcados
como ejemplo en `.env.example`.

## 2. Comandos disponibles

```bash
npm run dev            # arranca en desarrollo con recarga (ts-node-dev src/server.ts)
npm run build          # compila TypeScript a dist/
npm start              # ejecuta el build compilado (node dist/server.js)
npm run admin:create   # crea el primer administrador con ADMIN_* del entorno
npm test               # pruebas Vitest/Supertest + integración real en PostgreSQL de pruebas
npm run test:unit      # solo las pruebas que no requieren base de datos
npm run prisma:migrate # migración de desarrollo (prisma migrate dev)
npm run prisma:generate
npm run prisma:studio
```

## 3. Base de datos y migraciones

El esquema está en `prisma/schema.prisma` (`configuracion`, `usuarios`, `conductores`,
`vehiculos`, `pasajeros`, `ubicaciones_conductor`, `solicitudes`, `tarifas`, con `eliminado_en`
para soft delete). La URL de conexión vive en `prisma.config.ts`, no en el datasource del
schema (Prisma 7).

```bash
npx prisma validate
npx prisma migrate deploy   # aplica solo las migraciones pendientes; reejecutar es seguro
npx prisma migrate status   # debe responder "Database schema is up to date!"
npx prisma generate
```

## 4. Arranque y estado del servidor

```bash
npm run dev
```

Probar en el navegador o con curl:

```bash
curl http://localhost:3000/health
```

`GET /health` responde `200 {"status":"ok"}`. Informa únicamente que el proceso está vivo
(liveness), **no** la disponibilidad de PostgreSQL.

Importar `src/app.ts` no abre un puerto de escucha; el arranque está aislado en `src/server.ts`,
que además valida el entorno antes de escuchar y cierra HTTP y Prisma ante `SIGINT`/`SIGTERM`.

## 5. Crear el primer administrador

```powershell
$env:ADMIN_EMAIL="admin@empresa.com"
$env:ADMIN_PASSWORD="una-contrasena-le-segura-larga"
$env:ADMIN_PHONE="+59170000000"
npm run admin:create
```

Esta validación y sus consecuencias aplican al comando:

- Correo con formato válido, teléfono requerido y contraseña de al menos 12 caracteres y
  máximo 72 bytes UTF-8.
- La contraseña se guarda como hash bcrypt (coste 12); nunca en texto plano.
- Si el correo o el teléfono ya existen (incluso en una cuenta eliminada), el comando termina
  sin modificar la cuenta y con salida no exitosa.
- No se ejecuta al iniciar el servidor y no imprime credenciales.

No existe usuario administrador por defecto: debe crearse con este comando antes de poder
iniciar sesión.

## 6. Autenticación

### Login de administrador

```bash
curl -X POST http://localhost:3000/api/auth/admin/login \
  -H "Content-Type: application/json" \
  -d '{"correo":"admin@empresa.com","contraseña":"una-contrasena-le-segura-larga"}'
```

Respuesta `200`:

```json
{
  "token": "<JWT>",
  "tokenType": "Bearer",
  "expiresIn": 28800
}
```

- JWT firmado con HS256, 8 horas de validez; `sub` es el `id` del `Usuario.admin`.
- Credenciales incorrectas, cuenta eliminada, rol no admin o hash ausente devuelven un `401`
  genérico con el mismo cuerpo, sin revelar si la cuenta existe.
- Contraseñas con más de 72 bytes, recortadas o menores a 12 caracteres no autentican.

### Login de conductor

```bash
curl -X POST http://localhost:3000/api/auth/conductor/login \
  -H "Content-Type: application/json" \
  -d '{"telefono":"+59170000000","pin":"123456"}'
```

Respuesta `200`:

```json
{
  "token": "<JWT>",
  "tokenType": "Bearer",
  "expiresIn": 28800
}
```

- El `telefono` se busca exactamente como se envía; la cuenta debe tener rol `conductor`,
  `eliminadoEn` nulo y `hashContrasena` (el PIN) presente y no vacío.
- JWT firmado con HS256, 8 horas de validez; `sub` es el `id` del `Usuario`.
- Teléfono inexistente, PIN incorrecto, cuenta eliminada, rol no conductor o hash ausente
  devuelven el mismo `401` genérico, sin revelar cuál dato falló.
- El PIN se compara con bcrypt sobre `usuarios.hashContrasena`; un PIN de más de 72 bytes
  UTF-8 no autentica. Respuesta con `Cache-Control: no-store`.

### Resetear PIN de un conductor (administrador)

```bash
curl -X PATCH http://localhost:3000/api/auth/conductor/<id>/resetear-pin \
  -H "Authorization: Bearer <JWT-de-admin>"
```

Respuesta `200`:

```json
{ "pin": "123456" }
```

- `:id` es el `Usuario.id` (UUID). Solo `requireAdmin`: JWT de usuario activo con rol `admin`;
  el token n8n por sí solo no autoriza escritura.
- Genera un PIN numérico de 6 dígitos, lo guarda con bcrypt (coste 12) en `usuarios.hashContrasena`
  y devuelve el plaintext una sola vez para que el administrador se lo comunique al conductor.
- Usuario inexistente o eliminado: `404 NOT_FOUND`. Usuario con rol distinto a `conductor`:
  `400 VALIDATION_ERROR`.

### Middlewares de protección

| Middleware | Credencial aceptada | Protege |
|---|---|---|
| `requireAuth` | JWT de usuario activo (cualquier rol) **o** `X-N8N-Token` válido | Rutas de acceso interno. |
| `requireN8n` | Solo `X-N8N-Token` válido | Rutas reservadas exclusivamente a n8n. |
| `requireAdmin` | Solo JWT de usuario activo con rol `admin` | Rutas reservadas al administrador. |

- El rol se consulta en la base en **cada** petición; un cambio de rol o un borrado lógico
  aplica de inmediato al token vigente.
- El token n8n permite acceso interno pero **nunca** autoriza rutas de administrador.
- `requireN8n` solo acepta el `X-N8N-Token`: un JWT válido de admin o conductor recibe `403`, y
  un token n8n incorrecto no se rescata con un JWT válido.
- Cuerpo no autenticado en ruta admin: `401`. Usuario activo sin rol admin en ruta admin: `403`.
- Un fallo de PostgreSQL se responde como `500` seguro; nunca habilita acceso.

El módulo Configuración consume estos middlewares: `GET /api/configuracion` con `requireAuth` y
`PUT /api/configuracion` con `requireAdmin`. Ver [Configuración global](#7-configuración-global-spec-04).

### Formato de errores

Todos los errores usan el mismo contrato:

```json
{ "error": { "code": "<codigo>", "message": "<mensaje seguro>" } }
```

Códigos: `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404),
`CONFIGURATION_DELETED` (409), `CONFLICT` (409), `INVALID_STATE_TRANSITION` (409),
`PASAJERO_ELIMINADO` (409), `INTERNAL_ERROR` (500). Ningún error interno expone SQL, stack, URLs ni secretos.

## 7. Configuración global (SPEC 04)

`configuracion` es una fila única (`id = 1`) con el nombre de la empresa, el radio máximo de
búsqueda y el teléfono del centro de atención. La fila se crea automáticamente y de forma segura
ante peticiones concurrentes en la primera **lectura autenticada** o en el primer **PUT de
administrador**; una fila existente conserva sus valores y no se vuelve a sembrar en cada arranque.

### GET /api/configuracion

Lee o inicializa la configuración. Requiere JWT de usuario activo (cualquier rol) o token n8n
(`requireAuth`). Sin credencial válida devuelve `401` y **no** crea la fila.

```bash
curl http://localhost:3000/api/configuracion \
  -H "Authorization: Bearer <JWT>"

# desde n8n:
curl http://localhost:3000/api/configuracion \
  -H "X-N8N-Token: <N8N_API_TOKEN>"
```

### PUT /api/configuracion

Actualización **parcial** exclusiva de administrador (`requireAdmin`): solo se actualizan los
campos enviados y los omitidos se conservan. La ruta autentica y autoriza **antes** de validar
el cuerpo; el token n8n por sí solo no autoriza escritura.

```bash
curl -X PUT http://localhost:3000/api/configuracion \
  -H "Authorization: Bearer <JWT-de-admin>" \
  -H "Content-Type: application/json" \
  -d '{"nombreEmpresa":"Radio Taxi Sur","radioMaximoBusquedaKm":8}'
```

- Campos editables: `nombreEmpresa` (string recortado de 1 a 100), `radioMaximoBusquedaKm`
  (entero entre 1 y 2147483647, sin coerción de strings) y `telefonoCentroAtencion`
  (`null` o string recortado de 1 a 30).
- El cuerpo debe incluir al menos uno de esos tres campos. Un `null` explícito en
  `telefonoCentroAtencion` limpia el teléfono.
- Cuerpos vacíos, campos desconocidos o tipos inválidos devuelven `400` sin escribir.
- Si la fila está eliminada lógicamente, GET y PUT devuelven `409 CONFIGURATION_DELETED` y no la
  restauran ni la reemplazan.

Respuesta `200` (misma forma para GET y PUT):

```json
{
  "id": 1,
  "nombreEmpresa": "TaxiSur - Pruebas",
  "radioMaximoBusquedaKm": 5,
  "telefonoCentroAtencion": "+59100000000",
  "actualizadoEn": "2026-09-09T00:00:00.000Z"
}
```

El DTO expone solo los cinco campos anteriores; `actualizadoEn` es una fecha ISO 8601 en UTC.
No se exponen `creadoEn` ni `eliminadoEn`.

**Advertencia:** `+59100000000` es un **marcador ficticio, no un contacto operativo**. La fila se
inicializa con ese valor solo para poder arrancar sin datos reales. Antes de cualquier uso
operativo reemplázalo mediante el PUT de administrador:

```bash
curl -X PUT http://localhost:3000/api/configuracion \
  -H "Authorization: Bearer <JWT-de-admin>" \
  -H "Content-Type: application/json" \
  -d '{"telefonoCentroAtencion":"+59171234567"}'
```

## 8. Conductores y vehículos (SPEC 06)

`conductores` y `vehiculos` modelan el perfil del conductor y su vehículo. La relación es 1:N: un
conductor puede tener varios vehículos a lo largo del tiempo; los DTOs exponen el **vehículo
activo más reciente** (`vehiculos.eliminadoEn` nulo, ordenado por `creadoEn` desc). En todas las
rutas de este módulo, `:id` es el **`Conductor.id`** (UUID), nunca el `Usuario.id`; el perfil
propio se resuelve comparando el `usuarioId` del conductor con el `sub` del JWT del solicitante.

`telefono` (en `usuarios`) y `placa` (en `vehiculos`) son únicos, incluso contra filas eliminadas
lógicamente: el registro público y el PATCH de vehículo devuelven `409 CONFLICT` si colisionan y
no escriben. El registro es **público**; el resto exige autenticación y, salvo el detalle, solo
`requireAdmin`.

### POST /api/conductores — registro público

Crea `usuario`, `conductor` (estado `pendiente`, jornada `no_iniciada`, disponibilidad
`no_disponible`) y el primer `vehiculo` dentro de una única transacción; el `pin` se guarda como
bcrypt (coste 12). No requiere autenticación.

```bash
curl -X POST http://localhost:3000/api/conductores \
  -H "Content-Type: application/json" \
  -d '{
    "telefono": "+59170000000",
    "pin": "123456",
    "nombreCompleto": "Juan Perez",
    "cedulaIdentidad": "1234567",
    "vehiculo": {
      "placa": "1234ABC",
      "marca": "Toyota",
      "modelo": "Corolla",
      "color": "Blanco",
      "capacidadPasajeros": 4
    }
  }'
```

- `telefono` string recortado 1–30; `pin` numérico de 4 a 6 dígitos (string); `nombreCompleto`
  1–100; `cedulaIdentidad` 1–50; `vehiculo` exige sus cinco campos, con `placa`/`marca`/`modelo`/
  `color` recortados 1–30 y `capacidadPasajeros` entero 1–100.
- `201` devuelve el `ConductorDetalleDto`. Cuerpo inválido: `400 VALIDATION_ERROR`.
- `409 CONFLICT`: «El telefono ya esta registrado» o «La placa ya esta registrada» (también
  contra cuentas o vehículos eliminados; si ambos chocan, responde uno de los dos mensajes).
- Ante un fallo de PostgreSQL la transacción hace rollback y se responde `500` seguro.

### GET /api/conductores — listado administrativo

Lista los conductores no eliminados ordenados por `creadoEn` asc. Solo `requireAdmin`.

```bash
curl "http://localhost:3000/api/conductores" \
  -H "Authorization: Bearer <JWT-de-admin>"

curl "http://localhost:3000/api/conductores?estado=pendiente" \
  -H "Authorization: Bearer <JWT-de-admin>"
```

- Filtro opcional `estado` con un valor de `pendiente | aprobado | suspendido | rechazado`.
  Otro valor o campos extra: `400 VALIDATION_ERROR`.
- `200` con un array de `ListadoConductorDto` (el detalle sin `usuarioId`).

### GET /api/conductores/:id — detalle

Requiere autenticación. Autoriza a: administrador (JWT con rol `admin`), n8n (`X-N8N-Token`) y el
propio conductor (su `usuarioId` coincide con el `sub` del JWT). Otro conductor: `403 FORBIDDEN`.

```bash
curl http://localhost:3000/api/conductores/<id> \
  -H "Authorization: Bearer <JWT-de-admin-o-del-propio-conductor>"

curl http://localhost:3000/api/conductores/<id> \
  -H "X-N8N-Token: <N8N_API_TOKEN>"
```

- `200` con `ConductorDetalleDto`. `404 NOT_FOUND` si `:id` no es UUID o el conductor no existe
  (incluye eliminados). Sin credencial válida: `401`.

### Transiciones de estado (admin)

Cuatro `PATCH` **sin cuerpo**, exclusivos de `requireAdmin`, con transiciones estrictas y
atómicas (el `update` condicional impide transiciones duplicadas en condiciones de carrera):

| Endpoint | Desde | Hacia | Notificación stub |
|---|---|---|---|
| `PATCH /api/conductores/:id/aprobar` | `pendiente` | `aprobado` | sí |
| `PATCH /api/conductores/:id/rechazar` | `pendiente` | `rechazado` | sí |
| `PATCH /api/conductores/:id/suspender` | `aprobado` | `suspendido` | no |
| `PATCH /api/conductores/:id/reactivar` | `suspendido` | `aprobado` | no |

```bash
curl -X PATCH http://localhost:3000/api/conductores/<id>/aprobar \
  -H "Authorization: Bearer <JWT-de-admin>"
```

- `200` con el `ConductorDetalleDto` actualizado.
- Transición no permitida desde el estado actual: `409 INVALID_STATE_TRANSITION` con el mensaje
  «Transicion invalida: el conductor esta en estado <estado>».
- Conductor inexistente, eliminado o `:id` no UUID: `404 NOT_FOUND`.
- La notificación es un stub sin efectos (`notificaciones.notificarConductor`); nunca bloquea ni
  hace fallar al endpoint.

### PATCH /api/conductores/:id/vehiculo — actualización parcial (admin)

Actualiza el **vehículo activo más reciente** del conductor. Solo se actualizan los campos
enviados; los omitidos se conservan. `requireAdmin`.

```bash
curl -X PATCH http://localhost:3000/api/conductores/<id>/vehiculo \
  -H "Authorization: Bearer <JWT-de-admin>" \
  -H "Content-Type: application/json" \
  -d '{"color": "Negro", "capacidadPasajeros": 5}'
```

- Campos opcionales (al menos uno): `placa`, `marca`, `modelo`, `color` (string recortado 1–30)
  y `capacidadPasajeros` (entero 1–100, sin coerción de strings).
- `200` con `ConductorDetalleDto`. Body vacío o inválido: `400 VALIDATION_ERROR` (sin tocar la
  base). `409 CONFLICT` «La placa ya esta registrada» si la nueva placa choca (incluye vehículos
  eliminados).
- Sin vehículo activo: `404 NOT_FOUND` «Vehiculo no encontrado». Conductor inexistente, eliminado
  o `:id` no UUID: `404 NOT_FOUND` «Conductor no encontrado».

### DTOs del módulo

DTOs estrictos (Zod `.strict()`): los campos desconocidos en la salida quedan descartados.

`VehiculoDto`:

```json
{
  "id": "UUID",
  "placa": "1234ABC",
  "marca": "Toyota",
  "modelo": "Corolla",
  "color": "Blanco",
  "capacidadPasajeros": 4
}
```

`ConductorDetalleDto` (`vehiculo` puede ser `null`):

```json
{
  "id": "UUID",
  "usuarioId": "UUID",
  "telefono": "+59170000000",
  "nombreCompleto": "Juan Perez",
  "cedulaIdentidad": "1234567",
  "estado": "pendiente",
  "estadoJornada": "no_iniciada",
  "estadoDisponibilidad": "no_disponible",
  "creadoEn": "2026-09-12T00:00:00.000Z",
  "vehiculo": { "…": "VehiculoDto" }
}
```

`ListadoConductorDto`: el detalle **sin** `usuarioId`.

### Códigos de error propios

Además de los [códigos compartidos](#formato-de-errores):

- `409 CONFLICT`: «El telefono ya esta registrado» / «La placa ya esta registrada» (repetido,
  incluso contra registros eliminados).
- `409 INVALID_STATE_TRANSITION`: transición no permitida desde el estado actual del conductor.

## 9. Pasajeros (SPEC 07)

`pasajeros` identifica al remitente de WhatsApp. El pasajero **no** es un `Usuario`: no tiene rol,
PIN ni JWT. Ambos endpoints son **exclusivos de n8n** (`requireN8n`): sin credencial o con una
inválida, `401`; un JWT válido de admin o conductor, `403`; un `X-N8N-Token` inválido tiene
precedencia y no se rescata con un JWT válido. El contrato JSON usa **camelCase** (el roadmap
menciona nombres SQL en snake_case en `docs/`, pero la API es camelCase).

### POST /api/pasajeros/identificar

Idempotente; n8n la llama en cada mensaje entrante. `whatsappId` es el `wa_id` de Meta (cadena de
dígitos ASCII con código de país, sin `+`, espacios ni sufijos; **no** se normaliza ni se intenta
validar contra WhatsApp). `nombre` es obligatorio y se recorta con `trim`; si el pasajero ya
existe, se conserva su nombre registrado.

```bash
curl -X POST http://localhost:3000/api/pasajeros/identificar \
  -H "X-N8N-Token: <N8N_API_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"whatsappId":"59170000000","nombre":"Ana Perez"}'
```

- `200` siempre, tanto al crear como al recuperar, con el `PasajeroDto`.
- `409 PASAJERO_ELIMINADO` si el `whatsappId` pertenece a un pasajero con borrado lógico: no se
  restaura ni se crea un duplicado.
- Cuerpo estricto: campos faltantes, desconocidos o de tipo inválido, nombre vacío y formatos de
  WhatsApp con `+`, espacios o sufijos devuelven `400 VALIDATION_ERROR`.
- Dos identificaciones simultáneas del mismo `whatsappId` crean **una sola fila**; todas las
  respuestas devuelven `200` con el mismo id del registro ganador.

### PATCH /api/pasajeros/:id/aceptar-aviso

Registra la **primera** aceptación del aviso de privacidad con la fecha actual del servidor; los
reintentos y las llamadas concurrentes conservan exactamente esa fecha. Es el único mecanismo que
fija la aceptación: identificarse **no** implica consentimiento (al crear el pasajero,
`aceptacionAvisoPrivacidad` queda en `null`).

```bash
curl -X PATCH http://localhost:3000/api/pasajeros/<id>/aceptar-aviso \
  -H "X-N8N-Token: <N8N_API_TOKEN>"
```

- `:id` es el `Pasajero.id` (UUID). Sin cuerpo o con `{}` es válido; `null`, arrays, fechas
  enviadas por el cliente y campos adicionales responden `400 VALIDATION_ERROR`.
- `200` con el `PasajeroDto` actualizado.
- `404 NOT_FOUND` para UUID inválido, pasajero inexistente o pasajero eliminado.

DTO de respuesta (ambos endpoints):

```json
{
  "id": "UUID",
  "whatsappId": "59170000000",
  "nombre": "Ana Perez",
  "aceptacionAvisoPrivacidad": "2026-09-15T12:00:00.000Z",
  "creadoEn": "2026-09-15T12:00:00.000Z"
}
```

`aceptacionAvisoPrivacidad` es `null` hasta la primera aceptación; las fechas son ISO 8601 en UTC.
No se exponen `eliminadoEn` ni otras columnas.

**Dependencia del módulo siguiente:** el módulo `solicitudes` (módulo 7 del roadmap, spec futura)
deberá **rechazar la creación de una solicitud si el pasajero aún no aceptó el aviso**. Este
módulo solo registra el consentimiento; no implementa ese bloqueo.

## 10. Ubicaciones (SPEC 08)

`ubicaciones_conductor` registra el historial de posiciones GPS reportadas por el conductor y
aplica la **caducidad de 5 minutos de la Regla 9**, calculada siempre en el servidor sobre
`horaRegistro`. En ambas rutas `:id` es el `Conductor.id` (UUID). El contrato JSON usa camelCase y
el `UbicacionConductorDto` expone `id` (BigInt) como **string decimal**.

Dos endpoints con acceso opuesto:

| Endpoint | Permiso |
|---|---|
| `POST /api/conductores/:id/ubicacion` | Solo el conductor propietario con estado `aprobado` (`requireAuth`). |
| `GET /api/conductores/:id/ubicacion` | Solo administrador (`requireAdmin`). |

n8n **no** tiene acceso HTTP a ninguno de los dos: en el POST recibe `403` (identidad reconocida
sin permiso) y en el GET `401`, porque `requireAdmin` solo reconoce credenciales JWT Bearer. El
**motor de asignación** (SPEC 09) consume la caducidad y la última ubicación llamando al
**servicio interno**, nunca por HTTP. Reportar GPS no vuelve al conductor elegible ni modifica su
jornada o disponibilidad.

### POST /api/conductores/:id/ubicacion — reportar posición

Solo el conductor propietario `aprobado` (`conductor.usuarioId == sub` del JWT). En una única
transacción invalida las ubicaciones previas del mismo conductor con más de 5 minutos
(`horaRegistro < now - 300000` y `esValida = true`) y luego inserta la nueva con `horaRegistro`
del reloj del servidor y `esValida = true`.

```bash
curl -X POST http://localhost:3000/api/conductores/<id>/ubicacion \
  -H "Authorization: Bearer <JWT-del-propio-conductor>" \
  -H "Content-Type: application/json" \
  -d '{"latitud": -17.7833, "longitud": -63.1821}'
```

- Cuerpo estricto: `latitud` finito en `[-90, 90]` y `longitud` finito en `[-180, 180]`. Se
  rechazan claves desconocidas, NaN/Infinity, arrays, `null`, cuerpos ausentes y cualquier intento
  de imponer `horaRegistro`, `esValida`, `conductorId` o `id`: `400 VALIDATION_ERROR`.
- `201 Created` con el `UbicacionConductorDto` de la fila creada.
- Conductor ajeno (incluidos admin y n8n): `403 FORBIDDEN` sin revelar datos del destino.
- Propietario en `pendiente`/`rechazado`/`suspendido`: `403 CONDUCTOR_NO_APROBADO`.
- Conductor inexistente, eliminado o `:id` no UUID: `404 NOT_FOUND` (el UUID inválido no consulta
  la base). Sin credencial o token inválido: `401 UNAUTHORIZED`.

### GET /api/conductores/:id/ubicacion — última posición (admin)

Busca la última ubicación con `horaRegistro DESC, id DESC` excluyendo registros `eliminadoEn`.
`esValida` efectiva = bandera persistida **y** `(now - horaRegistro) <= 300000` ms: exactamente
5 minutos sigue vigente; a partir de 300001 ms caduca. Un registro reciente con bandera `false`
no se revive.

```bash
curl http://localhost:3000/api/conductores/<id>/ubicacion \
  -H "Authorization: Bearer <JWT-de-admin>"
```

- Conductor (JWT sin rol admin): `403 FORBIDDEN`. n8n: `401` (ver la nota de acceso de arriba).
- `200` con el `UbicacionConductorDto`. Sin ubicaciones, conductor inexistente/eliminado o `:id`
  no UUID: `404 NOT_FOUND`.
- El GET **no escribe**: la caducidad se calcula al responder; la persistencia no cambia.

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

`id` es BigInt serializado como string decimal; las fechas son ISO 8601 en UTC. No se exponen
`conductorId` ni `eliminadoEn`.

La vigencia se implementa una sola vez como función pura reutilizable
`esTemporalmenteValida(horaRegistro, now)`, que el motor de asignación usará sin duplicar la
Regla 9.

## 11. Motor de asignación (SPEC 09)

El **motor de asignación** selecciona los conductores elegibles más cercanos al punto de recogida
de una solicitud aplicando las Reglas 2, 3 y 4. El módulo **solo lee y calcula**: no cambia
estados de la solicitud ni del conductor (el ciclo de vida pertenece al módulo 7,
`specs/10-solicitudes`). Se expone bajo la ruta de `solicitudes` pero con un servicio interno
propio (`motor-asignacion.service.ts`) que el módulo 7 reutilizará.

La Regla 2 filtra por estado `aprobado`, jornada `activa`, disponibilidad `disponible` (que ya
excluye `solicitud_pendiente` y `en_servicio`), sin borrado lógico, con ubicación vigente y
vehículo activo. La Regla 3 limita al radio configurado y la Regla 4 devuelve los tres más
cercanos.

### GET /api/solicitudes/:id/candidatos

Endpoint **exclusivo de n8n** (`requireN8n`): solo el `X-N8N-Token` válido es aceptado. Un JWT
válido de admin o conductor recibe `403 FORBIDDEN`; sin credencial o con token inválido, `401
UNAUTHORIZED`. La autorización ocurre antes de validar el recurso y no se registran tokens ni
cuerpos en logs.

```bash
curl http://localhost:3000/api/solicitudes/<id>/candidatos \
  -H "X-N8N-Token: <N8N_API_TOKEN>"
```

- `:id` es el `Solicitud.id` (UUID). Un UUID inválido responde `404 NOT_FOUND` sin consultar el
  servicio.
- La solicitud debe existir y no estar eliminada lógicamente; en caso contrario, `404 NOT_FOUND`.
  **No se valida el estado de la solicitud**: el control de transiciones pertenece al módulo 7.
- Se lee `configuracion.radioMaximoBusquedaKm` (fila `id = 1`); si la fila no existe o está
  eliminada se usa el default documentado de `5` km.
- Solo son candidatos los conductores `aprobado` + `activa` + `disponible` + no eliminados, con su
  última ubicación (`horaRegistro DESC, id DESC`, `esValida` persistida en `true`) y su vehículo
  activo más reciente (`creadoEn DESC`).
- La última ubicación debe además pasar la **caducidad de 5 minutos de la Regla 9**, reutilizando
  `esTemporalmenteValida(horaRegistro, now)` de `ubicaciones.service` (límite inclusivo de
  `300000` ms; sin duplicar la lógica).
- Se conservan solo los conductores cuya distancia Haversine (radio terrestre 6371 km) sea
  `<= radioMaximoBusquedaKm` (exactamente igual al radio es elegible) y se devuelven como máximo
  los **3 más cercanos**, ordenados por distancia ascendente.
- Sin candidatos elegibles: `200` con `{ "candidatos": [] }`. La decisión de pasar la solicitud a
  `sin_conductor` es del módulo 7.

Respuesta `200` (DTO estricto `CandidatosDto`):

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

- `distanciaKm` usa Haversine y se redondea a 2 decimales (referencia para el pasajero; la
  distancia exacta no es operativa). La función pura `distanciaKm()` está exportada y testeable.
- Se expone la `placa` del vehículo activo más reciente: el pasajero la ve desde la selección de
  candidatos (Regla 4).
- No se exponen `creadoEn`, `eliminadoEn`, `usuarioId` ni el id del vehículo; este DTO no lleva
  fechas.

Códigos de error:

| HTTP | Código | Situación |
|---|---|---|
| 401 | `UNAUTHORIZED` | Credenciales ausentes o inválidas |
| 403 | `FORBIDDEN` | JWT válido sin permiso para el recurso |
| 404 | `NOT_FOUND` | UUID inválido, solicitud inexistente o eliminada |
| 500 | `INTERNAL_ERROR` | Fallo inesperado, sin filtrar SQL, stack ni secretos |

## 12. Pruebas

```bash
npm test            # Vitest + Supertest + integración con PostgreSQL de pruebas
npm run test:unit   # solo pruebas sin base de datos
```

`npm test` exige `TEST_DATABASE_URL` apuntando a una base **exclusiva de pruebas**, distinta de
la de desarrollo:

- No hay fallback a `DATABASE_URL`: si falta `TEST_DATABASE_URL`, la suite se detiene antes de
  conectar o escribir.
- Antes de migrar, la suite verifica en modo solo lectura la identidad de ambos destinos y
  rechaza el mismo proyecto, alias o referencias ambiguas.
- Las migraciones existentes se aplican **solo** al destino de pruebas validado.
- Cada suite crea y limpia únicamente sus propios registros (`spec03-<UUID>`, `spec04-<UUID>`,
  `spec05-<UUID>`, `spec07-<UUID>`, `spec08-<UUID>`, `spec09-<UUID>`); no se hace limpieza
  global. No se escribe jamás en la base de desarrollo.

## 13. Estructura del código fuente

```
backend/
├── prisma/
│   ├── schema.prisma
│   ├── prisma.config.ts   # conexión (DATABASE_URL) y ruta del schema
│   └── migrations/        # SQL versionado + migration_lock.toml
├── src/
│   ├── config/
│   │   ├── env.ts         # variables de entorno validadas con Zod
│   │   └── prisma.ts      # instancia runtime Prisma 7 con adaptador PostgreSQL
│   ├── middlewares/
│   │   ├── auth.ts        # requireAuth (JWT/n8n) y requireAdmin
│   │   └── error-handler.ts
│   ├── modules/
│   │   ├── auth/          # auth.schema / auth.service / auth.controller / auth.router
│   │   ├── configuracion/ # configuracion.schema / .service / .controller / .router
│   │   ├── conductores/   # conductores.schema / .service / .controller / .router / notificaciones
│   │   ├── pasajeros/     # pasajeros.schema / .service / .controller / .router
│   │   ├── ubicaciones/   # ubicaciones.schema / .service / .controller / .router
│   │   └── motor-asignacion/ # motor-asignacion.schema / .service / .controller / .router
│   ├── scripts/
│   │   └── create-admin.ts
│   ├── app.ts             # Express: middlewares globales y rutas (no abre puerto)
│   └── server.ts          # arranque y cierre ordenado
├── tests/
│   ├── setup.ts           # verificación read-only e isolación del destino de pruebas
│   ├── database-safety.ts # validación de destinos y proyectos Supabase
│   └── *.test.ts          # health, auth, create-admin, middlewares, database, configuracion, conductores, pasajeros, ubicaciones, motor-asignacion
├── vitest.config.ts
├── vitest.unit.config.ts
├── tsconfig.json
└── tsconfig.test.json
```

## 14. Orden recomendado para construir los módulos

1. **Base HTTP + Auth de administrador** — este módulo (SPEC 03).
2. **`configuracion`** — radio de búsqueda, teléfono y nombre de empresa (SPEC 04).
3. **`auth` de conductores** — login por teléfono y PIN, reseteo del PIN por admin (SPEC 05).
4. **`conductores` + `vehiculos`** — CRUD y estados.
5. **`pasajeros`** — identificación por WhatsApp (lo llama n8n).
6. **`ubicaciones`** — coordenadas y caducidad de 5 minutos.
7. **`motor-asignacion`** — candidatos más cercanos (Reglas 2, 3, 4).
8. **`solicitudes`** — ciclo de vida completo (Reglas 1, 5–11).
9. **`tarifario`** y **`dashboard`**.

Cada módulo se implementa contra su spec en `specs/` y se prueba antes de pasar al siguiente.

## 15. Cómo conectará n8n con esta API

n8n no tendrá acceso directo a la base de datos. Llamará a endpoints REST con el header
`X-N8N-Token` igual al secreto del `.env`, por ejemplo:

```
POST /api/pasajeros/identificar
POST /api/solicitudes            → crea una solicitud y dispara el motor de asignación
GET  /api/solicitudes/:id/candidatos
POST /api/solicitudes/:id/seleccionar-conductor
GET  /api/tarifas
```

El diseño exacto de endpoints se define módulo por módulo en cada spec.

## Siguientes pasos

- Verificar los criterios de aceptación de `specs/09-motor-asignacion.md` y, si pasan, marcarla
  como **Implementado** antes de fusionar la rama.
- Crear el administrador con `npm run admin:create` antes de probar login y PUT de configuración.
- Continuar con el módulo `solicitudes` (módulo 7 del roadmap): ciclo de vida completo de la
  solicitud, que reutilizará `obtenerCandidatos` por servicio interno sin exponer admin.