import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/config/prisma";
import {
  distanciaKm,
  obtenerCandidatos,
  type ObtenerCandidatosResult,
} from "../src/modules/motor-asignacion/motor-asignacion.service";
import type { CandidatoDto } from "../src/modules/motor-asignacion/motor-asignacion.schema";

vi.mock("../src/config/prisma", () => {
  const solicitud = { findFirst: vi.fn() };
  const configuracion = { findFirst: vi.fn() };
  const conductor = { findMany: vi.fn() };
  const solicitudConductorRechazado = { findMany: vi.fn() };
  return { prisma: { solicitud, configuracion, conductor, solicitudConductorRechazado } };
});

const solicitudFindFirst = vi.mocked(prisma.solicitud.findFirst);
const configuracionFindFirst = vi.mocked(prisma.configuracion.findFirst);
const conductorFindMany = vi.mocked(prisma.conductor.findMany);
const rechazadosFindMany = vi.mocked(prisma.solicitudConductorRechazado.findMany);

const solicitudId = "d9428888-122b-4e1f-b85c-61cd3cbb3210";
const ahora = new Date("2026-09-15T14:05:00.000Z");
const puntoRecogida = { latitudRecogida: -17.7833, longitudRecogida: -63.1821 };
const puntoEcuador = { latitudRecogida: 0, longitudRecogida: 0 };
const consultaSolicitud = {
  where: { id: solicitudId, eliminadoEn: null },
  select: { latitudRecogida: true, longitudRecogida: true },
};
const consultaConfiguracion = {
  where: { id: 1, eliminadoEn: null },
  select: { radioMaximoBusquedaKm: true },
};

const vehiculo = {
  placa: "1234ABC", marca: "Toyota", modelo: "Corolla", color: "Blanco", capacidadPasajeros: 4,
};

function conductor(overrides: Partial<{
  id: string;
  nombreCompleto: string;
  ubicaciones: Array<{
    latitud: number; longitud: number; horaRegistro: Date; esValida: boolean;
  }>;
  vehiculos: typeof vehiculo[];
}>) {
  return {
    id: "4c3f2b1a-9e8d-4a6b-8c1d-2e3f4a5b6c7d",
    nombreCompleto: "Juan Perez",
    ubicaciones: [{ latitud: -17.78, longitud: -63.18, horaRegistro: new Date(ahora.getTime() - 30000), esValida: true }],
    vehiculos: [{ ...vehiculo }],
    ...overrides,
  };
}

const ubicacionEn = (latitud: number, longitud: number, antiguedadMs = 30000, esValida = true) => ({
  latitud, longitud, horaRegistro: new Date(ahora.getTime() - antiguedadMs), esValida,
});

function esperadoCandidato(id: string, nombre: string, distanciaKm: number, auto = vehiculo): CandidatoDto {
  return { conductorId: id, nombreCompleto: nombre, distanciaKm, vehiculo: { ...auto } };
}

const consultaConductores = {
  where: {
    estado: "aprobado",
    estadoJornada: "activa",
    estadoDisponibilidad: "disponible",
    eliminadoEn: null,
    vehiculos: { some: { eliminadoEn: null } },
  },
  select: {
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
  },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(ahora);
  solicitudFindFirst.mockResolvedValue(puntoRecogida);
  configuracionFindFirst.mockResolvedValue({ radioMaximoBusquedaKm: 5 });
  conductorFindMany.mockResolvedValue([]);
  rechazadosFindMany.mockResolvedValue([]);
});

afterEach(() => { vi.useRealTimers(); });

describe("distanciaKm (Haversine, radio 6371 km)", () => {
  it("devuelve 0 para coordenadas identicas", () => {
    expect(distanciaKm(-17.7833, -63.1821, -17.7833, -63.1821)).toBe(0);
  });

  it("calcula ~111.19 km para 1 grado de longitud en el ecuador", () => {
    expect(distanciaKm(0, 0, 0, 1)).toBeCloseTo(111.19492664455873, 6);
  });

  it("es simetrica (misma entrada invertida, misma salida)", () => {
    expect(distanciaKm(-17.7833, -63.1821, -17.8, -63.25))
      .toBe(distanciaKm(-17.8, -63.25, -17.7833, -63.1821));
  });

  it("es pura: dos llamadas con la misma entrada devuelven lo mismo", () => {
    const a = distanciaKm(10, -65, 10.3, -65.5);
    const b = distanciaKm(10, -65, 10.3, -65.5);
    expect(a).toBe(b);
  });
});

