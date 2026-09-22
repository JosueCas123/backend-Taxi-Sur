import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import type { ActualizarTarifaInput, CrearTarifaInput, TarifaDto } from "./tarifario.schema";

// America/La_Paz usa UTC-4 todo el ano (Bolivia no aplica horario de verano).
const DESPLAZAMIENTO_LA_PAZ_MS = 4 * 60 * 60 * 1000;

const tarifaSelect = {
  id: true,
  descripcion: true,
  monto: true,
  vigenciaDesde: true,
} satisfies Prisma.TarifaSelect;

export function fechaDeNegocioEnLaPaz(now: Date): string {
  const laPaz = new Date(now.getTime() - DESPLAZAMIENTO_LA_PAZ_MS);
  const mes = String(laPaz.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(laPaz.getUTCDate()).padStart(2, "0");
  return `${laPaz.getUTCFullYear()}-${mes}-${dia}`;
}

export function inicioDelDiaSiguienteEnLaPaz(fecha: string): Date {
  const partes = fecha.split("-").map(Number) as [number, number, number];
  const [anio, mes, dia] = partes;
  return new Date(Date.UTC(anio, mes - 1, dia, 0, 0, 0, 0) + 24 * 60 * 60 * 1000);
}

function toTarifaDto(tarifa: Prisma.TarifaGetPayload<{ select: typeof tarifaSelect }>): TarifaDto {
  return {
    id: tarifa.id,
    descripcion: tarifa.descripcion,
    monto: tarifa.monto.toFixed(2),
    vigenciaDesde: tarifa.vigenciaDesde.toISOString().slice(0, 10),
  };
}

export async function obtenerTarifasVigentes(now: Date): Promise<TarifaDto[]> {
  const fechaDeNegocio = fechaDeNegocioEnLaPaz(now);
  const limiteExclusivo = inicioDelDiaSiguienteEnLaPaz(fechaDeNegocio);
  const tarifas = await prisma.tarifa.findMany({
    where: {
      eliminadoEn: null,
      vigenciaDesde: { lt: limiteExclusivo },
    },
    orderBy: [{ descripcion: "asc" }, { id: "asc" }],
    select: tarifaSelect,
  });
  return tarifas.map(toTarifaDto);
}

export async function crearTarifa(input: CrearTarifaInput): Promise<TarifaDto> {
  const creada = await prisma.tarifa.create({
    data: {
      descripcion: input.descripcion,
      monto: input.monto,
      vigenciaDesde: new Date(`${input.vigenciaDesde}T00:00:00.000Z`),
    },
    select: tarifaSelect,
  });
  return toTarifaDto(creada);
}

function camposPresentes(input: ActualizarTarifaInput): Prisma.TarifaUpdateManyMutationInput {
  return {
    ...(input.descripcion !== undefined ? { descripcion: input.descripcion } : {}),
    ...(input.monto !== undefined ? { monto: input.monto } : {}),
  };
}

export type ActualizarTarifaResult =
  | { ok: true; tarifa: TarifaDto }
  | { ok: false; code: "NOT_FOUND" };

export async function actualizarTarifa(
  id: string,
  input: ActualizarTarifaInput,
): Promise<ActualizarTarifaResult> {
  const actualizada = await prisma.$transaction(async (tx) => {
    const resultado = await tx.tarifa.updateMany({
      where: { id, eliminadoEn: null },
      data: camposPresentes(input),
    });
    if (resultado.count === 0) return null;
    return tx.tarifa.findFirst({
      where: { id, eliminadoEn: null },
      select: tarifaSelect,
    });
  });
  if (actualizada === null) return { ok: false, code: "NOT_FOUND" };
  return { ok: true, tarifa: toTarifaDto(actualizada) };
}