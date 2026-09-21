import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/config/prisma";
import {
  barridoInicial, cancelarExpiracion, expirarSiVencida, programarExpiracion,
} from "../src/modules/solicitudes/solicitudes.service";

vi.mock("../src/config/prisma", () => {
  const solicitud = {
    findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(),
  };
  const pasajero = { findUnique: vi.fn() };
  const conductor = { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() };
  const solicitudConductorRechazado = { create: vi.fn() };
  const prisma = { solicitud, pasajero, conductor, solicitudConductorRechazado, $transaction: vi.fn() };
  prisma.$transaction.mockImplementation(async (fn: unknown) =>
    (typeof fn === "function" ? fn(prisma) : Promise.all(fn as [])));
  return { prisma };
});

const solicitudFindFirst = vi.mocked(prisma.solicitud.findFirst);
const solicitudFindMany = vi.mocked(prisma.solicitud.findMany);
const solicitudUpdateMany = vi.mocked(prisma.solicitud.updateMany);
const conductorUpdate = vi.mocked(prisma.conductor.update);
const rechazoCreate = vi.mocked(prisma.solicitudConductorRechazado.create);

const solicitudId = "7a1f2c4e-0000-4000-8000-000000000000";
const conductorId = "8e7acf6d-0e5b-4e6a-9f2a-1c2b3d4e5f60";
const ahora = new Date("2026-09-16T12:00:00.000Z");
const expiraEn = new Date(ahora.getTime() + 60_000);

let infoSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(ahora);
  vi.clearAllMocks();
  infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  infoSpy.mockRestore();
  vi.useRealTimers();
});

function configurarExpiracionExitosa(id: string) {
  solicitudFindFirst.mockResolvedValue({ id, conductorAsignadoId: conductorId });
  solicitudUpdateMany.mockResolvedValue({ count: 1 });
  rechazoCreate.mockResolvedValue({ id: `exclusion-${id}` });
  conductorUpdate.mockResolvedValue({});
}

describe("programarExpiracion", () => {
  it("ejecuta expirarSiVencida cuando expiraEn - now se alcanza", async () => {
    configurarExpiracionExitosa(solicitudId);
    programarExpiracion(solicitudId, expiraEn);
    vi.advanceTimersByTime(59_999);
    expect(solicitudUpdateMany).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await vi.waitFor(() => {
      expect(solicitudUpdateMany).toHaveBeenCalledWith({
        where: { id: solicitudId, estado: "esperando_respuesta", expiraEn: { lte: expect.any(Date) }, eliminadoEn: null },
        data: { estado: "buscando", conductorAsignadoId: null, expiraEn: null },
      });
    });
  });

  it("rechazado registra la exclusion con motivo expiracion y libera al conductor", async () => {
    configurarExpiracionExitosa(solicitudId);
    programarExpiracion(solicitudId, expiraEn);
    vi.advanceTimersByTime(60_000);
    await vi.waitFor(() => {
      expect(rechazoCreate).toHaveBeenCalledWith({
        data: { solicitudId, conductorId, motivo: "expiracion" },
        select: expect.anything(),
      });
      expect(conductorUpdate).toHaveBeenCalledWith({
        where: { id: conductorId }, data: { estadoDisponibilidad: "disponible" },
      });
      expect(infoSpy).toHaveBeenCalledWith(`[job-expiracion] Solicitud ${solicitudId} expirada (motivo: job interno)`);
    });
  });

  it("no agenda un timeout cuando expiraEn ya esta vencido (ms <= 0)", async () => {
    programarExpiracion(solicitudId, new Date(ahora.getTime() - 1));
    vi.advanceTimersByTime(120_000);
    expect(solicitudFindFirst).not.toHaveBeenCalled();
    expect(solicitudUpdateMany).not.toHaveBeenCalled();
  });

  it("programarExpiracion reemplaza un timeout previo de la misma solicitud", async () => {
    configurarExpiracionExitosa(solicitudId);
    programarExpiracion(solicitudId, expiraEn);
    programarExpiracion(solicitudId, new Date(ahora.getTime() + 120_000));
    vi.advanceTimersByTime(60_000);
    expect(solicitudFindFirst).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    await vi.waitFor(() => expect(solicitudUpdateMany).toHaveBeenCalled());
  });
});

describe("cancelarExpiracion", () => {
  it("cancela el timeout pendiente de la solicitud", async () => {
    configurarExpiracionExitosa(solicitudId);
    programarExpiracion(solicitudId, expiraEn);
    cancelarExpiracion(solicitudId);
    vi.advanceTimersByTime(120_000);
    expect(solicitudFindFirst).not.toHaveBeenCalled();
    expect(solicitudUpdateMany).not.toHaveBeenCalled();
  });

  it("es segura cuando no hay timeout registrado", () => {
    cancelarExpiracion(solicitudId);
    vi.advanceTimersByTime(1000);
    expect(solicitudFindFirst).not.toHaveBeenCalled();
  });
});

describe("expirarSiVencida", () => {
  it("expira por limite inclusivo (expiraEn <= now)", async () => {
    configurarExpiracionExitosa(solicitudId);
    await expirarSiVencida(solicitudId, expiraEn);
    expect(solicitudFindFirst).toHaveBeenCalledWith({
      where: { id: solicitudId, eliminadoEn: null, estado: "esperando_respuesta", expiraEn: { lte: expiraEn } },
      select: { id: true, conductorAsignadoId: true },
    });
    expect(solicitudUpdateMany).toHaveBeenCalled();
  });

  it("no hace nada sobre una solicitud que ya cambio de estado (idempotente)", async () => {
    solicitudFindFirst.mockResolvedValueOnce(null);
    await expirarSiVencida(solicitudId, expiraEn);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(rechazoCreate).not.toHaveBeenCalled();
  });

  it("no duplica la exclusion si la actualizacion condicional no afecta filas", async () => {
    solicitudFindFirst.mockResolvedValueOnce({ id: solicitudId, conductorAsignadoId: conductorId });
    solicitudUpdateMany.mockResolvedValueOnce({ count: 0 });
    await expirarSiVencida(solicitudId, expiraEn);
    expect(rechazoCreate).not.toHaveBeenCalled();
    expect(conductorUpdate).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });
});

describe("barridoInicial", () => {
  it("expira las vencidas y reprograma las pendientes tras un reinicio", async () => {
    configurarExpiracionExitosa("vencida-1");
    solicitudFindMany
      .mockResolvedValueOnce([{ id: "vencida-1" }])
      .mockResolvedValueOnce([{ id: "pendiente-1", expiraEn }]);
    solicitudUpdateMany.mockResolvedValue({ count: 1 });

    await barridoInicial(ahora);

    expect(solicitudFindMany).toHaveBeenNthCalledWith(1, {
      where: { estado: "esperando_respuesta", expiraEn: { lte: ahora }, eliminadoEn: null },
      select: { id: true },
    });
    expect(solicitudUpdateMany).toHaveBeenCalledWith({
      where: { id: "vencida-1", estado: "esperando_respuesta", expiraEn: { lte: ahora }, eliminadoEn: null },
      data: { estado: "buscando", conductorAsignadoId: null, expiraEn: null },
    });
    expect(solicitudFindMany).toHaveBeenNthCalledWith(2, {
      where: { estado: "esperando_respuesta", expiraEn: { gt: ahora }, eliminadoEn: null },
      select: { id: true, expiraEn: true },
    });

    // La pendiente queda reprogramada: al vencer se expira sola.
    vi.advanceTimersByTime(60_000);
    await vi.waitFor(() => {
      expect(solicitudUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ id: "pendiente-1" }),
      }));
    });
  });
});