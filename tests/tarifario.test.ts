import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import app from "../src/app";
import { fechaDeNegocioEnLaPaz } from "../src/modules/tarifario/tarifario.service";
import { tarifaDtoSchema } from "../src/modules/tarifario/tarifario.schema";

const prefijo = "sp11-tar";

const tarifasCreadas: string[] = [];
const usuariosCreados: string[] = [];

const unauthorized = { error: { code: "UNAUTHORIZED", message: "Credenciales invalidas" } };
const forbidden = { error: { code: "FORBIDDEN", message: "Permiso denegado" } };
const validation = { error: { code: "VALIDATION_ERROR", message: "Entrada invalida" } };
const tarifaNoEncontrada = { error: { code: "NOT_FOUND", message: "Tarifa no encontrada" } };

function fechaEnLaPaz(offsetDias: number): string {
  return fechaDeNegocioEnLaPaz(new Date(Date.now() + offsetDias * 86_400_000));
}

let prisma: PrismaClient;
let jwtSecret: string;
let n8nToken: string;
let adminJwt: string;
let conductorJwt: string;

const n8n = () => ({ "X-N8N-Token": n8nToken });

beforeAll(async () => {
  const url = inject("adminTestDatabaseUrl");
  if (!url || process.env.DATABASE_URL !== url) throw new Error("Falta destino validado por el setup");
  prisma = (await import("../src/config/prisma")).prisma;
  const { env } = await import("../src/config/env");
  jwtSecret = env.JWT_SECRET;
  n8nToken = env.N8N_API_TOKEN;

  await prisma.tarifa.deleteMany({ where: { descripcion: { startsWith: prefijo } } });
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
    await prisma.tarifa.deleteMany({ where: { id: { in: tarifasCreadas } } });
    await prisma.usuario.deleteMany({ where: { id: { in: usuariosCreados } } });
    expect(await prisma.tarifa.count({ where: { id: { in: tarifasCreadas } } })).toBe(0);
    expect(await prisma.usuario.count({ where: { id: { in: usuariosCreados } } })).toBe(0);
  } finally {
    await prisma.$disconnect();
  }
});

async function crearYRegistrar(descripcion: string, monto: string, vigenciaDesde: string) {
  const fila = await prisma.tarifa.create({
    data: { descripcion, monto, vigenciaDesde: new Date(`${vigenciaDesde}T00:00:00.000Z`) },
    select: { id: true },
  });
  tarifasCreadas.push(fila.id);
  return fila.id;
}

