import type { RequestHandler } from "express";
import { solicitudIdSchema } from "./motor-asignacion.schema";

const solicitudNoEncontrada = { error: { code: "NOT_FOUND", message: "Solicitud no encontrada" } };

export const obtenerCandidatosSolicitud: RequestHandler<{ id: string }> = async (req, res) => {
  const id = solicitudIdSchema.safeParse(req.params.id);
  if (!id.success) {
    res.status(404).json(solicitudNoEncontrada);
    return;
  }
  const service = await import("./motor-asignacion.service");
  const result = await service.obtenerCandidatos(id.data, new Date());
  if (!result.ok) {
    res.status(404).json(solicitudNoEncontrada);
    return;
  }
  res.status(200).json({ candidatos: result.candidatos });
};