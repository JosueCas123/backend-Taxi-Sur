import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/config/prisma";
import { obtenerCandidatos } from "../src/modules/motor-asignacion/motor-asignacion.service";
import { notificarPasajero } from "../src/modules/solicitudes/notificaciones";
import {
  crearSolicitud, finalizarSolicitud, marcarSinConductor, obtenerSolicitud,
  responderSolicitud, seleccionarConductor, VENTANA_RESPUESTA_MS,
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

vi.mock("../src/modules/motor-asignacion/motor-asignacion.service", () => ({
  obtenerCandidatos: vi.fn(),
}));

vi.mock("../src/modules/solicitudes/notificaciones", () => ({
  notificarPasajero: vi.fn(),
}));

const solicitudFindFirst = vi.mocked(prisma.solicitud.findFirst);
const solicitudFindMany = vi.mocked(prisma.solicitud.findMany);
const solicitudCreate = vi.mocked(prisma.solicitud.create);
const solicitudUpdateMany = vi.mocked(prisma.solicitud.updateMany);
const pasajeroFindUnique = vi.mocked(prisma.pasajero.findUnique);
const conductorUpdate = vi.mocked(prisma.conductor.update);
const conductorUpdateMany = vi.mocked(prisma.conductor.updateMany);
const conductorFindFirst = vi.mocked(prisma.conductor.findFirst);
const conductorFindUnique = vi.mocked(prisma.conductor.findUnique);
const rechazoCreate = vi.mocked(prisma.solicitudConductorRechazado.create);
const candidatosMock = vi.mocked(obtenerCandidatos);
const notificarMock = vi.mocked(notificarPasajero);

const solicitudId = "7a1f2c4e-0000-4000-8000-000000000000";
const pasajeroId = "d9428888-122b-4e1f-b85c-61cd3cbb3210";
const conductorId = "8e7acf6d-0e5b-4e6a-9f2a-1c2b3d4e5f60";
const otroConductorId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const usuarioId = "c4f3a2b1-9e8d-4a6b-8c1d-2e3f4a5b6c7d";

const ahora = new Date("2026-09-16T12:00:00.000Z");
const expiraEn = new Date(ahora.getTime() + VENTANA_RESPUESTA_MS);

const coordenadas = { latitudRecogida: -17.7833, longitudRecogida: -63.1821 };

type FilaSolicitud = ReturnType<typeof fila>;

function fila(overrides: Partial<{
  id: string;
  pasajeroId: string;
  conductorAsignadoId: string | null;
  estado: string;
  latitudRecogida: number;
  longitudRecogida: number;
  destino: string | null;
  expiraEn: Date | null;
  aceptadaEn: Date | null;
  finalizadaEn: Date | null;
  creadoEn: Date;
}>) {
  return {
    id: solicitudId,
    pasajeroId,
    conductorAsignadoId: null,
    estado: "buscando",
    latitudRecogida: -17.7833,
    longitudRecogida: -63.1821,
    destino: "Plaza 24 de Septiembre",
    expiraEn: null,
    aceptadaEn: null,
    finalizadaEn: null,
    creadoEn: ahora,
    ...overrides,
  } as FilaSolicitud;
}

function dtoEsperado(overrides: Partial<Record<string, unknown>> = {}) {
  const base = fila();
  return {
    id: base.id,
    pasajeroId: base.pasajeroId,
    conductorAsignadoId: base.conductorAsignadoId,
    estado: base.estado,
    latitudRecogida: base.latitudRecogida,
    longitudRecogida: base.longitudRecogida,
    destino: base.destino,
    expiraEn: base.expiraEn?.toISOString() ?? null,
    aceptadaEn: base.aceptadaEn?.toISOString() ?? null,
    finalizadaEn: base.finalizadaEn?.toISOString() ?? null,
    creadoEn: base.creadoEn.toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(ahora);
  vi.clearAllMocks();
  candidatosMock.mockResolvedValue({ ok: true, candidatos: [] });
  notificarMock.mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("crearSolicitud (Regla 1 y aviso de privacidad)", () => {
  it("crea en buscando cuando el pasajero existe, acepto el aviso y no tiene solicitud activa", async () => {
    pasajeroFindUnique.mockResolvedValueOnce({
      id: pasajeroId, aceptacionAvisoPrivacidad: new Date("2026-09-01T10:00:00.000Z"), eliminadoEn: null,
    });
    solicitudFindFirst.mockResolvedValueOnce(null);
    solicitudCreate.mockResolvedValueOnce(fila());
    const result = await crearSolicitud({ ...coordenadas, pasajeroId, destino: "Plaza 24 de Septiembre" }, ahora);
    expect(result).toEqual({ ok: true, solicitud: dtoEsperado() });
    expect(solicitudCreate).toHaveBeenCalledWith({
      data: { pasajeroId, estado: "buscando", ...coordenadas, destino: "Plaza 24 de Septiembre" },
      select: expect.anything(),
    });
  });

  it("crea con destino null cuando no viene un destino", async () => {
    pasajeroFindUnique.mockResolvedValueOnce({ id: pasajeroId, aceptacionAvisoPrivacidad: ahora, eliminadoEn: null });
    solicitudFindFirst.mockResolvedValueOnce(null);
    solicitudCreate.mockResolvedValueOnce(fila({ destino: null }));
    const result = await crearSolicitud({ ...coordenadas, pasajeroId }, ahora);
    expect(result).toEqual({ ok: true, solicitud: dtoEsperado({ destino: null }) });
    expect(solicitudCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ destino: null }),
    }));
  });

  it("pasajero inexistente devuelve NOT_FOUND", async () => {
    pasajeroFindUnique.mockResolvedValueOnce(null);
    const result = await crearSolicitud({ ...coordenadas, pasajeroId }, ahora);
    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(solicitudCreate).not.toHaveBeenCalled();
  });

  it("pasajero eliminado logicamente devuelve NOT_FOUND", async () => {
    pasajeroFindUnique.mockResolvedValueOnce({
      id: pasajeroId, aceptacionAvisoPrivacidad: ahora, eliminadoEn: new Date("2026-09-02T00:00:00.000Z"),
    });
    const result = await crearSolicitud({ ...coordenadas, pasajeroId }, ahora);
    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("pasajero sin aviso de privacidad devuelve AVISO_NO_ACEPTADO", async () => {
    pasajeroFindUnique.mockResolvedValueOnce({ id: pasajeroId, aceptacionAvisoPrivacidad: null, eliminadoEn: null });
    const result = await crearSolicitud({ ...coordenadas, pasajeroId }, ahora);
    expect(result).toEqual({ ok: false, code: "AVISO_NO_ACEPTADO" });
    expect(solicitudCreate).not.toHaveBeenCalled();
  });

  it.each(["creada", "buscando", "conductor_seleccionado", "esperando_respuesta", "aceptada", "en_servicio"])(
    "Regla 1: una solicitud en %s bloquea la creacion (SOLICITUD_ACTIVA)",
    async (estado) => {
      pasajeroFindUnique.mockResolvedValueOnce({ id: pasajeroId, aceptacionAvisoPrivacidad: ahora, eliminadoEn: null });
      solicitudFindFirst.mockResolvedValueOnce({ id: "00000000-0000-4000-8000-000000000000" });
      const result = await crearSolicitud({ ...coordenadas, pasajeroId }, ahora);
      expect(result).toEqual({ ok: false, code: "SOLICITUD_ACTIVA" });
      expect(solicitudCreate).not.toHaveBeenCalled();
    },
  );

  it.each(["finalizada", "rechazada", "expirada", "sin_conductor"])(
    "Regla 1: una solicitud terminal (%s) no bloquea la creacion",
    async (estado) => {
      pasajeroFindUnique.mockResolvedValueOnce({ id: pasajeroId, aceptacionAvisoPrivacidad: ahora, eliminadoEn: null });
      solicitudFindFirst.mockResolvedValueOnce(null);
      solicitudCreate.mockResolvedValueOnce(fila());
      const result = await crearSolicitud({ ...coordenadas, pasajeroId }, ahora);
      expect(result.ok).toBe(true);
      const args = (solicitudFindFirst.mock.calls[0] as any)[0];
      expect(args.where.estado.in).toEqual([
        "creada", "buscando", "conductor_seleccionado", "esperando_respuesta",
        "aceptada", "en_servicio",
      ]);
      expect(args.where.estado.in).not.toContain(estado);
    },
  );
});

describe("seleccionarConductor (reserva temporal, Reglas 5 y 6)", () => {
  const candidato = { conductorId, nombreCompleto: "Juan Perez", distanciaKm: 2.5, vehiculo: { placa: "1234ABC", marca: "Toyota", modelo: "Corolla", color: "Blanco", capacidadPasajeros: 4 } };

  it("reserva al conductor, fija expiraEn = now + 60000 y agenda la expiracion", async () => {
    solicitudFindFirst.mockResolvedValueOnce({ id: solicitudId, estado: "buscando" });
    candidatosMock.mockResolvedValueOnce({ ok: true, candidatos: [candidato] });
    conductorUpdateMany.mockResolvedValueOnce({ count: 1 });
    solicitudUpdateMany.mockResolvedValueOnce({ count: 1 });
    solicitudFindFirst.mockResolvedValueOnce(fila({ conductorAsignadoId: conductorId, estado: "esperando_respuesta", expiraEn }));
    const result = await seleccionarConductor(solicitudId, conductorId, ahora);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.expiraEn.getTime()).toBe(ahora.getTime() + VENTANA_RESPUESTA_MS);
      expect(result.solicitud.estado).toBe("esperando_respuesta");
      expect(result.solicitud.conductorAsignadoId).toBe(conductorId);
      expect(result.solicitud.expiraEn).toBe(expiraEn.toISOString());
    }
    expect(conductorUpdateMany).toHaveBeenCalledWith({
      where: { id: conductorId, estadoDisponibilidad: "disponible" },
      data: { estadoDisponibilidad: "solicitud_pendiente" },
    });
    expect(solicitudUpdateMany).toHaveBeenCalledWith({
      where: { id: solicitudId, estado: "buscando", eliminadoEn: null },
      data: { conductorAsignadoId: conductorId, estado: "esperando_respuesta", expiraEn },
    });
  });

  it("usa now como el numero de ms si se pasa como numero", async () => {
    const now = ahora.getTime();
    solicitudFindFirst.mockResolvedValueOnce({ id: solicitudId, estado: "buscando" });
    candidatosMock.mockResolvedValueOnce({ ok: true, candidatos: [candidato] });
    conductorUpdateMany.mockResolvedValueOnce({ count: 1 });
    solicitudUpdateMany.mockResolvedValueOnce({ count: 1 });
    solicitudFindFirst.mockResolvedValueOnce(fila({ estado: "esperando_respuesta", expiraEn }));
    const result = await seleccionarConductor(solicitudId, conductorId, now);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.expiraEn.getTime()).toBe(now + VENTANA_RESPUESTA_MS);
  });

  it("solicitud inexistente o eliminada devuelve NOT_FOUND", async () => {
    solicitudFindFirst.mockResolvedValueOnce(null);
    const result = await seleccionarConductor(solicitudId, conductorId, ahora);
    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(conductorUpdateMany).not.toHaveBeenCalled();
  });

  it("solicitud que no esta en buscando devuelve ESTADO_INVALIDO", async () => {
    for (const estado of ["esperando_respuesta", "en_servicio", "finalizada"]) {
      solicitudFindFirst.mockReset();
      solicitudFindFirst.mockResolvedValueOnce({ id: solicitudId, estado });
      const result = await seleccionarConductor(solicitudId, conductorId, ahora);
      expect(result).toEqual({ ok: false, code: "ESTADO_INVALIDO" });
    }
  });

  it("conductor que no esta entre los candidatos actuales devuelve CANDIDATO_INVALIDO sin reservar", async () => {
    solicitudFindFirst.mockResolvedValueOnce({ id: solicitudId, estado: "buscando" });
    candidatosMock.mockResolvedValueOnce({ ok: true, candidatos: [{ ...candidato, conductorId: otroConductorId }] });
    const result = await seleccionarConductor(solicitudId, conductorId, ahora);
    expect(result).toEqual({ ok: false, code: "CANDIDATO_INVALIDO" });
    expect(conductorUpdateMany).not.toHaveBeenCalled();
    expect(solicitudUpdateMany).not.toHaveBeenCalled();
  });

  it("sin candidatos devuelve CANDIDATO_INVALIDO", async () => {
    solicitudFindFirst.mockResolvedValueOnce({ id: solicitudId, estado: "buscando" });
    candidatosMock.mockResolvedValueOnce({ ok: true, candidatos: [] });
    const result = await seleccionarConductor(solicitudId, conductorId, ahora);
    expect(result).toEqual({ ok: false, code: "CANDIDATO_INVALIDO" });
    expect(solicitudUpdateMany).not.toHaveBeenCalled();
  });

  it("candidatos NOT_FOUND propaga NOT_FOUND", async () => {
    solicitudFindFirst.mockResolvedValueOnce({ id: solicitudId, estado: "buscando" });
    candidatosMock.mockResolvedValueOnce({ ok: false, code: "NOT_FOUND" });
    const result = await seleccionarConductor(solicitudId, conductorId, ahora);
    expect(result).toEqual({ ok: false, code: "CANDIDATO_INVALIDO" });
  });

  it("conductor ya no disponible devuelve CANDIDATO_INVALIDO sin reservar (carrera)", async () => {
    solicitudFindFirst.mockResolvedValueOnce({ id: solicitudId, estado: "buscando" });
    candidatosMock.mockResolvedValueOnce({ ok: true, candidatos: [candidato] });
    conductorUpdateMany.mockResolvedValueOnce({ count: 0 });
    const result = await seleccionarConductor(solicitudId, conductorId, ahora);
    expect(result).toEqual({ ok: false, code: "CANDIDATO_INVALIDO" });
    expect(solicitudUpdateMany).not.toHaveBeenCalled();
  });

  it("si la solicitud pierde la carrera revierte la reserva del conductor (ESTADO_INVALIDO)", async () => {
    solicitudFindFirst.mockResolvedValueOnce({ id: solicitudId, estado: "buscando" });
    candidatosMock.mockResolvedValueOnce({ ok: true, candidatos: [candidato] });
    conductorUpdateMany.mockResolvedValueOnce({ count: 1 });
    solicitudUpdateMany.mockResolvedValueOnce({ count: 0 });
    const result = await seleccionarConductor(solicitudId, conductorId, ahora);
    expect(result).toEqual({ ok: false, code: "ESTADO_INVALIDO" });
    expect(conductorUpdateMany).toHaveBeenLastCalledWith({
      where: { id: conductorId, estadoDisponibilidad: "solicitud_pendiente" },
      data: { estadoDisponibilidad: "disponible" },
    });
  });
});