describe("obtenerCandidatos: existencia de la solicitud", () => {
  it("devuelve NOT_FOUND y no consulta mas alla cuando la solicitud no existe", async () => {
    solicitudFindFirst.mockResolvedValueOnce(null);
    await expect(obtenerCandidatos(solicitudId, new Date())).resolves
      .toEqual({ ok: false, code: "NOT_FOUND" });
    expect(solicitudFindFirst).toHaveBeenCalledWith(consultaSolicitud);
    expect(configuracionFindFirst).not.toHaveBeenCalled();
    expect(conductorFindMany).not.toHaveBeenCalled();
  });

  it("excluye solicitudes eliminadas logicamente", async () => {
    await obtenerCandidatos(solicitudId, new Date());
    expect(solicitudFindFirst).toHaveBeenCalledWith(consultaSolicitud);
  });

  it("propaga fallo de lectura de la solicitud", async () => {
    const error = new Error("Read failure");
    solicitudFindFirst.mockRejectedValueOnce(error);
    await expect(obtenerCandidatos(solicitudId, new Date())).rejects.toBe(error);
    expect(configuracionFindFirst).not.toHaveBeenCalled();
  });
});

describe("obtenerCandidatos: radio de busqueda (Regla 3)", () => {
  it("usa el default 5 km cuando la configuracion no existe o esta eliminada", async () => {
    solicitudFindFirst.mockResolvedValue(puntoEcuador);
    configuracionFindFirst.mockResolvedValueOnce(null);
    conductorFindMany.mockResolvedValueOnce([conductor({ ubicaciones: [ubicacionEn(0, 0.04496)] })]);
    const result = await obtenerCandidatos(solicitudId, new Date());
    expect(result).toEqual({ ok: true, candidatos: [esperadoCandidato("4c3f2b1a-9e8d-4a6b-8c1d-2e3f4a5b6c7d", "Juan Perez", 5)] });
    expect(configuracionFindFirst).toHaveBeenCalledWith(consultaConfiguracion);
  });

  it("usa el radio almacenado cuando la configuracion existe", async () => {
    solicitudFindFirst.mockResolvedValue(puntoEcuador);
    configuracionFindFirst.mockResolvedValueOnce({ radioMaximoBusquedaKm: 4 });
    conductorFindMany.mockResolvedValueOnce([conductor({ ubicaciones: [ubicacionEn(0, 0.04496)] })]);
    const result = await obtenerCandidatos(solicitudId, new Date());
    expect(result).toEqual({ ok: true, candidatos: [] });
    expect(configuracionFindFirst).toHaveBeenCalledWith(consultaConfiguracion);
  });

  it("conserva al conductor con distancia exactamente igual al radio (inclusivo)", async () => {
    solicitudFindFirst.mockResolvedValue(puntoEcuador);
    configuracionFindFirst.mockResolvedValueOnce({ radioMaximoBusquedaKm: distanciaKm(0, 0, 0, 0.045) });
    conductorFindMany.mockResolvedValueOnce([conductor({ ubicaciones: [ubicacionEn(0, 0.045)] })]);
    const result = await obtenerCandidatos(solicitudId, new Date());
    expect(result).toEqual({ ok: true, candidatos: [esperadoCandidato("4c3f2b1a-9e8d-4a6b-8c1d-2e3f4a5b6c7d", "Juan Perez", 5)] });
  });

  it("descarta un conductor justo fuera del radio aunque su distancia redondee a 5.00", async () => {
    solicitudFindFirst.mockResolvedValue(puntoEcuador);
    const cercano = conductor({
      id: "11111111-2222-4333-8444-555555555555",
      nombreCompleto: "Cercano",
      ubicaciones: [ubicacionEn(0, 0.04496)],
    });
    const lejano = conductor({
      id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      nombreCompleto: "Lejano",
      ubicaciones: [ubicacionEn(0, 0.04501)],
    });
    conductorFindMany.mockResolvedValueOnce([cercano, lejano]);
    const result = await obtenerCandidatos(solicitudId, new Date());
    expect(result).toEqual({ ok: true, candidatos: [esperadoCandidato("11111111-2222-4333-8444-555555555555", "Cercano", 5)] });
  });

  it("propaga fallo de lectura de la configuracion", async () => {
    const error = new Error("Config failure");
    configuracionFindFirst.mockRejectedValueOnce(error);
    await expect(obtenerCandidatos(solicitudId, new Date())).rejects.toBe(error);
  });
});

