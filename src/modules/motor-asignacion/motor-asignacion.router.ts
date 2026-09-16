import { Router } from "express";
import type { RequestHandler } from "express";
import { obtenerCandidatosSolicitud } from "./motor-asignacion.controller";

const requireN8nLazy: RequestHandler = (req, res, next) => {
  void import("../../middlewares/auth").then(({ requireN8n }) => requireN8n(req, res, next)).catch(next);
};

export const motorAsignacionRouter = Router();
motorAsignacionRouter.get("/:id/candidatos", requireN8nLazy, obtenerCandidatosSolicitud);