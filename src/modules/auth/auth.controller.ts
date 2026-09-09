import type { RequestHandler } from "express";
import { loginSchema } from "./auth.schema";

export const loginAdmin: RequestHandler = async (req, res) => {
  const input = loginSchema.parse(req.body);
  // Health e importar app no requieren inicializar el runtime de base de datos.
  const service = await import("./auth.service");
  const result = await service.loginAdmin(input.correo, input["contrase\u00f1a"]);
  if (!result) {
    res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Credenciales invalidas" } });
    return;
  }
  res.set("Cache-Control", "no-store").json(result);
};
