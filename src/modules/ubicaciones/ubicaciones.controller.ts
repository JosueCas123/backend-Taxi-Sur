import type { RequestHandler } from "express";
import type { AuthenticatedRequest } from "../../middlewares/auth";
import { conductorIdSchema, ubicacionRegistroSchema } from "./ubicaciones.schema";

const conductorInexistente = { error: { code: "NOT_FOUND", message: "Conductor no encontrado" } };
const permisoDenegado = { error: { code: "FORBIDDEN", message: "Permiso denegado" } };
const conductorNoAprobado = { error: { code: "CONDUCTOR_NO_APROBADO", message: "Conductor no aprobado" } };
const credencialesInvalidas = { error: { code: "UNAUTHORIZED", message: "Credenciales invalidas" } };

export const registrarUbicacionConductor: RequestHandler<{ id: string }> = async (req, res) => {
  const id = conductorIdSchema.safeParse(req.params.id);
  if (!id.success) {
    res.status(404).json(conductorInexistente);
    return;
  }
  const input = ubicacionRegistroSchema.parse(req.body);
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) {
    res.status(401).json(credencialesInvalidas);
    return;
  }
  const service = await import("./ubicaciones.service");
  const result = await service.registrarUbicacion(id.data, input, auth);
  if (!result.ok) {
    if (result.code === "NOT_FOUND") {
      res.status(404).json(conductorInexistente);
    } else if (result.code === "FORBIDDEN") {
      res.status(403).json(permisoDenegado);
    } else {
      res.status(403).json(conductorNoAprobado);
    }
    return;
  }
  res.status(201).json(result.ubicacion);
};

export const obtenerUltimaUbicacionConductor: RequestHandler<{ id: string }> = async (req, res) => {
  const id = conductorIdSchema.safeParse(req.params.id);
  if (!id.success) {
    res.status(404).json(conductorInexistente);
    return;
  }
  const service = await import("./ubicaciones.service");
  const result = await service.obtenerUltimaUbicacion(id.data, new Date());
  if (!result.ok) {
    res.status(404).json(conductorInexistente);
    return;
  }
  res.status(200).json(result.ubicacion);
};