import type { RequestHandler } from "express";
import type { AuthenticatedRequest } from "../../middlewares/auth";
import type { TransicionEstado } from "./conductores.service";
import { conductorRegistroSchema, conductoresFiltroSchema, vehiculoUpdateSchema } from "./conductores.schema";

const conductorInexistente = { error: { code: "NOT_FOUND", message: "Conductor no encontrado" } };
const uuidValido = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const listarConductores: RequestHandler = async (req, res) => {
  const filtro = conductoresFiltroSchema.parse(req.query);
  const service = await import("./conductores.service");
  res.json(await service.listarConductores(filtro));
};

export const obtenerConductorDetalle: RequestHandler<{ id: string }> = async (req, res) => {
  const { id } = req.params;
  if (!uuidValido.test(id)) {
    res.status(404).json(conductorInexistente);
    return;
  }
  const auth = (req as AuthenticatedRequest).auth;
  const service = await import("./conductores.service");
  const conductor = await service.obtenerConductorPorId(id);
  if (!conductor) {
    res.status(404).json(conductorInexistente);
    return;
  }
  if (auth?.source === "n8n" || auth?.rol === "admin") {
    res.json(conductor);
    return;
  }
  if (auth?.rol === "conductor") {
    if (conductor.usuarioId !== auth.userId) {
      res.status(403).json({ error: { code: "FORBIDDEN", message: "Permiso denegado" } });
      return;
    }
    res.json(conductor);
    return;
  }
  res.status(403).json({ error: { code: "FORBIDDEN", message: "Permiso denegado" } });
};

const transicion = (accion: TransicionEstado): RequestHandler<{ id: string }> => async (req, res) => {
  const { id } = req.params;
  if (!uuidValido.test(id)) {
    res.status(404).json(conductorInexistente);
    return;
  }
  const service = await import("./conductores.service");
  const result = await service.transicionarEstado(id, accion);
  if (!result.ok) {
    if (result.code === "NOT_FOUND") {
      res.status(404).json(conductorInexistente);
      return;
    }
    res.status(409).json({
      error: {
        code: "INVALID_STATE_TRANSITION",
        message: `Transicion invalida: el conductor esta en estado ${result.estadoActual}`,
      },
    });
    return;
  }
  res.json(result.conductor);
};

export const aprobarConductor = transicion("aprobar");
export const rechazarConductor = transicion("rechazar");
export const suspenderConductor = transicion("suspender");
export const reactivarConductor = transicion("reactivar");

export const actualizarVehiculoConductor: RequestHandler<{ id: string }> = async (req, res) => {
  const { id } = req.params;
  if (!uuidValido.test(id)) {
    res.status(404).json(conductorInexistente);
    return;
  }
  const datos = vehiculoUpdateSchema.parse(req.body);
  const service = await import("./conductores.service");
  const result = await service.actualizarVehiculo(id, datos);
  if (!result.ok) {
    if (result.code === "CONFLICT") {
      res.status(409).json({ error: { code: "CONFLICT", message: "La placa ya esta registrada" } });
      return;
    }
    res.status(404).json({ error: { code: "NOT_FOUND", message: result.message } });
    return;
  }
  res.json(result.conductor);
};

export const registrarConductor: RequestHandler = async (req, res) => {
  const input = conductorRegistroSchema.parse(req.body);
  const service = await import("./conductores.service");
  const result = await service.registrarConductor(input);
  if (!result.ok) {
    res.status(409).json({ error: { code: result.code, message: result.message } });
    return;
  }
  res.status(201).json(result.conductor);
};
