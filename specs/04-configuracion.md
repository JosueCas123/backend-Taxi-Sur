# SPEC 04 - Endpoints de configuracion global

> **Estado:** Borrador
> **Depende de:** SPEC 02 (`02-migracion-schema-prisma.md`), SPEC 03 (`03-base-auth-admin.md`)
> **Fecha:** 2026-09-09
> **Objetivo:** Consultar e inicializar la configuracion global de TaxiSur y permitir su actualizacion parcial exclusivamente a administradores autenticados.

## 1. Contexto

Las rutas son relativas a `backend/`.
Esta entrega corresponde al modulo 1 de `../docs/ROADMAP_ENDPOINTS.md`.
Se basa en SPEC 02, el esquema Prisma vigente y `ARQUITECTURA.md`, `MODELO_DE_DATOS.md` y `REGLAS_DE_NEGOCIO.md` de `../docs/`.
No se utiliza `../specs/backend/01-configuracion.md` ni se heredan sus decisiones.
El servidor y la seguridad se implementan primero en SPEC 03 por decision del usuario.
La referencia del roadmap a SPEC 02 se interpreta como antecedente de persistencia, no como implementacion de endpoints.

## 2. Alcance

**Incluye:**

- `GET /api/configuracion` para consumidores internos autenticados.
- `PUT /api/configuracion` parcial para administrador autenticado.
- Inicializacion segura de la fila `id = 1` cuando no existe, incluso ante peticiones concurrentes.
- Validacion Zod, DTO camelCase, errores JSON y pruebas HTTP con persistencia.
- Parametros que otros modulos usaran para aplicar la regla 3: radio inicial de 5 km.

**NO incluye:**

- Login, servidor nuevo o duplicacion de los middlewares de SPEC 03.
- Multiples empresas, endpoints de borrado o restauracion.
- Motor de asignacion, calculo de distancias o validacion de disponibilidad.
- Contacto telefonico real, llamadas, SMS o integracion de WhatsApp.
- Nuevas tablas, cambios al esquema o restricciones SQL adicionales.

## 3. Modelo de datos y contratos

No se agregan estructuras persistentes; se reutiliza `Configuracion` de SPEC 02.
Todos los accesos de este modulo usan exclusivamente `id = 1`.
No se aceptan identificadores enviados por el cliente.

Valores iniciales confirmados:

```json
{
  "id": 1,
  "nombreEmpresa": "TaxiSur - Pruebas",
  "radioMaximoBusquedaKm": 5,
  "telefonoCentroAtencion": "+59100000000"
}
```

El telefono es un marcador ficticio, no un contacto operativo.
La inicializacion usa estos valores fijos confirmados; `RADIO_BUSQUEDA_KM_DEFAULT` no cambia el contrato y se retira de `.env.example` para evitar configuraciones contradictorias.
Una fila existente conserva sus valores; no se vuelve a sembrar en cada arranque o lectura.

DTO de respuesta compartido por GET y PUT:

- `id`: numero, siempre `1`.
- `nombreEmpresa`: string.
- `radioMaximoBusquedaKm`: entero.
- `telefonoCentroAtencion`: string o `null`.
- `actualizadoEn`: fecha ISO 8601 serializada en UTC.

No exponer `creadoEn` ni `eliminadoEn` en este DTO.

### GET /api/configuracion

- Sin body ni parametros de negocio.
- Acepta Bearer JWT de usuario activo, de cualquier rol existente, o `X-N8N-Token` valido mediante SPEC 03.
- Sin credencial valida: 401; nunca crea una fila para una peticion no autenticada.
- Si la fila existe y esta activa, devolver 200 con el DTO sin modificar `actualizadoEn`.
- Si falta, crearla de forma segura y devolver 200 con el mismo DTO.
- Si `eliminadoEn` no es null, devolver 409 `CONFIGURATION_DELETED`; no restaurar ni reemplazar datos.

### PUT /api/configuracion

