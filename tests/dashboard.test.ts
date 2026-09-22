import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";
import { Client } from "pg";
import type { EstadoDisponibilidad, EstadoSolicitud, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import app from "../src/app";
import { inicioDelDiaEnLaPaz, inicioDelDiaSiguienteEnLaPaz } from "../src/modules/dashboard/dashboard.service";
import { fechaDeNegocioEnLaPaz } from "../src/modules/tarifario/tarifario.service";
import {
  indicadoresDtoSchema, mapaConductorDtoSchema, solicitudActivaDtoSchema,
} from "../src/modules/dashboard/dashboard.schema";

const prefijo = "sp11-dash";

const usuariosCreados: string[] = [];
const conductoresCreados: string[] = [];
const pasajerosCreados: string[] = [];
const solicitudesCreadas: string[] = [];

const ESTADOS_ACTIVOS: EstadoSolicitud[] = [
  "creada", "buscando", "conductor_seleccionado", "esperando_respuesta", "aceptada", "en_servicio",
];
const ESTADOS_TERMINALES: EstadoSolicitud[] = ["finalizada", "rechazada", "expirada", "sin_conductor"];

const unauthorized = { error: { code: "UNAUTHORIZED", message: "Credenciales invalidas" } };
const forbidden = { error: { code: "FORBIDDEN", message: "Permiso denegado" } };
const validation = { error: { code: "VALIDATION_ERROR", message: "Entrada invalida" } };

const punto = { latitudRecogida: -17.7833, longitudRecogida: -63.1821 };

let prisma: PrismaClient;
let testUrl: string;
let jwtSecret: string;
let adminJwt: string;
let conductorJwt: string;

const n8n = () => ({ "X-N8N-Token": "unit-test-only-internal-secret-not-for-deployment" });

type ConductorOpciones = {
  estado?: "pendiente" | "aprobado" | "rechazado" | "suspendido";
  jornada?: "no_iniciada" | "activa" | "finalizada";
  disponibilidad?: EstadoDisponibilidad;
  conVehiculo?: boolean;
  ubicacion?: { antiguedadMs?: number; esValida?: boolean; eliminada?: boolean };
  nombreCompleto?: string;
  id?: string;
  usuarioEliminado?: boolean;
  conductorEliminado?: boolean;
};

async function crearConductor(opciones: ConductorOpciones = {}): Promise<{ conductorId: string; usuarioId: string }> {
  const sufijo = `${prefijo}-${randomUUID().replace(/-/g, "").slice(0, 6)}`;
  const usuario = await prisma.usuario.create({
    data: {
      id: randomUUID(),
      telefono: sufijo,
      rol: "conductor",
      eliminadoEn: opciones.usuarioEliminado ? new Date() : null,
    },
    select: { id: true },
  });
  const conductor = await prisma.conductor.create({
    data: {
      id: opciones.id,
      usuarioId: usuario.id,
      nombreCompleto: opciones.nombreCompleto ?? `${sufijo}-conductor`,
      cedulaIdentidad: randomUUID(),
      estado: opciones.estado ?? "aprobado",
      estadoJornada: opciones.jornada ?? "activa",
      estadoDisponibilidad: opciones.disponibilidad ?? "disponible",
      eliminadoEn: opciones.conductorEliminado ? new Date() : null,
      ...(opciones.conVehiculo !== false ? {
        vehiculos: { create: { placa: randomUUID().replace(/-/g, "").slice(0, 30), marca: "Toyota", modelo: "Corolla", color: "Blanco", capacidadPasajeros: 4 } },
      } : {}),
      ...(opciones.ubicacion ? {
        ubicaciones: { create: [{
          latitud: -17.79,
          longitud: -63.19,
          horaRegistro: new Date(Date.now() - (opciones.ubicacion.antiguedadMs ?? 30000)),
          esValida: opciones.ubicacion.esValida ?? true,
          eliminadoEn: opciones.ubicacion.eliminada ? new Date() : null,
        }] },
      } : {}),
    },
    select: { id: true },
  });
  usuariosCreados.push(usuario.id);
  conductoresCreados.push(conductor.id);
  return { conductorId: conductor.id, usuarioId: usuario.id };
}

async function crearPasajero(eliminado = false): Promise<string> {
  const pasajero = await prisma.pasajero.create({
    data: {
      whatsappId: `${prefijo}-${randomUUID().replace(/-/g, "").slice(0, 6)}`,
      nombre: "Pasajero de dashboard",
      aceptacionAvisoPrivacidad: new Date(),
      eliminadoEn: eliminado ? new Date() : null,
    },
    select: { id: true },
  });
  pasajerosCreados.push(pasajero.id);
  return pasajero.id;
}

type SolicitudOpciones = {
  pasajeroId: string;
  estado: EstadoSolicitud;
  conductorAsignadoId?: string | null;
  expiraEn?: Date | null;
  finalizadaEn?: Date | null;
  destino?: string | null;
  creadoEn?: Date;
  id?: string;
  eliminada?: boolean;
};

async function crearSolicitud(opciones: SolicitudOpciones): Promise<string> {
  const fila = await prisma.solicitud.create({
    data: {
      id: opciones.id,
      pasajeroId: opciones.pasajeroId,
      conductorAsignadoId: opciones.conductorAsignadoId ?? null,
      estado: opciones.estado,
      latitudRecogida: punto.latitudRecogida,
      longitudRecogida: punto.longitudRecogida,
      destino: opciones.destino === undefined ? "Centro" : opciones.destino,
      expiraEn: opciones.expiraEn === undefined ? null : opciones.expiraEn,
      finalizadaEn: opciones.finalizadaEn === undefined ? null : opciones.finalizadaEn,
      creadoEn: opciones.creadoEn ?? new Date(),
      eliminadoEn: opciones.eliminada ? new Date() : null,
    },
    select: { id: true },
  });
  solicitudesCreadas.push(fila.id);
  return fila.id;
}

async function indicadores() {
  const respuesta = await request(app).get("/api/dashboard/indicadores").set({ Authorization: adminJwt });
  expect(respuesta.status).toBe(200);
  expect(indicadoresDtoSchema.parse(respuesta.body)).toEqual(respuesta.body);
  return respuesta.body as {
    conductoresDisponibles: number;
    conductoresEnServicio: number;
    solicitudesActivas: number;
    solicitudesCompletadasHoy: number;
  };
}

beforeAll(async () => {
  const url = inject("adminTestDatabaseUrl");
  if (!url || process.env.DATABASE_URL !== url) throw new Error("Falta destino validado por el setup");
  testUrl = url;
  prisma = (await import("../src/config/prisma")).prisma;
  const { env } = await import("../src/config/env");
  jwtSecret = env.JWT_SECRET;

  await prisma.solicitud.deleteMany({ where: { pasajero: { whatsappId: { startsWith: prefijo } } } });
  await prisma.ubicacionConductor.deleteMany({ where: { conductor: { nombreCompleto: { startsWith: prefijo } } } });
  await prisma.vehiculo.deleteMany({ where: { conductor: { nombreCompleto: { startsWith: prefijo } } } });
  await prisma.pasajero.deleteMany({ where: { whatsappId: { startsWith: prefijo } } });
  await prisma.conductor.deleteMany({ where: { nombreCompleto: { startsWith: prefijo } } });
  await prisma.usuario.deleteMany({ where: { telefono: { startsWith: prefijo } } });

  const sign = (sub: string) => `Bearer ${jwt.sign({}, jwtSecret, { subject: sub, expiresIn: "1h" })}`;
  const admin = await prisma.usuario.create({
    data: { telefono: `${prefijo}-admin-${randomUUID().replace(/-/g, "").slice(0, 6)}`, rol: "admin" },
    select: { id: true },
  });
  const conductor = await prisma.usuario.create({
    data: { telefono: `${prefijo}-conductor-${randomUUID().replace(/-/g, "").slice(0, 6)}`, rol: "conductor" },
    select: { id: true },
  });
  usuariosCreados.push(admin.id, conductor.id);
  adminJwt = sign(admin.id);
  conductorJwt = sign(conductor.id);
}, 30000);

afterAll(async () => {
  if (!prisma) return;
  try {
    await prisma.solicitud.deleteMany({ where: { id: { in: solicitudesCreadas } } });
    await prisma.ubicacionConductor.deleteMany({ where: { conductorId: { in: conductoresCreados } } });
    await prisma.vehiculo.deleteMany({ where: { conductorId: { in: conductoresCreados } } });
    await prisma.pasajero.deleteMany({ where: { id: { in: pasajerosCreados } } });
    await prisma.conductor.deleteMany({ where: { id: { in: conductoresCreados } } });
    await prisma.usuario.deleteMany({ where: { id: { in: usuariosCreados } } });
    expect(await prisma.solicitud.count({ where: { id: { in: solicitudesCreadas } } })).toBe(0);
    expect(await prisma.pasajero.count({ where: { id: { in: pasajerosCreados } } })).toBe(0);
    expect(await prisma.conductor.count({ where: { id: { in: conductoresCreados } } })).toBe(0);
    expect(await prisma.usuario.count({ where: { id: { in: usuariosCreados } } })).toBe(0);
  } finally {
    await prisma.$disconnect();
  }
});

describe("GET /api/dashboard/conductores-mapa con base real", () => {
  it("devuelve mas de 25 conductores sin truncamiento, con orden estable y DTOs validos", async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 32; i += 1) {
      const { conductorId } = await crearConductor();
      ids.add(conductorId!);
    }
    const respuesta = await request(app).get("/api/dashboard/conductores-mapa").set({ Authorization: adminJwt });
    expect(respuesta.status).toBe(200);
    expect(respuesta.headers["cache-control"]).toBe("no-store");
    const mapa = respuesta.body as Array<{ id: string; nombreCompleto: string }>;
    expect(mapa.length).toBeGreaterThanOrEqual(32);
    expect(new Set(mapa.map((item) => item.id)).size).toBe(mapa.length);
    for (const item of mapa) {
      expect(mapaConductorDtoSchema.parse(item)).toEqual(item);
    }
    const propios = mapa.filter((item) => ids.has(item.id));
    expect(propios.length).toBe(32);
    const nombres = propios.map((item) => item.nombreCompleto);
    expect(nombres).toEqual([...nombres].sort());
  }, 60000);

  it("respeta el empate de orden con id ascendente", async () => {
    const grupo = `${prefijo}-iguales-${randomUUID().replace(/-/g, "").slice(0, 6)}`;
    await crearConductor({ nombreCompleto: grupo, id: "10000000-0000-4000-8000-000000000001" });
    await crearConductor({ nombreCompleto: grupo, id: "10000000-0000-4000-8000-000000000002" });
    const respuesta = await request(app).get("/api/dashboard/conductores-mapa").set({ Authorization: adminJwt });
    const orden = (respuesta.body as Array<{ id: string; nombreCompleto: string }>)
      .filter((item) => item.nombreCompleto === grupo)
      .map((item) => item.id);
    expect(orden).toEqual(["10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002"]);
  }, 30000);

  it("P06: conductor no eliminado permanece aunque su usuario este eliminado y un conductor eliminado queda fuera", async () => {
    const conUsuarioEliminado = await crearConductor({ usuarioEliminado: true, disponibilidad: "disponible" });
    const conductorEliminado = await crearConductor({ conductorEliminado: true, disponibilidad: "disponible" });
    const respuesta = await request(app).get("/api/dashboard/conductores-mapa").set({ Authorization: adminJwt });
    const ids = (respuesta.body as Array<{ id: string }>).map((item) => item.id);
    expect(ids).toContain(conUsuarioEliminado.conductorId);
    expect(ids).not.toContain(conductorEliminado.conductorId);
  }, 30000);

  it("incluye conductores en cualquier estado de aprobacion, jornada y disponibilidad", async () => {
    const pendiente = await crearConductor({ estado: "pendiente", jornada: "no_iniciada", disponibilidad: "no_disponible", conVehiculo: false });
    const respuesta = await request(app).get("/api/dashboard/conductores-mapa").set({ Authorization: adminJwt });
    const item = (respuesta.body as Array<Record<string, unknown>>).find((c) => c.id === pendiente.conductorId);
    expect(item).toMatchObject({ estado: "pendiente", estadoJornada: "no_iniciada", estadoDisponibilidad: "no_disponible", vehiculo: null });
  }, 30000);

  it("vehiculo y ubicacion son null cuando faltan, y conserva la ultima ubicacion registrada", async () => {
    const sinNada = await crearConductor({ conVehiculo: false });
    const respuesta = await request(app).get("/api/dashboard/conductores-mapa").set({ Authorization: adminJwt });
    const item = (respuesta.body as Array<Record<string, unknown>>).find((c) => c.id === sinNada.conductorId);
    expect(item).toMatchObject({ vehiculo: null, ubicacion: null, ultimaUbicacionRegistradaEn: null });
  }, 30000);

  it("vigencia GPS real: una reciente vale; 300000/300001 caducan, y bandera falsa o eliminada no", async () => {
    const fresca = await crearConductor({ ubicacion: { antiguedadMs: 30000 } });
    const borde300 = await crearConductor({ ubicacion: { antiguedadMs: 300000 } });
    const caducada = await crearConductor({ ubicacion: { antiguedadMs: 300001 } });
    const banderaFalsa = await crearConductor({ ubicacion: { antiguedadMs: 30000, esValida: false } });
    const eliminada = await crearConductor({ ubicacion: { antiguedadMs: 30000, eliminada: true } });
    const respuesta = await request(app).get("/api/dashboard/conductores-mapa").set({ Authorization: adminJwt });
    const porId = new Map<string, Record<string, unknown>>(
      (respuesta.body as Array<Record<string, unknown>>).map((item) => [String(item.id), item]),
    );
    expect(porId.get(fresca.conductorId)?.ubicacion).not.toBeNull();
    expect(porId.get(fresca.conductorId)?.ultimaUbicacionRegistradaEn).not.toBeNull();
    expect(porId.get(borde300.conductorId)?.ubicacion).toBeNull();
    expect(porId.get(borde300.conductorId)?.ultimaUbicacionRegistradaEn).not.toBeNull();
    expect(porId.get(caducada.conductorId)?.ubicacion).toBeNull();
    expect(porId.get(banderaFalsa.conductorId)?.ubicacion).toBeNull();
    expect(porId.get(banderaFalsa.conductorId)?.ultimaUbicacionRegistradaEn).not.toBeNull();
    expect(porId.get(eliminada.conductorId)?.ubicacion).toBeNull();
    expect(porId.get(eliminada.conductorId)?.ultimaUbicacionRegistradaEn).toBeNull();
  }, 30000);

  it("permisos reales, cache y query invalida", async () => {
    const [admin, conductor, n8nRespuesta, anonimo] = await Promise.all([
      request(app).get("/api/dashboard/conductores-mapa").set({ Authorization: adminJwt }),
      request(app).get("/api/dashboard/conductores-mapa").set({ Authorization: conductorJwt }),
      request(app).get("/api/dashboard/conductores-mapa").set(n8n()),
      request(app).get("/api/dashboard/conductores-mapa"),
    ]);
    expect(admin.status).toBe(200);
    expect(admin.headers["cache-control"]).toBe("no-store");
    expect(conductor.status).toBe(403);
    expect(conductor.body).toEqual(forbidden);
    expect(n8nRespuesta.status).toBe(401);
    expect(n8nRespuesta.body).toEqual(unauthorized);
    expect(anonimo.status).toBe(401);
    expect(anonimo.body).toEqual(unauthorized);
    const invalida = await request(app).get("/api/dashboard/conductores-mapa").set({ Authorization: adminJwt }).query({ pagina: "1" });
    expect(invalida.status).toBe(400);
    expect(invalida.body).toEqual(validation);
  }, 30000);
});

