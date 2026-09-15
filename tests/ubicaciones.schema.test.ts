import { describe, expect, it } from "vitest";
import {
  conductorIdSchema, ubicacionDtoSchema, ubicacionRegistroSchema,
  type UbicacionConductorDto, type UbicacionRegistroInput,
} from "../src/modules/ubicaciones/ubicaciones.schema";

const coordenadas: UbicacionRegistroInput = { latitud: -17.7833, longitud: -63.1821 };
const dto: UbicacionConductorDto = {
  id: "42",
  ...coordenadas,
  horaRegistro: "2026-09-15T14:00:00.000Z",
  esValida: true,
};

describe("registro estricto de coordenadas", () => {
  it.each([
    { latitud: 90, longitud: 180 },
    { latitud: -90, longitud: -180 },
    { latitud: 0, longitud: 0 },
    coordenadas,
  ])("acepta coordenadas dentro del rango %j", (body) => {
    expect(ubicacionRegistroSchema.parse(body)).toEqual(body);
  });

  it.each([
    { latitud: 90.0001, longitud: 0 },
    { latitud: -90.0001, longitud: 0 },
    { latitud: 0, longitud: 180.0001 },
    { latitud: 0, longitud: -180.0001 },
    { latitud: 1000, longitud: 0 },
    { latitud: 0, longitud: 1000 },
  ])("rechaza coordenadas fuera de rango %j", (body) => {
    expect(ubicacionRegistroSchema.safeParse(body).success).toBe(false);
  });

  it.each([
    { latitud: Number.NaN, longitud: 0 },
    { latitud: Number.POSITIVE_INFINITY, longitud: 0 },
    { latitud: Number.NEGATIVE_INFINITY, longitud: 0 },
    { latitud: 0, longitud: Number.NaN },
    { latitud: 0, longitud: Number.POSITIVE_INFINITY },
    { latitud: 0, longitud: Number.NEGATIVE_INFINITY },
  ])("rechaza coordenadas no finitas %j", (body) => {
    expect(ubicacionRegistroSchema.safeParse(body).success).toBe(false);
  });

  it.each([
    { latitud: "-17.7833", longitud: -63.1821 },
    { latitud: -17.7833, longitud: "-63.1821" },
    { latitud: true, longitud: 0 },
    { latitud: 0, longitud: false },
    { latitud: null, longitud: 0 },
    { latitud: 0, longitud: null },
    { latitud: [1], longitud: 0 },
    { latitud: 0, longitud: [1] },
    { latitud: { value: 1 }, longitud: 0 },
    { latitud: 0, longitud: { value: 1 } },
  ])("rechaza tipos incorrectos %j", (body) => {
    expect(ubicacionRegistroSchema.safeParse(body).success).toBe(false);
  });

  it.each([
    { latitud: -17.7833, longitud: -63.1821, horaRegistro: dto.horaRegistro },
    { latitud: -17.7833, longitud: -63.1821, esValida: false },
    { latitud: -17.7833, longitud: -63.1821, conductorId: "d9428888-122b-4e1f-b85c-61cd3cbb3210" },
    { latitud: -17.7833, longitud: -63.1821, id: "42" },
    { latitud: -17.7833, longitud: -63.1821, eliminadoEn: null },
    { latitud: -17.7833, longitud: -63.1821, extra: undefined },
  ])("rechaza campos impuestos o desconocidos %j", (body) => {
    expect(ubicacionRegistroSchema.safeParse(body).success).toBe(false);
  });

  it.each(["latitud", "longitud"])("exige siempre %s", (field) => {
    const body: Record<string, unknown> = { ...coordenadas };
    delete body[field];
    expect(ubicacionRegistroSchema.safeParse(body).success).toBe(false);
  });

  it.each([undefined, null, [], [coordenadas], "texto", 42, true, {}])(
    "rechaza cuerpo ausente o invalido %j", (body) => {
      expect(ubicacionRegistroSchema.safeParse(body).success).toBe(false);
    },
  );
});

describe("UUID de ruta para posterior respuesta 404", () => {
  it.each(["d9428888-122b-4e1f-b85c-61cd3cbb3210", "D9428888-122b-4e1f-b85c-61cd3cbb3210", "00000000-0000-0000-0000-000000000000"])(
    "acepta formato hexadecimal existente sin transformar %s", (id) => {
      expect(conductorIdSchema.parse(id)).toBe(id);
    },
  );

  it.each([
    "", "no-uuid", dto.id, dto.horaRegistro, "d9428888122b4e1fb85c61cd3cbb3210",
    " d9428888-122b-4e1f-b85c-61cd3cbb3210", "d9428888-122b-4e1f-b85c-61cd3cbb3210 ",
    "d9428888-122b-4e1f-b85c-61cd3cbb3210\n", "d9428887-122b-4e1f-b85c-61cd3cbb321g",
    null, undefined, 42, [], {},
  ])("rechaza id %j con safeParse", (id) => {
    expect(conductorIdSchema.safeParse(id).success).toBe(false);
  });
});

describe("DTO explicito de ubicacion", () => {
  it("acepta el contrato completo", () => {
    expect(ubicacionDtoSchema.parse(dto)).toEqual(dto);
  });

  it.each(["id", "latitud", "longitud", "horaRegistro", "esValida"])("exige %s", (field) => {
    const body: Record<string, unknown> = { ...dto };
    delete body[field];
    expect(ubicacionDtoSchema.safeParse(body).success).toBe(false);
  });

  it.each(["conductorId", "eliminadoEn", "usuario", "extra"])("rechaza campo interno %s", (field) => {
    expect(ubicacionDtoSchema.safeParse({ ...dto, [field]: null }).success).toBe(false);
  });

  it.each(["42", "0", "9007199254740993"])("acepta id como string decimal %s", (id) => {
    expect(ubicacionDtoSchema.parse({ ...dto, id }).id).toBe(id);
  });

  it.each([42, "", "-1", "1.5", "abc", "1e3", null])("rechaza id no decimal %j", (id) => {
    expect(ubicacionDtoSchema.safeParse({ ...dto, id }).success).toBe(false);
  });

  it("rechaza id BigInt sin serializar", () => {
    expect(ubicacionDtoSchema.safeParse({ ...dto, id: 42n }).success).toBe(false);
  });

  it("exige ISO 8601 UTC serializado en horaRegistro", () => {
    for (const value of ["2026-09-15", "2026-09-15T14:00:00", "2026-09-15T14:00:00+02:00", new Date(), "invalido"]) {
      expect(ubicacionDtoSchema.safeParse({ ...dto, horaRegistro: value }).success).toBe(false);
    }
  });

  it.each([{ latitud: "0" }, { longitud: null }, { esValida: "true" }, { esValida: 1 }])(
    "rechaza tipos invalidos %j", (change) => {
      expect(ubicacionDtoSchema.safeParse({ ...dto, ...change }).success).toBe(false);
    },
  );
});
