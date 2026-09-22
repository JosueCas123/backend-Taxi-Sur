import { EstadoConductor, EstadoDisponibilidad, EstadoJornada, EstadoSolicitud } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  dashboardQuerySchema, indicadoresDtoSchema, mapaConductorDtoSchema,
  solicitudActivaDtoSchema,
  type IndicadoresDto, type MapaConductorDto, type SolicitudActivaDto,
} from "../src/modules/dashboard/dashboard.schema";
import { estadoSolicitudSchema } from "../src/modules/solicitudes/solicitudes.schema";

const mapa: MapaConductorDto = {
  id: "8e7acf6d-0e5b-4e6a-9f2a-1c2b3d4e5f60",
  nombreCompleto: "Juan Perez",
  estado: "suspendido",
  estadoJornada: "finalizada",
  estadoDisponibilidad: "disponible",
  vehiculo: { placa: "1234ABC", marca: "Toyota", modelo: "Corolla", color: "Blanco" },
  ubicacion: { latitud: -17.7833, longitud: -63.1821, horaRegistro: "2026-09-21T14:00:00.000Z" },
  ultimaUbicacionRegistradaEn: "2026-09-21T14:00:00.000Z",
};

const activa: SolicitudActivaDto = {
  id: "7a1f2c4e-0000-4000-8000-000000000000",
  estado: "buscando",
  pasajero: { id: "d9428888-122b-4e1f-b85c-61cd3cbb3210", nombre: "Ana Perez" },
  conductorAsignado: null,
  latitudRecogida: -17.7833,
  longitudRecogida: -63.1821,
  destino: "Terminal",
  expiraEn: null,
  creadoEn: "2026-09-21T14:00:00.000Z",
};

describe("mapaConductorDtoSchema", () => {
  it.each([
    ["con vehiculo y ubicacion", mapa],
    ["con vehiculo y sin ubicacion", { ...mapa, ubicacion: null, ultimaUbicacionRegistradaEn: null }],
    ["sin vehiculo ni ubicacion", {
      ...mapa, vehiculo: null, ubicacion: null, ultimaUbicacionRegistradaEn: null,
    }],
    ["con ultima ubicacion y ubicacion nula", { ...mapa, ubicacion: null }],
  ])("acepta un conductor no eliminado %s", (_nombre, conductor) => {
    expect(mapaConductorDtoSchema.parse(conductor)).toEqual(conductor);
  });

  it.each([
    ["estado", EstadoConductor], ["estadoJornada", EstadoJornada], ["estadoDisponibilidad", EstadoDisponibilidad],
  ] as const)("usa todos los valores Prisma de %s", (field, values) => {
    for (const value of Object.values(values)) {
      expect(mapaConductorDtoSchema.safeParse({ ...mapa, [field]: value }).success).toBe(true);
    }
    expect(mapaConductorDtoSchema.safeParse({ ...mapa, [field]: "desconocido" }).success).toBe(false);
  });

  it.each(["telefono", "cedulaIdentidad", "usuarioId", "creadoEn", "eliminadoEn", "esValida"])(
    "rechaza campo no publicado %s", (field) => {
      expect(mapaConductorDtoSchema.safeParse({ ...mapa, [field]: "privado" }).success).toBe(false);
    },
  );

  it("rechaza estadoVisual calculado", () => {
    expect(mapaConductorDtoSchema.safeParse({ ...mapa, estadoVisual: "online" }).success).toBe(false);
  });

  it.each(Object.keys(mapa))("exige %s", (field) => {
    const body: Record<string, unknown> = { ...mapa };
    delete body[field];
    expect(mapaConductorDtoSchema.safeParse(body).success).toBe(false);
  });

  it("exige UUID en id", () => {
    expect(mapaConductorDtoSchema.safeParse({ ...mapa, id: "no-uuid" }).success).toBe(false);
  });

  it.each(["2026-09-21", "2026-09-21T14:00:00", "2026-09-21T14:00:00+02:00", new Date(), "invalido"])(
    "exige instante ISO UTC en ultimaUbicacionRegistradaEn %j", (hora) => {
      expect(mapaConductorDtoSchema.safeParse({ ...mapa, ultimaUbicacionRegistradaEn: hora }).success).toBe(false);
    },
  );

  it("vehiculo es estricto y sin id ni capacidad", () => {
    expect(mapaConductorDtoSchema.safeParse({ ...mapa, vehiculo: { ...mapa.vehiculo, id: "x" } }).success).toBe(false);
    expect(mapaConductorDtoSchema.safeParse(
      { ...mapa, vehiculo: { ...mapa.vehiculo!, capacidadPasajeros: 4 } },
    ).success).toBe(false);
    expect(mapaConductorDtoSchema.safeParse({ ...mapa, vehiculo: { placa: "x" } }).success).toBe(false);
  });

  it("ubicacion es estricta sin id ni esValida", () => {
    expect(mapaConductorDtoSchema.safeParse({ ...mapa, ubicacion: { ...mapa.ubicacion!, id: "1" } }).success)
      .toBe(false);
    expect(mapaConductorDtoSchema.safeParse({ ...mapa, ubicacion: { ...mapa.ubicacion!, esValida: true } }).success)
      .toBe(false);
  });

  it("valida los limites GPS de la ubicacion", () => {
    for (const ubicacion of [
      { ...mapa.ubicacion!, latitud: 90.1 },
      { ...mapa.ubicacion!, latitud: -90.1 },
      { ...mapa.ubicacion!, longitud: 180.1 },
      { ...mapa.ubicacion!, longitud: -180.1 },
    ]) {
      expect(mapaConductorDtoSchema.safeParse({ ...mapa, ubicacion }).success).toBe(false);
    }
    expect(mapaConductorDtoSchema.safeParse({ ...mapa, ubicacion: {
      ...mapa.ubicacion!, horaRegistro: "2026-09-21",
    } }).success).toBe(false);
  });
});

