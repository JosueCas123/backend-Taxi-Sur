import { z } from "zod";

export const solicitudIdSchema = z.string().length(36)
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export const estadoSolicitudSchema = z.enum([
  "creada",
  "buscando",
  "conductor_seleccionado",
  "esperando_respuesta",
  "aceptada",
  "rechazada",
  "expirada",
  "en_servicio",
  "finalizada",
  "sin_conductor",
]);

const latitudSchema = z.number().min(-90).max(90);
const longitudSchema = z.number().min(-180).max(180);

export const crearSolicitudSchema = z.object({
  pasajeroId: z.uuid(),
  latitudRecogida: latitudSchema,
  longitudRecogida: longitudSchema,
  destino: z.string().trim().min(1).max(255).optional(),
}).strict();

export const seleccionarConductorSchema = z.object({
  conductorId: z.uuid(),
}).strict();

export const responderSolicitudSchema = z.object({
  acepta: z.boolean(),
}).strict();

// Acepta ausencia de cuerpo o `{}`; arrays, `null`, strings y campos
// adicionales se rechazan con 400 (mismo patron que el aviso de SPEC 07).
export const finalizarSolicitudSchema = z.object({}).strict().optional();

export const sinConductorSolicitudSchema = z.object({}).strict().optional();

export const solicitudDtoSchema = z.object({
  id: z.uuid(),
  pasajeroId: z.uuid(),
  conductorAsignadoId: z.uuid().nullable(),
  estado: estadoSolicitudSchema,
  latitudRecogida: latitudSchema,
  longitudRecogida: longitudSchema,
  destino: z.string().nullable(),
  expiraEn: z.iso.datetime().nullable(),
  aceptadaEn: z.iso.datetime().nullable(),
  finalizadaEn: z.iso.datetime().nullable(),
  creadoEn: z.iso.datetime(),
}).strict();

export const conductorAsignadoDtoSchema = z.object({
  id: z.uuid(),
  nombreCompleto: z.string(),
  vehiculo: z.object({
    placa: z.string(),
    marca: z.string(),
    modelo: z.string(),
    color: z.string(),
    capacidadPasajeros: z.number().int(),
  }).strict().nullable(),
}).strict();

export const solicitudDetalleDtoSchema = solicitudDtoSchema.extend({
  pasajero: z.object({
    id: z.uuid(),
    nombre: z.string(),
  }).strict(),
  conductorAsignado: conductorAsignadoDtoSchema.nullable(),
}).strict();

export type SolicitudId = z.infer<typeof solicitudIdSchema>;
export type CrearSolicitudInput = z.infer<typeof crearSolicitudSchema>;
export type SeleccionarConductorInput = z.infer<typeof seleccionarConductorSchema>;
export type ResponderSolicitudInput = z.infer<typeof responderSolicitudSchema>;
export type EstadosSolicitud = z.infer<typeof estadoSolicitudSchema>;
export type SolicitudDto = z.infer<typeof solicitudDtoSchema>;
export type ConductorAsignadoDto = z.infer<typeof conductorAsignadoDtoSchema>;
export type SolicitudDetalleDto = z.infer<typeof solicitudDetalleDtoSchema>;