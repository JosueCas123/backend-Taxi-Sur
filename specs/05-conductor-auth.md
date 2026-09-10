# SPEC 05 — Autenticacion de conductores (login + resetear PIN)

> **Estado:** Implementado
> **Depende de:** SPEC 03 (`03-base-auth-admin.md`)
> **Fecha:** 2026-09-10
> **Objetivo:** Habilitar el login de conductores mediante telefono y PIN, y permitir a un administrador resetear el PIN de un conductor.

## 1. Contexto

Las rutas son relativas a `backend/`. Las fuentes son SPEC 03, `README.md`, `prisma/schema.prisma` y `docs/ROADMAP_ENDPOINTS.md`. No se usa `../specs/backend/01-configuracion.md` ni se heredan sus decisiones. El servidor y la seguridad se implementan primero en SPEC 03 por decision del usuario. La referencia del roadmap a SPEC 02 se interpreta como antecedente de persistencia, no como implementacion de endpoints.

Esta entrega corresponde al modulo 2 de `docs/ROADMAP_ENDPOINTS.md` (endpoints #4 y #5). No se implementan los modulos 3 en adelante.

## 2. Alcance

**Incluye:**

- `POST /api/auth/conductor/login` — autenticacion de conductores mediante `telefono` + `pin`.
- `PATCH /api/auth/conductor/:id/resetear-pin` — generacion de PIN temporal por administrador.
- Esquema Zod para el login de conductor.
- Funciones de servicio `loginConductor` y `resetearPin`.
- Controladores y rutas actualizados.
- Middleware `requireAdmin` con importacion lazy, como en `configuracion.router.ts`.
- Errores JSON, pruebas HTTP con persistencia contra PostgreSQL separado.
- Misma estructura de archivos, errores y convenciones que SPEC 03.

**NO incluye:**

- OTP, login de administrador ni ningun otro endpoint ya implementado en SPEC 03.
- Nuevas tablas, columnas o migraciones. No se modifica `prisma/schema.prisma`.
- Refresh tokens, recuperacion de contrasena, logout o sesiones persistidas.
- Registro publico de conductores, cambios de estado, asignacion de vehiculos o cualquier otro modulo.
- Endpoints de Configuracion, Conductores/Vehiculos o cualquier otro modulo del roadmap.
- Despliegue de produccion o cambios en los documentos fuera de `backend/`.

## 3. Modelo y contratos

Se reutiliza `Usuario` y la tabla `usuarios` de SPEC 02 sin nuevas estructuras persistentes. Una cuenta autenticable debe tener `eliminadoEn = null`. El login de conductor exige `rol = "conductor"` y `hashContrasena` presente.

El campo `usuarios.telefono` es el identificador de conductor. El PIN se guarda con bcrypt en `usuarios.hashContrasena`, el mismo campo que usa el administrador.

### Login de conductor

- Body JSON: `telefono` y `pin`, ambos strings requeridos.
- `telefono` se busca exactamente como se envia (sin normalizacion ni transformacion).
- Se busca el usuario por `telefono` en `usuarios`.
- El usuario debe tener `rol = "conductor"`, `eliminadoEn = null` y `hashContrasena` presente y no vacio.
- El `pin` se compara con bcrypt contra `hashContrasena`. Se aplica proteccion contra timing attacks mediante dummy hash, igual que `loginAdmin`.
- El PIN tiene una extension de longitud maxima de 72 bytes UTF-8; si excede ese limite, se rechaza igualmente.
- Si el telefono no existe, el PIN no coincide, la cuenta esta eliminada, el rol no es conductor o el hash esta ausente: **mismo 401 generico**. No se revela cual de los dos datos fallo.
- Respuesta 200: `{ "token": "<JWT>", "tokenType": "Bearer", "expiresIn": 28800 }`.
- JWT firmado exclusivamente con HS256: `sub` identifica `Usuario.id`, `iat` indica emision y `exp` caducidad a las ocho horas.
- Headers de respuesta: `Cache-Control: no-store`.
- Nunca se devuelven hashes ni se registran PINs ni tokens.

### Resetear PIN

- Ruta: `PATCH /api/auth/conductor/:id/resetear-pin`.
- `:id` es `Usuario.id` (UUID).
- Requiere autenticacion y autorizacion de administrador mediante `requireAdmin`.
- El administrador autenticado busca el usuario por `:id`.
- Si el usuario no existe o esta eliminado: 404 `NOT_FOUND`.
- Si el usuario existe pero su rol no es `"conductor"`: 400 `VALIDATION_ERROR`.
- Genera un PIN numerico temporal de **6 digitos** (por ejemplo, `123456`).
- Hashea el PIN con bcrypt costo 12 y actualiza `usuarios.hashContrasena`.
- Devuelve el PIN en plaintext para que el administrador lo comunique al conductor.
- Respuesta 200: `{ "pin": "123456" }`.
- No se requiere `Cache-Control: no-store` para esta respuesta (no es un token de sesion).
- El PIN se genera con `crypto.randomInt(100000, 999999)` o equivalente.
- Un fallo de PostgreSQL se trata como fallo interno; nunca habilita acceso ni se confunde con un usuario inexistente.

### Errores

- 400 `VALIDATION_ERROR` para JSON o entrada invalida (Zod).
- 401 `UNAUTHORIZED` para credenciales invalidas o ausentes (login).
- 403 `FORBIDDEN` para usuario activo sin permiso admin (resetear-pin).
- 404 `NOT_FOUND` para usuario no encontrado o eliminado (resetear-pin).
- 500 `INTERNAL_ERROR` para fallos internos de PostgreSQL.
- Formato: `{ "error": { "code": "<codigo estable>", "message": "<mensaje seguro>" } }`.
- Un error interno no expone SQL, stack, URL de conexion ni secretos al cliente.

## 4. Archivos previstos

| Ruta | Responsabilidad |
|---|---|
| `src/modules/auth/auth.schema.ts` | Agregar `conductorLoginSchema` (telefono + pin). Mantener `loginSchema` existente. |
| `src/modules/auth/auth.service.ts` | Agregar `loginConductor(telefono, pin)` y `resetearPin(usuarioId)`. Mantener `loginAdmin` existente. |
| `src/modules/auth/auth.controller.ts` | Agregar `loginConductor` y `resetearPin` controladores. Mantener `loginAdmin` existente. |
| `src/modules/auth/auth.router.ts` | Agregar rutas `POST /conductor/login` y `PATCH /conductor/:id/resetear-pin`. Usar importacion lazy de `requireAdmin` para esta ultima. |
| `src/app.ts` | Sin cambios (ya monta `/api/auth` con `authRouter`). |
| `tests/auth-conductor.test.ts` | Login de conductor, resetear PIN, permisos y variantes de error. |
| `tests/setup.ts` | Sin cambios (reutilizar existente). |
| `vitest.config.ts` | Sin cambios. |
| `package.json`, `tsconfig.json` | Sin cambios. |

No se requieren dependencias adicionales respecto de SPEC 03. Se reutilizan `src/config/prisma.ts`, `src/middlewares/auth.ts`, el manejador de errores y el entorno de pruebas sin duplicarlos.

## 5. Plan de implementacion

1. Verificar que SPEC 03 esta implementada y que build, health y pruebas de Auth funcionan. Agregar el esquema Zod `conductorLoginSchema` y sus casos de prueba sin cambiar las rutas existentes.
2. Implementar `loginConductor(telefono, pin)` en el servicio con proteccion contra timing attacks (dummy hash), comparacion bcrypt y generacion JWT. Verificar exito y las variantes de credenciales rechazadas con pruebas unitarias.
3. Implementar el controlador `loginConductor` y la ruta `POST /conductor/login`. Probar exito, credenciales invalidas, telefono no encontrado, usuario eliminado, usuario no conductor y fallo de base de datos.
4. Implementar `resetearPin(usuarioId)` en el servicio: generar PIN de 6 digitos, hashear con bcrypt costo 12, actualizar `hashContrasena`, devolver plaintext. Verificar exito y manejo de errores.
5. Implementar el controlador `resetearPin`, el middleware `requireAdmin` con importacion lazy y la ruta `PATCH /conductor/:id/resetear-pin`. Probar exito por admin, 403 por no admin, usuario no encontrado, usuario no conductor y fallo de base de datos.
6. Completar `tests/auth-conductor.test.ts` con cobertura completa contra PostgreSQL separado. Ejecutar y verificar todas las pruebas en verde.
7. Actualizar README si es necesario con los nuevos contratos de conductor.

Cada paso debe mantener el servidor ejecutable y sus pruebas existentes en verde; dividir cambios grandes en incrementos funcionales, no en capas incompletas.

## 6. Criterios de aceptacion

- [x] `npm run build` termina sin errores; `npm test` pasa con las pruebas de SPEC 03 y las nuevas.
- [x] `POST /api/auth/conductor/login` con credenciales validas devuelve JWT HS256 de ocho horas con `sub` = `Usuario.id`, `expiresIn: 28800`, `tokenType: "Bearer"` y header `Cache-Control: no-store`.
- [x] Los casos de credenciales invalidas documentadas (telefono inexistente, PIN incorrecto, cuenta eliminada, rol no conductor, hash ausente) devuelven el mismo 401 exacto `{ error: { code: "UNAUTHORIZED", message: "Credenciales invalidas" } }` sin revelar cual dato fallo.
- [x] Body invalido (campos faltantes, tipos incorrectos, telefono vacio) devuelve 400 `VALIDATION_ERROR` sin consultar la base de datos.
- [x] Fallo de base de datos en login devuelve 500 seguro sin token.
- [x] `PATCH /api/auth/conductor/:id/resetear-pin` sin JWT valido devuelve 401; con JWT de usuario activo no admin devuelve 403; con solo token n8n no permite escritura.
- [x] Resetear PIN por admin genera un PIN de 6 digitos, lo hashea con bcrypt costo 12 en `usuarios.hashContrasena`, y devuelve el plaintext en `{ "pin": "123456" }`.
- [x] El PIN generado es verificable por bcrypt contra el hash almacenado.
- [x] Resetear PIN para usuario no encontrado o eliminado devuelve 404 `NOT_FOUND`.
- [x] Resetear PIN para usuario que no es conductor devuelve 400 `VALIDATION_ERROR`.
- [x] Un administrador puede resetear el PIN de cualquier conductor, incluyendose a si mismo si tiene rol conductor.
- [x] El `:id` en la ruta se interpreta como `Usuario.id` (UUID).
- [x] `npm test` ejecuta Vitest/Supertest y cubre los casos anteriores contra una base PostgreSQL exclusiva de pruebas.
- [x] Las pruebas exigen `TEST_DATABASE_URL`, sin fallback a `DATABASE_URL`, y rechazan el mismo destino de desarrollo antes de cualquier escritura o limpieza.
- [x] Las migraciones existentes se aplican solo al destino de pruebas validado; la limpieza se limita a datos de prueba.
- [x] La proteccion contra timing attacks se mantiene igual que en `loginAdmin` (dummy hash para cuenta no existente).
- [x] No se agregan tablas, columnas ni modificaciones al esquema Prisma.

## 7. Decisiones tomadas y descartadas

- **Si: telefono + PIN en vez de OTP por SMS.** No depende de proveedor externo (Twilio/SNS). El admin ya aprueba manualmente a cada conductor, así que un segundo factor por SMS es redundante en el MVP.
- **Si: PIN guardado en `usuarios.hashContrasena`.** Mismo campo que usa el admin. No se necesita nueva columna ni tabla.
- **Si: 401 generico para login de conductor.** No revela si el telefono no existe o el PIN es incorrecto, igual que SPEC 03 para administrador. Protege contra enumeracion de cuentas.
- **Si: PIN de 6 digitos numericos.** Simplifica la comunicacion verbal/visual del conductor al admin. Fácil de leer y tipear.
- **Si: `requireAdmin` con importacion lazy.** Siguiendo el patron de `configuracion.router.ts` para mantener consistencia en la carga de middlewares.
- **Si: `:id` es `Usuario.id` (UUID).** El PIN se almacena en `usuarios.hashContrasena`, que pertenece a la tabla `usuarios`, no a `conductores`.
- **Si: mismo formato de respuesta que login admin.** Consistencia en el contrato de autenticacion para ambos roles.
- **No: OTP ni SMS.** El roadmap explicita esta decision de diseño.
- **No: nuevas tablas o migraciones.** El esquema vigente soporta el caso sin cambios.
- **No: respuestas diferenciadas en resetear-pin para usuario no existente vs no conductor.** Se usa 404 vs 400 para que el admin pueda distinguir si el conductor existe, ya que es un endpoint administrativo y no de autenticacion.

## 8. Riesgos identificados

| Riesgo | Mitigacion |
|---|---|
| PIN en plaintext expuesto en logs o respuesta HTTP. | No registrar el PIN. La respuesta solo llega al administrador autenticado. El PIN se envia una sola vez. |
| PIN corto (6 digitos) vulnerable a fuerza bruta. | El hash bcrypt costo 12 protege el almacenamiento. El PIN se puede regenerar en cualquier momento. |
| Timing attack en login de conductor. | Se aplica el mismo dummy hash que `loginAdmin`, garantizando tiempo constante. |
| Confundir el destino de desarrollo con el de pruebas. | Exigir destino exclusivo y verificar identidad antes de migrar o limpiar; no basta comparar literalmente URLs con distintos alias. |
| El `:id` en la ruta no es un UUID valido. | Zod o validacion manual del parametro; la busqueda por UUID de Prisma retorna null si no existe, manejado como 404. |
| Pin generado con `crypto.randomInt` no disponible en el runtime. | Verificar disponibilidad en Node.js runtime; alternativa con `crypto.randomBytes` si es necesario. |

## 9. Que NO forma parte de esta especificacion

- Login de administrador (ya implementado en SPEC 03).
- Configuracion de empresa y sus endpoints.
- OTP, recuperacion de cuenta, refresh tokens o registro publico.
- Gestion de conductores (creacion, aprobacion, suspension, vehiculos).
- Pasajeros, ubicaciones, solicitudes, tarifas o dashboard.
- Nuevas tablas, migraciones de negocio o despliegue de produccion.
- Endpoints de Configuracion, Conductores/Vehiculos o cualquier otro modulo del roadmap.
- Despliegue de produccion con los datos de prueba.
