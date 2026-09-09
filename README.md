# Backend — Radio Taxi MVP

API REST en Node.js + Express + TypeScript + Prisma + PostgreSQL. Es la única fuente de
verdad del sistema: n8n (agente IA), la app del conductor y el dashboard admin consumen
esta API. Ver reglas de negocio en [`../docs/REGLAS_DE_NEGOCIO.md`](../docs/REGLAS_DE_NEGOCIO.md)
y el spec de cada módulo en [`../specs/backend/`](../specs/backend/) antes de implementarlo.

## Requisitos previos

- Node.js 20+ y npm
- PostgreSQL 15+ (local con Docker, o un servicio gestionado como Railway, Supabase o Neon)
- Git

## 1. Instalación inicial

```bash
cd backend
npm init -y
npm i -D typescript ts-node-dev @types/node @types/express
npx tsc --init
```

En el `tsconfig.json` generado, ajusta como mínimo:

```json
{
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "target": "ES2020",
    "module": "commonjs",
    "strict": true,
    "esModuleInterop": true
  }
}
```

## 2. Dependencias del proyecto

```bash
npm i express cors dotenv zod jsonwebtoken bcrypt
npm i -D prisma
npm i @prisma/client
```

¿Por qué estas y no otras?
- **express**: minimalista y con muchísimo soporte de IA para generar código correcto.
- **zod**: valida cada payload que entra a la API (crítico porque n8n le mandará datos
  extraídos por un LLM, que pueden venir incompletos o mal formados).
- **jsonwebtoken + bcrypt**: autenticación del admin (email + contraseña).
- **prisma**: ORM tipado + migraciones.

## 3. Base de datos

```bash
npx prisma init
```

Esto crea `prisma/schema.prisma` (ya lo tienes listo, ver abajo) y un `.env`.

Copia `.env.example` a `.env` y completa `DATABASE_URL` con tu conexión real:

```bash
cp .env.example .env
```

Si no quieres instalar PostgreSQL localmente, la ruta más rápida es Docker:

```bash
docker run --name radiotaxi-db -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=radiotaxi -p 5432:5432 -d postgres:16
```

Y tu `DATABASE_URL` quedaría: `postgresql://postgres:postgres@localhost:5432/radiotaxi`

## 4. Schema y migración

El schema completo (traducido de tu Diagrama E-R) ya está en `prisma/schema.prisma`. Incluye:
`configuracion`, `usuarios`, `conductores`, `vehiculos`, `pasajeros`, `ubicaciones_conductor`,
`solicitudes`, `tarifas` — todas con `eliminado_en` para soft delete.

```bash
npx prisma migrate dev --name init
npx prisma generate
```

Verifica visualmente con:

```bash
npx prisma studio
```

## 5. Estructura del código fuente

```
backend/
├── prisma/
│   └── schema.prisma
├── src/
│   ├── modules/
│   │   ├── auth/
│   │   ├── pasajeros/
│   │   ├── conductores/
│   │   ├── vehiculos/
│   │   ├── ubicaciones/
│   │   ├── motor-asignacion/
│   │   ├── solicitudes/
│   │   ├── tarifario/
│   │   ├── configuracion/
│   │   └── dashboard/
│   ├── config/          # conexión a Prisma, variables de entorno tipadas
│   ├── middlewares/      # auth (JWT admin, token n8n), manejo de errores, validación zod
│   ├── utils/            # cálculo de distancia (haversine), helpers de fecha, etc.
│   ├── app.ts            # configuración de Express (middlewares globales, rutas)
│   └── server.ts         # punto de entrada, arranca el servidor
├── tests/
├── .env.example
├── package.json
└── tsconfig.json
```

Cada módulo sigue el mismo patrón interno:

```
modules/solicitudes/
├── solicitudes.router.ts       # define las rutas HTTP
├── solicitudes.controller.ts   # recibe el request, valida, llama al service
├── solicitudes.service.ts      # lógica de negocio (aquí viven las 14 reglas)
├── solicitudes.schema.ts       # esquemas zod de entrada/salida
└── solicitudes.types.ts
```

## 6. Servidor base

Crea `src/server.ts`:

```ts
import app from "./app";

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Backend corriendo en http://localhost:${PORT}`);
});
```

Y `src/app.ts` con un endpoint de salud mínimo:

```ts
import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

export default app;
```

Levántalo:

```bash
npx ts-node-dev src/server.ts
```

Prueba en el navegador o con curl: `curl http://localhost:3000/health`

## 7. Orden recomendado para construir los módulos

No construyas todo a la vez. Este orden respeta las dependencias reales entre entidades:

1. **`configuracion`** — es la base (radio de búsqueda, teléfono de atención).
2. **`auth`** — login admin + autenticación conductor (teléfono + OTP simulado al inicio).
3. **`conductores` + `vehiculos`** — CRUD y estados (pendiente/aprobado/suspendido, jornada, disponibilidad).
4. **`pasajeros`** — registro por WhatsApp (lo llamará n8n).
5. **`ubicaciones`** — recibir ubicación del conductor y calcular `es_valida`.
6. **`motor-asignacion`** — la lógica de filtrado + los 3 candidatos más cercanos (Reglas 2, 3, 4).
7. **`solicitudes`** — el ciclo de vida completo (Reglas 1, 5–11). Es el módulo más grande.
8. **`tarifario`** — CRUD simple de tarifas, consumido por n8n para responder al pasajero.
9. **`dashboard`** — endpoints de agregación (conductores activos, solicitudes activas, indicadores).

Cada módulo, cuando lo termines, debería tener sus rutas probadas con curl o Postman antes
de pasar al siguiente.

## 8. Cómo conectará n8n con esta API

n8n no tendrá acceso directo a la base de datos. Llamará a endpoints REST protegidos con un
token fijo (`N8N_API_TOKEN` del `.env`), por ejemplo:

```
POST /api/pasajeros/identificar
POST /api/solicitudes            → crea una solicitud y dispara el motor de asignación
GET  /api/solicitudes/:id/candidatos
POST /api/solicitudes/:id/seleccionar-conductor
GET  /api/tarifas
```

El diseño exacto de endpoints se define módulo por módulo; este README se irá actualizando
a medida que avances.

## Scripts sugeridos en `package.json`

```json
{
  "scripts": {
    "dev": "ts-node-dev --respawn src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "prisma:migrate": "prisma migrate dev",
    "prisma:studio": "prisma studio"
  }
}
```

## Siguientes pasos

Una vez que `/health` responde y las migraciones corrieron sin errores, continúa con el
módulo `configuracion` (paso 1 de la lista de arriba). Si trabajas con un asistente de IA
(Claude Code, Cursor, etc.), pásale este README + `docs/REGLAS_DE_NEGOCIO.md` como contexto
antes de pedirle que genere cada módulo — así respeta las reglas de negocio desde el primer intento.
