import { randomUUID } from "node:crypto";
import request from "supertest";
import type { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";
import app from "../src/app";
import { candidatosDtoSchema } from "../src/modules/motor-asignacion/motor-asignacion.schema";
import { distanciaKm, obtenerCandidatos } from "../src/modules/motor-asignacion/motor-asignacion.service";

type EstadoConductor = "pendiente" | "aprobado" | "rechazado" | "suspendido";
type EstadoJornada = "no_iniciada" | "activa" | "finalizada";
type EstadoDisponibilidad = "disponible" | "no_disponible" | "solicitud_pendiente" | "en_servicio";

let prisma: PrismaClient;
let n8nToken: string;
let solicitudId: string;
let solicitudSinCandidatosId: string;
let solicitudEliminadaId: string;
let c1: string;
let c2: string;
let c3: string;
let c4: string;
let cCaducado: string;
let cFueraRadio: string;
let cNoDisponible: string;
let cJornadaFinalizada: string;
let cPendiente: string;
let cSuspendido: string;
let cEliminado: string;
let cSinVehiculo: string;

const conductoresCreados: string[] = [];
const usuariosCreados: string[] = [];
const pasajerosCreados: string[] = [];
const solicitudesCreadas: string[] = [];

const punto = { latitudRecogida: -17.7833, longitudRecogida: -63.1821 };
// Coordenadas de Santa Cruz de la Sierra usadas como punto de recogida.
const VIGENCIA_MS = 300000;

async function crearConductor(opciones: {
  estado: EstadoConductor;
  jornada?: EstadoJornada;
  disponibilidad?: EstadoDisponibilidad;
  eliminadoEn?: Date;
  conVehiculo?: boolean;
  ubicacion?: { latitud: number; longitud: number; antiguedadMs?: number; esValida?: boolean };
}): Promise<string> {
  const telefono = randomUUID().replace(/-/g, "").slice(0, 30);
  const placa = randomUUID().replace(/-/g, "").slice(0, 30);
  const usuario = await prisma.usuario.create({ data: { telefono, rol: "conductor" }, select: { id: true } });
  const conductor = await prisma.conductor.create({
    data: {
      usuarioId: usuario.id,
      nombreCompleto: `Conductor ${telefono}`,
      cedulaIdentidad: randomUUID(),
      estado: opciones.estado,
      estadoJornada: opciones.jornada ?? "activa",
      estadoDisponibilidad: opciones.disponibilidad ?? "disponible",
      eliminadoEn: opciones.eliminadoEn ?? null,
      ...(opciones.conVehiculo === false ? {} : {
        vehiculos: { create: { placa, marca: "Toyota", modelo: "Corolla", color: "Blanco", capacidadPasajeros: 4 } },
      }),
      ...(opciones.ubicacion ? {
        ubicaciones: { create: [{
          latitud: opciones.ubicacion.latitud,
          longitud: opciones.ubicacion.longitud,
          horaRegistro: new Date(Date.now() - (opciones.ubicacion.antiguedadMs ?? 30000)),
          esValida: opciones.ubicacion.esValida ?? true,
        }] },
      } : {}),
    },
    select: { id: true },
  });
  usuariosCreados.push(usuario.id);
  conductoresCreados.push(conductor.id);
  return conductor.id;
}

async function crearSolicitud(latitud: number, longitud: number, eliminada = false): Promise<string> {
  const pasajero = await prisma.pasajero.create({
    data: { whatsappId: randomUUID(), nombre: "Pasajero de pruebas" },
    select: { id: true },
  });
  pasajerosCreados.push(pasajero.id);
  const solicitud = await prisma.solicitud.create({
    data: {
      pasajeroId: pasajero.id,
      estado: "creada",
      latitudRecogida: latitud,
      longitudRecogida: longitud,
      eliminadoEn: eliminada ? new Date() : null,
    },
    select: { id: true },
  });
  solicitudesCreadas.push(solicitud.id);
  return solicitud.id;
}

function distanciaEsperada(latitud: number, longitud: number): number {
  return Math.round(distanciaKm(punto.latitudRecogida, punto.longitudRecogida, latitud, longitud) * 100) / 100;
}

function getCandidatos(id: string) {
  return request(app).get(`/api/solicitudes/${id}/candidatos`).set("X-N8N-Token", n8nToken);
}

beforeAll(async () => {
  const url = inject("adminTestDatabaseUrl");
  if (!url || process.env.DATABASE_URL !== url) throw new Error("Falta destino validado por el setup");
  prisma = (await import("../src/config/prisma")).prisma;
  const { env } = await import("../src/config/env");
  n8nToken = env.N8N_API_TOKEN;

  await prisma.configuracion.deleteMany({ where: { id: 1 } });
  await prisma.configuracion.create({
    data: { id: 1, nombreEmpresa: "Motor de asignacion - Pruebas", radioMaximoBusquedaKm: 5 },
  });
  expect(await prisma.configuracion.count({ where: { id: 1 } })).toBe(1);

  solicitudId = await crearSolicitud(punto.latitudRecogida, punto.longitudRecogida);
  solicitudSinCandidatosId = await crearSolicitud(-20.0, -65.0);
  solicitudEliminadaId = await crearSolicitud(punto.latitudRecogida, punto.longitudRecogida, true);

  // Elegibles dentro del radio 5 configurado, con distancias 1.12 / 2.65 / 4.19 / 4.96 km.
  c1 = await crearConductor({ estado: "aprobado", ubicacion: { latitud: -17.79, longitud: -63.19 } });
  c2 = await crearConductor({ estado: "aprobado", ubicacion: { latitud: -17.8, longitud: -63.2 } });
  c3 = await crearConductor({ estado: "aprobado", ubicacion: { latitud: -17.81, longitud: -63.21 } });
  c4 = await crearConductor({ estado: "aprobado", ubicacion: { latitud: -17.815, longitud: -63.215 } });
  // Dentro del radio pero con ubicacion vencida (Regla 9) aunque esValida este persistida true.
  cCaducado = await crearConductor({
    estado: "aprobado",
    ubicacion: { latitud: -17.805, longitud: -63.205, antiguedadMs: VIGENCIA_MS + 5000 },
  });
  // Fuera del radio 5.
  cFueraRadio = await crearConductor({ estado: "aprobado", ubicacion: { latitud: -17.85, longitud: -63.28 } });
  // No elegibles por Regla 2.
  cNoDisponible = await crearConductor({
    estado: "aprobado", disponibilidad: "no_disponible",
    ubicacion: { latitud: -17.8, longitud: -63.2 },
  });
  cJornadaFinalizada = await crearConductor({
    estado: "aprobado", jornada: "finalizada",
    ubicacion: { latitud: -17.8, longitud: -63.2 },
  });
  cPendiente = await crearConductor({ estado: "pendiente", ubicacion: { latitud: -17.8, longitud: -63.2 } });
  cSuspendido = await crearConductor({ estado: "suspendido", ubicacion: { latitud: -17.8, longitud: -63.2 } });
  cEliminado = await crearConductor({
    estado: "aprobado", eliminadoEn: new Date(), ubicacion: { latitud: -17.8, longitud: -63.2 },
  });
  cSinVehiculo = await crearConductor({
    estado: "aprobado", conVehiculo: false, ubicacion: { latitud: -17.8, longitud: -63.2 },
  });
}, 30000);

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  if (!prisma) return;
  try {
    await prisma.ubicacionConductor.deleteMany({ where: { conductorId: { in: conductoresCreados } } });
    await prisma.vehiculo.deleteMany({ where: { conductorId: { in: conductoresCreados } } });
    await prisma.solicitud.deleteMany({ where: { id: { in: solicitudesCreadas } } });
    await prisma.pasajero.deleteMany({ where: { id: { in: pasajerosCreados } } });
    await prisma.conductor.deleteMany({ where: { id: { in: conductoresCreados } } });
    await prisma.usuario.deleteMany({ where: { id: { in: usuariosCreados } } });
    await prisma.configuracion.deleteMany({ where: { id: 1 } });
    expect(await prisma.solicitud.count({ where: { id: { in: solicitudesCreadas } } })).toBe(0);
    expect(await prisma.conductor.count({ where: { id: { in: conductoresCreados } } })).toBe(0);
    expect(await prisma.usuario.count({ where: { id: { in: usuariosCreados } } })).toBe(0);
    expect(await prisma.configuracion.count({ where: { id: 1 } })).toBe(0);
  } finally {
    await prisma.$disconnect();
  }
});

