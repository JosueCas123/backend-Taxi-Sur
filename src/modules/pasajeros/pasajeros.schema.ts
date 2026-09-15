import { z } from "zod";

// La asercion final no permite el salto de linea que puede aceptar $.
const whatsappIdSchema = z.string().regex(/^[0-9]+(?![\s\S])/);

export const pasajeroIdentificarSchema = z.object({
  whatsappId: whatsappIdSchema,
  nombre: z.string().trim().min(1),
}).strict();

export const pasajeroAceptarAvisoSchema = z.object({}).strict().optional();

export const pasajeroIdSchema = z.string().length(36)
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export const pasajeroDtoSchema = z.object({
  id: z.uuid(),
  whatsappId: whatsappIdSchema,
  nombre: z.string(),
  aceptacionAvisoPrivacidad: z.iso.datetime().nullable(),
  creadoEn: z.iso.datetime(),
}).strict();

export type PasajeroIdentificarInput = z.infer<typeof pasajeroIdentificarSchema>;
export type PasajeroDto = z.infer<typeof pasajeroDtoSchema>;
