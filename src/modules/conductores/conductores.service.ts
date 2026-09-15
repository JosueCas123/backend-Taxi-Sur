import bcrypt from "bcrypt";
import { Prisma, type EstadoConductor } from "@prisma/client";
import { prisma } from "../../config/prisma";
import type { ConductorDetalleDto, ConductorRegistroInput, ConductoresFiltroInput, ListadoConductorDto, VehiculoUpdateInput } from "./conductores.schema";

const transiciones = {
  aprobar: { desde: "pendiente", hasta: "aprobado", notificacion: true },
  rechazar: { desde: "pendiente", hasta: "rechazado", notificacion: true },
  suspender: { desde: "aprobado", hasta: "suspendido", notificacion: false },
  reactivar: { desde: "suspendido", hasta: "aprobado", notificacion: false },
} as const satisfies { [nombre: string]: { desde: EstadoConductor; hasta: EstadoConductor; notificacion: boolean } };

export type TransicionEstado = keyof typeof transiciones;

export async function listarConductores(filtro: ConductoresFiltroInput): Promise<ListadoConductorDto[]> {
  const conductores = await prisma.conductor.findMany({
    where: { eliminadoEn: null, estado: filtro.estado },
    orderBy: { creadoEn: "asc" },
    select: {
      id: true, nombreCompleto: true, cedulaIdentidad: true,
      estado: true, estadoJornada: true, estadoDisponibilidad: true, creadoEn: true,
      usuario: { select: { telefono: true } },
      vehiculos: {
        where: { eliminadoEn: null }, orderBy: { creadoEn: "desc" }, take: 1,
        select: { id: true, placa: true, marca: true, modelo: true, color: true, capacidadPasajeros: true },
      },
    },
  });
  return conductores.map(({ usuario, vehiculos, creadoEn, ...conductor }) => ({
    ...conductor, telefono: usuario.telefono, creadoEn: creadoEn.toISOString(), vehiculo: vehiculos[0] ?? null,
  }));
}

export async function obtenerConductorPorId(id: string): Promise<ConductorDetalleDto | null> {
  const conductor = await prisma.conductor.findFirst({
    where: { id, eliminadoEn: null },
    select: {
      id: true, nombreCompleto: true, cedulaIdentidad: true,
      estado: true, estadoJornada: true, estadoDisponibilidad: true, creadoEn: true,
      usuario: { select: { id: true, telefono: true } },
      vehiculos: {
        where: { eliminadoEn: null }, orderBy: { creadoEn: "desc" }, take: 1,
        select: { id: true, placa: true, marca: true, modelo: true, color: true, capacidadPasajeros: true },
      },
    },
  });
  if (!conductor) return null;
  const { usuario, vehiculos, creadoEn, ...perfil } = conductor;
  return {
    ...perfil, usuarioId: usuario.id, telefono: usuario.telefono,
    creadoEn: creadoEn.toISOString(), vehiculo: vehiculos[0] ?? null,
  };
}

export type TransicionEstadoResult =
  | { ok: true; conductor: ConductorDetalleDto }
  | { ok: false; code: "NOT_FOUND" }
  | { ok: false; code: "INVALID_STATE_TRANSITION"; estadoActual: EstadoConductor };

export async function transicionarEstado(id: string, accion: TransicionEstado): Promise<TransicionEstadoResult> {
  const { desde, hasta, notificacion } = transiciones[accion];
  const actualizado = await prisma.conductor.updateMany({
    where: { id, eliminadoEn: null, estado: desde },
    data: { estado: hasta },
  });
  if (actualizado.count === 0) {
    const conductor = await prisma.conductor.findFirst({
      where: { id },
      select: { eliminadoEn: true, estado: true },
    });
    if (!conductor || conductor.eliminadoEn !== null) return { ok: false, code: "NOT_FOUND" };
    return { ok: false, code: "INVALID_STATE_TRANSITION", estadoActual: conductor.estado };
  }
  const detalle = await obtenerConductorPorId(id);
  if (!detalle) return { ok: false, code: "NOT_FOUND" };
  if (notificacion) {
    try {
      const { notificarConductor } = await import("./notificaciones");
      await notificarConductor(detalle);
    } catch {
      // Notificacion es un stub: nunca debe bloquear ni hacer fallar el endpoint.
    }
  }
  return { ok: true, conductor: detalle };
}

