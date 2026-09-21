import type { Request, RequestHandler } from "express";
import type { AuthenticatedRequest } from "../../middlewares/auth";
import {
  crearSolicitudSchema, finalizarSolicitudSchema, responderSolicitudSchema,
  seleccionarConductorSchema, sinConductorSolicitudSchema, solicitudIdSchema,
} from "./solicitudes.schema";

const solicitudNoEncontrada = { error: { code: "NOT_FOUND", message: "Solicitud no encontrada" } };
const pasajeroNoEncontrado = { error: { code: "NOT_FOUND", message: "Pasajero no encontrado" } };
const permisoDenegado = { error: { code: "FORBIDDEN", message: "Permiso denegado" } };
const credencialesInvalidas = { error: { code: "UNAUTHORIZED", message: "Credenciales invalidas" } };

const conflictos = {
  AVISO_NO_ACEPTADO: { code: "AVISO_NO_ACEPTADO", message: "El pasajero no acepto el aviso de privacidad" },
  SOLICITUD_ACTIVA: { code: "SOLICITUD_ACTIVA", message: "El pasajero ya tiene una solicitud activa" },
  ESTADO_INVALIDO: { code: "ESTADO_INVALIDO", message: "Transicion no permitida desde el estado actual de la solicitud" },
  CANDIDATO_INVALIDO: { code: "CANDIDATO_INVALIDO", message: "El conductor no es un candidato elegible" },
} as const;

function authDe(req: Request) {
  return (req as AuthenticatedRequest).auth;
}

export const crearSolicitud: RequestHandler = async (req, res) => {
  const input = crearSolicitudSchema.parse(req.body);
  const service = await import("./solicitudes.service");
  const result = await service.crearSolicitud(input, new Date());
  if (!result.ok) {
    if (result.code === "NOT_FOUND") {
      res.status(404).json(pasajeroNoEncontrado);
      return;
    }
    res.status(409).json({ error: conflictos[result.code] });
    return;
  }
  res.status(201).json(result.solicitud);
};

async function cargarId(req: Request): Promise<string | null> {
  const id = solicitudIdSchema.safeParse(req.params.id);
  return id.success ? id.data : null;
}

export const seleccionarConductor: RequestHandler<{ id: string }> = async (req, res) => {
  const id = await cargarId(req);
  if (!id) {
    res.status(404).json(solicitudNoEncontrada);
    return;
  }
  const input = seleccionarConductorSchema.parse(req.body);
  const service = await import("./solicitudes.service");
  const result = await service.seleccionarConductor(id, input.conductorId, new Date());
  if (!result.ok) {
    if (result.code === "NOT_FOUND") {
      res.status(404).json(solicitudNoEncontrada);
      return;
    }
    res.status(409).json({ error: conflictos[result.code] });
    return;
  }
  res.status(200).json(result.solicitud);
};

export const responderSolicitud: RequestHandler<{ id: string }> = async (req, res) => {
  const id = await cargarId(req);
  if (!id) {
    res.status(404).json(solicitudNoEncontrada);
    return;
  }
  const input = responderSolicitudSchema.parse(req.body);
  const auth = authDe(req);
  if (!auth) {
    res.status(401).json(credencialesInvalidas);
    return;
  }
  const service = await import("./solicitudes.service");
  const result = await service.responderSolicitud(id, auth.userId ?? "", input.acepta, new Date());
  if (!result.ok) {
    if (result.code === "NOT_FOUND") {
      res.status(404).json(solicitudNoEncontrada);
      return;
    }
    if (result.code === "FORBIDDEN") {
      res.status(403).json(permisoDenegado);
      return;
    }
    res.status(409).json({ error: conflictos[result.code] });
    return;
  }
  res.status(200).json(result.solicitud);
};

export const finalizarSolicitud: RequestHandler<{ id: string }> = async (req, res) => {
  const id = await cargarId(req);
  if (!id) {
    res.status(404).json(solicitudNoEncontrada);
    return;
  }
  finalizarSolicitudSchema.parse(req.body);
  const auth = authDe(req);
  if (!auth) {
    res.status(401).json(credencialesInvalidas);
    return;
  }
  const service = await import("./solicitudes.service");
  const result = await service.finalizarSolicitud(id, auth.userId ?? "", new Date());
  if (!result.ok) {
    if (result.code === "NOT_FOUND") {
      res.status(404).json(solicitudNoEncontrada);
      return;
    }
    if (result.code === "FORBIDDEN") {
      res.status(403).json(permisoDenegado);
      return;
    }
    res.status(409).json({ error: conflictos[result.code] });
    return;
  }
  res.status(200).json(result.solicitud);
};

export const marcarSinConductor: RequestHandler<{ id: string }> = async (req, res) => {
  const id = await cargarId(req);
  if (!id) {
    res.status(404).json(solicitudNoEncontrada);
    return;
  }
  sinConductorSolicitudSchema.parse(req.body);
  const service = await import("./solicitudes.service");
  const result = await service.marcarSinConductor(id);
  if (!result.ok) {
    if (result.code === "NOT_FOUND") {
      res.status(404).json(solicitudNoEncontrada);
      return;
    }
    res.status(409).json({ error: conflictos[result.code] });
    return;
  }
  res.status(200).json(result.solicitud);
};

export const obtenerSolicitudDetalle: RequestHandler<{ id: string }> = async (req, res) => {
  const id = await cargarId(req);
  if (!id) {
    res.status(404).json(solicitudNoEncontrada);
    return;
  }
  const service = await import("./solicitudes.service");
  const result = await service.obtenerSolicitud(id);
  if (!result.ok) {
    res.status(404).json(solicitudNoEncontrada);
    return;
  }
  res.status(200).json(result.solicitud);
};