describe("solicitudActivaDtoSchema", () => {
  it("acepta una solicitud activa con conductor asignado", () => {
    const body = {
      ...activa,
      conductorAsignado: { id: "4c3f2b1a-9e8d-4a6b-8c1d-2e3f4a5b6c7d", nombreCompleto: "Carlos Rios" },
    };
    expect(solicitudActivaDtoSchema.parse(body)).toEqual(body);
  });

  it.each([null, { id: "d9428888-122b-4e1f-b85c-61cd3cbb3210", nombre: "Ana Perez" }])(
    "pasajero nulo o resumen valido %j", (pasajero) => {
      expect(solicitudActivaDtoSchema.parse({ ...activa, pasajero })).toEqual({ ...activa, pasajero });
    },
  );

  it.each(Object.values(EstadoSolicitud))("usa el enum Prisma %s", (estado) => {
    expect(solicitudActivaDtoSchema.safeParse({ ...activa, estado }).success).toBe(true);
  });

  it("rechaza un estado inventado", () => {
    expect(solicitudActivaDtoSchema.safeParse({ ...activa, estado: "pendiente" }).success).toBe(false);
  });

  it("el enum de solicitudes conserva la misma representacion que el schema existente", () => {
    expect(Object.values(EstadoSolicitud)).toEqual(estadoSolicitudSchema.options);
  });

  it.each(["pasajeroId", "conductorAsignadoId", "aceptadaEn", "finalizadaEn", "telefono", "creadoPor"])(
    "rechaza campo no publicado %s", (field) => {
      expect(solicitudActivaDtoSchema.safeParse({ ...activa, [field]: "privado" }).success).toBe(false);
    },
  );

  it.each(Object.keys(activa))("exige %s", (field) => {
    const body: Record<string, unknown> = { ...activa };
    delete body[field];
    expect(solicitudActivaDtoSchema.safeParse(body).success).toBe(false);
  });

  it("conductorAsignado resumen es estricto", () => {
    expect(solicitudActivaDtoSchema.safeParse({ ...activa, conductorAsignado: {
      id: "4c3f2b1a-9e8d-4a6b-8c1d-2e3f4a5b6c7d", nombreCompleto: "Carlos Rios", telefono: "0991234567",
    } }).success).toBe(false);
    expect(solicitudActivaDtoSchema.safeParse({ ...activa, conductorAsignado: {
      id: "4c3f2b1a-9e8d-4a6b-8c1d-2e3f4a5b6c7d", nombreCompleto: "Carlos Rios", vehiculo: null,
    } }).success).toBe(false);
  });

  it("valida los limites de las coordenadas de recogida", () => {
    for (const body of [
      { ...activa, latitudRecogida: 90.1 },
      { ...activa, latitudRecogida: -90.1 },
      { ...activa, longitudRecogida: 180.1 },
      { ...activa, longitudRecogida: -180.1 },
    ]) {
      expect(solicitudActivaDtoSchema.safeParse(body).success).toBe(false);
    }
  });

  it.each(["2026-09-21", "2026-09-21T14:00:00", "2026-09-21T14:00:00+02:00", new Date(), "invalido"])(
    "exige instante ISO UTC en creadoEn %j", (creadoEn) => {
      expect(solicitudActivaDtoSchema.safeParse({ ...activa, creadoEn }).success).toBe(false);
    },
  );

  it.each([null, "2026-09-21T14:05:00.000Z"])("expiraEn nullable o instante valido %j", (expiraEn) => {
    expect(solicitudActivaDtoSchema.parse({ ...activa, expiraEn })).toEqual({ ...activa, expiraEn });
  });
});