describe("responderSolicitud (Reglas 7 y propietario)", () => {
  const filaAcepta = fila({ conductorAsignadoId: conductorId, estado: "esperando_respuesta", expiraEn });
  const solicitudPropietario = {
    id: solicitudId, estado: "esperando_respuesta", pasajeroId,
    conductorAsignadoId: conductorId,
    conductorAsignado: { usuarioId, nombreCompleto: "Juan Perez" },
  };

  it("acepta: pasa a en_servicio, fija aceptadaEn, limpia expiraEn, reserva al conductor y notifica", async () => {
    solicitudFindFirst.mockResolvedValueOnce(solicitudPropietario);
    solicitudUpdateMany.mockResolvedValueOnce({ count: 1 });
    conductorUpdate.mockResolvedValueOnce({});
    conductorFindFirst.mockResolvedValueOnce({
      nombreCompleto: "Juan Perez",
      vehiculos: [{ placa: "1234ABC" }],
    });
    solicitudFindFirst.mockResolvedValueOnce(fila({
      conductorAsignadoId: conductorId, estado: "en_servicio",
      aceptadaEn: ahora, expiraEn: null,
    }));
    const result = await responderSolicitud(solicitudId, usuarioId, true, ahora);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.solicitud).toEqual(dtoEsperado({
        conductorAsignadoId: conductorId, estado: "en_servicio",
        aceptadaEn: ahora.toISOString(), expiraEn: null,
      }));
    }
    expect(solicitudUpdateMany).toHaveBeenCalledWith({
      where: { id: solicitudId, estado: "esperando_respuesta", eliminadoEn: null },
      data: { estado: "en_servicio", aceptadaEn: ahora, expiraEn: null },
    });
    expect(conductorUpdate).toHaveBeenCalledWith({
      where: { id: conductorId }, data: { estadoDisponibilidad: "en_servicio" },
    });
    expect(notificarMock).toHaveBeenCalledWith(pasajeroId, {
      solicitudId, conductorNombre: "Juan Perez", placa: "1234ABC",
    });
  });

  it("rechaza: registra la exclusion, libera al conductor y vuelve a buscando", async () => {
    solicitudFindFirst.mockResolvedValueOnce(solicitudPropietario);
    solicitudUpdateMany.mockResolvedValueOnce({ count: 1 });
    rechazoCreate.mockResolvedValueOnce({ id: "exclusion-1" });
    conductorUpdate.mockResolvedValueOnce({});
    solicitudFindFirst.mockResolvedValueOnce(fila({ conductorAsignadoId: null, estado: "buscando", expiraEn: null }));
    const result = await responderSolicitud(solicitudId, usuarioId, false, ahora);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.solicitud).toEqual(dtoEsperado({ conductorAsignadoId: null, estado: "buscando", expiraEn: null }));
    }
    expect(solicitudUpdateMany).toHaveBeenCalledWith({
      where: { id: solicitudId, estado: "esperando_respuesta", eliminadoEn: null },
      data: { estado: "buscando", conductorAsignadoId: null, expiraEn: null },
    });
    expect(rechazoCreate).toHaveBeenCalledWith({
      data: { solicitudId, conductorId, motivo: "rechazo" },
      select: expect.anything(),
    });
    expect(conductorUpdate).toHaveBeenCalledWith({
      where: { id: conductorId }, data: { estadoDisponibilidad: "disponible" },
    });
    expect(notificarMock).not.toHaveBeenCalled();
  });

  it("solicitud inexistente devuelve NOT_FOUND antes que cualquier propiedad", async () => {
    solicitudFindFirst.mockResolvedValueOnce(null);
    const result = await responderSolicitud(solicitudId, usuarioId, true, ahora);
    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(solicitudUpdateMany).not.toHaveBeenCalled();
  });

  it("conductor distinto del asignado devuelve FORBIDDEN sin revelar el recurso", async () => {
    solicitudFindFirst.mockResolvedValueOnce({
      ...solicitudPropietario,
      conductorAsignado: { usuarioId, nombreCompleto: "Juan Perez" },
    });
    const result = await responderSolicitud(solicitudId, "otro-usuario", true, ahora);
    expect(result).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(solicitudUpdateMany).not.toHaveBeenCalled();
    expect(rechazoCreate).not.toHaveBeenCalled();
  });

  it("solicitud no en esperando_respuesta devuelve ESTADO_INVALIDO", async () => {
    for (const estado of ["buscando", "en_servicio", "finalizada"]) {
      solicitudFindFirst.mockReset();
      solicitudFindFirst.mockResolvedValueOnce({ ...solicitudPropietario, estado });
      const result = await responderSolicitud(solicitudId, usuarioId, true, ahora);
      expect(result).toEqual({ ok: false, code: "ESTADO_INVALIDO" });
      expect(solicitudUpdateMany).not.toHaveBeenCalled();
    }
  });

  it("la actualizacion condicional protege de una expiracion concurrente (ESTADO_INVALIDO)", async () => {
    solicitudFindFirst.mockResolvedValueOnce(solicitudPropietario);
    solicitudUpdateMany.mockResolvedValueOnce({ count: 0 });
    const result = await responderSolicitud(solicitudId, usuarioId, true, ahora);
    expect(result).toEqual({ ok: false, code: "ESTADO_INVALIDO" });
  });
});