- Requiere Bearer JWT de administrador activo; n8n por si solo no autoriza esta ruta.
- Autenticar y autorizar antes de validar los campos de negocio o acceder a la configuracion.
- Body JSON estricto con al menos uno de los tres campos editables siguientes.

| Campo | Validacion |
|---|---|
| `nombreEmpresa` | String recortado de 1 a 100 caracteres; no acepta null. |
| `radioMaximoBusquedaKm` | Numero entero entre 1 y 2147483647, sin coercion de strings; no acepta null. |
| `telefonoCentroAtencion` | Null o string recortado de 1 a 30 caracteres; sin obligacion de formato telefonico real. |

- `{}`, arrays, null, campos desconocidos o tipos invalidos producen 400.
- No admitir cambios de `id`, fechas ni `eliminadoEn`.
- Actualizar solo los campos presentes; `null` explicito limpia el telefono.
- Si falta la fila, crearla con los valores por defecto y aplicar los campos validos enviados en la misma operacion atomica.
- Si la fila esta eliminada logicamente, devolver 409 sin modificarla.
- Respuesta 200 con el DTO actualizado; Prisma administra `actualizadoEn`.
- Una peticion invalida o no autorizada no inicializa ni modifica datos.

### Concurrencia y errores

- Usar operaciones atomicas respaldadas por la PK para que GET/PUT concurrentes no produzcan duplicados ni errores de unicidad sin controlar.
- La rama de lectura/inicializacion no debe sobrescribir campos de una fila existente ni avanzar su fecha de actualizacion.
- PUT debe actualizar campos individualmente sin reescribir una copia completa leida antes; las actualizaciones de campos distintos no deben perderse.
- Para escrituras simultaneas al mismo campo se acepta la ultima escritura efectiva en la base, sin versionado optimista.
- Reutilizar `{ "error": { "code": "...", "message": "..." } }` y los codigos de SPEC 03.
- 400 entrada invalida, 401 sin autenticacion valida, 403 usuario activo sin permiso admin, 409 configuracion eliminada y 500 fallo interno seguro.
- La indisponibilidad de PostgreSQL nunca se sustituye por una respuesta 200 con valores solo en memoria.

## 4. Archivos previstos

| Ruta | Cambio |
|---|---|
| `src/modules/configuracion/configuracion.router.ts` | GET interno y PUT admin usando middlewares de SPEC 03. |
| `src/modules/configuracion/configuracion.controller.ts` | Validacion, DTO y respuestas. |
| `src/modules/configuracion/configuracion.service.ts` | Inicializacion y actualizacion atomicas de id=1. |
| `src/modules/configuracion/configuracion.schema.ts` | Esquema estricto del PUT y contrato de salida. |
| `src/app.ts` | Montar `/api/configuracion`. |
| `tests/configuracion.test.ts` | Contratos, permisos, validacion, persistencia y concurrencia. |
| `.env.example` | Retirar la variable de radio predeterminado que no se usa. |
| `README.md` | Valores ficticios, permisos y ejemplos reproducibles. |

Se reutilizan `src/config/prisma.ts`, `src/middlewares/auth.ts`, el manejador de errores y el entorno de pruebas sin duplicarlos.
No se requieren dependencias adicionales respecto de SPEC 03.

## 5. Plan de implementacion

1. Verificar que SPEC 03 esta implementada y que build, health y pruebas de Auth funcionan. Incorporar el esquema de validacion y sus casos de prueba sin cambiar las rutas existentes.
2. Implementar consulta/inicializacion y conectar GET con autenticacion interna y DTO. Probar lectura inicial, lectura repetida y acceso denegado.
3. Implementar actualizacion parcial atomica y conectar PUT protegido por rol admin. Probar inicializacion mediante PUT, persistencia y campos omitidos.
4. Completar manejo de fila eliminada, fallos de base y carreras de inicializacion/actualizacion. Incorporar pruebas concurrentes contra PostgreSQL separado.
5. Actualizar README con contratos y ejemplos curl de GET/PUT y advertencia sobre el telefono ficticio. Retirar el ejemplo de variable de radio no utilizada.

Cada paso conserva las rutas existentes y deja las pruebas previas funcionando.