describe("obtenerCandidatos: filtros de elegibilidad (Regla 2)", () => {
  it("solo consulta conductores aprobados, en jornada activa, disponibles, no eliminados y con vehiculo activo", async () => {
    await obtenerCandidatos(solicitudId, new Date());
    expect(conductorFindMany).toHaveBeenCalledWith(consultaConductores);
  });

  it("recupera la ultima ubicacion (horaRegistro DESC, id DESC) y el vehiculo mas reciente (creadoEn DESC) con take 1", async () => {
    await obtenerCandidatos(solicitudId, new Date());
    const args = conductorFindMany.mock.calls[0][0] as unknown as typeof consultaConductores;
    expect(args.select.ubicaciones.orderBy).toEqual([{ horaRegistro: "desc" }, { id: "desc" }]);
    expect(args.select.ubicaciones.take).toBe(1);
    expect(args.select.ubicaciones.where).toEqual({ eliminadoEn: null });
    expect(args.select.vehiculos.orderBy).toEqual({ creadoEn: "desc" });
    expect(args.select.vehiculos.take).toBe(1);
    expect(args.select.vehiculos.where).toEqual({ eliminadoEn: null });
  });

  it("descarta conductores sin ubicacion", async () => {
    conductorFindMany.mockResolvedValueOnce([conductor({ ubicaciones: [] })]);
    const result = await obtenerCandidatos(solicitudId, new Date());
    expect(result).toEqual({ ok: true, candidatos: [] });
  });

  it("descarta conductores con esValida persistida false aunque sea reciente", async () => {
    conductorFindMany.mockResolvedValueOnce([conductor({ ubicaciones: [ubicacionEn(-17.78, -63.18, 30000, false)] })]);
    const result = await obtenerCandidatos(solicitudId, new Date());
    expect(result).toEqual({ ok: true, candidatos: [] });
  });

  it("descarta conductores sin vehiculo activo aunque la consulta ya los filtre", async () => {
    conductorFindMany.mockResolvedValueOnce([conductor({ vehiculos: [] })]);
    const result = await obtenerCandidatos(solicitudId, new Date());
    expect(result).toEqual({ ok: true, candidatos: [] });
  });

  it("propaga fallo de lectura de conductores", async () => {
    const error = new Error("Conductors failure");
    conductorFindMany.mockRejectedValueOnce(error);
    await expect(obtenerCandidatos(solicitudId, new Date())).rejects.toBe(error);
  });
});

