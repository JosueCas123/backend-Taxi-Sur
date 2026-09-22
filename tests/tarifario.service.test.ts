import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import {
  actualizarTarifa, crearTarifa, fechaDeNegocioEnLaPaz, inicioDelDiaSiguienteEnLaPaz,
  obtenerTarifasVigentes,
} from "../src/modules/tarifario/tarifario.service";

vi.mock("../src/config/prisma", () => {
  const tarifa = { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn() };
  return { prisma: { tarifa, $transaction: vi.fn() } };
});

const tarifaFindMany = vi.mocked(prisma.tarifa.findMany);
const tarifaCreate = vi.mocked(prisma.tarifa.create);
const tarifaUpdateMany = vi.mocked(prisma.tarifa.updateMany);
const tarifaFindFirst = vi.mocked(prisma.tarifa.findFirst);
const transaction = vi.mocked(prisma.$transaction);

const tarifaSelect = {
  id: true,
  descripcion: true,
  monto: true,
  vigenciaDesde: true,
};

const fila = {
  id: "7a1f2c4e-0000-4000-8000-000000000000",
  descripcion: "Referencia centro a terminal",
  monto: new Prisma.Decimal("15.00"),
  vigenciaDesde: new Date("2026-09-21T00:00:00.000Z"),
};

const tx = { tarifa: { updateMany: tarifaUpdateMany, findFirst: tarifaFindFirst } };
const transactionImpl = (cb: (client: typeof tx) => Promise<unknown>) => cb(tx);

beforeEach(() => {
  vi.resetAllMocks();
  (transaction as unknown as { mockImplementation: (impl: typeof transactionImpl) => void })
    .mockImplementation(transactionImpl);
});

afterEach(() => { vi.useRealTimers(); });

describe("fecha de negocio en America/La_Paz", () => {
  it("usa inicio del dia a las 04:00 UTC", () => {
    expect(fechaDeNegocioEnLaPaz(new Date("2026-09-21T04:00:00.000Z"))).toBe("2026-09-21");
  });

  it("cambia de dia solo desde las 04:00 UTC, no antes", () => {
    expect(fechaDeNegocioEnLaPaz(new Date("2026-09-21T03:59:59.999Z"))).toBe("2026-09-20");
  });

  it("maneja limites de anio sin depender de la zona local del servidor", () => {
    expect(fechaDeNegocioEnLaPaz(new Date("2026-01-01T04:00:00.000Z"))).toBe("2026-01-01");
    expect(fechaDeNegocioEnLaPaz(new Date("2026-12-31T03:59:59.999Z"))).toBe("2026-12-30");
  });
});

describe("inicio del dia siguiente", () => {
  it("sigue a la fecha de calendario en UTC", () => {
    expect(inicioDelDiaSiguienteEnLaPaz("2026-09-21")).toEqual(new Date("2026-09-22T00:00:00.000Z"));
  });

  it("cruza fin de mes y de anio", () => {
    expect(inicioDelDiaSiguienteEnLaPaz("2026-12-31")).toEqual(new Date("2027-01-01T00:00:00.000Z"));
  });

  it("respeta anos bisiestos", () => {
    expect(inicioDelDiaSiguienteEnLaPaz("2028-02-28")).toEqual(new Date("2028-02-29T00:00:00.000Z"));
    expect(inicioDelDiaSiguienteEnLaPaz("1900-02-28")).toEqual(new Date("1900-03-01T00:00:00.000Z"));
  });
});

