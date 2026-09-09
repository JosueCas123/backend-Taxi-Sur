# SPEC 03 - Base HTTP y autenticacion de administrador

> **Estado:** Implementado
> **Depende de:** SPEC 02 (`02-migracion-schema-prisma.md`)
> **Fecha:** 2026-09-09
> **Objetivo:** Habilitar una base HTTP con login y autorizacion JWT de administrador para proteger el modulo Configuracion.

## 1. Contexto

Las rutas son relativas a `backend/`.
Las fuentes son SPEC 02, `README.md`, `prisma/schema.prisma` y los cuatro documentos de `../docs/`.
No se usa `../specs/backend/01-configuracion.md` ni se heredan sus decisiones.
SPEC 02 figura como Implementado, pero conserva verificaciones pendientes sobre el destino y sus datos; no se supone que la base este vacia.
El backend tiene dependencias y migracion inicial, pero no tiene `src/` ni pruebas funcionales.
El usuario aprobo adelantar solo Auth de administrador respecto del roadmap para no exponer un PUT sin proteccion.

## 2. Alcance

**Incluye:**

- Servidor Express 5, TypeScript, JSON, conexion runtime Prisma 7 mediante el adaptador PostgreSQL instalado y cierre ordenado de recursos.
- `GET /health`, publico, con respuesta 200 `{ "status": "ok" }`; informa vida del proceso, no disponibilidad de PostgreSQL.
- `POST /api/auth/admin/login`.
- Validacion JWT y consulta del usuario activo en cada peticion protegida.
- Autorizacion separada por rol admin y autenticacion interna por `X-N8N-Token`, reutilizables por Configuracion.
- Comando explicito para crear el primer administrador sin credenciales predeterminadas.
- Errores JSON, pruebas automatizadas y documentacion reproducible.

**NO incluye:**

- OTP, login de conductores, registro publico o gestion de usuarios.
- Refresh tokens, recuperacion de contrasena, logout con lista de revocacion o sesiones persistidas.
- Endpoints de Configuracion, otros modulos o cambios al esquema y a las migraciones.
- Despliegue de produccion o cambios en los documentos fuera de `backend/`.

## 3. Modelo y contratos

Se reutilizan `Usuario`, `RolUsuario` y la tabla `usuarios` de SPEC 02 sin nuevas estructuras persistentes.
Una cuenta autenticable debe tener `eliminadoEn = null`.
El login exige ademas `rol = admin` y `hashContrasena` presente.

### Login

- Body JSON: `correo` y `contraseña`, ambos strings requeridos; la segunda clave lleva la letra ene con tilde, exactamente como en el roadmap.
- `correo` debe tener formato de correo valido. No recortar ni transformar la contrasena.
- La politica de fortaleza se aplica al crear la cuenta, no como motivo para distinguir errores de credenciales en login.
- Respuesta 200: `{ "token": "<JWT>", "tokenType": "Bearer", "expiresIn": 28800 }`.
- JWT firmado exclusivamente con HS256: `sub` identifica `Usuario.id`, `iat` indica emision y `exp` caducidad a las ocho horas.
- El rol efectivo procede de la base, no de confiar en un rol enviado por el cliente.
- Correo inexistente, contrasena incorrecta, cuenta eliminada, rol no admin o hash ausente producen el mismo 401 y mensaje generico.
- Nunca se devuelven hashes ni se registran contrasenas o tokens.

### Autenticacion y autorizacion

- Bearer ausente, mal formado, firma incorrecta, algoritmo distinto, token expirado, `sub` invalido o usuario inexistente/eliminado: 401.
- Usuario activo autenticado sin rol admin al acceder a una ruta reservada: 403.
- Un fallo de PostgreSQL se trata como fallo interno; nunca habilita acceso ni se confunde con un usuario inexistente.
- El middleware interno admite un JWT de usuario activo o el secreto `X-N8N-Token`; una credencial interna valida basta.
- Un token n8n no otorga rol admin y nunca habilita una escritura reservada al administrador.
- No se agrega una ruta de negocio ficticia para probar los middlewares; las pruebas los montan en una aplicacion de prueba.

### Creacion del administrador

