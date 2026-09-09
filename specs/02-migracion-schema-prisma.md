# SPEC 02 - Migracion inicial del esquema Prisma

> **Estado:** Implementado
> **Depende de:** ninguno
> **Fecha:** 2026-09-09
> **Objetivo:** Migrar los ocho modelos actuales de Prisma a la base vacia de desarrollo en Supabase mediante SQL versionado y revisado, sin crear datos iniciales.

## 1. Contexto

Las rutas de implementacion de este documento son relativas a `backend/`.

Referencias revisadas:

- `../docs/ARQUITECTURA.md`.
- `../docs/MODELO_DE_DATOS.md`.
- `../docs/REGLAS_DE_NEGOCIO.md`.
- `../specs/backend/01-configuracion.md`.
- `README.md`.

El repositorio contiene `prisma/schema.prisma` y `prisma.config.ts`, pero no tiene historial local de migraciones.
La version bloqueada de Prisma es 7.10.0.
La URL del datasource aparece tanto en el esquema como en la configuracion de Prisma; debe quedar en `prisma.config.ts` para la compatibilidad con Prisma 7.

El usuario confirma que la base de Supabase esta vacia y se destina exclusivamente a desarrollo.
La implementacion debe verificar esa condicion antes de aplicar cambios.
Los esquemas internos de Supabase no se consideran tablas de la aplicacion y no deben modificarse.

## 2. Alcance

**Incluye:**

- Verificar requisitos locales y acceso de migracion a Supabase sin mostrar credenciales.
- Inspeccionar el esquema de destino y el posible historial remoto de migraciones antes de modificar la base.
- Ajustar la configuracion necesaria para usar la version instalada de Prisma 7.
- Conservar los ocho modelos existentes y sus nombres fisicos.
- Generar SQL inicial desde un esquema vacio, sin base sombra.
- Revisar y versionar la migracion antes de aplicarla con Prisma Migrate deploy.
- Verificar tablas, columnas, enumeraciones, relaciones y restricciones declaradas en el esquema.
- Generar Prisma Client.
- Documentar el procedimiento y sus comprobaciones en `README.md`.

**NO incluye:**

- Redisenar modelos o agregar restricciones de negocio no declaradas actualmente.
- Crear registros iniciales, usuarios administradores, tarifas o datos de prueba.
- Implementar endpoints, autenticacion o un modulo de conexion de la aplicacion.
- Implementar reservas exclusivas, reintentos, rechazos o historial de solicitudes.
- Migrar datos existentes, realizar un baseline o desplegar a produccion.
- Reiniciar la base, borrar datos o modificar esquemas administrados por Supabase.
- Actualizar dependencias a otra version principal de Prisma.

## 3. Modelo de datos usado

No se introducen nuevas estructuras de datos de negocio.
La fuente de verdad para columnas, tipos, valores por defecto y relaciones es `prisma/schema.prisma` al comenzar la implementacion.

| Modelo Prisma | Tabla fisica |
|---|---|
| `Configuracion` | `configuracion` |
| `Usuario` | `usuarios` |
| `Conductor` | `conductores` |
| `Vehiculo` | `vehiculos` |
| `Pasajero` | `pasajeros` |
| `UbicacionConductor` | `ubicaciones_conductor` |
| `Solicitud` | `solicitudes` |
| `Tarifa` | `tarifas` |

Se conservan las enumeraciones `RolUsuario`, `EstadoConductor`, `EstadoJornada`, `EstadoDisponibilidad` y `EstadoSolicitud` con sus valores actuales.
Se conservan los campos de borrado logico `eliminado_en`.
No se convierten los identificadores a UUID nativo ni se agregan indices o restricciones ajenos al esquema actual.

Prisma administrara su tabla tecnica `_prisma_migrations`; no es un modelo de negocio ni un registro inicial de la aplicacion.

## 4. Reglas de negocio aplicables

Esta migracion materializa la estructura documentada, pero no implementa los servicios que aplican las reglas operativas.

- La columna de borrado logico no impide por si sola un borrado fisico.
- El valor por defecto `Configuracion.id = 1` no garantiza una unica fila.
- La exclusividad de solicitudes activas y reservas de conductores queda fuera de esta especificacion.
- La caducidad de ubicaciones y solicitudes requiere logica posterior.
- La inicializacion de configuracion permanece en `01-configuracion.md`; no es una dependencia para crear las tablas.

## 5. Archivos previstos

| Ruta | Cambio |
|---|---|
| `prisma/schema.prisma` | Retirar la URL del datasource del esquema sin modificar los modelos. |
| `prisma.config.ts` | Conservar la conexion mediante `DATABASE_URL`; ajustar solo lo necesario para la migracion si la validacion lo exige. |
| `prisma/migrations/<marca-temporal>_init/migration.sql` | Crear el SQL inicial revisado. |
| `prisma/migrations/migration_lock.toml` | Registrar PostgreSQL como proveedor del historial. |
| `README.md` | Documentar requisitos, generacion, despliegue y verificaciones. |

La marca temporal sera la correspondiente a la generacion de la migracion durante la implementacion.
Prisma Client es un artefacto generado en la ubicacion configurada por el proyecto; no se edita manualmente.
No se agregaran credenciales al repositorio ni al documento.
Si el acceso requiere cambios fuera de estas rutas, se debe aclarar el ajuste antes de ampliar el alcance.

## 6. Plan de implementacion