describe("GET /api/dashboard/solicitudes-activas con base real", () => {
  it("devuelve mas de 30 sin truncamiento, solo estados activos y orden estable", async () => {
    const base = Date.now();
    const ids = new Set<string>();
    for (let i = 0; i < 30; i += 1) {
      const pasajeroId = await crearPasajero();
      const id = await crearSolicitud({ pasajeroId, estado: "buscando", creadoEn: new Date(base - i * 1000) });
      ids.add(id);
    }
    const respuesta = await request(app).get("/api/dashboard/solicitudes-activas").set({ Authorization: adminJwt });
    expect(respuesta.status).toBe(200);
    expect(respuesta.headers["cache-control"]).toBe("no-store");
    const lista = respuesta.body as Array<Record<string, unknown>>;
    expect(lista.length).toBeGreaterThanOrEqual(30);
    const propios = lista.filter((item) => ids.has(String(item.id)));
    expect(propios.length).toBe(30);
    const transitados = propios.map((item) => new Date(item.creadoEn as string).getTime());
    expect(transitados).toEqual([...transitados].sort((a, b) => b - a));
    const estados = new Set(propios.map((item) => String(item.estado)));
    for (const estado of estados) {
      expect(ESTADOS_ACTIVOS).toContain(estado);
    }
  }, 60000);

  it("empate de orden por creadoEn resuelve con id descendente", async () => {
    const momento = new Date("2026-09-20T12:00:00.000Z");
    const pasajeroAlto = await crearPasajero();
    const pasajeroBajo = await crearPasajero();
    await crearSolicitud({ pasajeroId: pasajeroAlto, estado: "buscando", creadoEn: momento, id: "20000000-0000-4000-8000-000000000002" });
    await crearSolicitud({ pasajeroId: pasajeroBajo, estado: "buscando", creadoEn: momento, id: "20000000-0000-4000-8000-000000000001" });
    const respuesta = await request(app).get("/api/dashboard/solicitudes-activas").set({ Authorization: adminJwt });
    const lista = respuesta.body as Array<{ id: string }>;
    const indices = { alto: lista.findIndex((item) => item.id === "20000000-0000-4000-8000-000000000002"), bajo: lista.findIndex((item) => item.id === "20000000-0000-4000-8000-000000000001") };
    expect(indices.alto).toBeGreaterThanOrEqual(0);
    expect(indices.bajo).toBeGreaterThanOrEqual(0);
    expect(indices.alto).toBeLessThan(indices.bajo);
  }, 30000);

  it("incluye los seis estados activos y excluye los cuatro terminales y las eliminadas", async () => {
    const porEstado = new Map<EstadoSolicitud, string>();
    for (const estado of ESTADOS_ACTIVOS) {
      const pasajeroId = await crearPasajero();
      const id = await crearSolicitud({ pasajeroId, estado });
      porEstado.set(estado, id);
    }
    for (const estado of ESTADOS_TERMINALES) {
      const pasajeroId = await crearPasajero();
      await crearSolicitud({ pasajeroId, estado, finalizadaEn: estado === "finalizada" ? null : undefined });
    }
    const eliminada = await crearSolicitud({ pasajeroId: await crearPasajero(), estado: "buscando", eliminada: true });
    const respuesta = await request(app).get("/api/dashboard/solicitudes-activas").set({ Authorization: adminJwt });
    const lista = respuesta.body as Array<{ id: string; estado: EstadoSolicitud }>;
    for (const [estado, id] of porEstado) {
      expect(lista.find((item) => item.id === id)?.estado).toBe(estado);
    }
    expect(lista.map((item) => item.id)).not.toContain(eliminada);
    for (const item of lista) {
      expect(ESTADOS_ACTIVOS).toContain(item.estado);
    }
  }, 45000);

  it("P06: pasajero o conductor eliminado dejan la solicitud visible con resumen null", async () => {
    const pasajeroEliminado = await crearPasajero(true);
    const idPasajeroEliminado = await crearSolicitud({ pasajeroId: pasajeroEliminado, estado: "buscando" });
    const { conductorId } = await crearConductor({ disponibilidad: "en_servicio" });
    await prisma.conductor.update({ where: { id: conductorId }, data: { eliminadoEn: new Date() } });
    const idConductorEliminado = await crearSolicitud({
      pasajeroId: await crearPasajero(), estado: "en_servicio", conductorAsignadoId: conductorId,
    });
    const respuesta = await request(app).get("/api/dashboard/solicitudes-activas").set({ Authorization: adminJwt });
    const lista = respuesta.body as Array<Record<string, unknown>>;
    const conPasajeroEliminado = lista.find((item) => item.id === idPasajeroEliminado);
    const conConductorEliminado = lista.find((item) => item.id === idConductorEliminado);
    expect(conPasajeroEliminado).not.toBeUndefined();
    expect(conPasajeroEliminado!.pasajero).toBeNull();
    expect(conConductorEliminado).not.toBeUndefined();
    expect(conConductorEliminado!.conductorAsignado).toBeNull();
  }, 45000);

  it("soporta destino, expiraEn y campos opcionales nulos con DTO valido", async () => {
    const sinDestino = await crearSolicitud({ pasajeroId: await crearPasajero(), estado: "creada", destino: null });
    const respuesta = await request(app).get("/api/dashboard/solicitudes-activas").set({ Authorization: adminJwt });
    const item = (respuesta.body as Array<Record<string, unknown>>).find((s) => s.id === sinDestino);
    expect(item).toMatchObject({ destino: null, expiraEn: null });
    for (const s of respuesta.body as Array<unknown>) {
      expect(solicitudActivaDtoSchema.parse(s)).toEqual(s);
    }
  }, 30000);
});

