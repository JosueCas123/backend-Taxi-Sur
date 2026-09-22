import { z } from "zod";

export const tarifaIdSchema = z.string().length(36)
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

const descripcionSchema = z.string().trim().min(1).max(255);
// El formato limita Decimal(10,2) sin conversion numerica ni redondeo.
const montoSchema = z.string().regex(/^(?:0|[1-9][0-9]{0,7})\.[0-9]{2}$/)
  .refine((value) => value !== "0.00" && value === value.trim());
const vigenciaDesdeSchema = z.iso.date();

export const crearTarifaSchema = z.object({
  descripcion: descripcionSchema,
  monto: montoSchema,
  vigenciaDesde: vigenciaDesdeSchema,
}).strict();

export const actualizarTarifaSchema = z.object({
  descripcion: descripcionSchema.optional(),
  monto: montoSchema.optional(),
}).strict().refine((value) => value.descripcion !== undefined || value.monto !== undefined);

export const tarifaQuerySchema = z.object({}).strict();

export const tarifaDtoSchema = z.object({
  id: z.uuid(),
  descripcion: z.string().min(1).max(255),
  monto: montoSchema,
  vigenciaDesde: vigenciaDesdeSchema,
}).strict();

export type CrearTarifaInput = z.infer<typeof crearTarifaSchema>;
export type ActualizarTarifaInput = z.infer<typeof actualizarTarifaSchema>;
export type TarifaDto = z.infer<typeof tarifaDtoSchema>;