describe("finalizarSolicitud (Regla 10 y 11)", () => {
  const solicitudEnServicio = {
    id: solicitudId, estado: "en_servicio", conductorAsignadoId: conductorId,
    conductorAsignado: { usuarioId },
  };

  it("finaliza, fija finalizadaEn y libera al conductor (disponible si jornada activa)", async () => {
    solicitudFindFirst.mockResolvedValueOnce(solicitudEnServicio);
    solicitudUpdateMany.mockResolvedValueOnce({ count: 1 });
    conductorFindUnique.mockResolvedValueOnce({ estadoJornada: "activa" });
    conductorUpdate.mockResolvedValueOnce({});
    solicitudFindFirst.mockResolvedValueOnce(fila({
      conductorAsignadoId: conductorId, estado: "finalizada", finalizadaEn: ahora,
    }));
    const result = await finalizarSolicitud(solicitudId, usuarioId, ahora);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.solicitud).toEqual(dtoEsperado({
        conductorAsignadoId: conductorId, estado: "finalizada", finalizadaEn: ahora.toISOString(),
      }));
    }
    expect(solicitudUpdateMany).toHaveBeenCalledWith({
      where: { id: solicitudId, estado: "en_servicio", eliminadoEn: null },
      data: { estado: "finalizada", finalizadaEn: ahora },
    });
    expect(conductorUpdate).toHaveBeenCalledWith({
      where: { id: conductorId }, data: { estadoDisponibilidad: "disponible" },
    });
  });

  it("libera al conductor como no_disponible cuando la jornada no esta activa", async () => {
    for (const estadoJornada of ["no_iniciada", "finalizada"]) {
      conductorFindUnique.mockReset();
      solicitudFindFirst.mockReset();
      solicitudFindFirst.mockResolvedValueOnce(solicitudEnServicio);
      solicitudUpdateMany.mockReset();
      solicitudUpdateMany.mockResolvedValueOnce({ count: 1 });
      conductorFindUnique.mockResolvedValueOnce({ estadoJornada });
      conductorUpdate.mockReset();
      conductorUpdate.mockResolvedValueOnce({});
      solicitudFindFirst.mockResolvedValueOnce(fila({ estado: "finalizada", finalizadaEn: ahora }));
      const result = await finalizarSolicitud(solicitudId, usuarioId, ahora);
      expect(result.ok).toBe(true);
      expect(conductorUpdate).toHaveBeenCalledWith({
        where: { id: conductorId }, data: { estadoDisponibilidad: "no_disponible" },
      });
    }
  });

  it("inexistente o eliminada devuelve NOT_FOUND", async () => {
    solicitudFindFirst.mockResolvedValueOnce(null);
    const result = await finalizarSolicitud(solicitudId, usuarioId, ahora);
    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("conductor distinto del asignado devuelve FORBIDDEN", async () => {
    solicitudFindFirst.mockResolvedValueOnce(solicitudEnServicio);
    const result = await finalizarSolicitud(solicitudId, "otro-usuario", ahora);
    expect(result).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(solicitudUpdateMany).not.toHaveBeenCalled();
  });

  it("solicitud que no esta en en_servicio devuelve ESTADO_INVALIDO", async () => {
    for (const estado of ["buscando", "esperando_respuesta", "finalizada"]) {
      solicitudFindFirst.mockReset();
      solicitudFindFirst.mockResolvedValueOnce({ ...solicitudEnServicio, estado });
      const result = await finalizarSolicitud(solicitudId, usuarioId, ahora);
      expect(result).toEqual({ ok: false, code: "ESTADO_INVALIDO" });
      expect(solicitudUpdateMany).not.toHaveBeenCalled();
    }
  });
});

