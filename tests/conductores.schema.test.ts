import { EstadoConductor, EstadoDisponibilidad, EstadoJornada } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  conductorDetalleDtoSchema, conductorRegistroSchema, conductoresFiltroSchema,
  listadoConductorDtoSchema, vehiculoDtoSchema, vehiculoUpdateSchema,
  type ConductorDetalleDto, type ConductorRegistroInput, type ListadoConductorDto,
} from "../src/modules/conductores/conductores.schema";

const vehiculo = { placa: "ABC-123", marca: "Toyota", modelo: "Corolla", color: "Blanco", capacidadPasajeros: 4 };
const registro: ConductorRegistroInput = {
  telefono: "0991234567", pin: "1234", nombreCompleto: "Ana Perez", cedulaIdentidad: "CI-123", vehiculo,
};
const detalle: ConductorDetalleDto = {
  id: "00000000-0000-4000-8000-000000000001",
  usuarioId: "00000000-0000-4000-8000-000000000002",
  telefono: registro.telefono, nombreCompleto: registro.nombreCompleto, cedulaIdentidad: registro.cedulaIdentidad,
  estado: "pendiente", estadoJornada: "no_iniciada", estadoDisponibilidad: "no_disponible",
  creadoEn: "2026-09-12T00:00:00.000Z",
  vehiculo: { ...vehiculo, id: "00000000-0000-4000-8000-000000000003" },
};

describe("registro estricto de conductor", () => {
  it.each(["0000", "12345", "123456"])("acepta PIN numerico %s sin transformarlo", (pin) => {
    expect(conductorRegistroSchema.parse({ ...registro, pin })).toEqual({ ...registro, pin });
  });

  it.each(["", "123", "1234567", "abcd", "12.34", "-1234", " 1234", "1234 ", "1234\n", 1234, null])(
    "rechaza PIN invalido %j", (pin) => {
      expect(conductorRegistroSchema.safeParse({ ...registro, pin }).success).toBe(false);
    },
  );

  it.each([null, undefined, [], "texto", 42, {}])("rechaza cuerpo invalido %j", (body) => {
    expect(conductorRegistroSchema.safeParse(body).success).toBe(false);
  });

  it.each(Object.keys(registro))("exige el campo %s", (field) => {
    const body: Record<string, unknown> = { ...registro };
    delete body[field];
    expect(conductorRegistroSchema.safeParse(body).success).toBe(false);
  });

  it.each(["rol", "estado", "usuarioId", "hashContrasena", "extra"])("rechaza campo extra %s", (field) => {
    expect(conductorRegistroSchema.safeParse({ ...registro, [field]: "no permitido" }).success).toBe(false);
  });

  it.each([
    ["telefono", 30], ["nombreCompleto", 100], ["cedulaIdentidad", 50],
  ] as const)("valida limites, tipos y recorte de %s", (field, max) => {
    for (const value of ["x", "x".repeat(max)]) {
      expect(conductorRegistroSchema.parse({ ...registro, [field]: `  ${value}  ` })[field]).toBe(value);
    }
    for (const value of ["", "   ", "x".repeat(max + 1), 1, null, [], {}]) {
      expect(conductorRegistroSchema.safeParse({ ...registro, [field]: value }).success).toBe(false);
    }
  });
});

describe("vehiculo en registro y PATCH", () => {
  it.each(["placa", "marca", "modelo", "color"] as const)("valida limites y recorta %s", (field) => {
    for (const value of ["x", "x".repeat(30)]) {
      expect(vehiculoUpdateSchema.parse({ [field]: ` ${value} ` })).toEqual({ [field]: value });
      expect(conductorRegistroSchema.parse({ ...registro, vehiculo: { ...vehiculo, [field]: ` ${value} ` } })
        .vehiculo[field]).toBe(value);
    }
    for (const value of ["", "   ", "x".repeat(31), 42, null, [], {}]) {
      expect(vehiculoUpdateSchema.safeParse({ [field]: value }).success).toBe(false);
      expect(conductorRegistroSchema.safeParse({ ...registro, vehiculo: { ...vehiculo, [field]: value } }).success)
        .toBe(false);
    }
  });

  it.each([1, 100])("acepta capacidad limite %d", (capacidadPasajeros) => {
    expect(vehiculoUpdateSchema.parse({ capacidadPasajeros })).toEqual({ capacidadPasajeros });
    expect(conductorRegistroSchema.safeParse({ ...registro, vehiculo: { ...vehiculo, capacidadPasajeros } }).success)
      .toBe(true);
  });

  it.each([0, 101, -1, 1.5, "4", null, true, NaN, Infinity])("rechaza capacidad %j sin coercion", (capacidadPasajeros) => {
    expect(vehiculoUpdateSchema.safeParse({ capacidadPasajeros }).success).toBe(false);
    expect(conductorRegistroSchema.safeParse({ ...registro, vehiculo: { ...vehiculo, capacidadPasajeros } }).success)
      .toBe(false);
  });

  it.each([null, undefined, [], "texto", {}])("registro exige vehiculo completo %j", (value) => {
    expect(conductorRegistroSchema.safeParse({ ...registro, vehiculo: value }).success).toBe(false);
  });

  it.each(Object.keys(vehiculo))("registro exige vehiculo.%s y PATCH permite actualizarlo solo", (field) => {
    const incomplete: Record<string, unknown> = { ...vehiculo };
    delete incomplete[field];
    expect(conductorRegistroSchema.safeParse({ ...registro, vehiculo: incomplete }).success).toBe(false);
    const partial = { [field]: vehiculo[field as keyof typeof vehiculo] };
    expect(vehiculoUpdateSchema.parse(partial)).toEqual(partial);
  });

  it.each(["id", "conductorId", "eliminadoEn", "extra"])("rechaza vehiculo.%s desconocido en ambos contratos", (field) => {
    const body = { ...vehiculo, [field]: "no permitido" };
    expect(vehiculoUpdateSchema.safeParse(body).success).toBe(false);
    expect(conductorRegistroSchema.safeParse({ ...registro, vehiculo: body }).success).toBe(false);
  });

  it.each([{}, { placa: undefined }, null, undefined, [], "texto"])("PATCH exige algun valor definido %j", (body) => {
    expect(vehiculoUpdateSchema.safeParse(body).success).toBe(false);
  });

  it("PATCH acepta todos los campos y no agrega omitidos", () => {
    expect(vehiculoUpdateSchema.parse(vehiculo)).toEqual(vehiculo);
    expect(vehiculoUpdateSchema.parse({ color: " Negro " })).toEqual({ color: "Negro" });
  });
});