describe("GET /api/dashboard/indicadores con base real", () => {
  it("cuenta disponibilidad registrada (suspendido repchazado disponible) y no pide GPS, jornada ni vehiculo", async () => {
    const antes = await indicadores();
    await crearConductor({ estado: "suspendido", jornada: "finalizada", disponibilidad: "disponible", conVehiculo: false, ubicacion: { antiguedadMs: 400000 } });
    const despues = await indicadores();
    expect(despues.conductoresDisponibles - antes.conductoresDisponibles).toBe(1);
  }, 30000);

  it("en_servicio suma solo conductores, y no_disponible/solicitud_pendiente no suman como disponibles", async () => {
    const antes = await indicadores();
    await crearConductor({ disponibilidad: "en_servicio" });
    await crearConductor({ disponibilidad: "no_disponible" });
    await crearConductor({ disponibilidad: "solicitud_pendiente" });
    const despues = await indicadores();
    expect(despues.conductoresEnServicio - antes.conductoresEnServicio).toBe(1);
    expect(despues.conductoresDisponibles - antes.conductoresDisponibles).toBe(0);
  }, 30000);

  it("P06 en conteos: conductor disponible con usuario eliminado suma; conductor eliminado no", async () => {
    const antes = await indicadores();
    await crearConductor({ disponibilidad: "disponible", usuarioEliminado: true });
    await crearConductor({ disponibilidad: "disponible", conductorEliminado: true });
    const despues = await indicadores();
    expect(despues.conductoresDisponibles - antes.conductoresDisponibles).toBe(1);
  }, 30000);

  it("activas suman los seis estados y ninguno de los terminales", async () => {
    const antes = await indicadores();
    for (const estado of ESTADOS_ACTIVOS) {
      await crearSolicitud({ pasajeroId: await crearPasajero(), estado });
    }
    for (const estado of ESTADOS_TERMINALES) {
      await crearSolicitud({ pasajeroId: await crearPasajero(), estado, finalizadaEn: estado === "finalizada" ? null : undefined });
    }
    const despues = await indicadores();
    expect(despues.solicitudesActivas - antes.solicitudesActivas).toBe(6);
  }, 45000);

  it("completadas del dia usan finalizadaEn en America/La_Paz con limites inclusivo/exclusive", async () => {
    const fechaDeNegocio = fechaDeNegocioEnLaPaz(new Date());
    const inicio = inicioDelDiaEnLaPaz(fechaDeNegocio);
    const siguienteInicio = inicioDelDiaSiguienteEnLaPaz(fechaDeNegocio);
    const antes = await indicadores();

    await crearSolicitud({ pasajeroId: await crearPasajero(), estado: "finalizada", finalizadaEn: new Date() });
    const inicioExacto = await crearSolicitud({ pasajeroId: await crearPasajero(), estado: "finalizada", finalizadaEn: inicio });
    const futuroExcluido = await crearSolicitud({ pasajeroId: await crearPasajero(), estado: "finalizada", finalizadaEn: siguienteInicio });
    const sinFecha = await crearSolicitud({ pasajeroId: await crearPasajero(), estado: "finalizada", finalizadaEn: null });
    const otroEstadoConFecha = await crearSolicitud({ pasajeroId: await crearPasajero(), estado: "rechazada", finalizadaEn: new Date() });

    const despues = await indicadores();
    expect(despues.solicitudesCompletadasHoy - antes.solicitudesCompletadasHoy).toBe(2);
    const idsIncluidas = new Set<string>([inicioExacto]);
    void futuroExcluido;
    void sinFecha;
    void otroEstadoConFecha;
  }, 45000);

  it("los conteos devuelven DTO estricto sin cache", async () => {
    const respuesta = await request(app).get("/api/dashboard/indicadores").set({ Authorization: adminJwt });
    expect(respuesta.status).toBe(200);
    expect(respuesta.headers["cache-control"]).toBe("no-store");
    expect(indicadoresDtoSchema.parse(respuesta.body)).toEqual(respuesta.body);
  }, 30000);
});

