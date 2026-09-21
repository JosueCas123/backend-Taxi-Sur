import { describe, expect, it } from "vitest";
import {
  crearSolicitudSchema, finalizarSolicitudSchema, responderSolicitudSchema,
  seleccionarConductorSchema, sinConductorSolicitudSchema, solicitudDetalleDtoSchema,
  solicitudDtoSchema, solicitudIdSchema,
  type SolicitudDetalleDto, type SolicitudDto,
} from "../src/modules/solicitudes/solicitudes.schema";

const solicitudId = "7a1f2c4e-0000-4000-8000-000000000000";

const crearValido = {
  pasajeroId: "d9428888-122b-4e1f-b85c-61cd3cbb3210",
  latitudRecogida: -17.7833,
  longitudRecogida: -63.1821,
};

const solicitud: SolicitudDto = {
  id: "7a1f2c4e-0000-4000-8000-000000000000",
  pasajeroId: "d9428888-122b-4e1f-b85c-61cd3cbb3210",
  conductorAsignadoId: null,
  estado: "buscando",
  latitudRecogida: -17.7833,
  longitudRecogida: -63.1821,
  destino: "Plaza 24 de Septiembre",
  expiraEn: null,
  aceptadaEn: null,
  finalizadaEn: null,
  creadoEn: "2026-09-16T12:00:00.000Z",
};

const detalle: SolicitudDetalleDto = {
  ...solicitud,
  pasajero: { id: solicitud.pasajeroId, nombre: "Ana Perez" },
  conductorAsignado: {
    id: "8e7acf6d-0e5b-4e6a-9f2a-1c2b3d4e5f60",
    nombreCompleto: "Juan Perez",
    vehiculo: {
      placa: "1234ABC", marca: "Toyota", modelo: "Corolla", color: "Blanco", capacidadPasajeros: 4,
    },
  },
};

describe("UUID de ruta para posterior respuesta 404", () => {
  it.each([solicitudId, solicitudId.toUpperCase(), "00000000-0000-0000-0000-000000000000"])(
    "acepta formato hexadecimal existente sin transformar %s", (id) => {
      expect(solicitudIdSchema.parse(id)).toBe(id);
    },
  );

  it.each([
    "", "no-uuid", "42", solicitudId.replaceAll("-", ""),
    ` ${solicitudId}`, `${solicitudId} `, `${solicitudId}\n`, solicitudId.replace("7", "g"),
    null, undefined, 42, [], {},
  ])("rechaza id %j con safeParse", (id) => {
    expect(solicitudIdSchema.safeParse(id).success).toBe(false);
  });
});

describe("crear solicitud (POST /api/solicitudes)", () => {
  it("acepta el contrato minimo completo", () => {
    expect(crearSolicitudSchema.parse(crearValido)).toEqual(crearValido);
  });

  it("acepta destino con recorte de espacios exteriores", () => {
    expect(crearSolicitudSchema.parse({ ...crearValido, destino: "  Plaza 24 de Septiembre  " }))
      .toEqual({ ...crearValido, destino: "Plaza 24 de Septiembre" });
  });

  it.each(["pasajeroId", "latitudRecogida", "longitudRecogida"])("exige %s", (field) => {
    const body: Record<string, unknown> = { ...crearValido };
    delete body[field];
    expect(crearSolicitudSchema.safeParse(body).success).toBe(false);
  });

  it.each([
    undefined, null, [], [crearValido], "texto", 42, true, {},
  ])("rechaza cuerpo %j", (body) => {
    expect(crearSolicitudSchema.safeParse(body).success).toBe(false);
  });

  it.each([
    { pasajeroId: "no-uuid" }, { pasajeroId: 42 }, { pasajeroId: null },
    { latitudRecogida: Number.NaN }, { latitudRecogida: Number.POSITIVE_INFINITY }, { latitudRecogida: "x" },
    { longitudRecogida: Number.NaN }, { longitudRecogida: Number.NEGATIVE_INFINITY },
  ])("rechaza tipos o formatos invalidos %j", (change) => {
    expect(crearSolicitudSchema.safeParse({ ...crearValido, ...change }).success).toBe(false);
  });

  it.each([
    { latitudRecogida: -90 }, { latitudRecogida: 90 }, { longitudRecogida: -180 }, { longitudRecogida: 180 },
  ])("acepta limites inclusivos %j", (cambio) => {
    expect(crearSolicitudSchema.safeParse({ ...crearValido, ...cambio }).success).toBe(true);
  });

  it.each([
    { latitudRecogida: -90.01 }, { latitudRecogida: 90.01 },
    { longitudRecogida: -180.01 }, { longitudRecogida: 180.01 },
  ])("rechaza fuera de rango %j", (cambio) => {
    expect(crearSolicitudSchema.safeParse({ ...crearValido, ...cambio }).success).toBe(false);
  });

  it.each(["", "   ", 42, null, ["Plaza"]])("rechaza destino %j", (destino) => {
    expect(crearSolicitudSchema.safeParse({ ...crearValido, destino }).success).toBe(false);
  });

  it("acepta destino ausente (opcional)", () => {
    expect(crearSolicitudSchema.safeParse(crearValido).success).toBe(true);
  });

  it("recorta el destino a 255 chars antes de validar el maximo", () => {
    expect(crearSolicitudSchema.safeParse({ ...crearValido, destino: ` ${"a".repeat(255)} ` }).success).toBe(true);
    expect(crearSolicitudSchema.safeParse({ ...crearValido, destino: ` ${"a".repeat(256)} ` }).success).toBe(false);
  });

  it.each(["estado", "conductorAsignadoId", "expiraEn", "creadoEn", "eliminadoEn", "extra"])(
    "rechaza campo adicional %s", (field) => {
      for (const value of [solicitud.creadoEn, null, undefined]) {
        expect(crearSolicitudSchema.safeParse({ ...crearValido, [field]: value }).success).toBe(false);
      }
    },
  );
});

