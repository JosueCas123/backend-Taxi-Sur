import { z } from "zod";

export const solicitudIdSchema = z.string().length(36)
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export const candidatoDtoSchema = z.object({
  conductorId: z.uuid(),
  nombreCompleto: z.string(),
  distanciaKm: z.number().finite().nonnegative(),
  vehiculo: z.object({
    placa: z.string(),
    marca: z.string(),
    modelo: z.string(),
    color: z.string(),
    capacidadPasajeros: z.number().int(),
  }).strict(),
}).strict();

export const candidatosDtoSchema = z.object({
  candidatos: z.array(candidatoDtoSchema),
}).strict();

export type SolicitudId = z.infer<typeof solicitudIdSchema>;
export type CandidatoDto = z.infer<typeof candidatoDtoSchema>;
export type CandidatosDto = z.infer<typeof candidatosDtoSchema>;