describe("P09 concurrencia y frescura real", () => {
  it("la respuesta de indicadores abre una transaccion real RepeatableRead sobre la base de pruebas", async () => {
    const original = prisma.$transaction as unknown as ((this: unknown, ...args: unknown[]) => Promise<unknown>);
    let usado: unknown = null;
    const spy = vi.spyOn(prisma, "$transaction").mockImplementation((async (...args: unknown[]) => {
      const opciones = args[1] as { isolationLevel?: unknown } | undefined;
      if (typeof args[0] === "function" && opciones?.isolationLevel) usado = opciones.isolationLevel;
      return original.apply(prisma, args);
    }) as unknown as typeof prisma.$transaction);
    try {
      const respuesta = await request(app).get("/api/dashboard/indicadores").set({ Authorization: adminJwt });
      expect(respuesta.status).toBe(200);
      expect(usado).toBe("RepeatableRead");
    } finally {
      spy.mockRestore();
    }
  }, 30000);

  it("PostgreSQL real mantiene la instantanea RepeatableRead y detecta la escritura concurrente", async () => {
    const { conductorId } = await crearConductor({ disponibilidad: "no_disponible" });
    const a = new Client({ connectionString: testUrl });
    const b = new Client({ connectionString: testUrl });
    await a.connect();
    await b.connect();
    try {
      await a.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      const primera = await a.query<{ total: number }>(
        "SELECT count(*)::int AS total FROM conductores WHERE eliminado_en IS NULL",
      );
      await b.query("BEGIN");
      await b.query("UPDATE conductores SET estado_disponibilidad = 'disponible' WHERE id = $1", [conductorId]);
      await b.query("COMMIT");
      const segunda = await a.query<{ total: number }>(
        "SELECT count(*)::int AS total FROM conductores WHERE eliminado_en IS NULL",
      );
      expect(segunda.rows[0].total).toBe(primera.rows[0].total);
      await expect(a.query("UPDATE conductores SET estado_disponibilidad = 'no_disponible' WHERE id = $1", [conductorId]))
        .rejects.toMatchObject({ code: "40001" });
    } finally {
      await a.query("ROLLBACK").catch(() => undefined);
      await a.end();
      await b.end();
    }
  }, 30000);

  it("GETs concurrentes bajo escrituras concurrentes responden consistentes sin errores", async () => {
    const objetivo = (await crearConductor({ disponibilidad: "no_disponible" })).conductorId;
    const flip = async () => {
      const actual = await prisma.conductor.findUniqueOrThrow({ where: { id: objetivo }, select: { estadoDisponibilidad: true } });
      const siguiente = actual.estadoDisponibilidad === "disponible" ? "no_disponible" : "disponible";
      await prisma.conductor.update({ where: { id: objetivo }, data: { estadoDisponibilidad: siguiente } });
    };
    const flips = Array.from({ length: 5 }, async () => {
      await flip();
      return flip();
    });
    const lecturas = Array.from({ length: 5 }, () =>
      request(app).get("/api/dashboard/indicadores").set({ Authorization: adminJwt }));
    const [resultadoLecturas] = await Promise.all([Promise.all(lecturas), Promise.all(flips)]);
    for (const respuesta of resultadoLecturas) {
      expect(respuesta.status).toBe(200);
      expect(indicadoresDtoSchema.parse(respuesta.body)).toEqual(respuesta.body);
    }
  }, 45000);
});