- Comando: `npm run admin:create`.
- Lee `ADMIN_EMAIL`, `ADMIN_PASSWORD` y `ADMIN_PHONE` solo durante la ejecucion del comando.
- Correo valido, telefono requerido y contrasena de al menos 12 caracteres y como maximo 72 bytes UTF-8.
- Usa bcrypt para `hashContrasena` y crea `Usuario` con rol `admin`.
- Si correo o telefono ya existe, incluso en una cuenta eliminada, termina sin modificar la cuenta y con salida no exitosa.
- Una colision concurrente de unicidad debe convertirse en el mismo resultado controlado, sin actualizaciones ni duplicados.
- El comando no se ejecuta al iniciar el servidor, no imprime credenciales y cierra la conexion al terminar.

### Entorno y errores

- Reutilizar `DATABASE_URL`, `PORT`, `NODE_ENV`, `JWT_SECRET`, `JWT_EXPIRES_IN` y `N8N_API_TOKEN`.
- Esta entrega fija la duracion en ocho horas: `JWT_EXPIRES_IN` debe corresponder a `8h`; el JWT y `expiresIn` no deben divergir.
- Validar configuracion al arrancar y rechazar secretos ausentes o los marcadores de `.env.example`, sin imprimir sus valores.
- Agregar ejemplos sin secretos de `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_PHONE` y `TEST_DATABASE_URL`.
- Errores: `{ "error": { "code": "<codigo estable>", "message": "<mensaje seguro>" } }`.
- 400 `VALIDATION_ERROR` para JSON o entrada invalida; 401 `UNAUTHORIZED`; 403 `FORBIDDEN`; 404 `NOT_FOUND` para ruta inexistente; 500 `INTERNAL_ERROR` para fallos internos.
- Un error interno no expone SQL, stack, URL de conexion ni secretos al cliente.

## 4. Archivos previstos

| Ruta | Responsabilidad |
|---|---|
| `src/app.ts` | Aplicacion Express, JSON, health, rutas y errores; no abre puerto al importarse. |
| `src/server.ts` | Arranque y cierre del servidor y recursos de base. |
| `src/config/env.ts` | Configuracion validada. |
| `src/config/prisma.ts` | Instancia runtime Prisma con adaptador PostgreSQL. |
| `src/middlewares/auth.ts` | Bearer, usuario activo, rol admin y acceso interno JWT/n8n. |
| `src/middlewares/error-handler.ts` | Traduccion consistente de errores. |
| `src/modules/auth/auth.router.ts` | Ruta del login. |
| `src/modules/auth/auth.controller.ts` | Validacion de entrada y respuesta HTTP. |
| `src/modules/auth/auth.service.ts` | Verificacion de credenciales y emision JWT. |
| `src/modules/auth/auth.schema.ts` | Esquema Zod del login. |
| `src/scripts/create-admin.ts` | Inicializacion explicita del administrador. |
| `tests/setup.ts` | Entorno aislado y protecciones de la base de pruebas. |
| `tests/auth.test.ts` | Login, JWT y permisos. |
| `tests/create-admin.test.ts` | Creacion, validacion y conflictos. |
| `tests/health.test.ts` | Salud y errores globales. |
| `vitest.config.ts` | Configuracion de pruebas. |
| `package.json`, `package-lock.json` | Vitest, Supertest y tipos necesarios; scripts. |
| `tsconfig.json` | Compilacion coherente con `src/server.ts` y scripts internos. |
| `.env.example`, `README.md` | Variables sin secretos y operacion documentada. |

No se exige un archivo de tipos vacio ni capas adicionales sin uso.
No se modifica el `.env` real durante la implementacion sin una necesidad confirmada.

## 5. Plan de implementacion

1. Verificar dependencias y artefactos de SPEC 02 sin modificar la base de desarrollo. Crear `app.ts` y `server.ts` con `/health`; corregir `dev` y `start` para dejar de apuntar al inexistente `index.ts`. Comprobar build y respuesta de salud.
2. Incorporar validacion del entorno y conexion runtime Prisma 7 con cierre de recursos. Verificar arranque valido y fallo seguro con configuracion incompleta.
3. Incorporar errores JSON y soporte Vitest/Supertest con PostgreSQL separado. Comprobar health, JSON mal formado y ruta inexistente.
4. Agregar `admin:create` con validacion, bcrypt y manejo de unicidad. Verificar creacion y rechazo de duplicados en la base de pruebas.
5. Agregar el modulo de login con su esquema, servicio, controlador y ruta. Verificar exito y las variantes de credenciales rechazadas con pruebas HTTP.
6. Agregar autenticacion Bearer, autorizacion admin y acceso interno JWT/n8n. Probar expiracion, firma, algoritmo, usuario eliminado, cambios de rol y ausencia de credenciales.
7. Completar README y `.env.example` con comandos de arranque, creacion de admin y llamadas HTTP sin credenciales reales. Dejar documentado el consumo de los middlewares por SPEC 04.

