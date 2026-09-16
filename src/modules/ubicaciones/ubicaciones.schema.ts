import { z } from "zod";

const latitudSchema = z.number().min(-90).max(90);
const longitudSchema = z.number().min(-180).max(180);

export const ubicacionRegistroSchema = z.object({
  latitud: latitudSchema,
  longitud: longitudSchema,
}).strict();

export const conductorIdSchema = z.string().length(36)
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export const ubicacionDtoSchema = z.object({
  id: z.string().regex(/^\d+$/),
  latitud: z.number(),
  longitud: z.number(),
  horaRegistro: z.iso.datetime(),
  esValida: z.boolean(),
}).strict();

export type UbicacionRegistroInput = z.infer<typeof ubicacionRegistroSchema>;
export type UbicacionConductorDto = z.infer<typeof ubicacionDtoSchema>;
