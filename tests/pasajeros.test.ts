import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterAll, afterEach, beforeAll, expect, inject, it, vi } from "vitest";
import app from "../src/app";
import { pasajeroDtoSchema } from "../src/modules/pasajeros/pasajeros.schema";

let prisma: PrismaClient;
let n8nToken: string;
const jwtTokens: string[] = [];
const whatsappIds: string[] = [];
const usuarioIds: string[] = [];
const endpoint = "/api/pasajeros/identificar";
const aviso = (id: string) => `/api/pasajeros/${id}/aceptar-aviso`;

function input() {
  const whatsappId = BigInt(`0x${randomUUID().replace(/-/g, "")}`).toString();
  whatsappIds.push(whatsappId);
  return { whatsappId, nombre: "Pasajero de prueba" };
}

beforeAll(async () => {
  const url = inject("adminTestDatabaseUrl");
  if (!url || process.env.DATABASE_URL !== url) throw new Error("Falta destino validado por el setup");
  prisma = (await import("../src/config/prisma")).prisma;
  const { env } = await import("../src/config/env");
  n8nToken = env.N8N_API_TOKEN;
  for (const rol of ["admin", "conductor"] as const) {
    const id = randomUUID();
    usuarioIds.push(id);
    await prisma.usuario.create({ data: { id, telefono: `spec07-${id}`, rol } });
    jwtTokens.push(jwt.sign({}, env.JWT_SECRET, { subject: id, expiresIn: "1h" }));
  }
});

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  if (!prisma) return;
  try {
    const pasajeros = { whatsappId: { in: whatsappIds } };
    const usuarios = { id: { in: usuarioIds } };
    await prisma.pasajero.deleteMany({ where: pasajeros });
    await prisma.usuario.deleteMany({ where: usuarios });
    expect(await prisma.pasajero.count({ where: pasajeros })).toBe(0);
    expect(await prisma.usuario.count({ where: usuarios })).toBe(0);
  } finally {
    await prisma.$disconnect();
  }
});

it("identifica nuevo y existente con 200, DTO estricto, nombre recortado y sin consentimiento implicito", async () => {
  const body = input();
  const first = await request(app).post(endpoint).set("X-N8N-Token", n8nToken)
    .send({ ...body, nombre: `  ${body.nombre}  ` });
  expect(first.status).toBe(200);
  expect(pasajeroDtoSchema.parse(first.body)).toEqual(first.body);
  expect(first.body.nombre).toBe(body.nombre);
  expect(first.body.aceptacionAvisoPrivacidad).toBeNull();
  const original = await prisma.pasajero.findUniqueOrThrow({ where: { whatsappId: body.whatsappId } });
  const again = await request(app).post(endpoint).set("X-N8N-Token", n8nToken).send({ ...body, nombre: "Otro" });
  expect(again.status).toBe(200);
  expect(again.body).toEqual(first.body);
  expect(await prisma.pasajero.findUnique({ where: { id: original.id } })).toEqual(original);
  const missingName = await request(app).post(endpoint).set("X-N8N-Token", n8nToken).send({ whatsappId: body.whatsappId });
  expect(missingName.status).toBe(400);
});

it("identificaciones HTTP simultaneas crean una sola fila y conservan el nombre ganador", async () => {
  const body = input();
  const names = Array.from({ length: 8 }, (_, index) => `Nombre ${index}`);
  const responses = await Promise.all(names.map((nombre) => request(app).post(endpoint)
    .set("X-N8N-Token", n8nToken).send({ ...body, nombre })));
  const rows = await prisma.pasajero.findMany({ where: { whatsappId: body.whatsappId } });
  expect(rows).toHaveLength(1);
  expect(names).toContain(rows[0].nombre);
  for (const response of responses) {
    expect(response.status).toBe(200);
    expect(response.body.id).toBe(rows[0].id);
    expect(response.body.nombre).toBe(rows[0].nombre);
    expect(response.body.aceptacionAvisoPrivacidad).toBeNull();
    expect(response.body).toEqual(responses[0].body);
  }
});

it("eliminado: identificar 409 y aceptar 404 sin restaurar, duplicar o registrar consentimiento", async () => {
  const body = input();
  const original = await prisma.pasajero.create({ data: { ...body, eliminadoEn: new Date() } });
  const identify = await request(app).post(endpoint).set("X-N8N-Token", n8nToken).send(body);
  expect(identify.status).toBe(409);
  expect(identify.body.error.code).toBe("PASAJERO_ELIMINADO");
  const accept = await request(app).patch(aviso(original.id)).set("X-N8N-Token", n8nToken);
  expect(accept.status).toBe(404);
  expect(accept.body.error.code).toBe("NOT_FOUND");
  expect(await prisma.pasajero.findMany({ where: { whatsappId: body.whatsappId } })).toEqual([original]);
});

it("primera aceptacion persiste fecha del servidor; repetir e identificar conservan esa fecha y el nombre", async () => {
  const body = input();
  const original = await prisma.pasajero.create({ data: body });
  const start = Date.now();
  const first = await request(app).patch(aviso(original.id)).set("X-N8N-Token", n8nToken);
  const end = Date.now();
  expect(first.status).toBe(200);
  expect(pasajeroDtoSchema.parse(first.body)).toEqual(first.body);
  const date = Date.parse(first.body.aceptacionAvisoPrivacidad);
  expect(date).toBeGreaterThanOrEqual(start);
  expect(date).toBeLessThanOrEqual(end);
  const persisted = await prisma.pasajero.findUniqueOrThrow({ where: { id: original.id } });
  expect(persisted.aceptacionAvisoPrivacidad?.toISOString()).toBe(first.body.aceptacionAvisoPrivacidad);
  const repeated = await request(app).patch(aviso(original.id)).set("X-N8N-Token", n8nToken).send({});
  expect(repeated.status).toBe(200);
  expect(repeated.body).toEqual(first.body);
  const identified = await request(app).post(endpoint).set("X-N8N-Token", n8nToken).send({ ...body, nombre: "Otro" });
  expect(identified.status).toBe(200);
  expect(identified.body).toEqual(first.body);
  expect(await prisma.pasajero.findUnique({ where: { id: original.id } })).toEqual(persisted);
});