Cada paso debe mantener el servidor ejecutable y sus pruebas existentes en verde; dividir cambios grandes en incrementos funcionales, no en capas incompletas.

### Seguimiento de implementacion

- [x] Paso 1: completado y revisado por el usuario antes de autorizar el paso 2.
- [x] Paso 2: implementado y revisado; el usuario autorizo explicitamente el paso 3.
- Evidencia del paso 2 (2026-09-09): `npm run build` correcto. Comprobaciones puntuales con Node, entorno ficticio, carga de `.env` deshabilitada y conexiones de `pg` bloqueadas: 28 casos de configuracion incompleta/invalida salen con codigo 1 y mensaje seguro; arranque valido y `/health` 200 con cuerpo exacto; handlers de SIGINT/SIGTERM invocados mediante IPC en Windows salen con codigo 0 y cierran el pool una vez; puerto ocupado cierra el pool y sale con codigo 1; fallo simulado de inicializacion Prisma desconecta sin revelar el error; importar `app` no abre puerto.
- Limitacion: `$connect()` inicializa el adaptador y su pool de forma perezosa; no acredita conectividad PostgreSQL. No se verifico conexion real al no disponer de un destino exclusivo de pruebas confirmado. No se consulto ni modifico la base de desarrollo, el esquema o las migraciones. Health sigue siendo liveness.
- [x] Paso 3: errores JSON, Vitest/Supertest y PostgreSQL separado verificados; cierre pendiente de revision del diff por el usuario antes de autorizar el paso 4.
- Evidencia del paso 3 (2026-09-09): `npm run build`, `npx tsc -p tsconfig.test.json` y `npm run test:unit` correctos (17 pruebas). Se verificaron health, importacion sin listen, JSON malformado, 404, 500 seguro, validacion Zod y protecciones puras de destino/identidad. Ejecucion de Vitest con `TEST_DATABASE_URL` explicitamente vacia: salida 1 antes de conectar o migrar, sin fallback a desarrollo. `git diff --check` sin errores de whitespace.
- Integracion: `npm test` exige destino de pruebas y referencia de desarrollo; rechaza nombres iguales incluso con alias y parametros de URL ambiguos. Consulta `current_database()` en modo solo lectura para comprobar ambas identidades antes de `prisma migrate deploy` exclusivamente en pruebas. No se ejecuto esta conexion ni migracion real; no se implementa limpieza global ni se crearon datos de negocio. Las pruebas puras no acreditan criterios PostgreSQL.
- Reintento de cierre del paso 3 (2026-09-09): configuracion inspeccionada en proceso sin imprimir valores ni modificar `.env`; `DATABASE_URL`, `TEST_DATABASE_URL` y `TEST_DATABASE_PASSWORD` presentes. El setup y Prisma no consumen `TEST_DATABASE_PASSWORD` ni interpolan esa variable en la URL. La validacion de destinos rechazo nombres de base iguales antes de cualquier conexion. Esto no demuestra que los servidores/proyectos sean iguales; la guarda conservadora actual no permite acreditar aislamiento entre bases de igual nombre.
- Resultados del reintento: `npm test` salida 1 en `validateDatabaseTargets` con el error seguro `La base de pruebas debe tener un nombre distinto de desarrollo`; no se ejecutaron consultas, migraciones ni limpieza. `npm run test:unit` salida 0 (2 archivos, 17 pruebas), `npm run build` salida 0 y `npx tsc -p tsconfig.test.json` salida 0. Vitest advierte sobre sintaxis ESM en configuracion CommonJS ante un futuro cambio de cargador; no impide las pruebas unitarias. Integracion y cierre del paso 3 pendientes; no se marcaron criterios futuros.
- Cierre del paso 3 (2026-09-09), sustituye el bloqueo historico anterior: el usuario confirmo y autorizo otro proyecto Supabase exclusivo de pruebas. La guarda reconoce referencias de proyecto en hosts directos/dedicados y usuarios de pooler compartido segun https://supabase.com/docs/guides/database/connecting-to-postgres. Admite proyectos verificables distintos con base `postgres`; rechaza el mismo proyecto incluso con otro rol, host de pooler, puerto o nombre de base. Rechaza formatos ambiguos y referencias no verificables; no usa IPs de poolers como evidencia de aislamiento. Conserva comprobacion de `current_database()` de ambos destinos con `BEGIN READ ONLY` antes de migrar.
- Evidencia final: `npm test` salida 0, 3 archivos y 37 pruebas; `npm run test:unit` salida 0, 2 archivos y 36 pruebas; `npm run build` y `npx tsc -p tsconfig.test.json` salida 0. `tests/database.test.ts` verifica mediante Prisma real el registro de la migracion finalizada y acceso a `usuarios` con `LIMIT 0`, sin leer ni crear datos de negocio. Las pruebas puras incluyen proyectos distintos con igual nombre, mismo proyecto directo/poolers/aliases y entradas ambiguas. Se mantiene la advertencia no bloqueante de Vite sobre el futuro cargador de configuracion.
- Revalidacion negativa final: `npm test` con `TEST_DATABASE_URL` vacia solo en el entorno del subproceso termina con salida 1 en la guarda de variables requeridas, antes de conectar o migrar; salida capturada y comprobada sin volcar valores. `git diff --check` sin errores de whitespace en archivos rastreados.
- Migracion aplicada SOLO en pruebas: `20260909113507_init`, inicio `2026-09-09T21:44:33.974Z`, fin `2026-09-09T21:44:38.728Z`, comprobados mediante consulta read-only a `_prisma_migrations`. Segundo `npm test` tambien completo `migrate deploy` y la suite real correctamente. No se modificaron schema, archivos de migraciones ni `.env`; no se consumio ni sustituyo `TEST_DATABASE_PASSWORD`, no se desactivo TLS y no hubo resets, drops, limpieza ni escrituras en desarrollo. Una consulta auxiliar de evidencia fallo por expansion de `$1` en PowerShell; al escapar el parametro se verificaron las fechas anteriores sin mostrar errores de driver ni secretos.
- [x] Paso 4: implementado con autorizacion explicita del usuario; pendiente de revision del diff antes de autorizar el paso 5.
- Evidencia del paso 4 (2026-09-09): `npm test` salida 0, 4 archivos y 57 pruebas (20 nuevas en `tests/create-admin.test.ts`); `npm run test:unit` salida 0, 2 archivos y 36 pruebas; `npm run build` y `npx tsc -p tsconfig.test.json` salida 0. Sin dependencias nuevas. Se mantiene la advertencia no bloqueante de Vite sobre el futuro cargador de configuracion.
- El comando real `npm run --silent admin:create` se ejecuto en cinco casos de exito SOLO contra el destino test suministrado por el setup tras guardas de identidad read-only y deploy de migraciones existentes. Se comprobaron rol admin, bcrypt con coste 12 verificable, contrasena incorrecta rechazada, ausencia de plaintext en la fila y de credenciales/URL en stdout/stderr. Limites aceptados: 12 caracteres ASCII, 72 bytes ASCII, 72 bytes UTF-8, 12 puntos de codigo no BMP y espacios preservados.
- Otros subprocesos ejecutaron el mismo entrypoint con ts-node: nueve entradas invalidas sin escrituras; importacion sin creacion ni salida; repeticion y conflictos independientes por correo/telefono en cuentas activas y eliminadas (tambien rol conductor), comparando la fila completa sin cambios; dos carreras reales por correo y telefono con exactamente un ganador y un error controlado. Un destino local ficticio inaccesible comprobo fallo seguro con salida 1. Todos terminaron naturalmente antes del timeout, sin `process.exit()` forzado en el comando.
- Seguridad y limpieza: el setup entrega la URL test mediante `provide` solo despues de validar/migrar; la suite exige que coincida con el runtime. Limpieza limitada a correos/telefonos `spec03-<UUID>` propios de esta ejecucion, seguida de conteo cero y desconexion. No hubo creacion de admin ni escrituras en desarrollo, cambios de schema/migraciones o `.env`. El cierre se acredita por terminacion natural en exito, duplicados y fallo de conexion; no se simularon fallos de `$disconnect()` ni terminacion por senales.
- [x] Paso 5: implementado con autorizacion explicita del usuario; implementacion interrumpida y reanudada, verificacion final completada en esta sesion. Pendiente de revision del diff por el usuario antes de autorizar el paso 6.
- Evidencia del paso 5 (2026-09-09): `npm run build` y `npx tsc -p tsconfig.test.json` correctos; `npm test` salida 0 con 5 archivos y 84 pruebas (nuevas en `tests/auth.test.ts`). `git diff --check` sin errores de whitespace en archivos rastreados.
- Contrato del login verificado con Prisma real: `POST /api/auth/admin/login` (clave `contraseña` con ene acentuada). Respuesta exacta `{ token, tokenType: "Bearer", expiresIn: 28800 }` con `Cache-Control: no-store`; JWT HS256 con `sub` = id del usuario, `iat` y `exp` a 28800 segundos; firma distinta rechazada y expiracion detectada. Cuerpos invalidos devuelven 400 sin consultar la base; JSON malformado y body ausente 400; credenciales inexistentes, incorrectas, cuenta eliminada, rol conductor, hash ausente o vacio, clave recortada y claves sobre 72 bytes o 12 puntos de codigo devuelven el mismo 401 exacto; fallo de PostgreSQL devuelve 500 seguro sin token.
- Limpieza limitada a cuentas `spec03-login-<UUID>` propias, seguida de conteo cero y desconexion. No hubo escrituras en desarrollo, cambios de schema/migraciones, `.env` ni commits.
- [x] Paso 6: implementedo con autorizacion explicita del usuario; pendiente de revision del diff por el usuario antes de autorizar el paso 7.
- Evidencia del paso 6 (2026-09-09): `npm run build` y `npx tsc -p tsconfig.test.json` correctos; `npm test` salida 0 con 6 archivos y 93 pruebas (9 nuevas en `tests/middleware.test.ts`). `git diff --check` sin errores de whitespace en archivos rastreados.
- Middlewares en `src/middlewares/auth.ts`: `requireAuth` (acceso interno mediante JWT de usuario activo de cualquier rol o `X-N8N-Token` con comparacion en tiempo constante) y `requireAdmin` (solo JWT de usuario activo con rol admin; n8n por si solo nunca autoriza). Ambos consultan el rol en base en cada peticion y propagan fallos de PostgreSQL como 500 seguro. Verificado con aplicacion de prueba, sin rutas de negocio ficticias: Bearer ausente/mal formado, firma incorrecta, algoritmo distinto, token expirado, `sub` no textual, usuario inexistente o eliminado devuelven 401; usuario activo no admin en ruta admin devuelve 403; cambio de rol en base se refleja de inmediato; token n8n invalido devuelve 401; fallo de base devuelve 500.
- Limpieza limitada a cuentas `spec03-mw-<UUID>` propias, seguida de conteo cero y desconexion. No hubo escrituras en desarrollo, cambios de schema/migraciones, `.env` ni commits.
- [x] Paso 7: implementado con autorizacion explicita del usuario; pendiente de revision del diff y de la verificacion global de criterios antes de marcar la spec.
- Evidencia del paso 7 (2026-09-09): `README.md` reescrito con configuracion de entorno, comandos, migraciones, arranque y `/health` (liveness), creacion del administrador, contrato del login, middlewares `requireAuth`/`requireAdmin` y su consumo por SPEC 04, formato de errores, pruebas con base separada y estructura real del codigo. `.env.example` agrega `ADMIN_EMAIL`, `ADMIN_PASSWORD` y `ADMIN_PHONE` como ejemplos sin secretos y aclara que `TEST_DATABASE_PASSWORD` es de referencia. Sin credenciales reales en el repositorio.
- Verificacion tras el paso 7 (2026-09-09): `npm run build` y `npx tsc -p tsconfig.test.json` correctos; `npm test` salida 0 con 6 archivos y 93 pruebas. `git diff --check` sin errores de whitespace. Advertencia no bloqueante de Vite sobre el futuro cargador de configuracion sin cambios.

