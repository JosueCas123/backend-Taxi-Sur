import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { esTemporalmenteValida } from "../ubicaciones/ubicaciones.service";
import type { CandidatoDto } from "./motor-asignacion.schema";

const RADIO_TIERRA_KM = 6371;
const RADIO_MAXIMO_DEFAULT_KM = 5;

export function distanciaKm(
  latitudA: number,
  longitudA: number,
  latitudB: number,
  longitudB: number,
): number {
  const gradosARadianes = (grados: number): number => (grados * Math.PI) / 180;
  const dLatitud = gradosARadianes(latitudB - latitudA);
  const dLongitud = gradosARadianes(longitudB - longitudA);
  const a = Math.sin(dLatitud / 2) ** 2
    + Math.cos(gradosARadianes(latitudA)) * Math.cos(gradosARadianes(latitudB))
    * Math.sin(dLongitud / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return RADIO_TIERRA_KM * c;
}

function redondear2Decimales(valor: number): number {
  return Math.round(valor * 100) / 100;
}

export type ObtenerCandidatosResult =
  | { ok: true; candidatos: CandidatoDto[] }
  | { ok: false; code: "NOT_FOUND" };

const candidatosConductorSelect = {
  id: true,
  nombreCompleto: true,
  ubicaciones: {
    where: { eliminadoEn: null },
    orderBy: [{ horaRegistro: "desc" }, { id: "desc" }],
    take: 1,
    select: { latitud: true, longitud: true, horaRegistro: true, esValida: true },
  },
  vehiculos: {
    where: { eliminadoEn: null },
    orderBy: { creadoEn: "desc" },
    take: 1,
    select: {
      placa: true, marca: true, modelo: true, color: true, capacidadPasajeros: true,
    },
  },
} satisfies Prisma.ConductorSelect;

type CandidatosConductor = Prisma.ConductorGetPayload<{ select: typeof candidatosConductorSelect }>;

function aCandidatoDto(conductor: CandidatosConductor, distancia: number): CandidatoDto {
  const vehiculo = conductor.vehiculos[0];
  return {
    conductorId: conductor.id,
    nombreCompleto: conductor.nombreCompleto,
    distanciaKm: redondear2Decimales(distancia),
    vehiculo: {
      placa: vehiculo.placa,
      marca: vehiculo.marca,
      modelo: vehiculo.modelo,
      color: vehiculo.color,
      capacidadPasajeros: vehiculo.capacidadPasajeros,
    },
  };
}

export async function obtenerCandidatos(
  solicitudId: string,
  now: Date | number,
): Promise<ObtenerCandidatosResult> {
  const solicitud = await prisma.solicitud.findFirst({
    where: { id: solicitudId, eliminadoEn: null },
    select: { latitudRecogida: true, longitudRecogida: true },
  });
  if (!solicitud) return { ok: false, code: "NOT_FOUND" };

  const configuracion = await prisma.configuracion.findFirst({
    where: { id: 1, eliminadoEn: null },
    select: { radioMaximoBusquedaKm: true },
  });
  const radioMaximoKm = configuracion?.radioMaximoBusquedaKm ?? RADIO_MAXIMO_DEFAULT_KM;

  const conductores = await prisma.conductor.findMany({
    where: {
      estado: "aprobado",
      estadoJornada: "activa",
      estadoDisponibilidad: "disponible",
      eliminadoEn: null,
      vehiculos: { some: { eliminadoEn: null } },
    },
    select: candidatosConductorSelect,
  });

  const elegibles: Array<{ candidato: CandidatoDto; distancia: number }> = [];
  for (const conductor of conductores) {
    const ubicacion = conductor.ubicaciones[0];
    if (!ubicacion || !ubicacion.esValida) continue;
    if (!esTemporalmenteValida(ubicacion.horaRegistro, now)) continue;
    const vehiculo = conductor.vehiculos[0];
    if (!vehiculo) continue;
    const distancia = distanciaKm(
      solicitud.latitudRecogida,
      solicitud.longitudRecogida,
      ubicacion.latitud,
      ubicacion.longitud,
    );
    if (distancia > radioMaximoKm) continue;
    elegibles.push({ candidato: aCandidatoDto(conductor, distancia), distancia });
  }

  elegibles.sort((a, b) => a.distancia - b.distancia);
  const candidatos = elegibles.slice(0, 3).map(({ candidato }) => candidato);
  return { ok: true, candidatos };
}