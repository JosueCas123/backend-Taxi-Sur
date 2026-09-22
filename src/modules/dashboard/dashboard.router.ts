import { Router } from "express";
import type { RequestHandler } from "express";
import {
  obtenerIndicadores, obtenerMapaConductores, obtenerSolicitudesActivas,
} from "./dashboard.controller";

const requireAdminLazy: RequestHandler = (req, res, next) => {
  void import("../../middlewares/auth").then(({ requireAdmin }) => requireAdmin(req, res, next)).catch(next);
};

export const dashboardRouter = Router();
dashboardRouter.get("/conductores-mapa", requireAdminLazy, obtenerMapaConductores);
dashboardRouter.get("/solicitudes-activas", requireAdminLazy, obtenerSolicitudesActivas);
dashboardRouter.get("/indicadores", requireAdminLazy, obtenerIndicadores);