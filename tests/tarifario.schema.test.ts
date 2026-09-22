import { describe, expect, it } from "vitest";
import {
  actualizarTarifaSchema, crearTarifaSchema, tarifaDtoSchema, tarifaIdSchema,
  tarifaQuerySchema, type CrearTarifaInput, type TarifaDto,
} from "../src/modules/tarifario/tarifario.schema";

const id = "7a1f2c4e-0000-4000-8000-000000000000";
const crear: CrearTarifaInput = {
  descripcion: "Referencia centro a terminal", monto: "15.00", vigenciaDesde: "2026-09-21",
};
const tarifa: TarifaDto = { id, ...crear };

describe("tarifas: POST y PATCH", () => {
  it("acepta POST completo sin transformar monto ni fecha", () => {
    expect(crearTarifaSchema.parse(crear)).toEqual(crear);
  });

  it.each(["descripcion", "monto", "vigenciaDesde"])("POST exige %s", (campo) => {
    const body: Record<string, unknown> = { ...crear };
    delete body[campo];
    expect(crearTarifaSchema.safeParse(body).success).toBe(false);
  });

  it.each([undefined, null, [], [crear], "texto", 42, true, {}])("rechaza cuerpo %j", (body) => {
    expect(crearTarifaSchema.safeParse(body).success).toBe(false);
    expect(actualizarTarifaSchema.safeParse(body).success).toBe(false);
  });

  it.each(["a", "a".repeat(255)])("recorta descripcion valida de longitud %s", (descripcion) => {
    expect(crearTarifaSchema.parse({ ...crear, descripcion: ` ${descripcion} ` }).descripcion)
      .toBe(descripcion);
    expect(actualizarTarifaSchema.parse({ descripcion: ` ${descripcion} ` })).toEqual({ descripcion });
  });

  it.each(["", " \t\n", "a".repeat(256), null, 1, [], {}, false])("rechaza descripcion %j", (descripcion) => {
    expect(crearTarifaSchema.safeParse({ ...crear, descripcion }).success).toBe(false);
    expect(actualizarTarifaSchema.safeParse({ descripcion }).success).toBe(false);
  });

  it.each(["0.01", "0.10", "1.00", "15.00", "99999999.99"])("conserva monto exacto %s", (monto) => {
    expect(crearTarifaSchema.parse({ ...crear, monto }).monto).toBe(monto);
    expect(actualizarTarifaSchema.parse({ monto })).toEqual({ monto });
    expect(tarifaDtoSchema.parse({ ...tarifa, monto }).monto).toBe(monto);
  });

  it.each([
    "0.00", "-0.01", "-1.00", "+1.00", "100000000.00", "99999999.999",
    "1", "1.0", "1.001", ".01", "1.", "01.00", "00.01", "1,00", "1e2", "1E+2",
    " 1.00", "1.00 ", "1.00\n", "1.00\r\n", "1.00\t", "1. 00", "", "NaN", "Infinity",
    0.01, 15, null, undefined, true, [], {},
  ])("rechaza monto %j sin coercion ni redondeo", (monto) => {
    expect(crearTarifaSchema.safeParse({ ...crear, monto }).success).toBe(false);
    expect(actualizarTarifaSchema.safeParse({ monto }).success).toBe(false);
    expect(tarifaDtoSchema.safeParse({ ...tarifa, monto }).success).toBe(false);
  });

  it.each(["1900-01-01", "2000-02-29", "2024-02-29", "2026-09-21", "2100-12-31"])(
    "acepta fecha real pasada o futura sin normalizar %s", (vigenciaDesde) => {
      expect(crearTarifaSchema.parse({ ...crear, vigenciaDesde }).vigenciaDesde).toBe(vigenciaDesde);
      expect(tarifaDtoSchema.parse({ ...tarifa, vigenciaDesde }).vigenciaDesde).toBe(vigenciaDesde);
    },
  );

  it.each([
    "1900-02-29", "2100-02-29", "2026-02-29", "2024-02-30", "2026-04-31",
    "2026-00-01", "2026-13-01", "2026-01-00", "2026-01-32", "2026-9-21", "26-09-21",
    "2026-09-21T00:00:00.000Z", "2026-09-21T00:00:00-04:00", "2026-09-21\n",
    " 2026-09-21", "2026-09-21 ", "", null, undefined, 20260921, new Date("2026-09-21"),
  ])("rechaza fecha imposible o formato no calendario %j", (vigenciaDesde) => {
    expect(crearTarifaSchema.safeParse({ ...crear, vigenciaDesde }).success).toBe(false);
    expect(tarifaDtoSchema.safeParse({ ...tarifa, vigenciaDesde }).success).toBe(false);
  });

  it.each([
    { descripcion: "Otra referencia" }, { monto: "0.01" }, { descripcion: "Otra", monto: "2.00" },
  ])("PATCH conserva solo campos enviados %j", (body) => {
    expect(actualizarTarifaSchema.parse(body)).toEqual(body);
  });

  it.each([{ descripcion: undefined }, { monto: undefined }, { descripcion: undefined, monto: undefined }])(
    "PATCH rechaza actualizacion sin valores %j", (body) => {
      expect(actualizarTarifaSchema.safeParse(body).success).toBe(false);
    },
  );

  it.each([crear.vigenciaDesde, "2027-01-01", null, undefined])("PATCH rechaza vigenciaDesde %j", (vigenciaDesde) => {
    expect(actualizarTarifaSchema.safeParse({ monto: "2.00", vigenciaDesde }).success).toBe(false);
  });

  it.each(["id", "creadoEn", "eliminadoEn", "moneda", "concepto", "montoMinimo", "montoMaximo", "extra"])(
    "rechaza campo adicional %s", (campo) => {
      for (const valor of ["valor", null, undefined]) {
        expect(crearTarifaSchema.safeParse({ ...crear, [campo]: valor }).success).toBe(false);
        expect(actualizarTarifaSchema.safeParse({ monto: "2.00", [campo]: valor }).success).toBe(false);
      }
    },
  );
});

