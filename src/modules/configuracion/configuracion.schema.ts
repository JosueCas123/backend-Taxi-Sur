import { z } from "zod";

const maxEnteroPositivo = 2147483647;

const nombreEmpresa = z.string().trim().min(1).max(100);
const radioMaximoBusquedaKm = z.number().int().min(1).max(maxEnteroPositivo);
const telefonoCentroAtencion = z.nullable(z.string().trim().min(1).max(30));

export const configuracionUpdateSchema = z.object({
  nombreEmpresa: z.optional(nombreEmpresa),
  radioMaximoBusquedaKm: z.optional(radioMaximoBusquedaKm),
  telefonoCentroAtencion: z.optional(telefonoCentroAtencion),
}).strict().refine((value) => Object.keys(value).length > 0);

export type ConfiguracionUpdateInput = z.infer<typeof configuracionUpdateSchema>;

export const configuracionDtoSchema = z.object({
  id: z.number(),
  nombreEmpresa: z.string(),
  radioMaximoBusquedaKm: z.number().int(),
  telefonoCentroAtencion: z.string().nullable(),
  actualizadoEn: z.string(),
}).strict();

export type ConfiguracionDto = z.infer<typeof configuracionDtoSchema>;