describe("obtenerTarifasVigentes", () => {
  it("incluye la fecha de negocio de forma inclusiva con el limite del dia siguiente", async () => {
    tarifaFindMany.mockResolvedValueOnce([fila]);
    await obtenerTarifasVigentes(new Date("2026-09-21T04:00:00.000Z"));
    expect(tarifaFindMany).toHaveBeenCalledWith({
      where: {
        eliminadoEn: null,
        vigenciaDesde: { lt: new Date("2026-09-22T00:00:00.000Z") },
      },
      orderBy: [{ descripcion: "asc" }, { id: "asc" }],
      select: tarifaSelect,
    });
  });

  it("excluye las filas cuya fecha de inicio aun no llego al dia de negocio", async () => {
    tarifaFindMany.mockResolvedValueOnce([fila]);
    await obtenerTarifasVigentes(new Date("2026-09-21T03:59:59.999Z"));
    expect(tarifaFindMany).toHaveBeenCalledWith({
      where: {
        eliminadoEn: null,
        vigenciaDesde: { lt: new Date("2026-09-21T00:00:00.000Z") },
      },
      orderBy: [{ descripcion: "asc" }, { id: "asc" }],
      select: tarifaSelect,
    });
  });

  it("filtra por borrado logico y excluye filas eliminadas", async () => {
    tarifaFindMany.mockResolvedValueOnce([fila]);
    await obtenerTarifasVigentes(new Date("2026-09-21T04:00:00.000Z"));
    expect(tarifaFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ eliminadoEn: null }) }),
    );
  });

  it("no agrupa filas por descripcion ni filtra por versiones o montos", async () => {
    tarifaFindMany.mockResolvedValueOnce([fila]);
    await obtenerTarifasVigentes(new Date("2026-09-21T04:00:00.000Z"));
    const consulta = tarifaFindMany.mock.calls[0][0];
    const where = consulta?.where as Record<string, unknown>;
    expect(Object.keys(where)).toEqual(["eliminadoEn", "vigenciaDesde"]);
    expect(where.eliminadoEn).toBeNull();
    expect(where.vigenciaDesde).toEqual({ lt: new Date("2026-09-22T00:00:00.000Z") });
  });

  it("convierte montos Decimal y fechas a string sin perder precision", async () => {
    tarifaFindMany.mockResolvedValueOnce([
      { ...fila, descripcion: "Aero->Centro de noche", monto: new Prisma.Decimal("120.50") },
    ]);
    const resultado = await obtenerTarifasVigentes(new Date("2026-09-21T04:00:00.000Z"));
    expect(resultado).toEqual([
      {
        id: fila.id,
        descripcion: "Aero->Centro de noche",
        monto: "120.50",
        vigenciaDesde: "2026-09-21",
      },
    ]);
  });

  it("devuelve [] cuando no hay filas vigentes sin valores por defecto", async () => {
    tarifaFindMany.mockResolvedValueOnce([]);
    expect(await obtenerTarifasVigentes(new Date("2026-09-21T04:00:00.000Z"))).toEqual([]);
  });
});

describe("crearTarifa (POST /api/tarifas)", () => {
  it.each(["2020-01-01", "2026-09-21", "2030-12-31"])(
    "acepta fecha %s pasada, de hoy o futura sin restriccion de negocio",
    async (vigenciaDesde) => {
      tarifaCreate.mockResolvedValueOnce({ ...fila, vigenciaDesde: new Date(`${vigenciaDesde}T00:00:00.000Z`) });
      await crearTarifa({ descripcion: "Referencia centro a terminal", monto: "15.00", vigenciaDesde });
      expect(tarifaCreate).toHaveBeenCalledWith({
        data: {
          descripcion: "Referencia centro a terminal",
          monto: "15.00",
          vigenciaDesde: new Date(`${vigenciaDesde}T00:00:00.000Z`),
        },
        select: tarifaSelect,
      });
    },
  );

  it.each(["0.01", "99999999.99"])("persiste y serializa monto %s exacto", async (monto) => {
    tarifaCreate.mockResolvedValueOnce({ ...fila, monto: new Prisma.Decimal(monto) });
    const resultado = await crearTarifa({ descripcion: "Referencia", monto, vigenciaDesde: "2026-09-21" });
    expect(tarifaCreate).toHaveBeenCalledWith({
      data: { descripcion: "Referencia", monto, vigenciaDesde: new Date("2026-09-21T00:00:00.000Z") },
      select: tarifaSelect,
    });
    expect(resultado.monto).toBe(monto);
  });

  it("devuelve el DTO completo de la fila creada", async () => {
    tarifaCreate.mockResolvedValueOnce(fila);
    const resultado = await crearTarifa({ descripcion: fila.descripcion, monto: "15.00", vigenciaDesde: "2026-09-21" });
    expect(resultado).toEqual({
      id: fila.id,
      descripcion: fila.descripcion,
      monto: "15.00",
      vigenciaDesde: "2026-09-21",
    });
  });
});