describe("POST /api/tarifas con base real: P04 y decimales", () => {
  it("crea tarifas con fechas pasadas, de hoy y futuras en America/La_Paz (P04)", async () => {
    const pasada = fechaEnLaPaz(-5);
    const hoy = fechaEnLaPaz(0);
    const futura = fechaEnLaPaz(3);
    const respuestas = await Promise.all([
      request(app).post("/api/tarifas").set({ Authorization: adminJwt }).send({ descripcion: `${prefijo}-pasada`, monto: "12.34", vigenciaDesde: pasada }),
      request(app).post("/api/tarifas").set({ Authorization: adminJwt }).send({ descripcion: `${prefijo}-hoy`, monto: "15.00", vigenciaDesde: hoy }),
      request(app).post("/api/tarifas").set({ Authorization: adminJwt }).send({ descripcion: `${prefijo}-futura`, monto: "99.99", vigenciaDesde: futura }),
    ]);
    for (const respuesta of respuestas) {
      expect(respuesta.status).toBe(201);
      expect(tarifaDtoSchema.parse(respuesta.body)).toEqual(respuesta.body);
      tarifasCreadas.push(respuesta.body.id);
    }
    expect(respuestas.map(({ body }) => body.vigenciaDesde)).toEqual([pasada, hoy, futura]);
  }, 30000);

  it("persiste montos decimales exactos 0.01 y 99999999.99 sin perdida ni redondeo", async () => {
    const idMinimo = await crearYRegistrar(`${prefijo}-minimo`, "0.01", fechaEnLaPaz(0));
    const idMaximo = await crearYRegistrar(`${prefijo}-maximo`, "99999999.99", fechaEnLaPaz(0));
    const minimo = await prisma.tarifa.findUniqueOrThrow({ where: { id: idMinimo } });
    const maximo = await prisma.tarifa.findUniqueOrThrow({ where: { id: idMaximo } });
    expect(minimo.monto.toFixed(2)).toBe("0.01");
    expect(maximo.monto.toFixed(2)).toBe("99999999.99");
    const respuesta = await request(app).get("/api/tarifas").set(n8n());
    expect(respuesta.status).toBe(200);
    const dto = respuesta.body.find((item: { id: string }) => item.id === idMinimo);
    expect(dto.monto).toBe("0.01");
    expect(dto.descripcion).toBe(`${prefijo}-minimo`);
  }, 30000);

  it("tres intentos invalidos devuelven 400 sin crear filas", async () => {
    const invalidos = [
      { descripcion: `${prefijo}-cero`, monto: "0.00", vigenciaDesde: fechaEnLaPaz(0) },
      { descripcion: `${prefijo}-nueve`, monto: "100000000.00", vigenciaDesde: fechaEnLaPaz(0) },
      { descripcion: `${prefijo}-numero`, monto: 15.5, vigenciaDesde: fechaEnLaPaz(0) },
    ];
    for (const cuerpo of invalidos) {
      const respuesta = await request(app).post("/api/tarifas").set({ Authorization: adminJwt }).send(cuerpo);
      expect(respuesta.status).toBe(400);
      expect(respuesta.body).toEqual(validation);
    }
    expect(await prisma.tarifa.count({ where: { descripcion: { startsWith: prefijo } } }))
      .toBe(tarifasCreadas.length);
  }, 30000);
});

describe("GET /api/tarifas con base real: vigencia por fecha en America/La_Paz", () => {
  it("incluye pasada y de hoy, excluye la futura y conserva orden estable", async () => {
    const futura = fechaEnLaPaz(3);
    const idFutura = await crearYRegistrar(`${prefijo}-zz-futura`, "5.55", futura);
    const respuesta = await request(app).get("/api/tarifas").set(n8n());
    expect(respuesta.status).toBe(200);
    expect(Array.isArray(respuesta.body)).toBe(true);
    const ids = respuesta.body.map((item: { id: string; descripcion: string }) => item.id);
    expect(ids).not.toContain(idFutura);
    for (const item of respuesta.body) {
      expect(tarifaDtoSchema.parse(item)).toEqual(item);
      expect(item.vigenciaDesde <= fechaEnLaPaz(0)).toBe(true);
    }
    const misIds = respuesta.body
      .filter((item: { descripcion: string }) => item.descripcion.startsWith(prefijo))
      .map((item: { descripcion: string }) => item.descripcion);
    expect(misIds).toEqual([...misIds].sort());
  }, 30000);

  it("excluye las tarifas eliminadas con borrado logico", async () => {
    const id = await crearYRegistrar(`${prefijo}-eliminada`, "1.11", fechaEnLaPaz(-1));
    await prisma.tarifa.update({ where: { id }, data: { eliminadoEn: new Date() } });
    const respuesta = await request(app).get("/api/tarifas").set(n8n());
    expect(respuesta.status).toBe(200);
    expect(respuesta.body.map((item: { id: string }) => item.id)).not.toContain(id);
  }, 30000);

  it("GET respeta requisito de creadenciales reales: n8n y admin 200, conductor 403, anonimo 401", async () => {
    const [admin, n8nRespuesta, conductor, anonimo] = await Promise.all([
      request(app).get("/api/tarifas").set({ Authorization: adminJwt }),
      request(app).get("/api/tarifas").set(n8n()),
      request(app).get("/api/tarifas").set({ Authorization: conductorJwt }),
      request(app).get("/api/tarifas"),
    ]);
    expect(admin.status).toBe(200);
    expect(n8nRespuesta.status).toBe(200);
    expect(conductor.status).toBe(403);
    expect(conductor.body).toEqual(forbidden);
    expect(anonimo.status).toBe(401);
    expect(anonimo.body).toEqual(unauthorized);
  }, 30000);
});

