import { type EstadoSolicitud, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { obtenerCandidatos } from "../motor-asignacion/motor-asignacion.service";
import { notificarPasajero } from "./notificaciones";
import type {
  CrearSolicitudInput,
  SolicitudDetalleDto,
  SolicitudDto,
} from "./solicitudes.schema";

// Regla 6: ventana de 1 minuto para que el conductor responda.
export const VENTANA_RESPUESTA_MS = 60_000;

// Regla 1: estados no terminales que bloquean una nueva solicitud del pasajero.
// Terminales: finalizada, rechazada, expirada, sin_conductor.
const ESTADOS_NO_TERMINALES: EstadoSolicitud[] = [
  "creada", "buscando", "conductor_seleccionado", "esperando_respuesta",
  "aceptada", "en_servicio",
];

const solicitudSelect = {
  id: true, pasajeroId: true, conductorAsignadoId: true, estado: true,
  latitudRecogida: true, longitudRecogida: true, destino: true,
  expiraEn: true, aceptadaEn: true, finalizadaEn: true, creadoEn: true,
} satisfies Prisma.SolicitudSelect;

type SolicitudRow = Prisma.SolicitudGetPayload<{ select: typeof solicitudSelect }>;

function aSolicitudDto(solicitud: SolicitudRow): SolicitudDto {
  return {
    id: solicitud.id,
    pasajeroId: solicitud.pasajeroId,
    conductorAsignadoId: solicitud.conductorAsignadoId,
    estado: solicitud.estado,
    latitudRecogida: solicitud.latitudRecogida,
    longitudRecogida: solicitud.longitudRecogida,
    destino: solicitud.destino,
    expiraEn: solicitud.expiraEn?.toISOString() ?? null,
    aceptadaEn: solicitud.aceptadaEn?.toISOString() ?? null,
    finalizadaEn: solicitud.finalizadaEn?.toISOString() ?? null,
    creadoEn: solicitud.creadoEn.toISOString(),
  };
}

// -----------------------------------------------------------------------
// POST /api/solicitudes — crear (n8n)
// -----------------------------------------------------------------------
export type CrearSolicitudResult =
  | { ok: true; solicitud: SolicitudDto }
  | { ok: false; code: "NOT_FOUND" | "AVISO_NO_ACEPTADO" | "SOLICITUD_ACTIVA" };

export async function crearSolicitud(
  input: CrearSolicitudInput,
  now: Date | number = new Date(),
): Promise<CrearSolicitudResult> {
  return prisma.$transaction(async (tx) => {
    const pasajero = await tx.pasajero.findUnique({
      where: { id: input.pasajeroId },
      select: { id: true, aceptacionAvisoPrivacidad: true, eliminadoEn: true },
    });
    if (!pasajero || pasajero.eliminadoEn !== null) {
      return { ok: false as const, code: "NOT_FOUND" as const };
    }
    if (!pasajero.aceptacionAvisoPrivacidad) {
      return { ok: false as const, code: "AVISO_NO_ACEPTADO" as const };
    }
    // Regla 1: la validacion y la creacion van en la misma transaccion (atomica).
    const activa = await tx.solicitud.findFirst({
      where: { pasajeroId: input.pasajeroId, eliminadoEn: null, estado: { in: ESTADOS_NO_TERMINALES } },
      select: { id: true },
    });
    if (activa) {
      return { ok: false as const, code: "SOLICITUD_ACTIVA" as const };
    }
    const creada = await tx.solicitud.create({
      data: {
        pasajeroId: input.pasajeroId,
        estado: "buscando",
        latitudRecogida: input.latitudRecogida,
        longitudRecogida: input.longitudRecogida,
        destino: input.destino ?? null,
      },
      select: solicitudSelect,
    });
    return { ok: true as const, solicitud: aSolicitudDto(creada) };
  });
}

// -----------------------------------------------------------------------
// POST /api/solicitudes/:id/seleccionar-conductor — reservar (n8n)
// -----------------------------------------------------------------------
export type SeleccionarConductorResult =
  | { ok: true; solicitud: SolicitudDto; expiraEn: Date }
  | { ok: false; code: "NOT_FOUND" | "ESTADO_INVALIDO" | "CANDIDATO_INVALIDO" };

export async function seleccionarConductor(
  solicitudId: string,
  conductorId: string,
  now: Date | number = new Date(),
): Promise<SeleccionarConductorResult> {
  const expiraEn = new Date(new Date(now).getTime() + VENTANA_RESPUESTA_MS);
  const resultado = await prisma.$transaction(async (tx) => {
    const solicitud = await tx.solicitud.findFirst({
      where: { id: solicitudId, eliminadoEn: null },
      select: { id: true, estado: true },
    });
    if (!solicitud) return { ok: false as const, code: "NOT_FOUND" as const };

    if (solicitud.estado !== "buscando") {
      return { ok: false as const, code: "ESTADO_INVALIDO" as const };
    }

    // Reutiliza el motor de asignacion para verificar candidatura actual.
    const candidatos = await obtenerCandidatos(solicitudId, new Date(now), []);
    const esCandidato = candidatos.ok
      && candidatos.candidatos.some(({ conductorId: id }) => id === conductorId);
    if (!esCandidato) {
      return { ok: false as const, code: "CANDIDATO_INVALIDO" as const };
    }

    // Reserva atomica: solo si el conductor sigue disponible evita condiciones de carrera.
    const reservado = await tx.conductor.updateMany({
      where: { id: conductorId, estadoDisponibilidad: "disponible" },
      data: { estadoDisponibilidad: "solicitud_pendiente" },
    });
    if (reservado.count === 0) {
      return { ok: false as const, code: "CANDIDATO_INVALIDO" as const };
    }

    const actualizada = await tx.solicitud.updateMany({
      where: { id: solicitudId, estado: "buscando", eliminadoEn: null },
      data: { conductorAsignadoId: conductorId, estado: "esperando_respuesta", expiraEn },
    });
    if (actualizada.count === 0) {
      // Perdio la carrera: se revierte la reserva del conductor.
      await tx.conductor.updateMany({
        where: { id: conductorId, estadoDisponibilidad: "solicitud_pendiente" },
        data: { estadoDisponibilidad: "disponible" },
      });
      return { ok: false as const, code: "ESTADO_INVALIDO" as const };
    }

    const dto = await tx.solicitud.findFirst({ where: { id: solicitudId }, select: solicitudSelect });
    return { ok: true as const, solicitud: aSolicitudDto(dto!) };
  });

  if (!resultado.ok) return resultado;
  programarExpiracion(solicitudId, expiraEn);
  return { ok: true, solicitud: resultado.solicitud, expiraEn };
}

// -----------------------------------------------------------------------
// POST /api/solicitudes/:id/responder — aceptar o rechazar (conductor)
// -----------------------------------------------------------------------
export type ResponderSolicitudResult =
  | { ok: true; solicitud: SolicitudDto }
  | { ok: false; code: "NOT_FOUND" | "FORBIDDEN" | "ESTADO_INVALIDO" };

const solicitudConPropietarioSelect = {
  id: true, estado: true, pasajeroId: true, conductorAsignadoId: true,
  conductorAsignado: { select: { usuarioId: true, nombreCompleto: true } },
} satisfies Prisma.SolicitudSelect;

export async function responderSolicitud(
  solicitudId: string,
  usuarioId: string,
  acepta: boolean,
  now: Date | number = new Date(),
): Promise<ResponderSolicitudResult> {
  const resultado = await prisma.$transaction(async (tx) => {
    // El recurso se carga antes de validar la propiedad: inexistente -> 404.
    const solicitud = await tx.solicitud.findFirst({
      where: { id: solicitudId, eliminadoEn: null },
      select: solicitudConPropietarioSelect,
    });
    if (!solicitud) return { ok: false as const, code: "NOT_FOUND" as const };
    if (solicitud.conductorAsignado?.usuarioId !== usuarioId) {
      return { ok: false as const, code: "FORBIDDEN" as const };
    }
    if (solicitud.estado !== "esperando_respuesta") {
      return { ok: false as const, code: "ESTADO_INVALIDO" as const };
    }

    const conductorId = solicitud.conductorAsignadoId!;
    if (acepta) {
      const condicional = await tx.solicitud.updateMany({
        where: { id: solicitudId, estado: "esperando_respuesta", eliminadoEn: null },
        data: { estado: "en_servicio", aceptadaEn: new Date(now), expiraEn: null },
      });
      if (condicional.count === 0) return { ok: false as const, code: "ESTADO_INVALIDO" as const };
      await tx.conductor.update({
        where: { id: conductorId },
        data: { estadoDisponibilidad: "en_servicio" },
      });
      const conductor = await tx.conductor.findFirst({
        where: { id: conductorId },
        select: {
          nombreCompleto: true,
          vehiculos: {
            where: { eliminadoEn: null }, orderBy: { creadoEn: "desc" }, take: 1,
            select: { placa: true },
          },
        },
      });
      const dto = await tx.solicitud.findFirst({ where: { id: solicitudId }, select: solicitudSelect });
      return {
        ok: true as const,
        solicitud: aSolicitudDto(dto!),
        notificacion: {
          pasajeroId: solicitud.pasajeroId,
          conductorNombre: conductor?.nombreCompleto ?? "",
          placa: conductor?.vehiculos[0]?.placa ?? "",
        },
      };
    }

    // Regla 7: rechazo -> exclusion registrada, conductor liberado y a buscando.
    const condicional = await tx.solicitud.updateMany({
      where: { id: solicitudId, estado: "esperando_respuesta", eliminadoEn: null },
      data: { estado: "buscando", conductorAsignadoId: null, expiraEn: null },
    });
    if (condicional.count === 0) return { ok: false as const, code: "ESTADO_INVALIDO" as const };
    await tx.solicitudConductorRechazado.create({
      data: { solicitudId, conductorId, motivo: "rechazo" },
      select: { id: true },
    });
    await tx.conductor.update({
      where: { id: conductorId },
      data: { estadoDisponibilidad: "disponible" },
    });
    const dto = await tx.solicitud.findFirst({ where: { id: solicitudId }, select: solicitudSelect });
    return { ok: true as const, solicitud: aSolicitudDto(dto!) };
  });

  const notificacion = resultado.ok && "notificacion" in resultado ? resultado.notificacion : null;
  if (!resultado.ok) return resultado;
  cancelarExpiracion(solicitudId);
  if (acepta && notificacion) {
    notificarPasajero(notificacion.pasajeroId, {
      solicitudId,
      conductorNombre: notificacion.conductorNombre,
      placa: notificacion.placa,
    });
  }
  return { ok: true, solicitud: resultado.solicitud };
}

// -----------------------------------------------------------------------
// POST /api/solicitudes/:id/finalizar — finalizar servicio (conductor)
// -----------------------------------------------------------------------
export type FinalizarSolicitudResult = ResponderSolicitudResult;

export async function finalizarSolicitud(
  solicitudId: string,
  usuarioId: string,
  now: Date | number = new Date(),
): Promise<FinalizarSolicitudResult> {
  const resultado = await prisma.$transaction(async (tx) => {
    const solicitud = await tx.solicitud.findFirst({
      where: { id: solicitudId, eliminadoEn: null },
      select: {
        id: true, estado: true, conductorAsignadoId: true,
        conductorAsignado: { select: { usuarioId: true } },
      },
    });
    if (!solicitud) return { ok: false as const, code: "NOT_FOUND" as const };
    if (solicitud.conductorAsignado?.usuarioId !== usuarioId) {
      return { ok: false as const, code: "FORBIDDEN" as const };
    }
    if (solicitud.estado !== "en_servicio") {
      return { ok: false as const, code: "ESTADO_INVALIDO" as const };
    }

    const conductorId = solicitud.conductorAsignadoId!;
    const condicional = await tx.solicitud.updateMany({
      where: { id: solicitudId, estado: "en_servicio", eliminadoEn: null },
      data: { estado: "finalizada", finalizadaEn: new Date(now) },
    });
    if (condicional.count === 0) return { ok: false as const, code: "ESTADO_INVALIDO" as const };

    // Regla 11: al finalizar, disponible si la jornada sigue activa; si no, no_disponible.
    const conductor = await tx.conductor.findUnique({
      where: { id: conductorId },
      select: { estadoJornada: true },
    });
    await tx.conductor.update({
      where: { id: conductorId },
      data: {
        estadoDisponibilidad: conductor?.estadoJornada === "activa" ? "disponible" : "no_disponible",
      },
    });

    const dto = await tx.solicitud.findFirst({ where: { id: solicitudId }, select: solicitudSelect });
    return { ok: true as const, solicitud: aSolicitudDto(dto!) };
  });

  if (!resultado.ok) return resultado;
  cancelarExpiracion(solicitudId);
  return resultado;
}

// -----------------------------------------------------------------------
// POST /api/solicitudes/:id/sin-conductor — sin candidatos (n8n)
// -----------------------------------------------------------------------
export type SinConductorResult =
  | { ok: true; solicitud: SolicitudDto }
  | { ok: false; code: "NOT_FOUND" | "ESTADO_INVALIDO" };

export async function marcarSinConductor(
  solicitudId: string,
): Promise<SinConductorResult> {
  return prisma.$transaction(async (tx) => {
    const actualizada = await tx.solicitud.updateMany({
      where: { id: solicitudId, estado: "buscando", eliminadoEn: null },
      data: { estado: "sin_conductor", conductorAsignadoId: null, expiraEn: null },
    });
    if (actualizada.count === 0) {
      const solicitud = await tx.solicitud.findFirst({
        where: { id: solicitudId },
        select: { eliminadoEn: true },
      });
      if (!solicitud || solicitud.eliminadoEn !== null) {
        return { ok: false as const, code: "NOT_FOUND" as const };
      }
      return { ok: false as const, code: "ESTADO_INVALIDO" as const };
    }
    const dto = await tx.solicitud.findFirst({ where: { id: solicitudId }, select: solicitudSelect });
    return { ok: true as const, solicitud: aSolicitudDto(dto!) };
  });
}

// -----------------------------------------------------------------------
// GET /api/solicitudes/:id — detalle (n8n o admin)
// -----------------------------------------------------------------------
export type ObtenerSolicitudResult =
  | { ok: true; solicitud: SolicitudDetalleDto }
  | { ok: false; code: "NOT_FOUND" };

export async function obtenerSolicitud(solicitudId: string): Promise<ObtenerSolicitudResult> {
  const solicitud = await prisma.solicitud.findFirst({
    where: { id: solicitudId, eliminadoEn: null },
    select: {
      ...solicitudSelect,
      pasajero: { select: { id: true, nombre: true } },
      conductorAsignado: {
        select: {
          id: true, nombreCompleto: true,
          vehiculos: {
            where: { eliminadoEn: null }, orderBy: { creadoEn: "desc" }, take: 1,
            select: { placa: true, marca: true, modelo: true, color: true, capacidadPasajeros: true },
          },
        },
      },
    },
  });
  if (!solicitud) return { ok: false, code: "NOT_FOUND" };

  const { pasajero, conductorAsignado, ...base } = solicitud;
  return {
    ok: true,
    solicitud: {
      ...aSolicitudDto(base),
      pasajero,
      conductorAsignado: conductorAsignado
        ? {
          id: conductorAsignado.id,
          nombreCompleto: conductorAsignado.nombreCompleto,
          vehiculo: conductorAsignado.vehiculos[0] ?? null,
        }
        : null,
    },
  };
}

// -----------------------------------------------------------------------
// Job interno (Regla 8): expiracion por setTimeout + barrido al iniciar
// -----------------------------------------------------------------------
const expiraciones = new Map<string, NodeJS.Timeout>();

export function programarExpiracion(solicitudId: string, expiraEn: Date): void {
  cancelarExpiracion(solicitudId);
  const ms = expiraEn.getTime() - Date.now();
  if (ms <= 0) return;
  const timeout = setTimeout(() => { void expirarSiVencida(solicitudId); }, ms);
  timeout.unref();
  expiraciones.set(solicitudId, timeout);
}

export function cancelarExpiracion(solicitudId: string): void {
  const timeout = expiraciones.get(solicitudId);
  if (timeout) {
    clearTimeout(timeout);
    expiraciones.delete(solicitudId);
  }
}

export async function expirarSiVencida(solicitudId: string, now: Date = new Date()): Promise<void> {
  const solicitud = await prisma.solicitud.findFirst({
    where: { id: solicitudId, eliminadoEn: null, estado: "esperando_respuesta", expiraEn: { lte: now } },
    select: { id: true, conductorAsignadoId: true },
  });
  if (!solicitud) return; // Ya cambio de estado o no vencio: idempotente.

  await prisma.$transaction(async (tx) => {
    const actualizada = await tx.solicitud.updateMany({
      where: { id: solicitudId, estado: "esperando_respuesta", expiraEn: { lte: now }, eliminadoEn: null },
      data: { estado: "buscando", conductorAsignadoId: null, expiraEn: null },
    });
    if (actualizada.count === 0) return; // Otra ejecucion la expiro: no duplicar exclusion.

    if (solicitud.conductorAsignadoId) {
      await tx.solicitudConductorRechazado.create({
        data: { solicitudId, conductorId: solicitud.conductorAsignadoId, motivo: "expiracion" },
        select: { id: true },
      });
      await tx.conductor.update({
        where: { id: solicitud.conductorAsignadoId },
        data: { estadoDisponibilidad: "disponible" },
      });
    }
    console.info(`[job-expiracion] Solicitud ${solicitudId} expirada (motivo: job interno)`);
  });
}

export async function barridoInicial(now: Date = new Date()): Promise<void> {
  const vencidas = await prisma.solicitud.findMany({
    where: { estado: "esperando_respuesta", expiraEn: { lte: now }, eliminadoEn: null },
    select: { id: true },
  });
  for (const { id } of vencidas) {
    await expirarSiVencida(id, now);
  }
  const pendientes = await prisma.solicitud.findMany({
    where: { estado: "esperando_respuesta", expiraEn: { gt: now }, eliminadoEn: null },
    select: { id: true, expiraEn: true },
  });
  for (const { id, expiraEn } of pendientes) {
    if (expiraEn) programarExpiracion(id, expiraEn);
  }
}