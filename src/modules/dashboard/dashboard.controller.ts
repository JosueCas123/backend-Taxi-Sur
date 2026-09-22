import type { RequestHandler } from "express";
import { dashboardQuerySchema } from "./dashboard.schema";

const SIN_CACHE = "no-store";

export const obtenerMapaConductores: RequestHandler = async (req, res) => {
  dashboardQuerySchema.parse(req.query);
  const service = await import("./dashboard.service");
  const mapa = await service.obtenerConductoresParaMapa(new Date());
  res.set("Cache-Control", SIN_CACHE).status(200).json(mapa);
};

export const obtenerSolicitudesActivas: RequestHandler = async (req, res) => {
  dashboardQuerySchema.parse(req.query);
  const service = await import("./dashboard.service");
  const solicitudes = await service.obtenerSolicitudesActivas();
  res.set("Cache-Control", SIN_CACHE).status(200).json(solicitudes);
};

export const obtenerIndicadores: RequestHandler = async (req, res) => {
  dashboardQuerySchema.parse(req.query);
  const service = await import("./dashboard.service");
  const indicadores = await service.obtenerIndicadores(new Date());
  res.set("Cache-Control", SIN_CACHE).status(200).json(indicadores);
};