describe("seleccionar conductor (POST /:id/seleccionar-conductor)", () => {
  it("acepta el contrato completo", () => {
    const body = { conductorId: "8e7acf6d-0e5b-4e6a-9f2a-1c2b3d4e5f60" };
    expect(seleccionarConductorSchema.parse(body)).toEqual(body);
  });

  it.each([null, undefined, 42, [], {}, "no-uuid"])("rechaza conductorId %j", (conductorId) => {
    expect(seleccionarConductorSchema.safeParse({ conductorId }).success).toBe(false);
  });

  it.each(["extra", "solicitudId"])("rechaza campo adicional %s", (field) => {
    expect(seleccionarConductorSchema.safeParse({ conductorId: solicitudId, [field]: null }).success).toBe(false);
  });
});

describe("responder solicitud (POST /:id/responder)", () => {
  it.each([true, false])("acepta booleano estricto %s", (acepta) => {
    expect(responderSolicitudSchema.parse({ acepta })).toEqual({ acepta });
  });

  it.each(["true", "false", 1, 0, null, undefined, [], "si"])("rechaza %j como acepta", (acepta) => {
    expect(responderSolicitudSchema.safeParse({ acepta }).success).toBe(false);
  });

  it.each([{}, { extra: 1 }])("rechaza cuerpo sin acepta o con extras %j", (body) => {
    expect(responderSolicitudSchema.safeParse(body).success).toBe(false);
  });
});

