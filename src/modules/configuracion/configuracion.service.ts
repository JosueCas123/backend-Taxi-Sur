import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import type { ConfiguracionUpdateInput } from "./configuracion.schema";

const VALORES_INICIALES = {
  id: 1,
  nombreEmpresa: "TaxiSur - Pruebas",
  radioMaximoBusquedaKm: 5,
  telefonoCentroAtencion: "+59100000000",
} as const;

function camposPresentes(campos: ConfiguracionUpdateInput) {
  return {
    ...(campos.nombreEmpresa !== undefined ? { nombreEmpresa: campos.nombreEmpresa } : {}),
    ...(campos.radioMaximoBusquedaKm !== undefined ? { radioMaximoBusquedaKm: campos.radioMaximoBusquedaKm } : {}),
    ...(campos.telefonoCentroAtencion !== undefined ? { telefonoCentroAtencion: campos.telefonoCentroAtencion } : {}),
  };
}

export async function obtenerOInicializar() {
  try {
    return await prisma.configuracion.create({ data: VALORES_INICIALES });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existente = await prisma.configuracion.findUnique({ where: { id: 1 } });
      if (existente) return existente;
      throw error;
    }
    throw error;
  }
}

export async function actualizarConfiguracion(campos: ConfiguracionUpdateInput) {
  const existente = await prisma.configuracion.findUnique({ where: { id: 1 } });
  if (existente && existente.eliminadoEn !== null) {
    return existente;
  }

  const data = camposPresentes(campos);
  if (existente) {
    return prisma.configuracion.update({ where: { id: 1 }, data });
  }

  try {
    return await prisma.configuracion.create({ data: { ...VALORES_INICIALES, ...data } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const concurrente = await prisma.configuracion.findUnique({ where: { id: 1 } });
      if (concurrente === null) throw error;
      if (concurrente.eliminadoEn !== null) return concurrente;
      return prisma.configuracion.update({ where: { id: 1 }, data });
    }
    throw error;
  }
}