describe("actualizarTarifa (PATCH /api/tarifas/:id)", () => {
  it("actualiza solo descripcion y conserva id, monto, fecha y campos omitidos", async () => {
    tarifaUpdateMany.mockResolvedValueOnce({ count: 1 });
    tarifaFindFirst.mockResolvedValueOnce({ ...fila, descripcion: "Otra referencia" });
    const resultado = await actualizarTarifa(fila.id, { descripcion: "Otra referencia" });
    expect(resultado).toEqual({
      ok: true,
      tarifa: { id: fila.id, descripcion: "Otra referencia", monto: "15.00", vigenciaDesde: "2026-09-21" },
    });
    expect(tarifaUpdateMany).toHaveBeenCalledWith({
      where: { id: fila.id, eliminadoEn: null },
      data: { descripcion: "Otra referencia" },
    });
    expect(tarifaFindFirst).toHaveBeenCalledWith({ where: { id: fila.id, eliminadoEn: null }, select: tarifaSelect });
    expect(tarifaCreate).not.toHaveBeenCalled();
  });

  it("actualiza solo monto con precision", async () => {
    tarifaUpdateMany.mockResolvedValueOnce({ count: 1 });
    tarifaFindFirst.mockResolvedValueOnce({ ...fila, monto: new Prisma.Decimal("0.01") });
    const resultado = await actualizarTarifa(fila.id, { monto: "0.01" });
    expect(resultado).toEqual({
      ok: true,
      tarifa: { id: fila.id, descripcion: fila.descripcion, monto: "0.01", vigenciaDesde: "2026-09-21" },
    });
    expect(tarifaUpdateMany).toHaveBeenCalledWith({
      where: { id: fila.id, eliminadoEn: null },
      data: { monto: "0.01" },
    });
  });

  it("actualiza descripcion y monto en un mismo PATCH", async () => {
    tarifaUpdateMany.mockResolvedValueOnce({ count: 1 });
    tarifaFindFirst.mockResolvedValueOnce({ ...fila, descripcion: "Nueva", monto: new Prisma.Decimal("2.00") });
    const resultado = await actualizarTarifa(fila.id, { descripcion: "Nueva", monto: "2.00" });
    expect(resultado).toEqual({
      ok: true,
      tarifa: { id: fila.id, descripcion: "Nueva", monto: "2.00", vigenciaDesde: "2026-09-21" },
    });
    expect(tarifaUpdateMany).toHaveBeenCalledWith({
      where: { id: fila.id, eliminadoEn: null },
      data: { descripcion: "Nueva", monto: "2.00" },
    });
  });

  it("nunca incluye vigenciaDesde en los datos de escritura", async () => {
    tarifaUpdateMany.mockResolvedValueOnce({ count: 1 });
    tarifaFindFirst.mockResolvedValueOnce(fila);
    await actualizarTarifa(fila.id, { descripcion: "Otra" });
    const consulta = tarifaUpdateMany.mock.calls[0][0];
    expect(consulta?.data).not.toHaveProperty("vigenciaDesde");
  });

  it("devuelve NOT_FOUND para fila inexistente o eliminada sin escribir ni leer despues", async () => {
    tarifaUpdateMany.mockResolvedValueOnce({ count: 0 });
    expect(await actualizarTarifa(fila.id, { descripcion: "Otra" }))
      .toEqual({ ok: false, code: "NOT_FOUND" });
    expect(tarifaUpdateMany).toHaveBeenCalledWith({
      where: { id: fila.id, eliminadoEn: null },
      data: { descripcion: "Otra" },
    });
    expect(tarifaFindFirst).not.toHaveBeenCalled();
  });

  it("excluye la fila eliminada tambien ante concurrencia", async () => {
    tarifaUpdateMany.mockResolvedValueOnce({ count: 1 });
    tarifaFindFirst.mockResolvedValueOnce(null);
    expect(await actualizarTarifa(fila.id, { descripcion: "Otra" }))
      .toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("no produce 409 por fecha y ejecuta una unica transaccion", async () => {
    tarifaUpdateMany.mockResolvedValueOnce({ count: 1 });
    tarifaFindFirst.mockResolvedValueOnce(fila);
    await actualizarTarifa(fila.id, { descripcion: "Otra" });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(tarifaCreate).not.toHaveBeenCalled();
  });
});