import { Router, type RequestHandler } from "express";
import { aceptarAvisoPasajero, identificarPasajero } from "./pasajeros.controller";

const requireN8nLazy: RequestHandler = (req, res, next) => {
  void import("../../middlewares/auth").then(({ requireN8n }) => requireN8n(req, res, next)).catch(next);
};

export const pasajerosRouter = Router();
pasajerosRouter.post("/identificar", requireN8nLazy, identificarPasajero);
pasajerosRouter.patch("/:id/aceptar-aviso", requireN8nLazy, aceptarAvisoPasajero);
