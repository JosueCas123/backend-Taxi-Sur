import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { esTemporalmenteValida } from "../ubicaciones/ubicaciones.service";
import { ESTADOS_NO_TERMINALES } from "../solicitudes/solicitudes.service";
import { fechaDeNegocioEnLaPaz } from "../tarifario/tarifario.service";
import type { IndicadoresDto, MapaConductorDto, SolicitudActivaDto } from "./dashboard.schema";

// America/La_Paz usa UTC-4 todo el ano (Bolivia no aplica horario de verano).
const DESPLAZAMIENTO_LA_PAZ_MS = 4 * 60 * 60 * 1000;

// P09: cada respuesta de dashboard se lee dentro de una misma transaccion de
// solo lectura con aislamiento explicito RepeatableRead, para que las consultas
// y relaciones de esa respuesta formen una instantanea consistente. Ninguna de
// estas lecturas abre puertos ni escribe; el reloj comun por si solo no basta.
function enLecturaRepeatableRead<T>(
  operacion: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(operacion, {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  });
}

// Dia de negocio en America/La_Paz como intervalo [inicio, inicio del siguiente)
// convertido a UTC: para la fecha de negocio 2026-09-21, desde las 04:00:00.000Z
// inclusive hasta las 04:00:00.000Z del dia siguiente exclusive.
export function inicioDelDiaEnLaPaz(fecha: string): Date {
  const [anio, mes, dia] = fecha.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(anio, mes - 1, dia, 0, 0, 0, 0) + DESPLAZAMIENTO_LA_PAZ_MS);
}

export function inicioDelDiaSiguienteEnLaPaz(fecha: string): Date {
  return new Date(inicioDelDiaEnLaPaz(fecha).getTime() + 24 * 60 * 60 * 1000);
}

const mapaConductorSelect = {
  id: true,
  nombreCompleto: true,
  estado: true,
  estadoJornada: true,
  estadoDisponibilidad: true,
  ubicaciones: {
    where: { eliminadoEn: null },
    orderBy: [{ horaRegistro: "desc" }, { id: "desc" }],
    take: 1,
    select: { latitud: true, longitud: true, horaRegistro: true, esValida: true },
  },
  vehiculos: {
    where: { eliminadoEn: null },
    orderBy: [{ creadoEn: "desc" }, { id: "desc" }],
    take: 1,
    select: { placa: true, marca: true, modelo: true, color: true },
  },
} satisfies Prisma.ConductorSelect;

type MapaConductorRow = Prisma.ConductorGetPayload<{ select: typeof mapaConductorSelect }>;

function aMapaConductorDto(conductor: MapaConductorRow, now: Date | number): MapaConductorDto {
  const ubicacionRegistrada = conductor.ubicaciones[0];
  const ubicacion = ubicacionRegistrada
    && ubicacionRegistrada.esValida
    && esTemporalmenteValida(ubicacionRegistrada.horaRegistro, now)
    ? {
        latitud: ubicacionRegistrada.latitud,
        longitud: ubicacionRegistrada.longitud,
        horaRegistro: ubicacionRegistrada.horaRegistro.toISOString(),
      }
    : null;
  const vehiculo = conductor.vehiculos[0];
  return {
    id: conductor.id,
    nombreCompleto: conductor.nombreCompleto,
    estado: conductor.estado,
    estadoJornada: conductor.estadoJornada,
    estadoDisponibilidad: conductor.estadoDisponibilidad,
    vehiculo: vehiculo
      ? { placa: vehiculo.placa, marca: vehiculo.marca, modelo: vehiculo.modelo, color: vehiculo.color }
      : null,
    ubicacion,
    // Conserva la ultima ubicacion no eliminada aunque sea invalida o caducada.
    ultimaUbicacionRegistradaEn: ubicacionRegistrada ? ubicacionRegistrada.horaRegistro.toISOString() : null,
  };
}

export async function obtenerConductoresParaMapa(now: Date | number = new Date()): Promise<MapaConductorDto[]> {
  // P09: instantanea consistente para la respuesta completa. Todos los
  // conductores no eliminados, sin filtros de aprobacion, jornada,
  // disponibilidad, vehiculo ni GPS; tampoco se filtra por usuario relacionado
  // (P06: su eliminacion no saca al conductor del mapa).
  const conductores = await enLecturaRepeatableRead((tx) =>
    tx.conductor.findMany({
      where: { eliminadoEn: null },
      orderBy: [{ nombreCompleto: "asc" }, { id: "asc" }],
      select: mapaConductorSelect,
    }),
  );
  return conductores.map((conductor) => aMapaConductorDto(conductor, now));
}

