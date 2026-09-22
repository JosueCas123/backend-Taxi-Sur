import { EstadoConductor, EstadoDisponibilidad, EstadoJornada } from "@prisma/client";
import { z } from "zod";
import { estadoSolicitudSchema } from "../solicitudes/solicitudes.schema";

const latitudSchema = z.number().min(-90).max(90);
const longitudSchema = z.number().min(-180).max(180);

export const vehiculoMapaDtoSchema = z.object({
  placa: z.string(),
  marca: z.string(),
  modelo: z.string(),
  color: z.string(),
}).strict();

export const ubicacionMapaDtoSchema = z.object({
  latitud: latitudSchema,
  longitud: longitudSchema,
  horaRegistro: z.iso.datetime(),
}).strict();

export const mapaConductorDtoSchema = z.object({
  id: z.uuid(),
  nombreCompleto: z.string(),
  estado: z.enum(EstadoConductor),
  estadoJornada: z.enum(EstadoJornada),
  estadoDisponibilidad: z.enum(EstadoDisponibilidad),
  vehiculo: vehiculoMapaDtoSchema.nullable(),
  ubicacion: ubicacionMapaDtoSchema.nullable(),
  ultimaUbicacionRegistradaEn: z.iso.datetime().nullable(),
}).strict();

export const pasajeroResumenDtoSchema = z.object({
  id: z.uuid(),
  nombre: z.string(),
}).strict();

export const conductorAsignadoResumenDtoSchema = z.object({
  id: z.uuid(),
  nombreCompleto: z.string(),
}).strict();

export const solicitudActivaDtoSchema = z.object({
  id: z.uuid(),
  estado: estadoSolicitudSchema,
  pasajero: pasajeroResumenDtoSchema.nullable(),
  conductorAsignado: conductorAsignadoResumenDtoSchema.nullable(),
  latitudRecogida: latitudSchema,
  longitudRecogida: longitudSchema,
  destino: z.string().nullable(),
  expiraEn: z.iso.datetime().nullable(),
  creadoEn: z.iso.datetime(),
}).strict();

export const indicadoresDtoSchema = z.object({
  conductoresDisponibles: z.number().int().nonnegative(),
  conductoresEnServicio: z.number().int().nonnegative(),
  solicitudesActivas: z.number().int().nonnegative(),
  solicitudesCompletadasHoy: z.number().int().nonnegative(),
}).strict();

// Query exclusivamente vacia para las tres rutas de dashboard: una query no
// vacia responde 400 VALIDATION_ERROR (mismo patron que tarifas).
export const dashboardQuerySchema = z.object({}).strict();

export type VehiculoMapaDto = z.infer<typeof vehiculoMapaDtoSchema>;
export type UbicacionMapaDto = z.infer<typeof ubicacionMapaDtoSchema>;
export type MapaConductorDto = z.infer<typeof mapaConductorDtoSchema>;
export type PasajeroResumenDto = z.infer<typeof pasajeroResumenDtoSchema>;
export type ConductorAsignadoResumenDto = z.infer<typeof conductorAsignadoResumenDtoSchema>;
export type SolicitudActivaDto = z.infer<typeof solicitudActivaDtoSchema>;
export type IndicadoresDto = z.infer<typeof indicadoresDtoSchema>;