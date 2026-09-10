import type { RequestHandler } from "express";
import { conductorLoginSchema, loginSchema } from "./auth.schema";

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

export const loginConductor: RequestHandler = async (req, res) => {
  const input = conductorLoginSchema.parse(req.body);
  const service = await import("./auth.service");
  const result = await service.loginConductor(input.telefono, input.pin);
  if (!result) {
    res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Credenciales invalidas" } });
    return;
  }
  res.set("Cache-Control", "no-store").json(result);
};

const conductorInexistente = {
  error: { code: "NOT_FOUND", message: "Conductor no encontrado" },
};
const conductorNoValido = {
  error: { code: "VALIDATION_ERROR", message: "El usuario no es conductor" },
};

export const resetearPin: RequestHandler<{ id: string }> = async (req, res) => {
  const service = await import("./auth.service");
  const result = await service.resetearPin(req.params.id);
  if (!result.ok) {
    res.status(result.code === "NOT_FOUND" ? 404 : 400).json(
      result.code === "NOT_FOUND" ? conductorInexistente : conductorNoValido,
    );
    return;
  }
  res.json({ pin: result.pin });
};
