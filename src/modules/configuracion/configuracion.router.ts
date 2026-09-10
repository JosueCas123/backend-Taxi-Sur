import { Router } from "express";
import type { RequestHandler } from "express";
import { getConfiguracion, updateConfiguracion } from "./configuracion.controller";

const requireAuthLazy: RequestHandler = (req, res, next) => {
  void import("../../middlewares/auth").then(({ requireAuth }) => requireAuth(req, res, next)).catch(next);
};

const requireAdminLazy: RequestHandler = (req, res, next) => {
  void import("../../middlewares/auth").then(({ requireAdmin }) => requireAdmin(req, res, next)).catch(next);
};

export const configuracionRouter = Router();
configuracionRouter.get("/", requireAuthLazy, getConfiguracion);
configuracionRouter.put("/", requireAdminLazy, updateConfiguracion);