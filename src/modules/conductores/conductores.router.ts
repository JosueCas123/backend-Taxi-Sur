import { Router } from "express";
import type { RequestHandler } from "express";
import {
  actualizarVehiculoConductor, aprobarConductor, listarConductores, obtenerConductorDetalle, reactivarConductor,
  rechazarConductor, registrarConductor, suspenderConductor,
} from "./conductores.controller";

const requireAdminLazy: RequestHandler = (req, res, next) => {
  void import("../../middlewares/auth").then(({ requireAdmin }) => requireAdmin(req, res, next)).catch(next);
};

const requireAuthLazy: RequestHandler = (req, res, next) => {
  void import("../../middlewares/auth").then(({ requireAuth }) => requireAuth(req, res, next)).catch(next);
};

export const conductoresRouter = Router();
conductoresRouter.post("/", registrarConductor);
conductoresRouter.get("/", requireAdminLazy, listarConductores);
conductoresRouter.get("/:id", requireAuthLazy, obtenerConductorDetalle);
conductoresRouter.patch("/:id/aprobar", requireAdminLazy, aprobarConductor);
conductoresRouter.patch("/:id/rechazar", requireAdminLazy, rechazarConductor);
conductoresRouter.patch("/:id/suspender", requireAdminLazy, suspenderConductor);
conductoresRouter.patch("/:id/reactivar", requireAdminLazy, reactivarConductor);
conductoresRouter.patch("/:id/vehiculo", requireAdminLazy, actualizarVehiculoConductor);
