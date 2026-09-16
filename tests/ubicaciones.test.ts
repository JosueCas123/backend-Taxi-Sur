import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";
import type { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";
import app from "../src/app";
import { ubicacionDtoSchema } from "../src/modules/ubicaciones/ubicaciones.schema";

let prisma: PrismaClient;
let adminToken: string;
let conductorAToken: string;
let conductorBToken: string;
let conductorA: { id: string };
let conductorB: { id: string };
let conductorSinUbicaciones: { id: string };
const telefonos: string[] = [];
const placas: string[] = [];
const conductoresCreados: string[] = [];

function input() {
  const telefono = randomUUID().replace(/-/g, "").slice(0, 30);
  const placa = randomUUID().replace(/-/g, "").slice(0, 30);
  telefonos.push(telefono);
  placas.push(placa);
  return {
    telefono, pin: "1234", nombreCompleto: "Conductor de ubicaciones", cedulaIdentidad: randomUUID(),
    vehiculo: { placa, marca: "Toyota", modelo: "Corolla", color: "Blanco", capacidadPasajeros: 4 },
  };
}

async function crearConductorAprobado(): Promise<{ id: string; usuarioId: string }> {
  const { registrarConductor } = await import("../src/modules/conductores/conductores.service");
  const result = await registrarConductor(input());
  if (!result.ok) throw new Error("Fallo de fixture");
  conductoresCreados.push(result.conductor.id);
  await prisma.conductor.update({ where: { id: result.conductor.id }, data: { estado: "aprobado" } });
  return { id: result.conductor.id, usuarioId: result.conductor.usuarioId };
}

beforeAll(async () => {
  const url = inject("adminTestDatabaseUrl");
  if (!url || process.env.DATABASE_URL !== url) throw new Error("Falta destino validado por el setup");
  prisma = (await import("../src/config/prisma")).prisma;
  const { env } = await import("../src/config/env");

  const contacto = input();
  const admin = await prisma.usuario.create({ data: { telefono: contacto.telefono, rol: "admin" } });
  adminToken = jwt.sign({}, env.JWT_SECRET, { subject: admin.id, algorithm: "HS256", expiresIn: "1h" });

  const a = await crearConductorAprobado();
  const b = await crearConductorAprobado();
  const sinUbicaciones = await crearConductorAprobado();
  conductorA = { id: a.id };
  conductorB = { id: b.id };
  conductorSinUbicaciones = { id: sinUbicaciones.id };
  conductorAToken = jwt.sign({}, env.JWT_SECRET, { subject: a.usuarioId, algorithm: "HS256", expiresIn: "1h" });
  conductorBToken = jwt.sign({}, env.JWT_SECRET, { subject: b.usuarioId, algorithm: "HS256", expiresIn: "1h" });
}, 30000);

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  if (!prisma) return;
  try {
    const usuarios = { telefono: { in: telefonos } };
    const conductores = { usuario: usuarios };
    await prisma.ubicacionConductor.deleteMany({ where: { conductorId: { in: conductoresCreados } } });
    await prisma.vehiculo.deleteMany({ where: { conductor: conductores } });
    await prisma.conductor.deleteMany({ where: conductores });
    await prisma.usuario.deleteMany({ where: usuarios });
    expect(await prisma.usuario.count({ where: usuarios })).toBe(0);
    expect(await prisma.ubicacionConductor.count({ where: { conductorId: { in: conductoresCreados } } })).toBe(0);
  } finally {
    await prisma.$disconnect();
  }
});

const VIGENCIA_MS = 300000;

function postUbicacion(conductorId: string, body: { latitud: number; longitud: number }, token: string) {
  return request(app).post(`/api/conductores/${conductorId}/ubicacion`)
    .set("Authorization", `Bearer ${token}`).send(body);
}

function getUbicacion(conductorId: string) {
  return request(app).get(`/api/conductores/${conductorId}/ubicacion`)
    .set("Authorization", `Bearer ${adminToken}`);
}