it("aceptaciones HTTP simultaneas devuelven la misma primera fecha persistida", async () => {
  const original = await prisma.pasajero.create({ data: input() });
  const responses = await Promise.all(Array.from({ length: 8 }, () => request(app).patch(aviso(original.id))
    .set("X-N8N-Token", n8nToken).send({})));
  const persisted = await prisma.pasajero.findUniqueOrThrow({ where: { id: original.id } });
  expect(persisted.aceptacionAvisoPrivacidad).not.toBeNull();
  for (const response of responses) {
    expect(response.status).toBe(200);
    expect(response.body.aceptacionAvisoPrivacidad).toBe(persisted.aceptacionAvisoPrivacidad?.toISOString());
    expect(response.body).toEqual(responses[0].body);
  }
});

it("UUID invalido no consulta persistencia; UUID inexistente devuelve 404", async () => {
  const update = vi.spyOn(prisma.pasajero, "updateMany");
  const read = vi.spyOn(prisma.pasajero, "findFirst");
  const invalid = await request(app).patch(aviso("no-uuid")).set("X-N8N-Token", n8nToken);
  expect(invalid.status).toBe(404);
  expect(update).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
  const absent = await request(app).patch(aviso(randomUUID())).set("X-N8N-Token", n8nToken);
  expect(absent.status).toBe(404);
  expect(absent.body.error.code).toBe("NOT_FOUND");
});

it.each(["post", "patch"] as const)("%s exige n8n y conserva precedencia sobre JWT sin escrituras", async (method) => {
  const body = input();
  const original = await prisma.pasajero.create({ data: body });
  const headers: { values: Record<string, string>; status: number }[] = [
    { values: {}, status: 401 }, { values: { "X-N8N-Token": "invalid" }, status: 401 },
    { values: { Authorization: "Bearer invalid" }, status: 401 },
    ...jwtTokens.flatMap((token) => [
      { values: { Authorization: `Bearer ${token}` }, status: 403 },
      { values: { Authorization: `Bearer ${token}`, "X-N8N-Token": "invalid" }, status: 401 },
    ]),
  ];
  for (const { values, status } of headers) {
    const response = await request(app)[method](method === "post" ? endpoint : aviso(original.id))
      .set(values).send(method === "post" ? body : {});
    expect(response.status).toBe(status);
    expect(response.body.error.code).toBe(status === 401 ? "UNAUTHORIZED" : "FORBIDDEN");
  }
  expect(await prisma.pasajero.findUnique({ where: { id: original.id } })).toEqual(original);
});

it("POST rechaza cuerpos invalidos sin persistir filas", async () => {
  const body = input();
  const bodies = [undefined, {}, [], { nombre: body.nombre }, { whatsappId: body.whatsappId },
    { ...body, nombre: " " }, { ...body, nombre: 42 }, { ...body, extra: true },
    { ...body, aceptacionAvisoPrivacidad: new Date().toISOString() },
    ...[42, "", "+591", " 591", "591 ", "591@s.whatsapp.net", "591\n", "\u0661\u0662"].map((whatsappId) => ({ ...body, whatsappId }))];
  const create = vi.spyOn(prisma.pasajero, "create");
  for (const invalid of bodies) {
    const response = await request(app).post(endpoint).set("X-N8N-Token", n8nToken).send(invalid);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  }
  expect(create).not.toHaveBeenCalled();
  expect(await prisma.pasajero.count({ where: { whatsappId: body.whatsappId } })).toBe(0);
});

it("PATCH rechaza extras, arrays, fechas y null sin consentimiento; parser mantiene error seguro", async () => {
  const original = await prisma.pasajero.create({ data: input() });
  for (const raw of ["null", "[]", '{"extra":true}', '{"aceptacionAvisoPrivacidad":"2026-01-01T00:00:00Z"}', '{"secret":']) {
    for (const method of ["post", "patch"] as const) {
      const response = await request(app)[method](method === "post" ? endpoint : aviso(original.id))
        .set("X-N8N-Token", n8nToken).set("Content-Type", "application/json").send(raw);
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: { code: "VALIDATION_ERROR", message: "Entrada invalida" } });
    }
  }
  expect(await prisma.pasajero.findUnique({ where: { id: original.id } })).toEqual(original);
});

it.each(["post", "patch"] as const)("%s oculta fallos inesperados de persistencia", async (method) => {
  const body = input();
  const original = await prisma.pasajero.create({ data: body });
  const error = new Error("SQL connection secret stack");
  if (method === "post") vi.spyOn(prisma.pasajero, "findUnique").mockRejectedValueOnce(error);
  else vi.spyOn(prisma.pasajero, "updateMany").mockRejectedValueOnce(error);
  const response = await request(app)[method](method === "post" ? endpoint : aviso(original.id))
    .set("X-N8N-Token", n8nToken).send(method === "post" ? body : {});
  expect(response.status).toBe(500);
  expect(response.body).toEqual({ error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } });
});
