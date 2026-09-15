import { Prisma, type Pasajero } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/config/prisma";
import { pasajeroDtoSchema } from "../src/modules/pasajeros/pasajeros.schema";
import { aceptarAvisoPasajero, identificarPasajero } from "../src/modules/pasajeros/pasajeros.service";

vi.mock("../src/config/prisma", () => ({
  prisma: { pasajero: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn() } },
}));

const lookup = vi.mocked(prisma.pasajero.findUnique);
const create = vi.mocked(prisma.pasajero.create);
const updateMany = vi.mocked(prisma.pasajero.updateMany);
const findFirst = vi.mocked(prisma.pasajero.findFirst);
const input = { whatsappId: "00059170000000", nombre: "Nombre nuevo" };
const registro: Pasajero = {
  id: "d9428888-122b-4e1f-b85c-61cd3cbb3210", whatsappId: input.whatsappId,
  nombre: "Nombre original", aceptacionAvisoPrivacidad: null,
  creadoEn: new Date("2026-09-15T12:00:00.000Z"), eliminadoEn: null,
};
const select = {
  id: true, whatsappId: true, nombre: true,
  aceptacionAvisoPrivacidad: true, creadoEn: true, eliminadoEn: true,
};

function uniqueError(target?: unknown) {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002", clientVersion: Prisma.prismaVersion.client,
    meta: target === undefined ? undefined : { target },
  });
}

beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

