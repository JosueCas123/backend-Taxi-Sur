import { Router } from "express";
import type { RequestHandler } from "express";
import { actualizarTarifa, crearTarifa, listarTarifas } from "./tarifario.controller";

const requireN8nOrAdminLazy: RequestHandler = (req, res, next) => {
  void import("../../middlewares/auth").then(({ requireN8nOrAdmin }) => requireN8nOrAdmin(req, res, next)).catch(next);
};

const requireAdminLazy: RequestHandler = (req, res, next) => {
  void import("../../middlewares/auth").then(({ requireAdmin }) => requireAdmin(req, res, next)).catch(next);
};

export const tarifarioRouter = Router();
tarifarioRouter.get("/", requireN8nOrAdminLazy, listarTarifas);
tarifarioRouter.post("/", requireAdminLazy, crearTarifa);
tarifarioRouter.patch("/:id", requireAdminLazy, actualizarTarifa);