// -----------------------------------------------------------------------
// GET /api/dashboard/solicitudes-activas
// -----------------------------------------------------------------------

const solicitudActivaSelect = {
  id: true,
  estado: true,
  latitudRecogida: true,
  longitudRecogida: true,
  destino: true,
  expiraEn: true,
  creadoEn: true,
  pasajero: {
    select: { id: true, nombre: true, eliminadoEn: true },
  },
  conductorAsignado: {
    select: { id: true, nombreCompleto: true, eliminadoEn: true },
  },
} satisfies Prisma.SolicitudSelect;

type SolicitudActivaRow = Prisma.SolicitudGetPayload<{ select: typeof solicitudActivaSelect }>;

function aSolicitudActivaDto(solicitud: SolicitudActivaRow): SolicitudActivaDto {
  return {
    id: solicitud.id,
    estado: solicitud.estado,
    // P06: el resumen de la relacion eliminada es null, sin ocultar la solicitud.
    pasajero: solicitud.pasajero?.eliminadoEn === null
      ? { id: solicitud.pasajero.id, nombre: solicitud.pasajero.nombre }
      : null,
    conductorAsignado: solicitud.conductorAsignado?.eliminadoEn === null
      ? {
          id: solicitud.conductorAsignado.id,
          nombreCompleto: solicitud.conductorAsignado.nombreCompleto,
        }
      : null,
    latitudRecogida: solicitud.latitudRecogida,
    longitudRecogida: solicitud.longitudRecogida,
    destino: solicitud.destino,
    expiraEn: solicitud.expiraEn?.toISOString() ?? null,
    creadoEn: solicitud.creadoEn.toISOString(),
  };
}

export async function obtenerSolicitudesActivas(): Promise<SolicitudActivaDto[]> {
  // P09: instantanea consistente para la respuesta. Seis estados activos de
  // SPEC 10 reutilizados desde solicitudes y lectura por lote sin N+1; GET no
  // expira ni repara solicitudes (solo lectura).
  const solicitudes = await enLecturaRepeatableRead((tx) =>
    tx.solicitud.findMany({
      where: {
        eliminadoEn: null,
        estado: { in: ESTADOS_NO_TERMINALES },
      },
      orderBy: [{ creadoEn: "desc" }, { id: "desc" }],
      select: solicitudActivaSelect,
    }),
  );
  return solicitudes.map(aSolicitudActivaDto);
}

// -----------------------------------------------------------------------
// GET /api/dashboard/indicadores
// -----------------------------------------------------------------------

export async function obtenerIndicadores(now: Date | number = new Date()): Promise<IndicadoresDto> {
  // P09: los cuatro conteos comparten una unica instantanea RepeatableRead y un
  // mismo reloj comun para derivar los limites del dia en America/La_Paz.
  // P06: solo cuenta lo no eliminado; el estado de usuario o relaciones
  // eliminadas no excluye del universo.
  const dia = new Date(now);
  const fechaDeNegocio = fechaDeNegocioEnLaPaz(dia);
  const inicioDelDia = inicioDelDiaEnLaPaz(fechaDeNegocio);
  const inicioDelDiaSiguiente = inicioDelDiaSiguienteEnLaPaz(fechaDeNegocio);

  return enLecturaRepeatableRead(async (tx) => {
    const [conductoresDisponibles, conductoresEnServicio, solicitudesActivas, solicitudesCompletadasHoy] =
      await Promise.all([
        tx.conductor.count({
          where: { eliminadoEn: null, estadoDisponibilidad: "disponible" },
        }),
        tx.conductor.count({
          where: { eliminadoEn: null, estadoDisponibilidad: "en_servicio" },
        }),
        tx.solicitud.count({
          where: { eliminadoEn: null, estado: { in: ESTADOS_NO_TERMINALES } },
        }),
        tx.solicitud.count({
          where: {
            eliminadoEn: null,
            estado: "finalizada",
            finalizadaEn: { gte: inicioDelDia, lt: inicioDelDiaSiguiente },
          },
        }),
      ]);
    return {
      conductoresDisponibles,
      conductoresEnServicio,
      solicitudesActivas,
      solicitudesCompletadasHoy,
    };
  });
}