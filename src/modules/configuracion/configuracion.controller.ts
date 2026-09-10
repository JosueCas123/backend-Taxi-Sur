import type { RequestHandler } from "express";
import type { Configuracion } from "@prisma/client";
import { configuracionDtoSchema, configuracionUpdateSchema } from "./configuracion.schema";

function toDto(fila: Configuracion) {
  return configuracionDtoSchema.parse({
    id: fila.id,
    nombreEmpresa: fila.nombreEmpresa,
    radioMaximoBusquedaKm: fila.radioMaximoBusquedaKm,
    telefonoCentroAtencion: fila.telefonoCentroAtencion,
    actualizadoEn: fila.actualizadoEn.toISOString(),
  });
}

const configuracionEliminada = {
  error: { code: "CONFIGURATION_DELETED", message: "Configuracion eliminada" },
};

export const getConfiguracion: RequestHandler = async (_req, res) => {
  const { obtenerOInicializar } = await import("./configuracion.service");
  const fila = await obtenerOInicializar();
  if (fila.eliminadoEn !== null) {
    res.status(409).json(configuracionEliminada);
    return;
  }
  res.json(toDto(fila));
};

export const updateConfiguracion: RequestHandler = async (req, res) => {
  const input = configuracionUpdateSchema.parse(req.body);
  const { actualizarConfiguracion } = await import("./configuracion.service");
  const fila = await actualizarConfiguracion(input);
  if (fila.eliminadoEn !== null) {
    res.status(409).json(configuracionEliminada);
    return;
  }
  res.json(toDto(fila));
};