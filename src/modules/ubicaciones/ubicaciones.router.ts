import { Router } from "express";
import type { RequestHandler } from "express";
import {
  obtenerUltimaUbicacionConductor, registrarUbicacionConductor,
} from "./ubicaciones.controller";

const requireAuthLazy: RequestHandler = (req, res, next) => {
  void import("../../middlewares/auth").then(({ requireAuth }) => requireAuth(req, res, next)).catch(next);
};

const requireAdminLazy: RequestHandler = (req, res, next) => {
  void import("../../middlewares/auth").then(({ requireAdmin }) => requireAdmin(req, res, next)).catch(next);
};

export const ubicacionesRouter = Router();
ubicacionesRouter.post("/:id/ubicacion", requireAuthLazy, registrarUbicacionConductor);
ubicacionesRouter.get("/:id/ubicacion", requireAdminLazy, obtenerUltimaUbicacionConductor);