describe("POST /api/conductores/:id/ubicacion real", () => {
  it("persiste una fila con reloj del servidor y GET admin la devuelve", async () => {
    const cuerpo = { latitud: -17.7833, longitud: -63.1821 };
    const post = await postUbicacion(conductorA.id, cuerpo, conductorAToken);
    expect(post.status).toBe(201);
    const dto = ubicacionDtoSchema.parse(post.body);
    expect(dto.id).toMatch(/^\d+$/);
    expect(dto.esValida).toBe(true);
    expect(post.body).not.toHaveProperty("conductorId");
    expect(post.body).not.toHaveProperty("eliminadoEn");

    const fila = await prisma.ubicacionConductor.findUniqueOrThrow({ where: { id: BigInt(dto.id) } });
    expect(fila).toMatchObject({
      conductorId: conductorA.id, latitud: cuerpo.latitud, longitud: cuerpo.longitud, esValida: true,
    });
    expect(dto.horaRegistro).toMatch(/Z$/);
    expect(dto.horaRegistro).toBe(fila.horaRegistro.toISOString());

    const get = await getUbicacion(conductorA.id);
    expect(get.status).toBe(200);
    expect(get.body).toEqual(dto);
  });

  it("invalida previas vencidas y conserva las recientes en la misma escritura", async () => {
    const base = Date.now();
    const vencida = await prisma.ubicacionConductor.create({ data: {
      conductorId: conductorA.id, latitud: 1, longitud: 1,
      horaRegistro: new Date(base - 6 * 60000), esValida: true,
    } });
    const reciente = await prisma.ubicacionConductor.create({ data: {
      conductorId: conductorA.id, latitud: 2, longitud: 2,
      horaRegistro: new Date(base - 60000), esValida: true,
    } });

    const post = await postUbicacion(conductorA.id, { latitud: 3, longitud: 3 }, conductorAToken);
    expect(post.status).toBe(201);

    const vencidaRow = await prisma.ubicacionConductor.findUniqueOrThrow({ where: { id: vencida.id } });
    const recienteRow = await prisma.ubicacionConductor.findUniqueOrThrow({ where: { id: reciente.id } });
    const nuevaRow = await prisma.ubicacionConductor.findUniqueOrThrow({ where: { id: BigInt(post.body.id) } });
    expect(vencidaRow.esValida).toBe(false);
    expect(recienteRow.esValida).toBe(true);
    expect(recienteRow.latitud).toBe(2);
    expect(nuevaRow.esValida).toBe(true);
    expect(nuevaRow.horaRegistro.getTime()).toBeGreaterThan(base);

    const get = await getUbicacion(conductorA.id);
    expect(get.status).toBe(200);
    expect(get.body.id).toBe(nuevaRow.id.toString());
    expect(get.body.esValida).toBe(true);
  });

  it("no invalida unicaciones vencidas de otro conductor", async () => {
    const base = Date.now();
    const vencidaA = await prisma.ubicacionConductor.create({ data: {
      conductorId: conductorA.id, latitud: 1, longitud: 1,
      horaRegistro: new Date(base - 6 * 60000), esValida: true,
    } });
    const vencidaB = await prisma.ubicacionConductor.create({ data: {
      conductorId: conductorB.id, latitud: 2, longitud: 2,
      horaRegistro: new Date(base - 6 * 60000), esValida: true,
    } });

    const post = await postUbicacion(conductorA.id, { latitud: 3, longitud: 3 }, conductorAToken);
    expect(post.status).toBe(201);

    const filaA = await prisma.ubicacionConductor.findUniqueOrThrow({ where: { id: vencidaA.id } });
    const filaB = await prisma.ubicacionConductor.findUniqueOrThrow({ where: { id: vencidaB.id } });
    expect(filaA.esValida).toBe(false);
    expect(filaB.esValida).toBe(true);
  });

  it("reportes simultaneos del mismo conductor quedan ambos validos", async () => {
    const [primero, segundo] = await Promise.all([
      postUbicacion(conductorA.id, { latitud: -17.7, longitud: -63.1 }, conductorAToken),
      postUbicacion(conductorA.id, { latitud: -17.8, longitud: -63.2 }, conductorAToken),
    ]);
    expect(primero.status).toBe(201);
    expect(segundo.status).toBe(201);
    expect(primero.body.id).not.toBe(segundo.body.id);
    for (const res of [primero, segundo]) {
      const fila = await prisma.ubicacionConductor.findUniqueOrThrow({ where: { id: BigInt(res.body.id) } });
      expect(fila.esValida).toBe(true);
    }
    const siguiente = await postUbicacion(conductorA.id, { latitud: -17.9, longitud: -63.3 }, conductorAToken);
    expect(siguiente.status).toBe(201);
    const get = await getUbicacion(conductorA.id);
    expect(get.status).toBe(200);
    expect(get.body.id).toBe(siguiente.body.id);
  });
});

describe("GET /api/conductores/:id/ubicacion real", () => {
  it("aplica la Regla 9 sin escribir: antiguedad > 300000 ms devuelve esValida false", async () => {
    const fila = await prisma.ubicacionConductor.create({ data: {
      conductorId: conductorB.id, latitud: -17.5, longitud: -63.5,
      horaRegistro: new Date(Date.now() - VIGENCIA_MS - 1000), esValida: true,
    } });
    const get = await getUbicacion(conductorB.id);
    expect(get.status).toBe(200);
    expect(get.body.id).toBe(fila.id.toString());
    expect(get.body.esValida).toBe(false);
    const intacta = await prisma.ubicacionConductor.findUniqueOrThrow({ where: { id: fila.id } });
    expect(intacta.esValida).toBe(true);
  });

  it("excluye registros eliminados logicamente y elige el mas reciente por horaRegistro DESC, id DESC", async () => {
    const base = Date.now();
    const antiguo = await prisma.ubicacionConductor.create({ data: {
      conductorId: conductorB.id, latitud: 1, longitud: 1,
      horaRegistro: new Date(base - 2 * 60000), esValida: true,
    } });
    const eliminado = await prisma.ubicacionConductor.create({ data: {
      conductorId: conductorB.id, latitud: 2, longitud: 2,
      horaRegistro: new Date(base - 60000), esValida: true, eliminadoEn: new Date(),
    } });
    const post = await postUbicacion(conductorB.id, { latitud: 3, longitud: 3 }, conductorBToken);
    expect(post.status).toBe(201);

    const get = await getUbicacion(conductorB.id);
    expect(get.status).toBe(200);
    expect(get.body.id).toBe(post.body.id);
    const [eliminadoRow, antiguoRow] = await Promise.all([
      prisma.ubicacionConductor.findUniqueOrThrow({ where: { id: eliminado.id } }),
      prisma.ubicacionConductor.findUniqueOrThrow({ where: { id: antiguo.id } }),
    ]);
    expect(eliminadoRow.eliminadoEn).not.toBeNull();
    expect(antiguoRow.esValida).toBe(true);
  });

  it("conductor sin ubicaciones recibe 404", async () => {
    const get = await getUbicacion(conductorSinUbicaciones.id);
    expect(get.status).toBe(404);
    expect(get.body).toEqual({ error: { code: "NOT_FOUND", message: "Conductor no encontrado" } });
  });
});