describe("identificar pasajero sin base de datos", () => {
  it("crea con datos explicitos y consentimiento null; devuelve solo DTO ISO UTC", async () => {
    lookup.mockResolvedValueOnce(null);
    create.mockResolvedValueOnce({ ...registro, nombre: input.nombre });
    const result = await identificarPasajero(input);
    expect(lookup).toHaveBeenCalledExactlyOnceWith({ where: { whatsappId: input.whatsappId }, select });
    expect(create).toHaveBeenCalledExactlyOnceWith({
      data: { ...input, aceptacionAvisoPrivacidad: null }, select,
    });
    expect(result).toEqual({ ok: true, pasajero: {
      id: registro.id, ...input, aceptacionAvisoPrivacidad: null, creadoEn: registro.creadoEn.toISOString(),
    } });
    if (result.ok) expect(pasajeroDtoSchema.parse(result.pasajero)).toEqual(result.pasajero);
  });

  it.each([null, new Date("2026-09-15T13:00:00.123Z")])(
    "existente conserva nombre y consentimiento %j sin escribir", async (aceptacionAvisoPrivacidad) => {
      lookup.mockResolvedValueOnce({ ...registro, aceptacionAvisoPrivacidad });
      const result = await identificarPasajero(input);
      expect(result).toEqual({ ok: true, pasajero: {
        id: registro.id, whatsappId: registro.whatsappId, nombre: registro.nombre,
        aceptacionAvisoPrivacidad: aceptacionAvisoPrivacidad?.toISOString() ?? null,
        creadoEn: registro.creadoEn.toISOString(),
      } });
      expect(create).not.toHaveBeenCalled();
    },
  );

  it("eliminado devuelve conflicto sin restaurar ni crear", async () => {
    lookup.mockResolvedValueOnce({ ...registro, eliminadoEn: new Date() });
    expect(await identificarPasajero(input)).toEqual({ ok: false, code: "PASAJERO_ELIMINADO" });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([["whatsapp_id"], ["whatsappId"], "whatsapp_id", undefined])(
    "recupera el ganador tras P2002 con target %j", async (target) => {
      lookup.mockResolvedValueOnce(null).mockResolvedValueOnce(registro);
      create.mockRejectedValueOnce(uniqueError(target));
      const result = await identificarPasajero(input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.pasajero.id).toBe(registro.id);
        expect(result.pasajero.nombre).toBe(registro.nombre);
      }
      expect(lookup).toHaveBeenCalledTimes(2);
      expect(lookup).toHaveBeenLastCalledWith({ where: { whatsappId: input.whatsappId }, select });
      expect(create).toHaveBeenCalledTimes(1);
    },
  );

  it("aplica borrado logico al ganador recuperado", async () => {
    lookup.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...registro, eliminadoEn: new Date() });
    create.mockRejectedValueOnce(uniqueError(["whatsapp_id"]));
    expect(await identificarPasajero(input)).toEqual({ ok: false, code: "PASAJERO_ELIMINADO" });
  });

  it("dos llamadas que leen ausencia recuperan el mismo ganador sin reintentar la creacion", async () => {
    lookup.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(registro);
    create.mockResolvedValueOnce(registro).mockRejectedValueOnce(uniqueError(["whatsapp_id"]));
    const results = await Promise.all([
      identificarPasajero({ ...input, nombre: registro.nombre }), identificarPasajero(input),
    ]);
    expect(results[0].ok).toBe(true);
    expect(results[1]).toEqual(results[0]);
    expect(create).toHaveBeenCalledTimes(2);
    expect(lookup).toHaveBeenCalledTimes(3);
  });

  it.each([uniqueError(["id"]), uniqueError(["whatsapp_id", "id"]),
    new Error("Persistence failure"), { code: "P2002" },
    new Prisma.PrismaClientKnownRequestError("Failure", { code: "P2024", clientVersion: Prisma.prismaVersion.client }),
  ])("propaga errores inesperados sin recuperar ni ocultar %j", async (error) => {
    lookup.mockResolvedValueOnce(null);
    create.mockRejectedValueOnce(error);
    await expect(identificarPasajero(input)).rejects.toBe(error);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it.each([["whatsapp_id"], undefined])("propaga P2002 sin ganador con target %j", async (target) => {
    const error = uniqueError(target);
    lookup.mockResolvedValue(null);
    create.mockRejectedValueOnce(error);
    await expect(identificarPasajero(input)).rejects.toBe(error);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("propaga fallo de lectura, recuperacion=%s", async (recovery) => {
    const error = new Error("Read failure");
    if (recovery) {
      lookup.mockResolvedValueOnce(null);
      create.mockRejectedValueOnce(uniqueError());
    }
    lookup.mockRejectedValueOnce(error);
    await expect(identificarPasajero(input)).rejects.toBe(error);
    expect(create).toHaveBeenCalledTimes(recovery ? 1 : 0);
  });
});

describe("aceptar aviso sin base de datos", () => {
  const primeraFecha = new Date("2026-09-15T14:00:00.123Z");
  const aceptado = { ...registro, aceptacionAvisoPrivacidad: primeraFecha };
  const esperado = { ok: true, pasajero: {
    id: registro.id, whatsappId: registro.whatsappId, nombre: registro.nombre,
    aceptacionAvisoPrivacidad: primeraFecha.toISOString(), creadoEn: registro.creadoEn.toISOString(),
  } };

  it("primera aceptacion escribe fecha del servidor con filtros atomicos antes de leer el activo", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(primeraFecha);
    updateMany.mockResolvedValueOnce({ count: 1 });
    findFirst.mockResolvedValueOnce(aceptado);
    const result = await aceptarAvisoPasajero(registro.id);
    expect(updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: registro.id, eliminadoEn: null, aceptacionAvisoPrivacidad: null },
      data: { aceptacionAvisoPrivacidad: primeraFecha },
    });
    expect(findFirst).toHaveBeenCalledExactlyOnceWith({
      where: { id: registro.id, eliminadoEn: null }, select,
    });
    expect(updateMany.mock.invocationCallOrder[0]).toBeLessThan(findFirst.mock.invocationCallOrder[0]);
    expect(lookup).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(result).toEqual(esperado);
    if (result.ok) expect(pasajeroDtoSchema.parse(result.pasajero)).toEqual(result.pasajero);
  });

  it("repetir con otro reloj conserva la primera fecha recuperada cuando count es cero", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(primeraFecha);
    updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    findFirst.mockResolvedValue(aceptado);
    const primero = await aceptarAvisoPasajero(registro.id);
    const despues = new Date("2026-09-16T14:00:00.123Z");
    vi.setSystemTime(despues);
    expect(await aceptarAvisoPasajero(registro.id)).toEqual(primero);
    expect(primero).toEqual(esperado);
    expect(updateMany).toHaveBeenLastCalledWith({
      where: { id: registro.id, eliminadoEn: null, aceptacionAvisoPrivacidad: null },
      data: { aceptacionAvisoPrivacidad: despues },
    });
  });

  it("dos llamadas devuelven la fecha ganadora recuperada, no su fecha candidata (carrera simulada)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(primeraFecha);
    updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    findFirst.mockResolvedValue(aceptado);
    const primera = aceptarAvisoPasajero(registro.id);
    vi.setSystemTime(new Date("2026-09-15T14:00:01.456Z"));
    const segunda = aceptarAvisoPasajero(registro.id);
    expect(await Promise.all([primera, segunda])).toEqual([esperado, esperado]);
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(findFirst).toHaveBeenCalledTimes(2);
    expect(updateMany.mock.calls[0][0].data.aceptacionAvisoPrivacidad)
      .not.toEqual(updateMany.mock.calls[1][0].data.aceptacionAvisoPrivacidad);
  });

  it.each([
    { caso: "inexistente", count: 0 },
    { caso: "eliminado", count: 0 },
    { caso: "eliminado despues de escribir", count: 1 },
  ])("devuelve NOT_FOUND si no recupera activo: $caso", async ({ count }) => {
    updateMany.mockResolvedValueOnce({ count });
    findFirst.mockResolvedValueOnce(null);
    expect(await aceptarAvisoPasajero(registro.id)).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(findFirst).toHaveBeenCalledExactlyOnceWith({
      where: { id: registro.id, eliminadoEn: null }, select,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("propaga fallo de escritura sin consultar ni devolver exito", async () => {
    const error = new Error("Write failure");
    updateMany.mockRejectedValueOnce(error);
    await expect(aceptarAvisoPasajero(registro.id)).rejects.toBe(error);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("propaga fallo al recuperar sin reintentar ni inventar fecha de respuesta", async () => {
    const error = new Error("Read failure");
    updateMany.mockResolvedValueOnce({ count: 1 });
    findFirst.mockRejectedValueOnce(error);
    await expect(aceptarAvisoPasajero(registro.id)).rejects.toBe(error);
    expect(updateMany).toHaveBeenCalledTimes(1);
  });
});