## 6. Criterios de aceptacion

- [x] `npm run build` termina sin errores; `npm run dev` y `npm start` usan `src/server.ts` y `dist/server.js` respectivamente.
- [x] Importar `app.ts` en pruebas no abre un puerto de escucha. Evidencia: `tests/health.test.ts`, paso 3.
- [x] `/health` devuelve exactamente el contrato 200 documentado. Evidencia: Supertest en `tests/health.test.ts`, paso 3, sin conexion PostgreSQL.
- [x] El arranque rechaza configuracion incompleta o secretos de ejemplo sin exponerlos. Evidencia: 28 comprobaciones controladas del paso 2, detalladas arriba.
- [x] `npm run admin:create` crea un administrador cuyo hash bcrypt verifica la contrasena, sin guardar texto plano. Evidencia: cinco ejecuciones npm reales y persistencia comprobada en `tests/create-admin.test.ts`, paso 4.
- [x] Credenciales ausentes o contrasena fuera de limites impiden crear registros. Evidencia: nueve casos de valores vacios/invalidos y limites ASCII/UTF-8 en `tests/create-admin.test.ts`, paso 4.
- [x] Repetir la inicializacion o colisionar por correo/telefono no modifica cuentas existentes. Evidencia: filas activas/eliminadas intactas y carreras reales por ambos campos en `tests/create-admin.test.ts`, paso 4.
- [x] Login valido devuelve JWT HS256 de ocho horas con `sub` correspondiente y `expiresIn: 28800`. Evidencia: `tests/auth.test.ts`, paso 5.
- [x] Los casos de credenciales invalidas documentados devuelven el mismo 401 sin revelar existencia de cuentas. Evidencia: conjunto uniforme en `tests/auth.test.ts`, paso 5.
- [x] Firma invalida, otro algoritmo, expiracion o usuario eliminado impiden acceso. Evidencia: `tests/middleware.test.ts`, paso 6.
- [x] El rol se consulta en base en cada peticion y un usuario activo no admin recibe 403 en rutas admin. Evidencia: `tests/middleware.test.ts` incluido cambio de rol en base aplicado de inmediato, paso 6.
- [x] El token n8n permite acceso interno pero no sustituye al JWT admin. Evidencia: `requireAuth` con `X-N8N-Token` valido y `requireAdmin` rechazando solo n8n, paso 6.
- [x] Errores de PostgreSQL devuelven 500 seguro y no conceden acceso. Evidencia: `tests/auth.test.ts` simula fallo de `findUnique` con 500, paso 5.
- [x] `npm test` ejecuta Vitest/Supertest y cubre los casos anteriores contra una base PostgreSQL exclusiva de pruebas. Evidencia: `tests/auth.test.ts` con destino test validado, 84 pruebas en 5 archivos, paso 5.
- [x] Las pruebas exigen `TEST_DATABASE_URL`, sin fallback a `DATABASE_URL`, y rechazan el mismo destino de desarrollo antes de cualquier escritura o limpieza. Evidencia: `tests/database-safety.test.ts` y verificacion read-only de `tests/setup.ts`, paso 3.
- [x] Las migraciones existentes se aplican solo al destino de pruebas validado; la limpieza se limita a datos de prueba. Evidencia: deploy real y registro finalizado de `20260909113507_init`, paso 3; paso 4 limpia solo identificadores UUID propios y verifica cero registros restantes.
- [x] README explica build, pruebas, inicializacion y login reproducibles sin secretos. Evidencia: reescritura de `README.md` y ejemplo de `admin:create` y login sin credenciales reales, paso 7.