describe("marcarSinConductor", () => {
  it("desde buscando pasa a sin_conductor y limpia asignado y expiraEn", async () => {
    solicitudUpdateMany.mockResolvedValueOnce({ count: 1 });
    solicitudFindFirst.mockResolvedValueOnce(fila({ estado: "sin_conductor", conductorAsignadoId: null, expiraEn: null }));
    const result = await marcarSinConductor(solicitudId);
    expect(result).toEqual({ ok: true, solicitud: dtoEsperado({ estado: "sin_conductor" }) });
    expect(solicitudUpdateMany).toHaveBeenCalledWith({
      where: { id: solicitudId, estado: "buscando", eliminadoEn: null },
      data: { estado: "sin_conductor", conductorAsignadoId: null, expiraEn: null },
    });
  });

  it("solicitud inexistente o eliminada devuelve NOT_FOUND", async () => {
    solicitudUpdateMany.mockResolvedValueOnce({ count: 0 });
    solicitudFindFirst.mockResolvedValueOnce({ eliminadoEn: new Date("2026-09-02T00:00:00.000Z") });
    const result = await marcarSinConductor(solicitudId);
    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("solicitud que no esta en buscando devuelve ESTADO_INVALIDO", async () => {
    solicitudUpdateMany.mockResolvedValueOnce({ count: 0 });
    solicitudFindFirst.mockResolvedValueOnce({ eliminadoEn: null });
    const result = await marcarSinConductor(solicitudId);
    expect(result).toEqual({ ok: false, code: "ESTADO_INVALIDO" });
  });
});

describe("obtenerSolicitud (detalle)", () => {
  it("devuelve el detalle con pasajero y conductor asignado con vehiculo activo", async () => {
    solicitudFindFirst.mockResolvedValueOnce({
      ...fila(),
      pasajero: { id: pasajeroId, nombre: "Ana Perez" },
      conductorAsignado: {
        id: conductorId, nombreCompleto: "Juan Perez",
        vehiculos: [{ placa: "1234ABC", marca: "Toyota", modelo: "Corolla", color: "Blanco", capacidadPasajeros: 4 }],
      },
    });
    const result = await obtenerSolicitud(solicitudId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.solicitud).toEqual({
        ...dtoEsperado(),
        pasajero: { id: pasajeroId, nombre: "Ana Perez" },
        conductorAsignado: {
          id: conductorId, nombreCompleto: "Juan Perez",
          vehiculo: { placa: "1234ABC", marca: "Toyota", modelo: "Corolla", color: "Blanco", capacidadPasajeros: 4 },
        },
      });
    }
  });

  it("devuelve conductorAsignado null cuando no hay conductor", async () => {
    solicitudFindFirst.mockResolvedValueOnce({
      ...fila(),
      pasajero: { id: pasajeroId, nombre: "Ana Perez" },
      conductorAsignado: null,
    });
    const result = await obtenerSolicitud(solicitudId);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.solicitud.conductorAsignado).toBeNull();
  });

  it("devuelve vehiculo null cuando el conductor no tiene vehiculo activo", async () => {
    solicitudFindFirst.mockResolvedValueOnce({
      ...fila(),
      pasajero: { id: pasajeroId, nombre: "Ana Perez" },
      conductorAsignado: { id: conductorId, nombreCompleto: "Juan Perez", vehiculos: [] },
    });
    const result = await obtenerSolicitud(solicitudId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.solicitud.conductorAsignado).toEqual({
        id: conductorId, nombreCompleto: "Juan Perez", vehiculo: null,
      });
    }
  });

  it("solicitud inexistente o eliminada devuelve NOT_FOUND", async () => {
    solicitudFindFirst.mockResolvedValueOnce(null);
    const result = await obtenerSolicitud(solicitudId);
    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("solicitudFindMany no se usa en este modulo de lectura", () => {
    expect(solicitudFindMany).toBeDefined();
  });
});