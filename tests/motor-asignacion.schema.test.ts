import { describe, expect, it } from "vitest";
import {
  candidatoDtoSchema, candidatosDtoSchema, solicitudIdSchema,
  type CandidatoDto, type CandidatosDto,
} from "../src/modules/motor-asignacion/motor-asignacion.schema";

const solicitudId = "d9428888-122b-4e1f-b85c-61cd3cbb3210";
const candidato: CandidatoDto = {
  conductorId: "4c3f2b1a-9e8d-4a6b-8c1d-2e3f4a5b6c7d",
  nombreCompleto: "Juan Perez",
  distanciaKm: 2.35,
  vehiculo: {
    placa: "1234ABC", marca: "Toyota", modelo: "Corolla", color: "Blanco", capacidadPasajeros: 4,
  },
};
const dto: CandidatosDto = { candidatos: [candidato] };

describe("UUID de ruta para posterior respuesta 404", () => {
  it.each([solicitudId, solicitudId.toUpperCase(), "00000000-0000-0000-0000-000000000000"])(
    "acepta formato hexadecimal existente sin transformar %s", (id) => {
      expect(solicitudIdSchema.parse(id)).toBe(id);
    },
  );

  it.each([
    "", "no-uuid", "42", solicitudId.replaceAll("-", ""),
    ` ${solicitudId}`, `${solicitudId} `, `${solicitudId}\n`, solicitudId.replace("d", "g"),
    null, undefined, 42, [], {},
  ])("rechaza id %j con safeParse", (id) => {
    expect(solicitudIdSchema.safeParse(id).success).toBe(false);
  });
});

describe("DTO explicito de candidato", () => {
  it("acepta el contrato completo", () => {
    expect(candidatoDtoSchema.parse(candidato)).toEqual(candidato);
  });

  it.each(Object.keys(candidato))("exige %s", (field) => {
    const body: Record<string, unknown> = { ...candidato };
    delete body[field];
    expect(candidatoDtoSchema.safeParse(body).success).toBe(false);
  });

  it.each([
    "usuarioId", "creadoEn", "eliminadoEn", "vehiculoId", "horaRegistro", "extra",
  ])("rechaza campo interno %s", (field) => {
    expect(candidatoDtoSchema.safeParse({ ...candidato, [field]: null }).success).toBe(false);
  });

  it.each([
    { conductorId: "no-uuid" }, { conductorId: 42 }, { nombreCompleto: null }, { nombreCompleto: 42 },
  ])("rechaza tipos o formatos invalidos %j", (change) => {
    expect(candidatoDtoSchema.safeParse({ ...candidato, ...change }).success).toBe(false);
  });

  it.each([
    { distanciaKm: -0.01 }, { distanciaKm: 0 }, { distanciaKm: 2.352 },
    { distanciaKm: Number.NaN }, { distanciaKm: Number.POSITIVE_INFINITY },
  ])("acepta o rechaza distancias %j", (change) => {
    const { distanciaKm } = change;
    const finitaPositiva = typeof distanciaKm === "number" && Number.isFinite(distanciaKm)
      && distanciaKm >= 0;
    // El contrato no insiste en 2 decimales: solo exige numero finito no negativo.
    expect(candidatoDtoSchema.safeParse({ ...candidato, ...change }).success).toBe(finitaPositiva);
  });
});

describe("DTO estricto de vehiculo dentro del candidato", () => {
  it.each(["placa", "marca", "modelo", "color", "capacidadPasajeros"])("exige %s", (field) => {
    const body: Record<string, unknown> = { ...candidato, vehiculo: { ...candidato.vehiculo } };
    delete (body.vehiculo as Record<string, unknown>)[field];
    expect(candidatoDtoSchema.safeParse(body).success).toBe(false);
  });

  it.each(["id", "conductorId", "creadoEn", "eliminadoEn", "extra"])("rechaza campo interno %s", (field) => {
    const body = { ...candidato, vehiculo: { ...candidato.vehiculo, [field]: null } };
    expect(candidatoDtoSchema.safeParse(body).success).toBe(false);
  });

  it.each([
    { capacidadPasajeros: 1.5 }, { capacidadPasajeros: Number.NaN },
    { capacidadPasajeros: Number.POSITIVE_INFINITY }, { placa: 42 }, { color: null },
  ])("rechaza tipos invalidos %j", (change) => {
    const body = { ...candidato, vehiculo: { ...candidato.vehiculo, ...change } };
    expect(candidatoDtoSchema.safeParse(body).success).toBe(false);
  });
});

describe("DTO de listado de candidatos", () => {
  it("acepta el contrato completo", () => {
    expect(candidatosDtoSchema.parse(dto)).toEqual(dto);
  });

  it("acepta lista vacia de candidatos sin vehiculos", () => {
    expect(candidatosDtoSchema.parse({ candidatos: [] })).toEqual({ candidatos: [] });
  });

  it("rechaza la lista de candidatos omitida", () => {
    expect(candidatosDtoSchema.safeParse({}).success).toBe(false);
    expect(candidatosDtoSchema.safeParse([]).success).toBe(false);
  });

  it.each([undefined, null, [], [candidato], "texto", 42, true])("rechaza cuerpo %j", (body) => {
    expect(candidatosDtoSchema.safeParse(body).success).toBe(false);
  });

  it.each(["conductorId", "motivo", "extra"])("rechaza campo adicional %s", (field) => {
    expect(candidatosDtoSchema.safeParse({ ...dto, [field]: null }).success).toBe(false);
  });
});