No se considera verificada la integracion si falta una base de pruebas separada; informar el bloqueo en vez de ejecutar contra desarrollo.

## 7. Decisiones tomadas y descartadas

- **Si: adelantar Auth admin.** Resuelve la dependencia de seguridad de Configuracion sin exponer escrituras anonimas.
- **Si: base HTTP en esta spec.** Configuracion la reutiliza, evitando una tercera entrega solo de infraestructura.
- **Si: JWT de ocho horas y usuario consultado en base.** Respeta el entorno existente y hace efectivos los cambios de rol o borrado.
- **Si: inicializacion por comando y variables.** No requiere registro publico ni contrasenas predeterminadas.
- **Si: Vitest, Supertest y PostgreSQL separado.** Permite comprobar contratos HTTP y persistencia sin escribir en desarrollo.
- **No: OTP o refresh tokens.** Amplian Auth mas alla del requisito previo confirmado.
- **No: spec antigua de Configuracion.** El usuario la excluyo expresamente como fuente.

## 8. Riesgos identificados

| Riesgo | Mitigacion |
|---|---|
| Confundir el destino de desarrollo con el de pruebas. | Exigir destino exclusivo y verificar identidad antes de migrar o limpiar; no basta comparar literalmente URLs con distintos alias. |
| Tokens o contrasenas expuestos en logs. | No registrar cuerpos del login ni headers de autenticacion. |
| Abuso del login en una exposicion publica. | Esta entrega no acredita endurecimiento de produccion; antes de publicarla se requiere TLS y proteccion contra intentos masivos. |
| Diferencias entre Prisma CLI y runtime de Prisma 7. | Usar el adaptador instalado y verificar integracion real, no solo generar el cliente. |

## 9. Que NO forma parte de esta especificacion

- Configuracion de empresa y sus valores iniciales.
- OTP, recuperacion de cuenta, refresh tokens o registro publico.
- Nuevas tablas, migraciones de negocio y despliegue de produccion.