describe("obtenerCandidatos: exclusion por lista optativa (excluirIds)", () => {
  it("sin lista de exclusion consulta sin filtro de id (comportamiento de SPEC 09)", async () => {
    await obtenerCandidatos(solicitudId, new Date());
    expect(conductorFindMany).toHaveBeenCalledWith(consultaConductores);
  });

  it("con lista vacia se comporta igual que sin lista", async () => {
    await obtenerCandidatos(solicitudId, new Date(), []);
    expect(conductorFindMany).toHaveBeenCalledWith(consultaConductores);
  });

  it("agrega notIn con los ids excluidos cuando la lista no esta vacia", async () => {
    const excluidos = ["11111111-2222-4333-8444-555555555555", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"];
    conductorFindMany.mockResolvedValueOnce([]);
    await obtenerCandidatos(solicitudId, new Date(), excluidos);
    expect(conductorFindMany).toHaveBeenCalledWith({
      ...consultaConductores,
      where: { ...consultaConductores.where, id: { notIn: excluidos } },
    });
  });

  it("no devuelve a un conductor excluido aunque sea el mas cercano", async () => {
    const excluido = conductor({
      id: "11111111-2222-4333-8444-555555555555",
      nombreCompleto: "Cercano",
      ubicaciones: [ubicacionEn(-17.7833, -63.1821)],
    });
    const otro = conductor({
      id: "22222222-3333-4444-8555-666666666666",
      nombreCompleto: "Otro",
      ubicaciones: [ubicacionEn(-17.78, -63.18)],
    });
    const excluir = [excluido.id];
    // El where con notIn filtra en la base; el mock responde solo los restantes.
    conductorFindMany.mockResolvedValueOnce([otro]);
    const result = await obtenerCandidatos(solicitudId, new Date(), excluir);
    expect(conductorFindMany).toHaveBeenCalledWith({
      ...consultaConductores,
      where: { ...consultaConductores.where, id: { notIn: excluir } },
    });
    expect(result).toEqual({
      ok: true,
      candidatos: [esperadoCandidato("22222222-3333-4444-8555-666666666666", "Otro", 0.43)],
    });
  });

  it("excluye a varios conductores a la vez", async () => {
    const a = conductor({
      id: "11111111-2222-4333-8444-555555555555",
      nombreCompleto: "A",
      ubicaciones: [ubicacionEn(-17.78, -63.18)],
    });
    const b = conductor({
      id: "22222222-3333-4444-8555-666666666666",
      nombreCompleto: "B",
      ubicaciones: [ubicacionEn(-17.79, -63.19)],
    });
    const c = conductor({
      id: "33333333-4444-4555-8666-777777777777",
      nombreCompleto: "C",
      ubicaciones: [ubicacionEn(-17.81, -63.21)],
    });
    const excluir = [a.id, b.id];
    // El where con notIn filtra en la base; el mock responde solo el resto.
    conductorFindMany.mockResolvedValueOnce([c]);
    const result = await obtenerCandidatos(solicitudId, new Date(), excluir);
    expect(conductorFindMany).toHaveBeenCalledWith({
      ...consultaConductores,
      where: { ...consultaConductores.where, id: { notIn: excluir } },
    });
    expect(result).toEqual({
      ok: true,
      candidatos: [esperadoCandidato("33333333-4444-4555-8666-777777777777", "C",
        Math.round(distanciaKm(-17.7833, -63.1821, -17.81, -63.21) * 100) / 100)],
    });
  });

  it("excluye sin lista los conductores con rechazo/expiracion registrado (Regla 7/8)", async () => {
    const rechazadoId = "55555555-6666-4777-8888-999999999999";
    rechazadosFindMany.mockResolvedValueOnce([{ conductorId: rechazadoId }]);
    const otro = conductor({ id: "66666666-7777-4888-8999-aaaaaaaaaaaa", nombreCompleto: "Otro" });
    conductorFindMany.mockResolvedValueOnce([otro]);
    const result = await obtenerCandidatos(solicitudId, new Date());
    expect(rechazadosFindMany).toHaveBeenCalledWith({
      where: { solicitudId }, select: { conductorId: true },
    });
    expect(conductorFindMany).toHaveBeenCalledWith({
      ...consultaConductores,
      where: { ...consultaConductores.where, id: { notIn: [rechazadoId] } },
    });
    expect(result).toEqual({
      ok: true,
      candidatos: [esperadoCandidato("66666666-7777-4888-8999-aaaaaaaaaaaa", "Otro", 0.43)],
    });
  });

  it("combina la tabla de rechazos con la lista explicita sin duplicar", async () => {
    const rechazadoId = "55555555-6666-4777-8888-999999999999";
    const explicitoId = "66666666-7777-4888-8999-aaaaaaaaaaaa";
    rechazadosFindMany.mockResolvedValueOnce([{ conductorId: rechazadoId }, { conductorId: explicitoId }]);
    conductorFindMany.mockResolvedValueOnce([]);
    await obtenerCandidatos(solicitudId, new Date(), [explicitoId]);
    expect(conductorFindMany).toHaveBeenCalledWith({
      ...consultaConductores,
      where: { ...consultaConductores.where, id: { notIn: [explicitoId, rechazadoId] } },
    });
  });
});

describe("obtenerCandidatos: vigencia de la ubicacion (Regla 9 via esTemporalmenteValida)", () => {
  it.each([0, 299999, 300000])("conserva con antiguedad %i ms", async (antiguedad) => {
    conductorFindMany.mockResolvedValueOnce([
      conductor({ ubicaciones: [ubicacionEn(-17.7833, -63.1821, antiguedad)] }),
    ]);
    const result = await obtenerCandidatos(solicitudId, new Date());
    expect(result).toEqual({
      ok: true,
      candidatos: [esperadoCandidato("4c3f2b1a-9e8d-4a6b-8c1d-2e3f4a5b6c7d", "Juan Perez", 0)],
    });
  });

  it("descarta con antiguedad 300001 ms aunque esValida este persistida como true", async () => {
    conductorFindMany.mockResolvedValueOnce([
      conductor({ ubicaciones: [ubicacionEn(-17.7833, -63.1821, 300001)] }),
    ]);
    const result = await obtenerCandidatos(solicitudId, new Date());
    expect(result).toEqual({ ok: true, candidatos: [] });
  });

  it("usa el reloj del sistema al pasar now como new Date()", async () => {
    vi.setSystemTime(new Date("2026-09-15T14:04:30.000Z"));
    conductorFindMany.mockResolvedValueOnce([
      conductor({ ubicaciones: [ubicacionEn(-17.7833, -63.1821, 30000)] }),
    ]);
    const result = await obtenerCandidatos(solicitudId, new Date());
    expect(result).toEqual({ ok: true, candidatos: [esperadoCandidato("4c3f2b1a-9e8d-4a6b-8c1d-2e3f4a5b6c7d", "Juan Perez", 0)] });
  });
});

describe("obtenerCandidatos: DTO, orden y top 3 (Regla 4)", () => {
  it("redondea distanciaKm a 2 decimales y no expone campos internos", async () => {
    conductorFindMany.mockResolvedValueOnce([
      conductor({ ubicaciones: [ubicacionEn(-17.78, -63.18)] }),
    ]);
    const result = await obtenerCandidatos(solicitudId, new Date());
    const dto = (result as Extract<ObtenerCandidatosResult, { ok: true }>).candidatos[0];
    expect(dto.distanciaKm * 100).toBe(Math.round(dto.distanciaKm * 100));
    expect(dto).toEqual(esperadoCandidato("4c3f2b1a-9e8d-4a6b-8c1d-2e3f4a5b6c7d", "Juan Perez", 0.43));
    expect(Object.keys(dto)).toEqual(["conductorId", "nombreCompleto", "distanciaKm", "vehiculo"]);
    expect(Object.keys(dto.vehiculo)).toEqual(["placa", "marca", "modelo", "color", "capacidadPasajeros"]);
  });

  it("usa Haversine en la distancia devuelta y ordena de menor a mayor", async () => {
    configuracionFindFirst.mockResolvedValueOnce({ radioMaximoBusquedaKm: 20 });
    const lejano = conductor({
      id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      nombreCompleto: "Lejano",
      ubicaciones: [ubicacionEn(-17.85, -63.28)],
    });
    const cercano = conductor({
      id: "11111111-2222-4333-8444-555555555555",
      nombreCompleto: "Cercano",
      ubicaciones: [ubicacionEn(-17.79, -63.19)],
    });
    const medio = conductor({
      id: "22222222-3333-4444-8555-666666666666",
      nombreCompleto: "Medio",
      ubicaciones: [ubicacionEn(-17.81, -63.21)],
    });
    conductorFindMany.mockResolvedValueOnce([lejano, cercano, medio]);
    const result = await obtenerCandidatos(solicitudId, new Date());
    expect(result).toEqual({
      ok: true,
      candidatos: [
        esperadoCandidato("11111111-2222-4333-8444-555555555555", "Cercano",
          Math.round(distanciaKm(-17.7833, -63.1821, -17.79, -63.19) * 100) / 100),
        esperadoCandidato("22222222-3333-4444-8555-666666666666", "Medio",
          Math.round(distanciaKm(-17.7833, -63.1821, -17.81, -63.21) * 100) / 100),
        esperadoCandidato("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "Lejano",
          Math.round(distanciaKm(-17.7833, -63.1821, -17.85, -63.28) * 100) / 100),
      ],
    });
  });

  it("devuelve como maximo 3 candidatos ordenados por distancia ascendente", async () => {
    const hacer = (id: string, nombre: string, lon: number) => conductor({
      id, nombreCompleto: nombre, ubicaciones: [ubicacionEn(-17.7833, lon)],
    });
    conductorFindMany.mockResolvedValueOnce([
      hacer("11111111-2222-4333-8444-555555555555", "A", -63.185),
      hacer("22222222-3333-4444-8555-666666666666", "B", -63.184),
      hacer("33333333-4444-4555-8666-777777777777", "C", -63.183),
      hacer("44444444-5555-4666-8777-888888888888", "D", -63.182),
    ]);
    const result = await obtenerCandidatos(solicitudId, new Date());
    const candidatos = (result as Extract<ObtenerCandidatosResult, { ok: true }>).candidatos;
    expect(candidatos).toHaveLength(3);
    expect(candidatos.map(({ conductorId }) => conductorId)).toEqual([
      "44444444-5555-4666-8777-888888888888",
      "33333333-4444-4555-8666-777777777777",
      "22222222-3333-4444-8555-666666666666",
    ]);
  });

  it("devuelve lista vacia cuando no hay elegibles", async () => {
    conductorFindMany.mockResolvedValueOnce([]);
    const result = await obtenerCandidatos(solicitudId, new Date());
    expect(result).toEqual({ ok: true, candidatos: [] });
  });

  it("expone el vehiculo mas reciente con placa", async () => {
    const moto = { ...vehiculo, placa: "9999XYZ", marca: "Honda", modelo: "Wave" };
    conductorFindMany.mockResolvedValueOnce([conductor({ vehiculos: [moto] })]);
    const result = await obtenerCandidatos(solicitudId, new Date());
    expect(result).toEqual({
      ok: true,
      candidatos: [esperadoCandidato("4c3f2b1a-9e8d-4a6b-8c1d-2e3f4a5b6c7d", "Juan Perez", 0.43, moto)],
    });
  });
});