export type ActualizarVehiculoResult =
  | { ok: true; conductor: ConductorDetalleDto }
  | { ok: false; code: "NOT_FOUND"; message: "Conductor no encontrado" | "Vehiculo no encontrado" }
  | { ok: false; code: "CONFLICT" };

export async function actualizarVehiculo(id: string, datos: VehiculoUpdateInput): Promise<ActualizarVehiculoResult> {
  const vehiculo = await prisma.vehiculo.findFirst({
    where: { conductor: { id, eliminadoEn: null }, eliminadoEn: null },
    orderBy: { creadoEn: "desc" },
    select: { id: true },
  });
  if (!vehiculo) {
    const conductor = await prisma.conductor.findFirst({ where: { id }, select: { eliminadoEn: true } });
    if (!conductor || conductor.eliminadoEn !== null) {
      return { ok: false, code: "NOT_FOUND", message: "Conductor no encontrado" };
    }
    return { ok: false, code: "NOT_FOUND", message: "Vehiculo no encontrado" };
  }
  try {
    await prisma.vehiculo.update({ where: { id: vehiculo.id }, data: datos, select: { id: true } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, code: "CONFLICT" };
    }
    throw error;
  }
  const conductor = await obtenerConductorPorId(id);
  if (!conductor) return { ok: false, code: "NOT_FOUND", message: "Conductor no encontrado" };
  return { ok: true, conductor };
}

export type RegistroConductorResult =
  | { ok: true; conductor: ConductorDetalleDto }
  | { ok: false; code: "CONFLICT"; message: string };

export async function registrarConductor(input: ConductorRegistroInput): Promise<RegistroConductorResult> {
  const hashContrasena = await bcrypt.hash(input.pin, 12);
  try {
    const conductor = await prisma.$transaction(async (tx): Promise<ConductorDetalleDto> => {
      const usuario = await tx.usuario.create({
        data: { telefono: input.telefono, rol: "conductor", hashContrasena },
        select: { id: true, telefono: true },
      });
      const perfil = await tx.conductor.create({
        data: {
          usuarioId: usuario.id, nombreCompleto: input.nombreCompleto, cedulaIdentidad: input.cedulaIdentidad,
          estado: "pendiente", estadoJornada: "no_iniciada", estadoDisponibilidad: "no_disponible",
        },
        select: {
          id: true, usuarioId: true, nombreCompleto: true, cedulaIdentidad: true,
          estado: true, estadoJornada: true, estadoDisponibilidad: true, creadoEn: true,
        },
      });
      const vehiculo = await tx.vehiculo.create({
        data: {
          conductorId: perfil.id, placa: input.vehiculo.placa, marca: input.vehiculo.marca,
          modelo: input.vehiculo.modelo, color: input.vehiculo.color,
          capacidadPasajeros: input.vehiculo.capacidadPasajeros,
        },
        select: { id: true, placa: true, marca: true, modelo: true, color: true, capacidadPasajeros: true },
      });
      return { ...perfil, telefono: usuario.telefono, creadoEn: perfil.creadoEn.toISOString(), vehiculo };
    });
    return { ok: true, conductor };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;

    const target = error.meta?.target;
    const fields = Array.isArray(target) ? target : [target];
    let field = fields.includes("telefono") ? "telefono" : fields.includes("placa") ? "placa" : undefined;
    if (!field) {
      // PostgreSQL ya hizo rollback: consultar fuera de la transaccion abortada, sin excluir soft delete.
      const usuario = await prisma.usuario.findUnique({ where: { telefono: input.telefono }, select: { id: true } });
      if (usuario) field = "telefono";
      else {
        const vehiculo = await prisma.vehiculo.findUnique({ where: { placa: input.vehiculo.placa }, select: { id: true } });
        if (vehiculo) field = "placa";
      }
    }
    if (!field) throw error;
    return {
      ok: false, code: "CONFLICT",
      message: field === "telefono" ? "El telefono ya esta registrado" : "La placa ya esta registrada",
    };
  }
}