describe("tarifas: UUID de ruta", () => {
  it.each([id, id.toUpperCase(), "00000000-0000-0000-0000-000000000000"])("acepta formato %s", (value) => {
    expect(tarifaIdSchema.parse(value)).toBe(value);
  });

  it.each(["", "no-uuid", id.replaceAll("-", ""), ` ${id}`, `${id}\n`, id.replace("7", "g"), null, undefined, 42])(
    "rechaza formato %j para posterior 404", (value) => {
      expect(tarifaIdSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe("tarifas: query y DTO", () => {
  it("acepta query vacia", () => {
    expect(tarifaQuerySchema.parse({})).toEqual({});
  });

  it.each([{ page: "1" }, { take: "25" }, { descripcion: "Centro" }, { extra: undefined }, [], null, undefined, ""])(
    "rechaza query %j", (query) => {
      expect(tarifaQuerySchema.safeParse(query).success).toBe(false);
    },
  );

  it("acepta DTO minimo sin agregar ni transformar campos", () => {
    expect(tarifaDtoSchema.parse(tarifa)).toEqual(tarifa);
  });

  it.each(["id", "descripcion", "monto", "vigenciaDesde"])("DTO exige %s", (campo) => {
    const dto: Record<string, unknown> = { ...tarifa };
    delete dto[campo];
    expect(tarifaDtoSchema.safeParse(dto).success).toBe(false);
  });

  it.each(["creadoEn", "eliminadoEn", "moneda", "concepto", "montoMinimo", "montoMaximo", "extra"])(
    "DTO rechaza campo fuera de contrato %s", (campo) => {
      expect(tarifaDtoSchema.safeParse({ ...tarifa, [campo]: null }).success).toBe(false);
    },
  );

  it.each([{ id: "no-uuid" }, { descripcion: null }, { descripcion: "" }, { descripcion: "a".repeat(256) }])(
    "DTO rechaza %j", (cambio) => {
      expect(tarifaDtoSchema.safeParse({ ...tarifa, ...cambio }).success).toBe(false);
    },
  );
});