describe("GET /api/solicitudes/:id/candidatos (integracion real)", () => {
  it("n8n recibe 200 con top 3 ordenados, distancias Haversine redondeadas y vehiculo con placa", async () => {
    const response = await getCandidatos(solicitudId);
    expect(response.status).toBe(200);
    expect(candidatosDtoSchema.parse(response.body)).toEqual(response.body);
    expect(response.body.candidatos.map(({ conductorId }: { conductorId: string }) => conductorId))
      .toEqual([c1, c2, c3]);
    expect(response.body.candidatos.map(({ distanciaKm }: { distanciaKm: number }) => distanciaKm))
      .toEqual([
        distanciaEsperada(-17.79, -63.19),
        distanciaEsperada(-17.8, -63.2),
        distanciaEsperada(-17.81, -63.21),
      ]);
    for (const candidato of response.body.candidatos) {
      expect(Object.keys(candidato).sort())
        .toEqual(["conductorId", "distanciaKm", "nombreCompleto", "vehiculo"]);
      expect(candidato).not.toHaveProperty("usuarioId");
      expect(candidato).not.toHaveProperty("creadoEn");
      expect(candidato).not.toHaveProperty("eliminadoEn");
      expect(Object.keys(candidato.vehiculo).sort())
        .toEqual(["capacidadPasajeros", "color", "marca", "modelo", "placa"]);
      expect(candidato.vehiculo.placa).toMatch(/^[0-9a-f]{30}$/i);
      expect(candidato.vehiculo).not.toHaveProperty("id");
      expect(candidato.vehiculo).not.toHaveProperty("conductorId");
    }
  });

  it("respeta el radio almacenado en configuracion (no el default)", async () => {
    await prisma.configuracion.update({ where: { id: 1 }, data: { radioMaximoBusquedaKm: 4 } });
    try {
      const response = await getCandidatos(solicitudId);
      expect(response.status).toBe(200);
      const ids = response.body.candidatos.map(({ conductorId }: { conductorId: string }) => conductorId);
      expect(ids).toEqual([c1, c2]);
      expect(ids).not.toContain(c3);
      expect(ids).not.toContain(c4);
    } finally {
      await prisma.configuracion.update({ where: { id: 1 }, data: { radioMaximoBusquedaKm: 5 } });
    }
  });

  it("descarta ubicaciones que exceden 300000 ms aunque esValida este persistida true", async () => {
    const response = await getCandidatos(solicitudId);
    const ids = response.body.candidatos.map(({ conductorId }: { conductorId: string }) => conductorId);
    expect(ids).not.toContain(cCaducado);
  });

  it("descarta los no elegibles por disponibilidad, jornada, estado, eliminacion o falta de vehiculo", async () => {
    const response = await getCandidatos(solicitudId);
    const ids = response.body.candidatos.map(({ conductorId }: { conductorId: string }) => conductorId);
    for (const id of [cFueraRadio, cNoDisponible, cJornadaFinalizada, cPendiente, cSuspendido, cEliminado, cSinVehiculo]) {
      expect(ids).not.toContain(id);
    }
  });

  it("solicitud eliminada logicamente devuelve 404", async () => {
    const response = await getCandidatos(solicitudEliminadaId);
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: "NOT_FOUND", message: "Solicitud no encontrada" } });
  });

  it("solicitud inexistente devuelve 404", async () => {
    const response = await getCandidatos("00000000-0000-0000-0000-000000000000");
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: "NOT_FOUND", message: "Solicitud no encontrada" } });
  });

  it("sin candidatos dentro del radio devuelve 200 con lista vacia", async () => {
    const response = await getCandidatos(solicitudSinCandidatosId);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ candidatos: [] });
  });

  it("fallo de base produce 500 generico sin detalles internos", async () => {
    const spy = vi.spyOn(prisma.conductor, "findMany").mockRejectedValueOnce(new Error("SQL connection secret stack"));
    try {
      const response = await getCandidatos(solicitudId);
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } });
      expect(JSON.stringify(response.body)).not.toMatch(/secret|stack|sql/i);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("obtenerCandidatos con excluirIds (integracion real)", () => {
  it("sin lista devuelve el top 3 habitual", async () => {
    const result = await obtenerCandidatos(solicitudId, new Date());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.candidatos.map(({ conductorId }) => conductorId)).toEqual([c1, c2, c3]);
    }
  });

  it("excluye al mejor candidato y el siguiente sube de posicion", async () => {
    const result = await obtenerCandidatos(solicitudId, new Date(), [c1]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = result.candidatos.map(({ conductorId }) => conductorId);
      expect(ids).not.toContain(c1);
      expect(ids).toEqual([c2, c3, c4]);
    }
  });

  it("excluye a varios y conserva el top 3 entre los restantes", async () => {
    const result = await obtenerCandidatos(solicitudId, new Date(), [c1, c2, c3]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = result.candidatos.map(({ conductorId }) => conductorId);
      expect(ids).toEqual([c4]);
    }
  });

  it("excluir a todos los conductores devuelve lista vacia", async () => {
    const todos = [
      c1, c2, c3, c4, cCaducado, cFueraRadio, cNoDisponible,
      cJornadaFinalizada, cPendiente, cSuspendido, cEliminado, cSinVehiculo,
    ];
    const result = await obtenerCandidatos(solicitudId, new Date(), todos);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.candidatos).toEqual([]);
    }
  });

  it("solicitud inexistente con lista de exclusion devuelve NOT_FOUND", async () => {
    const result = await obtenerCandidatos("00000000-0000-0000-0000-000000000000", new Date(), [c1]);
    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
  });
});