## 6. Criterios de aceptacion

- [ ] `npm run build` y `npm test` pasan, incluidas las pruebas de SPEC 03.
- [ ] GET sin credenciales devuelve 401 y no crea la fila.
- [ ] GET con JWT de usuario activo o token n8n valido devuelve 200.
- [ ] Primer GET autenticado crea exactamente id=1 con los tres valores predeterminados confirmados.
- [ ] GET repetido no cambia datos ni `actualizadoEn`.
- [ ] GET y PUT devuelven solo los cinco campos del DTO, con fecha ISO UTC.
- [ ] PUT sin JWT valido devuelve 401; con JWT de usuario activo no admin devuelve 403; con solo token n8n no permite escribir.
- [ ] PUT de admin actualiza uno o varios campos y conserva los omitidos.
- [ ] PUT valido sobre tabla vacia crea la fila con defaults para los campos omitidos y valores enviados para los restantes.
- [ ] PUT con telefono null limpia el campo y un GET posterior devuelve null.
- [ ] Cuerpo vacio, desconocidos, campos no editables, tipos incorrectos, radio cero/negativo/fraccionario/fuera de rango y strings fuera de limites devuelven 400 sin escritura.
- [ ] Los strings aceptados se almacenan recortados; strings de solo espacios se rechazan.
- [ ] GET y PUT sobre fila eliminada devuelven 409 y preservan todos sus datos.
- [ ] Inicializaciones GET/PUT concurrentes no generan duplicados, errores de unicidad sin controlar ni perdida de los valores actualizados por PUT.
- [ ] Dos PUT concurrentes de campos diferentes conservan ambas actualizaciones.
- [ ] Fallo de base produce 500 con error JSON seguro, sin datos inventados ni detalles internos.
- [ ] Todas las pruebas con escrituras usan exclusivamente el destino separado validado por SPEC 03.
- [ ] README advierte que `+59100000000` no es un telefono operativo y muestra como reemplazarlo mediante PUT admin.

## 7. Decisiones tomadas y descartadas

- **Si: Configuracion como primer modulo de negocio.** Auth admin se adelanta solo como prerrequisito de seguridad.
- **Si: GET interno autenticado.** El usuario confirmo JWT o token n8n en vez de acceso publico.
- **Si: PUT parcial.** Se conserva el metodo del roadmap aunque la actualizacion no reemplace todo el recurso.
- **Si: rechazar body vacio y campos desconocidos.** Hace explicitos los errores de los consumidores.
- **Si: valores ficticios fijos y radio de 5 km.** Permite iniciar sin datos reales y respeta la regla 3.
- **Si: telefono nullable sin formato estricto.** Permite limpiar el contacto y usar el marcador de prueba confirmado.
- **Si: fila eliminada produce conflicto.** Evita restauraciones implicitas.
- **Si: singleton aplicado por el modulo y PK.** No se amplian las migraciones de SPEC 02.
- **No: contrato de la spec antigua.** Todas las decisiones de esta entrega se aclararon de nuevo con el usuario.
- **No: actualizacion anonima temporal ni GET publico.** Se usa desde el inicio la seguridad de SPEC 03.

## 8. Riesgos identificados

| Riesgo | Mitigacion |
|---|---|
| El marcador telefonico se presenta como contacto real. | Advertir en README y reemplazarlo antes de uso operativo. |
| El esquema permite insertar ids distintos de 1 por acceso directo. | El modulo solo opera id=1; no prometer una restriccion global que la base actual no tiene. |
| Carreras entre inicializacion y actualizacion. | Operaciones atomicas y pruebas concurrentes reales; nunca resembrar datos existentes. |
| La base de pruebas no esta disponible. | Reportar integracion no verificada; no usar desarrollo como sustituto. |

## 9. Que NO forma parte de esta especificacion

- Auth adicional, OTP y gestion de usuarios.
- Multiples empresas, eliminacion/restauracion y nuevas migraciones.
- Asignacion de conductores, llamadas o envio de mensajes.
- Despliegue productivo con los datos de prueba.
