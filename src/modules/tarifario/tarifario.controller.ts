import type { RequestHandler } from "express";
import {
  actualizarTarifaSchema, crearTarifaSchema, tarifaIdSchema, tarifaQuerySchema,
} from "./tarifario.schema";

const tarifaNoEncontrada = { error: { code: "NOT_FOUND", message: "Tarifa no encontrada" } };

export const listarTarifas: RequestHandler = async (req, res) => {
  tarifaQuerySchema.parse(req.query);
  const service = await import("./tarifario.service");
  const tarifas = await service.obtenerTarifasVigentes(new Date());
  res.status(200).json(tarifas);
};

export const crearTarifa: RequestHandler = async (req, res) => {
  const input = crearTarifaSchema.parse(req.body);
  const service = await import("./tarifario.service");
  const tarifa = await service.crearTarifa(input);
  res.status(201).json(tarifa);
};

export const actualizarTarifa: RequestHandler<{ id: string }> = async (req, res) => {
  const id = tarifaIdSchema.safeParse(req.params.id);
  if (!id.success) {
    res.status(404).json(tarifaNoEncontrada);
    return;
  }
  const input = actualizarTarifaSchema.parse(req.body);
  const service = await import("./tarifario.service");
  const result = await service.actualizarTarifa(id.data, input);
  if (!result.ok) {
    res.status(404).json(tarifaNoEncontrada);
    return;
  }
  res.status(200).json(result.tarifa);
};