import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/config/prisma";
import type { AuthContext } from "../src/middlewares/auth";
import {
  esTemporalmenteValida, obtenerUltimaUbicacion, registrarUbicacion,
} from "../src/modules/ubicaciones/ubicaciones.service";

vi.mock("../src/config/prisma", () => {
  const conductor = { findFirst: vi.fn() };
  const ubicacionConductor = { updateMany: vi.fn(), create: vi.fn(), findFirst: vi.fn() };
  return {
    prisma: { conductor, ubicacionConductor, $transaction: vi.fn() },
  };
});

const conductorFindFirst = vi.mocked(prisma.conductor.findFirst);
const ubicacionUpdateMany = vi.mocked(prisma.ubicacionConductor.updateMany);
const ubicacionCreate = vi.mocked(prisma.ubicacionConductor.create);
const ubicacionFindFirst = vi.mocked(prisma.ubicacionConductor.findFirst);
const transaction = vi.mocked(prisma.$transaction);

const conductorId = "d9428888-122b-4e1f-b85c-61cd3cbb3210";
const conductorActivo = {
  usuarioId: "usuario-propietario",
  estado: "aprobado" as const,
  eliminadoEn: null as Date | null,
};
const input = { latitud: -17.7833, longitud: -63.1821 };
const ubicacion = {
  id: 42n,
  latitud: input.latitud,
  longitud: input.longitud,
  horaRegistro: new Date("2026-09-15T14:00:00.000Z"),
  esValida: true,
};
const select = {
  id: true, latitud: true, longitud: true, horaRegistro: true, esValida: true,
};
const dto = {
  id: "42",
  latitud: input.latitud,
  longitud: input.longitud,
  horaRegistro: "2026-09-15T14:00:00.000Z",
  esValida: true,
};

const authPropietario: AuthContext = { source: "jwt", userId: conductorActivo.usuarioId, rol: "conductor" };
const authAjeno: AuthContext = { source: "jwt", userId: "otro-usuario", rol: "conductor" };
const authAdmin: AuthContext = { source: "jwt", userId: null, rol: "admin" };
const authN8n: AuthContext = { source: "n8n", userId: null, rol: null };

const tx = { ubicacionConductor: { updateMany: ubicacionUpdateMany, create: ubicacionCreate } };
const transactionImpl = (cb: (client: typeof tx) => Promise<unknown>) => cb(tx);

beforeEach(() => {
  vi.resetAllMocks();
  (transaction as unknown as { mockImplementation: (impl: typeof transactionImpl) => void })
    .mockImplementation(transactionImpl);
});

afterEach(() => { vi.useRealTimers(); });

describe("esTemporalmenteValida (Regla 9)", () => {
  const referencia = ubicacion.horaRegistro.getTime();

  it.each([0, 1, 299999])("vigente con antiguedad %i ms", (antiguedad) => {
    expect(esTemporalmenteValida(ubicacion.horaRegistro, referencia + antiguedad)).toBe(true);
  });

  it("vigente con exactamente 300000 ms", () => {
    expect(esTemporalmenteValida(ubicacion.horaRegistro, referencia + 300000)).toBe(true);
  });

  it.each([300001, 400000])("caducada con antiguedad %i ms", (antiguedad) => {
    expect(esTemporalmenteValida(ubicacion.horaRegistro, referencia + antiguedad)).toBe(false);
  });

  it("acepta Date o numero de milisegundos", () => {
    const instante = referencia + 300000;
    expect(esTemporalmenteValida(ubicacion.horaRegistro, instante)).toBe(true);
    expect(esTemporalmenteValida(ubicacion.horaRegistro, new Date(instante))).toBe(true);
  });
});

