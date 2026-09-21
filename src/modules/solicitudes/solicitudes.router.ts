import { Router } from "express";
import type { RequestHandler } from "express";
import {
  crearSolicitud, finalizarSolicitud, marcarSinConductor, obtenerSolicitudDetalle,
  responderSolicitud, seleccionarConductor,
} from "./solicitudes.controller";

const requireN8nLazy: RequestHandler = (req, res, next) => {
  void import("../../middlewares/auth").then(({ requireN8n }) => requireN8n(req, res, next)).catch(next);
};

const requireAuthLazy: RequestHandler = (req, res, next) => {
  void import("../../middlewares/auth").then(({ requireAuth }) => requireAuth(req, res, next)).catch(next);
};

const requireN8nOrAdminLazy: RequestHandler = (req, res, next) => {
  void import("../../middlewares/auth").then(({ requireN8nOrAdmin }) => requireN8nOrAdmin(req, res, next)).catch(next);
};

export const solicitudesRouter = Router();
solicitudesRouter.post("/", requireN8nLazy, crearSolicitud);
solicitudesRouter.get("/:id", requireN8nOrAdminLazy, obtenerSolicitudDetalle);
solicitudesRouter.post("/:id/seleccionar-conductor", requireN8nLazy, seleccionarConductor);
solicitudesRouter.post("/:id/sin-conductor", requireN8nLazy, marcarSinConductor);
solicitudesRouter.post("/:id/responder", requireAuthLazy, responderSolicitud);
solicitudesRouter.post("/:id/finalizar", requireAuthLazy, finalizarSolicitud);