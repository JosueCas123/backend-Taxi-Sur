import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import type { AuthContext } from "../../middlewares/auth";
import type { UbicacionConductorDto, UbicacionRegistroInput } from "./ubicaciones.schema";

const VIGENCIA_UBICACION_MS = 300000;

export function esTemporalmenteValida(horaRegistro: Date, now: Date | number): boolean {
  const referencia = typeof now === "number" ? now : now.getTime();
  return referencia - horaRegistro.getTime() <= VIGENCIA_UBICACION_MS;
}

const ubicacionSelect = {
  id: true, latitud: true, longitud: true, horaRegistro: true, esValida: true,
} satisfies Prisma.UbicacionConductorSelect;

function toUbicacionDto(ubicacion: Prisma.UbicacionConductorGetPayload<{ select: typeof ubicacionSelect }>): UbicacionConductorDto {
  return {
    id: ubicacion.id.toString(),
    latitud: ubicacion.latitud,
    longitud: ubicacion.longitud,
    horaRegistro: ubicacion.horaRegistro.toISOString(),
    esValida: ubicacion.esValida,
  };
}

type ConductorAuthResult =
  | { ok: true }
  | { ok: false; code: "NOT_FOUND" | "FORBIDDEN" | "CONDUCTOR_NO_APROBADO" };

async function validarConductorPropietario(conductorId: string, auth: AuthContext): Promise<ConductorAuthResult> {
  const conductor = await prisma.conductor.findFirst({
    where: { id: conductorId },
    select: { usuarioId: true, estado: true, eliminadoEn: true },
  });
  if (!conductor || conductor.eliminadoEn !== null) return { ok: false, code: "NOT_FOUND" };
  if (conductor.usuarioId !== auth.userId) return { ok: false, code: "FORBIDDEN" };
  if (conductor.estado !== "aprobado") return { ok: false, code: "CONDUCTOR_NO_APROBADO" };
  return { ok: true };
}

export type RegistrarUbicacionResult =
  | { ok: true; ubicacion: UbicacionConductorDto }
  | { ok: false; code: "NOT_FOUND" | "FORBIDDEN" | "CONDUCTOR_NO_APROBADO" };

export async function registrarUbicacion(
  conductorId: string,
  input: UbicacionRegistroInput,
  auth: AuthContext,
): Promise<RegistrarUbicacionResult> {
  const validacion = await validarConductorPropietario(conductorId, auth);
  if (!validacion.ok) return validacion;

  const ahora = new Date();
  const creada = await prisma.$transaction(async (tx) => {
    await tx.ubicacionConductor.updateMany({
      where: {
        conductorId,
        esValida: true,
        horaRegistro: { lt: new Date(ahora.getTime() - VIGENCIA_UBICACION_MS) },
      },
      data: { esValida: false },
    });
    return tx.ubicacionConductor.create({
      data: {
        conductorId,
        latitud: input.latitud,
        longitud: input.longitud,
        horaRegistro: ahora,
        esValida: true,
      },
      select: ubicacionSelect,
    });
  });

  return { ok: true, ubicacion: toUbicacionDto(creada) };
}

export type ObtenerUltimaUbicacionResult =
  | { ok: true; ubicacion: UbicacionConductorDto }
  | { ok: false; code: "NOT_FOUND" };

export async function obtenerUltimaUbicacion(
  conductorId: string,
  now: Date | number,
): Promise<ObtenerUltimaUbicacionResult> {
  const conductor = await prisma.conductor.findFirst({
    where: { id: conductorId, eliminadoEn: null },
    select: { id: true },
  });
  if (!conductor) return { ok: false, code: "NOT_FOUND" };

  const ubicacion = await prisma.ubicacionConductor.findFirst({
    where: { conductorId, eliminadoEn: null },
    orderBy: [{ horaRegistro: "desc" }, { id: "desc" }],
    select: ubicacionSelect,
  });
  if (!ubicacion) return { ok: false, code: "NOT_FOUND" };

  const dto = toUbicacionDto(ubicacion);
  dto.esValida = dto.esValida && esTemporalmenteValida(ubicacion.horaRegistro, now);
  return { ok: true, ubicacion: dto };
}