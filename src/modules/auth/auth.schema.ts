import { z } from "zod";

export const loginSchema = z.object({
  correo: z.email(),
  "contrase\u00f1a": z.string().min(1),
});
