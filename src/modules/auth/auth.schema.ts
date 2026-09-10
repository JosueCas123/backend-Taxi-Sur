import { z } from "zod";

export const loginSchema = z.object({
  correo: z.email(),
  "contrase\u00f1a": z.string().min(1),
});

export const conductorLoginSchema = z.object({
  telefono: z.string().min(1),
  pin: z.string().min(1),
});