describe("filtro de estado", () => {
  it("permite omitir el filtro sin asignar un estado", () => {
    expect(conductoresFiltroSchema.parse({})).toEqual({});
  });

  it.each(Object.values(EstadoConductor))("acepta enum Prisma %s", (estado) => {
    expect(conductoresFiltroSchema.parse({ estado })).toEqual({ estado });
  });

  it.each(["", "activo", "APROBADO", " pendiente ", ["pendiente"], {}, null, 1])("rechaza estado %j", (estado) => {
    expect(conductoresFiltroSchema.safeParse({ estado }).success).toBe(false);
  });

  it("rechaza filtros desconocidos", () => {
    expect(conductoresFiltroSchema.safeParse({ estado: "pendiente", extra: "x" }).success).toBe(false);
  });
});

describe("DTOs estrictos", () => {
  it("valida detalle y listado sin usuarioId, con vehiculo o null", () => {
    for (const vehiculo of [detalle.vehiculo, null]) {
      const body = { ...detalle, vehiculo };
      expect(conductorDetalleDtoSchema.parse(body)).toEqual(body);
      const { usuarioId, ...listado }: ConductorDetalleDto = body;
      const dto: ListadoConductorDto = listadoConductorDtoSchema.parse(listado);
      expect(dto).toEqual(listado);
      expect(listadoConductorDtoSchema.safeParse({ ...dto, usuarioId }).success).toBe(false);
    }
    expect(vehiculoDtoSchema.parse(detalle.vehiculo)).toEqual(detalle.vehiculo);
  });

  it.each([
    ["estado", EstadoConductor], ["estadoJornada", EstadoJornada], ["estadoDisponibilidad", EstadoDisponibilidad],
  ] as const)("usa todos los valores Prisma de %s", (field, values) => {
    for (const value of Object.values(values)) {
      expect(conductorDetalleDtoSchema.safeParse({ ...detalle, [field]: value }).success).toBe(true);
    }
    expect(conductorDetalleDtoSchema.safeParse({ ...detalle, [field]: "desconocido" }).success).toBe(false);
  });

  it.each(["pin", "hashContrasena", "usuario", "eliminadoEn"])("rechaza campo no publicado %s", (field) => {
    expect(conductorDetalleDtoSchema.safeParse({ ...detalle, [field]: "privado" }).success).toBe(false);
  });

  it.each(Object.keys(detalle))("detalle exige %s", (field) => {
    const body: Record<string, unknown> = { ...detalle };
    delete body[field];
    expect(conductorDetalleDtoSchema.safeParse(body).success).toBe(false);
  });

  it.each(["id", "usuarioId"])("exige UUID en %s", (field) => {
    expect(conductorDetalleDtoSchema.safeParse({ ...detalle, [field]: "no-uuid" }).success).toBe(false);
  });

  it.each(["2026-09-12", "2026-09-12T00:00:00", "2026-09-12T00:00:00+02:00", new Date(), "invalido"])(
    "exige fecha ISO UTC serializada %j", (creadoEn) => {
      expect(conductorDetalleDtoSchema.safeParse({ ...detalle, creadoEn }).success).toBe(false);
    },
  );

  it.each([{ id: "no-uuid" }, { capacidadPasajeros: 1.5 }, { capacidadPasajeros: "4" }, { eliminadoEn: null }])(
    "valida el vehiculo anidado %j", (change) => {
      expect(conductorDetalleDtoSchema.safeParse({ ...detalle, vehiculo: { ...detalle.vehiculo, ...change } }).success)
        .toBe(false);
    },
  );
});
