import { describe, expect, it } from "vitest";
import {
  pasajeroAceptarAvisoSchema, pasajeroDtoSchema, pasajeroIdentificarSchema, pasajeroIdSchema,
  type PasajeroDto, type PasajeroIdentificarInput,
} from "../src/modules/pasajeros/pasajeros.schema";

const identificacion: PasajeroIdentificarInput = { whatsappId: "59170000000", nombre: "Ana Perez" };
const dto: PasajeroDto = {
  id: "d9428888-122b-4e1f-b85c-61cd3cbb3210",
  ...identificacion,
  aceptacionAvisoPrivacidad: null,
  creadoEn: "2026-09-15T12:00:00.000Z",
};

describe("identificacion estricta de pasajeros", () => {
  it.each(["0", "00059170000000", "59170000000", "9".repeat(100)])(
    "conserva whatsappId %s sin normalizacion ni conversion numerica", (whatsappId) => {
      const body = { ...identificacion, whatsappId };
      expect(pasajeroIdentificarSchema.parse(body)).toEqual(body);
    },
  );

  it.each([
    "", "+59170000000", "-59170000000", " 59170000000", "59170000000 ", "591 70000000",
    "59170000000@s.whatsapp.net", "591.70000000", "1e10", "59170000000\n", "59170000000\r",
    "59170000000\r\n", "59170000000\u2028", "59170000000\u2029", "591\n70000000",
    "59170000000\t", "59170000000\0", "\u0661\u0662\u0663", "\uff11\uff12\uff13",
    59170000000, true, null, undefined, [], {},
  ])("rechaza whatsappId invalido %j", (whatsappId) => {
    expect(pasajeroIdentificarSchema.safeParse({ ...identificacion, whatsappId }).success).toBe(false);
  });

  it("recorta solo los espacios exteriores del nombre", () => {
    expect(pasajeroIdentificarSchema.parse({ ...identificacion, nombre: " \tAna  Perez\n " }))
      .toEqual({ ...identificacion, nombre: "Ana  Perez" });
  });

  it.each(["", "   ", "\t\r\n", 42, false, null, undefined, [], {}])("rechaza nombre %j", (nombre) => {
    expect(pasajeroIdentificarSchema.safeParse({ ...identificacion, nombre }).success).toBe(false);
  });

  it.each(["whatsappId", "nombre"])("exige siempre %s", (field) => {
    const body: Record<string, unknown> = { ...identificacion };
    delete body[field];
    expect(pasajeroIdentificarSchema.safeParse(body).success).toBe(false);
  });

  it.each([undefined, null, [], [identificacion], "texto", 42, true, {}])("rechaza cuerpo %j", (body) => {
    expect(pasajeroIdentificarSchema.safeParse(body).success).toBe(false);
  });

  it.each(["id", "aceptacionAvisoPrivacidad", "creadoEn", "eliminadoEn", "extra"])(
    "rechaza campo adicional %s, incluso undefined", (field) => {
      for (const value of [dto.creadoEn, null, undefined]) {
        expect(pasajeroIdentificarSchema.safeParse({ ...identificacion, [field]: value }).success).toBe(false);
      }
    },
  );
});

describe("cuerpo de aceptacion del aviso", () => {
  it.each([undefined, {}])("acepta %j sin agregar datos", (body) => {
    expect(pasajeroAceptarAvisoSchema.parse(body)).toEqual(body);
  });

  it.each([
    null, [], [{}], "", "texto", 0, false, dto.creadoEn,
    { aceptacionAvisoPrivacidad: dto.creadoEn }, { fecha: dto.creadoEn },
    { whatsappId: identificacion.whatsappId }, { extra: undefined },
  ])("rechaza cuerpo %j", (body) => {
    expect(pasajeroAceptarAvisoSchema.safeParse(body).success).toBe(false);
  });
});

describe("UUID de ruta para posterior respuesta 404", () => {
  it.each([dto.id, dto.id.toUpperCase(), "00000000-0000-0000-0000-000000000000"])(
    "acepta formato hexadecimal existente sin transformar %s", (id) => {
      expect(pasajeroIdSchema.parse(id)).toBe(id);
    },
  );

  it.each([
    "", "no-uuid", identificacion.whatsappId, dto.id.replaceAll("-", ""),
    ` ${dto.id}`, `${dto.id} `, `${dto.id}\n`, dto.id.replace("d", "g"), null, undefined, 42, [], {},
  ])("rechaza id %j con safeParse", (id) => {
    expect(pasajeroIdSchema.safeParse(id).success).toBe(false);
  });
});

describe("DTO explicito de pasajero", () => {
  it.each([null, dto.creadoEn])("acepta consentimiento %j", (aceptacionAvisoPrivacidad) => {
    const body = { ...dto, aceptacionAvisoPrivacidad };
    expect(pasajeroDtoSchema.parse(body)).toEqual(body);
  });

  it.each(Object.keys(dto))("exige %s", (field) => {
    const body: Record<string, unknown> = { ...dto };
    delete body[field];
    expect(pasajeroDtoSchema.safeParse(body).success).toBe(false);
  });

  it.each(["eliminadoEn", "usuario", "solicitudes", "creado", "extra"])("rechaza campo interno %s", (field) => {
    expect(pasajeroDtoSchema.safeParse({ ...dto, [field]: null }).success).toBe(false);
  });

  it.each(["creadoEn", "aceptacionAvisoPrivacidad"])("exige ISO UTC serializado en %s", (field) => {
    for (const value of ["2026-09-15", "2026-09-15T12:00:00", "2026-09-15T12:00:00+02:00", new Date(), "invalido"]) {
      expect(pasajeroDtoSchema.safeParse({ ...dto, [field]: value }).success).toBe(false);
    }
  });

  it.each([{ id: "no-uuid" }, { whatsappId: 59170000000 }, { nombre: null }, { creadoEn: null }])(
    "rechaza tipos o formatos invalidos %j", (change) => {
      expect(pasajeroDtoSchema.safeParse({ ...dto, ...change }).success).toBe(false);
    },
  );
});
