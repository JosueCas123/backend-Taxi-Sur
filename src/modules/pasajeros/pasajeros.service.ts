import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import type { PasajeroDto, PasajeroIdentificarInput } from "./pasajeros.schema";

const pasajeroSelect = {
  id: true, whatsappId: true, nombre: true,
  aceptacionAvisoPrivacidad: true, creadoEn: true, eliminadoEn: true,
} satisfies Prisma.PasajeroSelect;

function toPasajeroDto(pasajero: Prisma.PasajeroGetPayload<{ select: typeof pasajeroSelect }>): PasajeroDto {
  return {
    id: pasajero.id,
    whatsappId: pasajero.whatsappId,
    nombre: pasajero.nombre,
    aceptacionAvisoPrivacidad: pasajero.aceptacionAvisoPrivacidad?.toISOString() ?? null,
    creadoEn: pasajero.creadoEn.toISOString(),
  };
}

export type IdentificarPasajeroResult =
  | { ok: true; pasajero: PasajeroDto }
  | { ok: false; code: "PASAJERO_ELIMINADO" };

export async function identificarPasajero(input: PasajeroIdentificarInput): Promise<IdentificarPasajeroResult> {
  const where = { whatsappId: input.whatsappId };
  let pasajero = await prisma.pasajero.findUnique({ where, select: pasajeroSelect });
  if (!pasajero) {
    try {
      pasajero = await prisma.pasajero.create({
        data: { whatsappId: input.whatsappId, nombre: input.nombre, aceptacionAvisoPrivacidad: null },
        select: pasajeroSelect,
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      const target = error.meta?.target;
      if (target !== undefined) {
        const fields = Array.isArray(target) ? target : [target];
        if (fields.length !== 1 || !["whatsappId", "whatsapp_id"].includes(fields[0])) throw error;
      }
      // El adaptador puede omitir target: confirmar el conflicto recuperando el ganador.
      pasajero = await prisma.pasajero.findUnique({ where, select: pasajeroSelect });
      if (!pasajero) throw error;
    }
  }
  if (pasajero.eliminadoEn !== null) return { ok: false, code: "PASAJERO_ELIMINADO" };
  return { ok: true, pasajero: toPasajeroDto(pasajero) };
}

export type AceptarAvisoPasajeroResult =
  | { ok: true; pasajero: PasajeroDto }
  | { ok: false; code: "NOT_FOUND" };

export async function aceptarAvisoPasajero(id: string): Promise<AceptarAvisoPasajeroResult> {
  await prisma.pasajero.updateMany({
    where: { id, eliminadoEn: null, aceptacionAvisoPrivacidad: null },
    data: { aceptacionAvisoPrivacidad: new Date() },
  });
  const pasajero = await prisma.pasajero.findFirst({
    where: { id, eliminadoEn: null }, select: pasajeroSelect,
  });
  if (!pasajero) return { ok: false, code: "NOT_FOUND" };
  return { ok: true, pasajero: toPasajeroDto(pasajero) };
}