1. Verificar la version de Node y las dependencias instaladas frente a los requisitos de Prisma 7.10.0. Comprobar que la conexion configurada sirve para migraciones en Supabase. Inspeccionar el esquema objetivo y el historial remoto sin modificar datos. Detenerse si existen tablas de aplicacion, migraciones previas o dudas sobre el destino.
2. Retirar `url` del bloque datasource de `prisma/schema.prisma` y mantener la conexion en `prisma.config.ts`. Ejecutar la validacion del esquema con la version local de Prisma. No cambiar modelos para resolver problemas ajenos a la compatibilidad.
3. Generar SQL con Prisma Migrate diff desde vacio hacia el esquema configurado usando la sintaxis de la version instalada. Guardarlo en `prisma/migrations/<marca-temporal>_init/migration.sql` y agregar el archivo de bloqueo del proveedor. Revisar que represente los ocho modelos y cinco enumeraciones sin instrucciones destructivas ni objetos internos de Supabase.
4. Aplicar la migracion revisada mediante Prisma Migrate deploy sobre el destino confirmado. Comprobar el estado del historial y la estructura creada. Ante un fallo, conservar el error sin secretos y detenerse; no reiniciar la base ni marcar manualmente una migracion como aplicada sin investigar.
5. Generar Prisma Client y actualizar `README.md` con los comandos exactos compatibles con la version instalada. Documentar los resultados de las comprobaciones y la repeticion segura de Migrate deploy.

## 7. Criterios de aceptacion

- [ ] Se confirma que el destino es el proyecto de desarrollo de Supabase previsto, sin revelar credenciales.
- [ ] La inspeccion previa confirma la ausencia de tablas de la aplicacion y de un historial de migraciones incompatible.
- [ ] Prisma valida `prisma/schema.prisma` correctamente con la configuracion de Prisma 7.
- [ ] El diff de los modelos no contiene cambios de campos, relaciones, enumeraciones o restricciones respecto del esquema inicial.
- [ ] El SQL inicial y `migration_lock.toml` existen bajo `prisma/migrations/` y pueden versionarse sin secretos.
- [ ] La revision del SQL confirma que no contiene operaciones destructivas ni cambios sobre esquemas administrados por Supabase.
- [ ] Migrate deploy finaliza correctamente y Migrate status informa que no hay migraciones pendientes.
- [ ] Las ocho tablas y cinco enumeraciones de negocio existen en el esquema objetivo.
- [ ] Las columnas, claves primarias, claves foraneas, restricciones unicas y valores por defecto de la base coinciden con el SQL revisado y el esquema Prisma, considerando los valores generados por Prisma Client.
- [ ] Las ocho tablas de negocio permanecen sin registros tras la migracion.
- [ ] Una segunda ejecucion de Migrate deploy finaliza sin volver a aplicar la migracion ni recrear tablas.
- [ ] Prisma Client se genera correctamente sin agregar un modulo de conexion de la aplicacion.
- [ ] `README.md` documenta el flujo ejecutado y las comprobaciones reproducibles sin credenciales.

## 8. Decisiones tomadas y descartadas

- **Si: conservar los modelos actuales.** El usuario prioriza desplegar el esquema existente; los cambios de reglas de negocio requieren otra especificacion.
- **Si: Supabase solo para desarrollo.** No se define un procedimiento de produccion en este trabajo.
- **Si: SQL inicial revisado y Migrate deploy.** Permite versionar y aplicar la migracion sin una base sombra.
- **No: Migrate dev sobre Supabase.** No se configurara una base sombra para este alcance.
- **No: db push como entrega.** La entrega requiere historial SQL versionado.
- **No: reset o baseline automatico.** La base vacia es una precondicion que debe comprobarse; una discrepancia exige detenerse.
- **No: datos iniciales.** La inicializacion de configuracion ya pertenece a otra especificacion.
- **No: modulo runtime de Prisma.** La generacion del cliente no implica integrar la aplicacion.
- **Si: guardar esta especificacion en `specs/` dentro de backend.** El usuario solicita mantener el archivo dentro de la raiz del workspace.

## 9. Riesgos identificados

| Riesgo | Mitigacion |
|---|---|
| La base no esta vacia o se apunta al proyecto equivocado. | Inspeccionar el destino antes de aplicar SQL y detenerse ante discrepancias. |
| La conexion configurada usa un modo de pool incompatible con la migracion o no tiene permisos suficientes. | Verificar el tipo de conexion de Supabase y los permisos antes del despliegue; no publicar la URL. |
| Confundir esquemas internos de Supabase con objetos de la aplicacion. | Limitar la inspeccion y el SQL de escritura al esquema objetivo de la aplicacion. |
| Prisma 7 no acepta la configuracion heredada o la version local de Node. | Validar requisitos y configuracion antes de generar o aplicar SQL. |
| La migracion falla y deja un estado parcial. | Inspeccionar el error y el historial antes de definir una recuperacion; no usar borrados ni resoluciones automaticas. |
| Interpretar tablas creadas como reglas de negocio implementadas. | Mantener explicitamente fuera de alcance las reglas que requieren servicios o nuevas restricciones. |

## 10. Que NO forma parte de esta especificacion

- Endpoints y modulo de conexion de la aplicacion.
- Autenticacion y creacion del primer administrador.
- Seeds de configuracion, tarifas o datos de prueba.
- Redisenos del modelo y ejecucion de reglas operativas.
- Migracion de datos existentes o despliegue a produccion.