describe("PATCH /api/tarifas/:id con base real", () => {
  it("actualiza descripcion y monto conservando id, vigenciaDesde y campos omitidos", async () => {
    const id = await crearYRegistrar(`${prefijo}-editar`, "10.00", fechaEnLaPaz(0));
    const primera = await request(app).patch(`/api/tarifas/${id}`).set({ Authorization: adminJwt })
      .send({ descripcion: "  Carrera editada  " });
    expect(primera.status).toBe(200);
    expect(tarifaDtoSchema.parse(primera.body)).toEqual(primera.body);
    expect(primera.body.descripcion).toBe("Carrera editada");
    expect(primera.body.monto).toBe("10.00");

    const segunda = await request(app).patch(`/api/tarifas/${id}`).set({ Authorization: adminJwt })
      .send({ monto: "18.45" });
    expect(segunda.status).toBe(200);
    expect(segunda.body.monto).toBe("18.45");
    expect(segunda.body.descripcion).toBe("Carrera editada");

    const fila = await prisma.tarifa.findUniqueOrThrow({ where: { id } });
    expect(fila.vigenciaDesde.toISOString()).toBe(`${fechaEnLaPaz(0)}T00:00:00.000Z`);
    expect(fila.monto.toFixed(2)).toBe("18.45");
    expect(await prisma.tarifa.count({ where: { id } })).toBe(1);
  }, 30000);

  it("una tarifa ya vigente no produce 409 por su fecha (la edicion no escribe fecha)", async () => {
    const id = await crearYRegistrar(`${prefijo}-vigente`, "20.00", fechaEnLaPaz(0));
    const respuesta = await request(app).patch(`/api/tarifas/${id}`).set({ Authorization: adminJwt })
      .send({ monto: "22.00" });
    expect(respuesta.status).toBe(200);
    expect(respuesta.body.monto).toBe("22.00");
  }, 30000);

  it("devuelve 404 para UUID invalido, inexistente y eliminada", async () => {
    const invalido = await request(app).patch("/api/tarifas/no-uuid").set({ Authorization: adminJwt }).send({ monto: "1.00" });
    expect(invalido.status).toBe(404);
    expect(invalido.body).toEqual(tarifaNoEncontrada);

    const inexistente = await request(app).patch("/api/tarifas/00000000-0000-0000-0000-000000000000")
      .set({ Authorization: adminJwt }).send({ monto: "1.00" });
    expect(inexistente.status).toBe(404);
    expect(inexistente.body).toEqual(tarifaNoEncontrada);

    const id = await crearYRegistrar(`${prefijo}-patch-eliminada`, "1.00", fechaEnLaPaz(-1));
    await prisma.tarifa.update({ where: { id }, data: { eliminadoEn: new Date() } });
    const eliminada = await request(app).patch(`/api/tarifas/${id}`).set({ Authorization: adminJwt }).send({ monto: "2.00" });
    expect(eliminada.status).toBe(404);
    expect(eliminada.body).toEqual(tarifaNoEncontrada);
  }, 30000);

  it("rechaza cuerpo vacio, solo vigenciaDesde, campos desconocidos y montos invalidos", async () => {
    const id = await crearYRegistrar(`${prefijo}-validacion`, "5.00", fechaEnLaPaz(0));
    const cuerpos = [
      {},
      { vigenciaDesde: fechaEnLaPaz(0) },
      { descripcion: "x", id },
      { monto: "-1.00" },
      { monto: "1.23.45" },
      { monto: "100000000.00" },
      { extra: "desconocido" },
    ];
    for (const cuerpo of cuerpos) {
      const respuesta = await request(app).patch(`/api/tarifas/${id}`).set({ Authorization: adminJwt }).send(cuerpo);
      expect(respuesta.status).toBe(400);
      expect(respuesta.body).toEqual(validation);
    }
    const fila = await prisma.tarifa.findUniqueOrThrow({ where: { id } });
    expect(fila.descripcion).toBe(`${prefijo}-validacion`);
    expect(fila.monto.toFixed(2)).toBe("5.00");
  }, 30000);

  it("PATCH solo admin real: n8n valido 401 y conductor valido 403 sin escribir", async () => {
    const id = await crearYRegistrar(`${prefijo}-permiso`, "3.00", fechaEnLaPaz(0));
    const n8nRespuesta = await request(app).patch(`/api/tarifas/${id}`).set(n8n()).send({ monto: "9.00" });
    expect(n8nRespuesta.status).toBe(401);
    expect(n8nRespuesta.body).toEqual(unauthorized);
    const conductor = await request(app).patch(`/api/tarifas/${id}`).set({ Authorization: conductorJwt }).send({ monto: "9.00" });
    expect(conductor.status).toBe(403);
    expect(conductor.body).toEqual(forbidden);
    const fila = await prisma.tarifa.findUniqueOrThrow({ where: { id } });
    expect(fila.monto.toFixed(2)).toBe("3.00");
  }, 30000);

  it("los DTOs y errores no exponen campos internos ni secretos", async () => {
    const id = await crearYRegistrar(`${prefijo}-limpieza`, "2.00", fechaEnLaPaz(0));
    const respuesta = await request(app).patch(`/api/tarifas/${id}`).set({ Authorization: adminJwt }).send({ monto: "2.50" });
    expect(JSON.stringify(respuesta.body)).not.toMatch(/hashContrasena|telefono|secret|stack|sql/i);
  }, 30000);
});