describe("finalizar y sin-conductor (cuerpo opcional vacio)", () => {
  it.each([finalizarSolicitudSchema, sinConductorSolicitudSchema])("acepta ausencia o {}", (schema) => {
    expect(schema.safeParse(undefined).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(true);
  });

  it.each([finalizarSolicitudSchema, sinConductorSolicitudSchema])("rechaza cuerpo %j", (schema) => {
    for (const body of [null, [], [{}], "", "texto", 0, false, { extra: undefined }, { motivo: "x" }]) {
      expect(schema.safeParse(body).success).toBe(false);
    }
  });
});

describe("DTO explicito de solicitud", () => {
  it("acepta el contrato completo de la seccion 3.4", () => {
    expect(solicitudDtoSchema.parse(solicitud)).toEqual(solicitud);
  });

  it.each(["id", "pasajeroId", "conductorAsignadoId", "estado", "latitudRecogida",
    "longitudRecogida", "destino", "expiraEn", "aceptadaEn", "finalizadaEn", "creadoEn"])(
  "exige %s", (field) => {
    const body: Record<string, unknown> = { ...solicitud };
    delete body[field];
    expect(solicitudDtoSchema.safeParse(body).success).toBe(false);
  });

  it.each(["eliminadoEn", "usuarioId", "pasajero", "conductorAsignado", "extra"])(
    "rechaza campo interno %s", (field) => {
      expect(solicitudDtoSchema.safeParse({ ...solicitud, [field]: null }).success).toBe(false);
    },
  );

  it.each([null, "8e7acf6d-0e5b-4e6a-9f2a-1c2b3d4e5f60"])("acepta conductorAsignadoId %j", (id) => {
    expect(solicitudDtoSchema.safeParse({ ...solicitud, conductorAsignadoId: id }).success).toBe(true);
  });

  it.each(["creadoEn", "expiraEn", "aceptadaEn", "finalizadaEn"])("exige ISO UTC serializado en %s", (field) => {
    for (const value of ["2026-09-16", "2026-09-16T12:00:00", "2026-09-16T12:00:00+02:00", new Date(), "invalido"]) {
      expect(solicitudDtoSchema.safeParse({ ...solicitud, [field]: value }).success).toBe(false);
    }
  });

  it.each(["buscando", "esperando_respuesta", "en_servicio", "finalizada", "sin_conductor", "expirada", "rechazada"])(
    "acepta estado %s", (estado) => {
      expect(solicitudDtoSchema.safeParse({ ...solicitud, estado }).success).toBe(true);
    },
  );

  it("rechaza un estado inexistente", () => {
    expect(solicitudDtoSchema.safeParse({ ...solicitud, estado: "pagada" }).success).toBe(false);
    expect(solicitudDtoSchema.safeParse({ ...solicitud, estado: null }).success).toBe(false);
  });

  it("rechaza tipos o formatos invalidos de coordenadas", () => {
    for (const cambio of [
      { latitudRecogida: Number.NaN }, { latitudRecogida: 91 }, { latitudRecogida: -91 },
      { longitudRecogida: Number.POSITIVE_INFINITY }, { longitudRecogida: 181 }, { longitudRecogida: -181 },
    ]) {
      expect(solicitudDtoSchema.safeParse({ ...solicitud, ...cambio }).success).toBe(false);
    }
  });
});

describe("DTO de detalle (GET /:id)", () => {
  it("acepta el detalle completo sin telefono", () => {
    expect(solicitudDetalleDtoSchema.parse(detalle)).toEqual(detalle);
  });

  it("acepta conductorAsignado null cuando no hay conductor", () => {
    const body = { ...detalle, conductorAsignado: null };
    expect(solicitudDetalleDtoSchema.parse(body)).toEqual(body);
  });

  it("acepta conductorAsignado con vehiculo null", () => {
    const body = {
      ...detalle,
      conductorAsignado: { ...detalle.conductorAsignado!, vehiculo: null },
    };
    expect(solicitudDetalleDtoSchema.parse(body)).toEqual(body);
  });

  it("omite telefono sin permitirlo ni en conductorAsignado", () => {
    const conTelefono = { ...detalle, conductorAsignado: { ...detalle.conductorAsignado!, telefono: "+59170000000" } };
    expect(solicitudDetalleDtoSchema.safeParse(conTelefono).success).toBe(false);
  });

  it("rechaza campos internos en pasajero y conductorAsignado", () => {
    const conUsuario = { ...detalle, pasajero: { ...detalle.pasajero, eliminadoEn: null } };
    expect(solicitudDetalleDtoSchema.safeParse(conUsuario).success).toBe(false);
    const conUsuarioId = { ...detalle, conductorAsignado: { ...detalle.conductorAsignado!, usuarioId: "x" } };
    expect(solicitudDetalleDtoSchema.safeParse(conUsuarioId).success).toBe(false);
  });

  it("exige pasajero y conductorAsignado", () => {
    expect(solicitudDetalleDtoSchema.safeParse({ ...detalle, pasajero: undefined }).success).toBe(false);
    expect(solicitudDetalleDtoSchema.safeParse({ ...detalle, conductorAsignado: undefined }).success).toBe(false);
  });

  it.each(["placa", "marca", "modelo", "color", "capacidadPasajeros"] as const)(
    "exige %s en el vehiculo del conductor asignado",
    (campo) => {
      const base = structuredClone(detalle);
      const vehiculo = base.conductorAsignado!.vehiculo! as Record<string, unknown>;
      delete vehiculo[campo];
      expect(solicitudDetalleDtoSchema.safeParse(base).success).toBe(false);
    },
  );

  it("rechaza extras en los objetos anidados", () => {
    expect(solicitudDetalleDtoSchema.safeParse({
      ...detalle,
      conductorAsignado: { ...detalle.conductorAsignado!, vehiculo: { ...detalle.conductorAsignado!.vehiculo!, id: "x" } },
    }).success).toBe(false);
    expect(solicitudDetalleDtoSchema.safeParse({
      ...detalle,
      pasajero: { ...detalle.pasajero, telefono: "+59170000000" },
    }).success).toBe(false);
  });
});