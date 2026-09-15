import type { RequestHandler } from "express";
import { pasajeroAceptarAvisoSchema, pasajeroIdentificarSchema, pasajeroIdSchema } from "./pasajeros.schema";

const pasajeroInexistente = { error: { code: "NOT_FOUND", message: "Pasajero no encontrado" } };

export const identificarPasajero: RequestHandler = async (req, res) => {
  const input = pasajeroIdentificarSchema.parse(req.body);
  const service = await import("./pasajeros.service");
  const result = await service.identificarPasajero(input);
  if (!result.ok) {
    res.status(409).json({ error: { code: result.code, message: "Pasajero eliminado" } });
    return;
  }
  res.status(200).json(result.pasajero);
};

export const aceptarAvisoPasajero: RequestHandler<{ id: string }> = async (req, res) => {
  const id = pasajeroIdSchema.safeParse(req.params.id);
  if (!id.success) {
    res.status(404).json(pasajeroInexistente);
    return;
  }
  pasajeroAceptarAvisoSchema.parse(req.body);
  const service = await import("./pasajeros.service");
  const result = await service.aceptarAvisoPasajero(id.data);
  if (!result.ok) {
    res.status(404).json(pasajeroInexistente);
    return;
  }
  res.status(200).json(result.pasajero);
};
