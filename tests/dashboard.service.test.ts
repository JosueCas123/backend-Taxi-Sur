import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/config/prisma";
import { esTemporalmenteValida } from "../src/modules/ubicaciones/ubicaciones.service";
import { ESTADOS_NO_TERMINALES } from "../src/modules/solicitudes/solicitudes.service";
import { fechaDeNegocioEnLaPaz } from "../src/modules/tarifario/tarifario.service";
import {
  obtenerConductoresParaMapa, obtenerIndicadores, obtenerSolicitudesActivas,
  inicioDelDiaEnLaPaz, inicioDelDiaSiguienteEnLaPaz,
} from "../src/modules/dashboard/dashboard.service";

vi.mock("../src/config/prisma", () => {
  return {
    prisma: {
      $transaction: vi.fn(),
      conductor: { findMany: vi.fn(), count: vi.fn() },
      solicitud: { findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    },
  };
});

const transaction = vi.mocked(prisma.$transaction);
const conductorFindMany = vi.mocked(prisma.conductor.findMany);
const conductorCount = vi.mocked(prisma.conductor.count);
const solicitudFindMany = vi.mocked(prisma.solicitud.findMany);
const solicitudCount = vi.mocked(prisma.solicitud.count);
const solicitudUpdateMany = vi.mocked(prisma.solicitud.updateMany);
const solicitudUpdate = vi.mocked(prisma.solicitud.update);

// P09 en unit: la transaccion interactiva delega el cliente a los mismos mocks,
// de modo que el servicio consulta bajo RepeatableRead y las aserciones de
// llamada verifican las consultas exactas sobre ese cliente transaccional.
function clienteTransaccional() {
  return {
    conductor: { findMany: conductorFindMany, count: conductorCount },
    solicitud: {
      findMany: solicitudFindMany,
      count: solicitudCount,
      updateMany: solicitudUpdateMany,
      update: solicitudUpdate,
    },
  };
}

const conductorId = "8e7acf6d-0e5b-4e6a-9f2a-1c2b3d4e5f60";
const horaRegistro = new Date("2026-09-21T14:00:00.000Z");
const vehiculo = { placa: "1234ABC", marca: "Toyota", modelo: "Corolla", color: "Blanco" };

function filaConductor(sobreescribe: Record<string, unknown> = {}) {
  return {
    id: conductorId,
    nombreCompleto: "Juan Perez",
    estado: "aprobado",
    estadoJornada: "activa",
    estadoDisponibilidad: "disponible",
    ubicaciones: [ubicacionRegistrada()],
    vehiculos: [vehiculo],
    ...sobreescripciones(sobreescribe),
  };
}

function sobreescripciones(sobreescribe: Record<string, unknown>): Record<string, unknown> {
  const { ubicaciones, vehiculos, ...resto } = sobreescribe;
  return {
    ...resto,
    ...(ubicaciones !== undefined ? { ubicaciones } : {}),
    ...(vehiculos !== undefined ? { vehiculos } : {}),
  };
}

function ubicacionRegistrada(sobreescribe: Record<string, unknown> = {}) {
  return {
    latitud: -17.7833,
    longitud: -63.1821,
    horaRegistro,
    esValida: true,
    ...sobreescribe,
  };
}

const dtoConCompleto = {
  id: conductorId,
  nombreCompleto: "Juan Perez",
  estado: "aprobado",
  estadoJornada: "activa",
  estadoDisponibilidad: "disponible",
  vehiculo,
  ubicacion: {
    latitud: -17.7833,
    longitud: -63.1821,
    horaRegistro: "2026-09-21T14:00:00.000Z",
  },
  ultimaUbicacionRegistradaEn: "2026-09-21T14:00:00.000Z",
};

const selectEsperado = {
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
};

beforeEach(() => {
  vi.resetAllMocks();
  transaction.mockImplementation(async (callback) => callback(clienteTransaccional() as never));
});

describe("obtenerConductoresParaMapa", () => {
  it("devuelve el array de conductores no eliminados con vehiculo y ubicacion vigente", async () => {
    conductorFindMany.mockResolvedValueOnce([filaConductor()]);
    const mapa = await obtenerConductoresParaMapa(horaRegistro);
    expect(conductorFindMany).toHaveBeenCalledExactlyOnceWith({
      where: { eliminadoEn: null },
      orderBy: [{ nombreCompleto: "asc" }, { id: "asc" }],
      select: selectEsperado,
    });
    expect(mapa).toEqual([dtoConCompleto]);
  });

  it("excluye solo conductores eliminados logicamente, sin filtros de estado ni usuario relacionado", async () => {
    conductorFindMany.mockResolvedValueOnce([]);
    await obtenerConductoresParaMapa(horaRegistro);
    expect(conductorFindMany.mock.calls[0][0].where).toEqual({ eliminadoEn: null });
  });

  it("vacio devuelve 200 []", async () => {
    conductorFindMany.mockResolvedValueOnce([]);
    expect(await obtenerConductoresParaMapa(horaRegistro)).toEqual([]);
  });

  it.each([
    "pendiente", "aprobado", "rechazado", "suspendido",
  ] as const)("conserva el estado de aprobacion %s sin filtro de elegibilidad", async (estado) => {
    conductorFindMany.mockResolvedValueOnce([filaConductor({ estado })]);
    const mapa = await obtenerConductoresParaMapa(horaRegistro);
    expect(mapa[0].estado).toBe(estado);
  });

  it.each([
    "no_iniciada", "activa", "finalizada",
  ] as const)("conserva el estado de jornada %s", async (estadoJornada) => {
    conductorFindMany.mockResolvedValueOnce([filaConductor({ estadoJornada })]);
    const mapa = await obtenerConductoresParaMapa(horaRegistro);
    expect(mapa[0].estadoJornada).toBe(estadoJornada);
  });

  it.each([
    "disponible", "no_disponible", "solicitud_pendiente", "en_servicio",
  ] as const)("conserva el estado de disponibilidad %s", async (estadoDisponibilidad) => {
    conductorFindMany.mockResolvedValueOnce([filaConductor({ estadoDisponibilidad })]);
    const mapa = await obtenerConductoresParaMapa(horaRegistro);
    expect(mapa[0].estadoDisponibilidad).toBe(estadoDisponibilidad);
  });

  it("incluye un conductor no eliminado aunque su usuario este eliminado (P06)", async () => {
    conductorFindMany.mockResolvedValueOnce([filaConductor()]);
    const mapa = await obtenerConductoresParaMapa(horaRegistro);
    expect(conductorFindMany.mock.calls[0][0].where).toEqual({ eliminadoEn: null });
    expect(mapa).toHaveLength(1);
  });

  it("vehiculo nulo cuando no hay vehiculo no eliminado", async () => {
    conductorFindMany.mockResolvedValueOnce([filaConductor({ vehiculos: [] })]);
    const mapa = await obtenerConductoresParaMapa(horaRegistro);
    expect(mapa[0].vehiculo).toBeNull();
  });

  it("ubicacion nula y ultimaUbicacionRegistradaEn nula cuando no hay registros", async () => {
    conductorFindMany.mockResolvedValueOnce([filaConductor({ ubicaciones: [] })]);
    const mapa = await obtenerConductoresParaMapa(horaRegistro);
    expect(mapa[0].ubicacion).toBeNull();
    expect(mapa[0].ultimaUbicacionRegistradaEn).toBeNull();
  });

  it("bandera persistida falsa invalida la ubicacion pero conserva la fecha separada", async () => {
    conductorFindMany.mockResolvedValueOnce([
      filaConductor({ ubicaciones: [ubicacionRegistrada({ esValida: false })] }),
    ]);
    const mapa = await obtenerConductoresParaMapa(horaRegistro);
    expect(mapa[0].ubicacion).toBeNull();
    expect(mapa[0].ultimaUbicacionRegistradaEn).toBe("2026-09-21T14:00:00.000Z");
  });

  it.each([0, 299999, 300000])("ubicacion vigente con antiguedad %i ms", async (antiguedad) => {
    conductorFindMany.mockResolvedValueOnce([filaConductor()]);
    const mapa = await obtenerConductoresParaMapa(horaRegistro.getTime() + antiguedad);
    expect(mapa[0].ubicacion).toEqual(dtoConCompleto.ubicacion);
  });

  it("ubicacion caducada con 300001 ms queda nula pero conserva la fecha separada", async () => {
    conductorFindMany.mockResolvedValueOnce([filaConductor()]);
    const mapa = await obtenerConductoresParaMapa(horaRegistro.getTime() + 300001);
    expect(mapa[0].ubicacion).toBeNull();
    expect(mapa[0].ultimaUbicacionRegistradaEn).toBe("2026-09-21T14:00:00.000Z");
  });

  it("reutiliza esTemporalmenteValida sin duplicar la Regla 9", async () => {
    conductorFindMany.mockResolvedValueOnce([filaConductor()]);
    const referencia = horaRegistro.getTime();
    expect(esTemporalmenteValida(horaRegistro, referencia + 300000)).toBe(true);
    expect(esTemporalmenteValida(horaRegistro, referencia + 300001)).toBe(false);
  });

  it("no filtra ubicaciones eliminadas ni vehiculos eliminados (take 1 sobre no eliminados)", async () => {
    conductorFindMany.mockResolvedValueOnce([filaConductor()]);
    await obtenerConductoresParaMapa(horaRegistro);
    expect(conductorFindMany.mock.calls[0][0].select.ubicaciones.where).toEqual({ eliminadoEn: null });
    expect(conductorFindMany.mock.calls[0][0].select.vehiculos.where).toEqual({ eliminadoEn: null });
  });

  it("consulta por lote sin N+1: una sola llamada y relaciones embebidas", async () => {
    conductorFindMany.mockResolvedValueOnce([
      filaConductor({ id: conductorId }),
      filaConductor({ id: "4c3f2b1a-9e8d-4a6b-8c1d-2e3f4a5b6c7d", nombreCompleto: "Zoe Vera" }),
      filaConductor({ id: "d9428888-122b-4e1f-b85c-61cd3cbb3210", nombreCompleto: "Ana Perez" }),
    ]);
    await obtenerConductoresParaMapa(horaRegistro);
    expect(conductorFindMany).toHaveBeenCalledTimes(1);
  });

  it("ordena por nombreCompleto ASC, id ASC con desempate estable", async () => {
    conductorFindMany.mockResolvedValueOnce([]);
    await obtenerConductoresParaMapa(horaRegistro);
    expect(conductorFindMany.mock.calls[0][0].orderBy).toEqual([
      { nombreCompleto: "asc" }, { id: "asc" },
    ]);
  });

  it("propaga fallos de lectura", async () => {
    const error = new Error("Read failure");
    conductorFindMany.mockRejectedValueOnce(error);
    await expect(obtenerConductoresParaMapa(horaRegistro)).rejects.toBe(error);
  });
});

describe("obtenerSolicitudesActivas", () => {
  const solicitudId = "7a1f2c4e-0000-4000-8000-000000000000";
  const pasajero = { id: "d9428888-122b-4e1f-b85c-61cd3cbb3210", nombre: "Ana Perez", eliminadoEn: null as Date | null };
  const conductor = {
    id: "4c3f2b1a-9e8d-4a6b-8c1d-2e3f4a5b6c7d", nombreCompleto: "Carlos Rios", eliminadoEn: null as Date | null,
  };

  function filaSolicitud(sobreescribe: Record<string, unknown> = {}) {
    return {
      id: solicitudId,
      estado: "buscando",
      latitudRecogida: -17.7833,
      longitudRecogida: -63.1821,
      destino: "Terminal",
      expiraEn: new Date("2026-09-21T14:05:00.000Z"),
      creadoEn: new Date("2026-09-21T14:00:00.000Z"),
      pasajero,
      conductorAsignado: conductor,
      ...sobreescripciones(sobreescribe),
    };
  }

  const selectEsperadoSolicitud = {
    id: true,
    estado: true,
    latitudRecogida: true,
    longitudRecogida: true,
    destino: true,
    expiraEn: true,
    creadoEn: true,
    pasajero: { select: { id: true, nombre: true, eliminadoEn: true } },
    conductorAsignado: { select: { id: true, nombreCompleto: true, eliminadoEn: true } },
  };

  it.each(ESTADOS_NO_TERMINALES)("incluye la solicitud activa %s", async (estado) => {
    solicitudFindMany.mockResolvedValueOnce([filaSolicitud({ estado })]);
    const activas = await obtenerSolicitudesActivas();
    expect(activas[0].estado).toBe(estado);
  });

  it.each([
    "finalizada", "rechazada", "expirada", "sin_conductor",
  ])("filtra el estado terminal %s en el where", async (estado) => {
    solicitudFindMany.mockResolvedValueOnce([]);
    await obtenerSolicitudesActivas();
    const where = solicitudFindMany.mock.calls[0][0].where;
    expect(where.eliminadoEn).toBeNull();
    expect(where.estado.in).not.toContain(estado);
    expect(where.estado.in).toEqual(ESTADOS_NO_TERMINALES);
  });

  it("excluye solicitudes eliminadas logicamente", async () => {
    solicitudFindMany.mockResolvedValueOnce([]);
    await obtenerSolicitudesActivas();
    expect(solicitudFindMany.mock.calls[0][0].where.eliminadoEn).toBeNull();
  });

  it("devuelve el DTO completo con pasajero y conductorAsignado", async () => {
    solicitudFindMany.mockResolvedValueOnce([filaSolicitud()]);
    const activas = await obtenerSolicitudesActivas();
    expect(solicitudFindMany).toHaveBeenCalledExactlyOnceWith({
      where: { eliminadoEn: null, estado: { in: ESTADOS_NO_TERMINALES } },
      orderBy: [{ creadoEn: "desc" }, { id: "desc" }],
      select: selectEsperadoSolicitud,
    });
    expect(activas[0]).toEqual({
      id: solicitudId,
      estado: "buscando",
      pasajero: { id: pasajero.id, nombre: pasajero.nombre },
      conductorAsignado: { id: conductor.id, nombreCompleto: conductor.nombreCompleto },
      latitudRecogida: -17.7833,
      longitudRecogida: -63.1821,
      destino: "Terminal",
      expiraEn: "2026-09-21T14:05:00.000Z",
      creadoEn: "2026-09-21T14:00:00.000Z",
    });
  });

  it("pasajero eliminado: solicitud visible con resumen null (P06)", async () => {
    solicitudFindMany.mockResolvedValueOnce([
      filaSolicitud({ pasajero: { ...pasajero, eliminadoEn: new Date() } }),
    ]);
    const activas = await obtenerSolicitudesActivas();
    expect(activas).toHaveLength(1);
    expect(activas[0].pasajero).toBeNull();
  });

  it("conductor asignado eliminado: resumen null sin ocultar la solicitud (P06)", async () => {
    solicitudFindMany.mockResolvedValueOnce([
      filaSolicitud({ conductorAsignado: { ...conductor, eliminadoEn: new Date() } }),
    ]);
    const activas = await obtenerSolicitudesActivas();
    expect(activas).toHaveLength(1);
    expect(activas[0].conductorAsignado).toBeNull();
  });

  it("solicitud sin conductor asignado devuelve conductorAsignado null", async () => {
    solicitudFindMany.mockResolvedValueOnce([filaSolicitud({ conductorAsignado: null })]);
    const activas = await obtenerSolicitudesActivas();
    expect(activas[0].conductorAsignado).toBeNull();
  });

  it("destino y expiraEn nullables", async () => {
    solicitudFindMany.mockResolvedValueOnce([filaSolicitud({ destino: null, expiraEn: null })]);
    const activas = await obtenerSolicitudesActivas();
    expect(activas[0].destino).toBeNull();
    expect(activas[0].expiraEn).toBeNull();
  });

  it("ordena por creadoEn DESC, id DESC", async () => {
    solicitudFindMany.mockResolvedValueOnce([]);
    await obtenerSolicitudesActivas();
    expect(solicitudFindMany.mock.calls[0][0].orderBy).toEqual([
      { creadoEn: "desc" }, { id: "desc" },
    ]);
  });

  it("solo lee: no expira ni repara solicitudes desde GET", async () => {
    solicitudFindMany.mockResolvedValueOnce([filaSolicitud()]);
    await obtenerSolicitudesActivas();
    expect(prisma.solicitud.updateMany).not.toHaveBeenCalled();
    expect(prisma.solicitud.update).not.toHaveBeenCalled();
  });

  it("mas de 25 registros sin truncamiento ni paginacion", async () => {
    const filas = Array.from({ length: 30 }, (_, i) => filaSolicitud({
      id: `${String(i + 1).padStart(8, "0")}-0000-4000-8000-000000000000`,
    }));
    solicitudFindMany.mockResolvedValueOnce(filas);
    const activas = await obtenerSolicitudesActivas();
    expect(activas).toHaveLength(30);
    expect(solicitudFindMany.mock.calls[0][0].take).toBeUndefined();
  });

  it("consulta por lote sin N+1: una sola lectura", async () => {
    solicitudFindMany.mockResolvedValueOnce([filaSolicitud(), filaSolicitud({ id: "b0a99e1f-0000-4000-8000-000000000000" })]);
    await obtenerSolicitudesActivas();
    expect(solicitudFindMany).toHaveBeenCalledTimes(1);
  });

  it("devuelve vacio como []", async () => {
    solicitudFindMany.mockResolvedValueOnce([]);
    expect(await obtenerSolicitudesActivas()).toEqual([]);
  });

  it("reutiliza ESTADOS_NO_TERMINALES de solicitudes y coincide con los seis activos", async () => {
    expect(ESTADOS_NO_TERMINALES).toEqual([
      "creada", "buscando", "conductor_seleccionado", "esperando_respuesta", "aceptada", "en_servicio",
    ]);
  });

  it("propaga fallos de lectura", async () => {
    const error = new Error("Read failure");
    solicitudFindMany.mockRejectedValueOnce(error);
    await expect(obtenerSolicitudesActivas()).rejects.toBe(error);
  });
});

describe("obtenerIndicadores", () => {
  const diaEnLaPaz = "2026-09-21";
  const inicioDelDia = new Date("2026-09-21T04:00:00.000Z");
  const inicioDelDiaSiguiente = new Date("2026-09-22T04:00:00.000Z");

  beforeEach(() => {
    conductorCount.mockResolvedValue(0);
    solicitudCount.mockResolvedValue(0);
  });

  it("cuenta cada tipo de conductor por disponibilidad registrada", async () => {
    conductorCount
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2);
    const indicadores = await obtenerIndicadores(new Date("2026-09-21T15:00:00.000Z"));
    expect(conductorCount).toHaveBeenCalledWith({
      where: { eliminadoEn: null, estadoDisponibilidad: "disponible" },
    });
    expect(conductorCount).toHaveBeenCalledWith({
      where: { eliminadoEn: null, estadoDisponibilidad: "en_servicio" },
    });
    expect(indicadores.conductoresDisponibles).toBe(3);
    expect(indicadores.conductoresEnServicio).toBe(2);
  });

  it("cuenta solicitudes activas y completadas del dia separadas", async () => {
    solicitudCount
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(7);
    const indicadores = await obtenerIndicadores(new Date("2026-09-21T15:00:00.000Z"));
    expect(solicitudCount).toHaveBeenCalledWith({
      where: { eliminadoEn: null, estado: { in: ESTADOS_NO_TERMINALES } },
    });
    expect(solicitudCount).toHaveBeenCalledWith({
      where: {
        eliminadoEn: null,
        estado: "finalizada",
        finalizadaEn: { gte: inicioDelDia, lt: inicioDelDiaSiguiente },
      },
    });
    expect(indicadores.solicitudesActivas).toBe(5);
    expect(indicadores.solicitudesCompletadasHoy).toBe(7);
  });

  it("P06: solo filtra eliminacion logica, sin usuario ni relaciones en conteos", async () => {
    await obtenerIndicadores(new Date("2026-09-21T15:00:00.000Z"));
    for (const llamada of conductorCount.mock.calls) {
      expect(Object.keys(llamada[0].where)).toEqual(["eliminadoEn", "estadoDisponibilidad"]);
    }
    for (const llamada of solicitudCount.mock.calls) {
      expect(Object.keys(llamada[0].where)).toContain("eliminadoEn");
      expect(llamada[0].where).not.toHaveProperty("pasajero");
      expect(llamada[0].where).not.toHaveProperty("conductorAsignado");
      expect(llamada[0].where).not.toHaveProperty("usuarioId");
    }
  });

  it("P06: un suspendido con disponibilidad registrada disponible cuenta", async () => {
    await obtenerIndicadores(new Date("2026-09-21T15:00:00.000Z"));
    expect(conductorCount.mock.calls[0][0].where).toEqual({
      eliminadoEn: null,
      estadoDisponibilidad: "disponible",
    });
    expect(conductorCount.mock.calls[0][0].where).not.toHaveProperty("estado");
    expect(conductorCount.mock.calls[0][0].where).not.toHaveProperty("estadoJornada");
  });

  it("solicitud_pendiente y no_disponible no suman en los dos conteos", async () => {
    await obtenerIndicadores(new Date("2026-09-21T15:00:00.000Z"));
    const disponibilidadesUsadas = conductorCount.mock.calls.map((llamada) => llamada[0].where.estadoDisponibilidad);
    expect(disponibilidadesUsadas).toEqual(["disponible", "en_servicio"]);
    expect(disponibilidadesUsadas).not.toContain("solicitud_pendiente");
    expect(disponibilidadesUsadas).not.toContain("no_disponible");
  });

  it("conductoresEnServicio cuenta conductores, no solicitudes", async () => {
    await obtenerIndicadores(new Date("2026-09-21T15:00:00.000Z"));
    expect(conductorCount).toHaveBeenCalledWith({
      where: { eliminadoEn: null, estadoDisponibilidad: "en_servicio" },
    });
  });

  it.each(ESTADOS_NO_TERMINALES)("incluye la solicitud activa %s en solicitudesActivas", async (estado) => {
    await obtenerIndicadores(new Date("2026-09-21T15:00:00.000Z"));
    expect(solicitudCount.mock.calls[0][0].where.estado.in).toEqual(ESTADOS_NO_TERMINALES);
    expect(solicitudCount.mock.calls[0][0].where.estado.in).toContain(estado);
  });

  it.each([
    "finalizada", "rechazada", "expirada", "sin_conductor",
  ])("excluye el estado terminal %s de solicitudesActivas", async (estado) => {
    await obtenerIndicadores(new Date("2026-09-21T15:00:00.000Z"));
    expect(solicitudCount.mock.calls[0][0].where.estado.in).not.toContain(estado);
  });

  it("finalizadaEn nulo u otro estado con fecha no cuentan como completadas", async () => {
    await obtenerIndicadores(new Date("2026-09-21T15:00:00.000Z"));
    const dondeCompletadas = solicitudCount.mock.calls[1][0].where;
    expect(dondeCompletadas.estado).toBe("finalizada");
    expect(dondeCompletadas.finalizadaEn).toEqual({ gte: inicioDelDia, lt: inicioDelDiaSiguiente });
  });

  it("referencia temporal comun: calcula el dia de America/La_Paz a partir de now", async () => {
    const ahora = new Date("2026-09-21T15:00:00.000Z");
    const fechaDeNegocio = fechaDeNegocioEnLaPaz(ahora);
    expect(fechaDeNegocio).toBe(diaEnLaPaz);
    await obtenerIndicadores(ahora);
    const dondeCompletadas = solicitudCount.mock.calls[1][0].where;
    expect(dondeCompletadas.finalizadaEn.gte).toEqual(inicioDelDiaEnLaPaz(diaEnLaPaz));
    expect(dondeCompletadas.finalizadaEn.lt).toEqual(inicioDelDiaSiguienteEnLaPaz(diaEnLaPaz));
  });

  it("inicio del dia inclusive, instante anterior al siguiente inicio incluido", async () => {
    const inicio = inicioDelDiaEnLaPaz("2026-09-21");
    const siguiente = inicioDelDiaSiguienteEnLaPaz("2026-09-21");
    expect(inicio.toISOString()).toBe("2026-09-21T04:00:00.000Z");
    expect(siguiente.toISOString()).toBe("2026-09-22T04:00:00.000Z");
    await obtenerIndicadores(new Date("2026-09-22T03:59:59.999Z"));
    expect(solicitudCount.mock.calls[1][0].where.finalizadaEn).toEqual({
      gte: inicio,
      lt: siguiente,
    });
  });

  it("siguiente inicio exclusive: el instante del limite pertenece al dia siguiente", async () => {
    const limite = new Date("2026-09-22T04:00:00.000Z");
    await obtenerIndicadores(limite);
    const hoyQuerido = fechaDeNegocioEnLaPaz(limite);
    expect(hoyQuerido).toBe("2026-09-22");
    expect(solicitudCount.mock.calls[1][0].where.finalizadaEn).toEqual({
      gte: inicioDelDiaEnLaPaz("2026-09-22"),
      lt: inicioDelDiaSiguienteEnLaPaz("2026-09-22"),
    });
    expect(new Date("2026-09-22T04:00:00.000Z") < inicioDelDiaSiguienteEnLaPaz("2026-09-21")).toBe(false);
  });

  it("cuenta hoy en America/La_Paz sin depender de la zona local del servidor", async () => {
    const ahoraMadrugada = new Date("2026-09-22T02:00:00.000Z");
    const fechaDeNegocio = fechaDeNegocioEnLaPaz(ahoraMadrugada);
    expect(fechaDeNegocio).toBe("2026-09-21");
    await obtenerIndicadores(ahoraMadrugada);
    expect(solicitudCount.mock.calls[1][0].where.finalizadaEn.gte).toEqual(
      new Date("2026-09-21T04:00:00.000Z"),
    );
    expect(solicitudCount.mock.calls[1][0].where.finalizadaEn.lt).toEqual(
      new Date("2026-09-22T04:00:00.000Z"),
    );
  });

  it("sin datos devuelve los cuatro conteos en cero", async () => {
    const indicadores = await obtenerIndicadores(new Date("2026-09-21T15:00:00.000Z"));
    expect(indicadores).toEqual({
      conductoresDisponibles: 0,
      conductoresEnServicio: 0,
      solicitudesActivas: 0,
      solicitudesCompletadasHoy: 0,
    });
  });

  it("sin escrituras correctivas desde GET", async () => {
    await obtenerIndicadores(new Date("2026-09-21T15:00:00.000Z"));
    expect(solicitudUpdateMany).not.toHaveBeenCalled();
    expect(solicitudUpdate).not.toHaveBeenCalled();
  });

  it("P09: los cuatro conteos comparten una unica transaccion RepeatableRead", async () => {
    await obtenerIndicadores(new Date("2026-09-21T15:00:00.000Z"));
    expect(transaction).toHaveBeenCalledTimes(1);
    const llamada = transaction.mock.calls[0];
    expect(llamada[1]).toEqual({ isolationLevel: "RepeatableRead" });
    const clienteUsado = clienteTransaccional();
    expect(llamada[0]).toEqual(expect.any(Function));
    expect((llamada[0] as (cliente: unknown) => Promise<unknown>)(clienteUsado)).toBeInstanceOf(Promise);
  });

  it("P09: la transaccion es interactiva y delega las consultas al cliente de la respuesta", async () => {
    conductorCount.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    solicitudCount.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const indicadores = await obtenerIndicadores(new Date("2026-09-21T15:00:00.000Z"));
    expect(indicadores).toEqual({
      conductoresDisponibles: 1,
      conductoresEnServicio: 0,
      solicitudesActivas: 1,
      solicitudesCompletadasHoy: 0,
    });
    expect(conductorCount).toHaveBeenCalledTimes(2);
    expect(solicitudCount).toHaveBeenCalledTimes(2);
  });

  it("propaga fallos de la transaccion", async () => {
    const error = new Error("Read failure");
    conductorCount.mockRejectedValueOnce(error);
    await expect(obtenerIndicadores(new Date("2026-09-21T15:00:00.000Z"))).rejects.toBe(error);
  });
});

describe("P09 dashboard: instantanea consistente por respuesta", () => {
  it("lee las solicitudes activas dentro de una transaccion", async () => {
    solicitudFindMany.mockResolvedValueOnce([]);
    await obtenerSolicitudesActivas();
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0][1]).toEqual({ isolationLevel: "RepeatableRead" });
  });

  it("el mapa lee dentro de una transaccion RepeatableRead", async () => {
    conductorFindMany.mockResolvedValueOnce([]);
    await obtenerConductoresParaMapa(horaRegistro);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0][1]).toEqual({ isolationLevel: "RepeatableRead" });
  });
});