describe("permisos de POST con autenticacion real", () => {
  it("admin 201; n8n valido 401; conductor 403; anonimo 401", async () => {
    const cuerpo = { descripcion: `${prefijo}-permisos`, monto: "8.00", vigenciaDesde: fechaEnLaPaz(0) };
    const cuerpos = [
      await request(app).post("/api/tarifas").set({ Authorization: adminJwt }).send(cuerpo),
      await request(app).post("/api/tarifas").set(n8n()).send(cuerpo),
      await request(app).post("/api/tarifas").set({ Authorization: conductorJwt }).send(cuerpo),
      await request(app).post("/api/tarifas").send(cuerpo),
    ];
    expect(cuerpos[0].status).toBe(201);
    tarifasCreadas.push(cuerpos[0].body.id);
    expect(cuerpos[1].status).toBe(401);
    expect(cuerpos[1].body).toEqual(unauthorized);
    expect(cuerpos[2].status).toBe(403);
    expect(cuerpos[2].body).toEqual(forbidden);
    expect(cuerpos[3].status).toBe(401);
    expect(cuerpos[3].body).toEqual(unauthorized);
  }, 30000);

  it("fallo inesperado real produce 500 generico sin detalles", async () => {
    vi.spyOn(prisma.tarifa, "create").mockRejectedValueOnce(new Error("SQL connection secret stack: privado=ok"));
    try {
      const respuesta = await request(app).post("/api/tarifas").set({ Authorization: adminJwt })
        .send({ descripcion: `${prefijo}-fallo`, monto: "1.00", vigenciaDesde: fechaEnLaPaz(0) });
      expect(respuesta.status).toBe(500);
      expect(respuesta.body).toEqual({ error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } });
      expect(JSON.stringify(respuesta.body)).not.toMatch(/secret|stack|sql|privado/i);
    } finally {
      vi.restoreAllMocks();
    }
  }, 30000);
});