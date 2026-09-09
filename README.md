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

### Middlewares de protección

| Middleware | Credencial aceptada | Protege |
|---|---|---|
| `requireAuth` | JWT de usuario activo (cualquier rol) **o** `X-N8N-Token` válido | Rutas de acceso interno. |
| `requireAdmin` | Solo JWT de usuario activo con rol `admin` | Rutas reservadas al administrador. |

- El rol se consulta en la base en **cada** petición; un cambio de rol o un borrado lógico
  aplica de inmediato al token vigente.
- El token n8n permite acceso interno pero **nunca** autoriza rutas de administrador.
- Cuerpo no autenticado en ruta admin: `401`. Usuario activo sin rol admin en ruta admin: `403`.
- Un fallo de PostgreSQL se responde como `500` seguro; nunca habilita acceso.

El módulo Configuración (SPEC 04) consumirá estos middlewares: `GET /api/configuracion` con
`requireAuth` y `PUT /api/configuracion` con `requireAdmin`.

### Formato de errores

Todos los errores usan el mismo contrato:

```json
{ "error": { "code": "<codigo>", "message": "<mensaje seguro>" } }
```

Códigos: `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404),
`INTERNAL_ERROR` (500). Ningún error interno expone SQL, stack, URLs ni secretos.

## 7. Pruebas

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
- Cada suite crea y limpia únicamente sus propios registros (`spec03-<UUID>`); no se hace
  limpieza global. No se escribe jamás en la base de desarrollo.

## 8. Estructura del código fuente

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
│   │   └── auth/          # auth.schema / auth.service / auth.controller / auth.router
│   ├── scripts/
│   │   └── create-admin.ts
│   ├── app.ts             # Express: middlewares globales y rutas (no abre puerto)
│   └── server.ts          # arranque y cierre ordenado
├── tests/
│   ├── setup.ts           # verificación read-only e isolación del destino de pruebas
│   ├── database-safety.ts # validación de destinos y proyectos Supabase
│   └── *.test.ts          # health, auth, create-admin, middlewares, database
├── vitest.config.ts
├── vitest.unit.config.ts
├── tsconfig.json
└── tsconfig.test.json
```

## 9. Orden recomendado para construir los módulos

1. **Base HTTP + Auth de administrador** — este módulo (SPEC 03).
2. **`configuracion`** — radio de búsqueda, teléfono y nombre de empresa (SPEC 04).
3. **`auth` de conductores** — OTP simulado (módulo 2 del roadmap).
4. **`conductores` + `vehiculos`** — CRUD y estados.
5. **`pasajeros`** — identificación por WhatsApp (lo llama n8n).
6. **`ubicaciones`** — coordenadas y caducidad de 5 minutos.
7. **`motor-asignacion`** — candidatos más cercanos (Reglas 2, 3, 4).
8. **`solicitudes`** — ciclo de vida completo (Reglas 1, 5–11).
9. **`tarifario`** y **`dashboard`**.

Cada módulo se implementa contra su spec en `specs/` y se prueba antes de pasar al siguiente.

## 10. Cómo conectará n8n con esta API

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

- Revisar y aprobar la implementación de `specs/03-base-auth-admin.md` y marcarla como
  **Implementado**.
- Crear el administrador con `npm run admin:create` antes de probar el login.
- Continuar con `specs/04-configuracion.md` (módulo Configuración).