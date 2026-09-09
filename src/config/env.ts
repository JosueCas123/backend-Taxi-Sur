import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ quiet: true });

const exampleSecrets = new Set([
  "XXXX",
  "cambia_esto_por_un_secreto_largo_y_aleatorio",
  "cambia_esto_por_otro_secreto",
]);

const secret = z.string().refine(
  (value) => value.trim().length > 0 && !exampleSecrets.has(value.trim()),
);

const result = z.object({
  DATABASE_URL: z.url().refine((value) => {
    try {
      const url = new URL(value);
      return ["postgresql:", "postgres:"].includes(url.protocol)
        && url.hostname.length > 0 && url.pathname.length > 1
        && !exampleSecrets.has(decodeURIComponent(url.password));
    } catch {
      return false;
    }
  }),
  PORT: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(65535)),
  NODE_ENV: z.enum(["development", "test", "production"]),
  JWT_SECRET: secret,
  JWT_EXPIRES_IN: z.literal("8h"),
  N8N_API_TOKEN: secret,
}).safeParse(process.env);

if (!result.success) {
  const fields = [...new Set(result.error.issues.map((issue) => issue.path[0]))];
  throw new Error(`Configuracion de entorno invalida: ${fields.join(", ")}`);
}

export const env = result.data;