describe("indicadoresDtoSchema", () => {
  const zeros: IndicadoresDto = {
    conductoresDisponibles: 0, conductoresEnServicio: 0, solicitudesActivas: 0, solicitudesCompletadasHoy: 0,
  };

  it("acepta los cuatro conteos en cero", () => {
    expect(indicadoresDtoSchema.parse(zeros)).toEqual(zeros);
  });

  it("acepta enteros grandes no negativos", () => {
    const body: IndicadoresDto = {
      conductoresDisponibles: 0, conductoresEnServicio: 0, solicitudesActivas: 0, solicitudesCompletadasHoy: 0,
    };
    for (const field of Object.keys(body) as (keyof IndicadoresDto)[]) {
      expect(indicadoresDtoSchema.parse({ ...body, [field]: 2_000_000 })[field]).toBe(2_000_000);
    }
  });

  it.each(Object.keys(zeros) as (keyof IndicadoresDto)[])("exige %s", (field) => {
    const body: Record<string, unknown> = { ...zeros };
    delete body[field];
    expect(indicadoresDtoSchema.safeParse(body).success).toBe(false);
  });

  it.each([-1, 1.5, "3", true, null, [], {}, NaN, Infinity])("rechaza conteo no entero no negativo %j", (value) => {
    for (const field of Object.keys(zeros) as (keyof IndicadoresDto)[]) {
      expect(indicadoresDtoSchema.safeParse({ ...zeros, [field]: value }).success).toBe(false);
    }
  });

  it("rechaza campos desconocidos", () => {
    expect(indicadoresDtoSchema.safeParse({ ...zeros, totalSolicitudes: 1 }).success).toBe(false);
  });
});

describe("dashboardQuerySchema", () => {
  it("acepta la query vacia", () => {
    expect(dashboardQuerySchema.parse({})).toEqual({});
  });

  it.each(["pagina", "estado", "ids", "activas", "desde", "hasta"])("rechaza query no vacia %s", (param) => {
    expect(dashboardQuerySchema.safeParse({ [param]: "1" }).success).toBe(false);
  });

  it.each([null, undefined, [], "texto", 42])("rechaza query de tipo invalido %j", (query) => {
    expect(dashboardQuerySchema.safeParse(query).success).toBe(false);
  });
});