describe("registrar ubicacion del conductor propietario", () => {
  it("propaga y no abre transaccion cuando el conductor no existe", async () => {
    conductorFindFirst.mockResolvedValueOnce(null);
    expect(await registrarUbicacion(conductorId, input, authPropietario))
      .toEqual({ ok: false, code: "NOT_FOUND" });
    expect(conductorFindFirst).toHaveBeenCalledWith({
      where: { id: conductorId },
      select: { usuarioId: true, estado: true, eliminadoEn: true },
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rechaza conductor eliminado logicamente", async () => {
    conductorFindFirst.mockResolvedValueOnce({ ...conductorActivo, eliminadoEn: new Date() });
    expect(await registrarUbicacion(conductorId, input, authPropietario))
      .toEqual({ ok: false, code: "NOT_FOUND" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([authAjeno, authAdmin, authN8n])(
    "rechaza a %j sin revelar datos del conductor destino", async (auth) => {
      conductorFindFirst.mockResolvedValueOnce(conductorActivo);
      expect(await registrarUbicacion(conductorId, input, auth))
        .toEqual({ ok: false, code: "FORBIDDEN" });
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it.each(["pendiente", "rechazado", "suspendido"])(
    "rechaza propietario no aprobado en estado %s", async (estado) => {
      conductorFindFirst.mockResolvedValueOnce({ ...conductorActivo, estado });
      expect(await registrarUbicacion(conductorId, input, authPropietario))
        .toEqual({ ok: false, code: "CONDUCTOR_NO_APROBADO" });
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it("invalida previas vencidas e inserta la nueva en la misma transaccion", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T14:05:00.000Z"));
    conductorFindFirst.mockResolvedValueOnce(conductorActivo);
    ubicacionCreate.mockResolvedValueOnce(ubicacion);
    const result = await registrarUbicacion(conductorId, input, authPropietario);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(ubicacionUpdateMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        conductorId,
        esValida: true,
        horaRegistro: { lt: new Date("2026-09-15T14:00:00.000Z") },
      },
      data: { esValida: false },
    });
    expect(ubicacionCreate).toHaveBeenCalledExactlyOnceWith({
      data: {
        conductorId,
        latitud: input.latitud,
        longitud: input.longitud,
        horaRegistro: new Date("2026-09-15T14:05:00.000Z"),
        esValida: true,
      },
      select,
    });
    expect(result).toEqual({ ok: true, ubicacion: dto });
  });

  it("el limite de invalidacion respeta 300000 ms exactos sin tocar previas recientes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T14:05:00.000Z"));
    conductorFindFirst.mockResolvedValueOnce(conductorActivo);
    ubicacionCreate.mockResolvedValueOnce({ ...ubicacion, horaRegistro: new Date("2026-09-15T14:05:00.000Z") });
    await registrarUbicacion(conductorId, input, authPropietario);
    const where = ubicacionUpdateMany.mock.calls[0][0].where;
    expect(where.horaRegistro.lt.getTime()).toBe(new Date("2026-09-15T14:05:00.000Z").getTime() - 300000);
    expect(where.conductorId).toBe(conductorId);
    expect(where.esValida).toBe(true);
  });

  it("propaga fallo de invalidacion sin insertar", async () => {
    const error = new Error("Invalidation failure");
    conductorFindFirst.mockResolvedValueOnce(conductorActivo);
    ubicacionUpdateMany.mockRejectedValueOnce(error);
    await expect(registrarUbicacion(conductorId, input, authPropietario)).rejects.toBe(error);
    expect(ubicacionCreate).not.toHaveBeenCalled();
  });

  it("propaga fallo de insercion", async () => {
    const error = new Error("Insert failure");
    conductorFindFirst.mockResolvedValueOnce(conductorActivo);
    ubicacionCreate.mockRejectedValueOnce(error);
    await expect(registrarUbicacion(conductorId, input, authPropietario)).rejects.toBe(error);
  });

  it("propaga fallo de lectura del conductor", async () => {
    const error = new Error("Read failure");
    conductorFindFirst.mockRejectedValueOnce(error);
    await expect(registrarUbicacion(conductorId, input, authPropietario)).rejects.toBe(error);
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("obtener la ultima ubicacion de un conductor", () => {
  it("rechaza conductor inexistente o eliminado sin consultar ubicaciones", async () => {
    conductorFindFirst.mockResolvedValueOnce(null);
    expect(await obtenerUltimaUbicacion(conductorId, new Date()))
      .toEqual({ ok: false, code: "NOT_FOUND" });
    expect(conductorFindFirst).toHaveBeenCalledWith({
      where: { id: conductorId, eliminadoEn: null },
      select: { id: true },
    });
    expect(ubicacionFindFirst).not.toHaveBeenCalled();
  });

  it("devuelve NOT_FOUND sin ubicaciones", async () => {
    conductorFindFirst.mockResolvedValueOnce({ id: conductorId });
    ubicacionFindFirst.mockResolvedValueOnce(null);
    expect(await obtenerUltimaUbicacion(conductorId, new Date()))
      .toEqual({ ok: false, code: "NOT_FOUND" });
    expect(ubicacionFindFirst).toHaveBeenCalledWith({
      where: { conductorId, eliminadoEn: null },
      orderBy: [{ horaRegistro: "desc" }, { id: "desc" }],
      select,
    });
  });

  it("desempata por id con horaRegistro DESC, id DESC y excluye borrado logico", async () => {
    conductorFindFirst.mockResolvedValueOnce({ id: conductorId });
    ubicacionFindFirst.mockResolvedValueOnce(ubicacion);
    await obtenerUltimaUbicacion(conductorId, new Date("2026-09-15T14:05:00.000Z"));
    expect(ubicacionFindFirst.mock.calls[0][0].orderBy).toEqual([
      { horaRegistro: "desc" }, { id: "desc" },
    ]);
    expect(ubicacionFindFirst.mock.calls[0][0].where).toEqual({ conductorId, eliminadoEn: null });
  });

  it.each([0, 299999, 300000])("mantiene vigente con antiguedad %i ms", async (antiguedad) => {
    conductorFindFirst.mockResolvedValueOnce({ id: conductorId });
    ubicacionFindFirst.mockResolvedValueOnce(ubicacion);
    const ahora = ubicacion.horaRegistro.getTime() + antiguedad;
    const result = await obtenerUltimaUbicacion(conductorId, ahora);
    expect(result).toEqual({ ok: true, ubicacion: { ...dto, esValida: true } });
  });

  it("caduca con antiguedad 300001 ms aunque la bandera persistida sea true", async () => {
    conductorFindFirst.mockResolvedValueOnce({ id: conductorId });
    ubicacionFindFirst.mockResolvedValueOnce({ ...ubicacion, esValida: true });
    const result = await obtenerUltimaUbicacion(conductorId, new Date("2026-09-15T14:05:00.001Z"));
    expect(result).toEqual({ ok: true, ubicacion: { ...dto, esValida: false } });
  });

  it("no revive un registro reciente con bandera persistida false", async () => {
    conductorFindFirst.mockResolvedValueOnce({ id: conductorId });
    ubicacionFindFirst.mockResolvedValueOnce({ ...ubicacion, esValida: false });
    const result = await obtenerUltimaUbicacion(conductorId, new Date("2026-09-15T14:04:00.000Z"));
    expect(result).toEqual({ ok: true, ubicacion: { ...dto, esValida: false } });
  });

  it("propaga fallos de lectura", async () => {
    const error = new Error("Read failure");
    conductorFindFirst.mockResolvedValueOnce({ id: conductorId });
    ubicacionFindFirst.mockRejectedValueOnce(error);
    await expect(obtenerUltimaUbicacion(conductorId, new Date())).rejects.toBe(error);
  });
});