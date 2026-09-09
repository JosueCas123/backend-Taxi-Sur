import { afterAll, beforeAll, expect, inject, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";
import express from "express";
import type { PrismaClient } from "@prisma/client";
import { requireAdmin, requireAuth } from "../src/middlewares/auth";
import { errorHandler, notFound } from "../src/middlewares/error-handler";

const password = "fictitious-middleware-password";
const ownedIds: string[] = [];
let prisma: PrismaClient;
let admins: Record<string, { id: string; correoElectronico: string | null }>;

function signToken(sub: string | number, secret: string, algorithm: jwt.Algorithm = "HS256", expiresIn: jwt.SignOptions["expiresIn"] = 28800) {
  return jwt.sign({}, secret, { algorithm, subject: String(sub), expiresIn });
}

function testApp() {
  const app = express();
  app.use(express.json());
  app.get("/api/protected", requireAuth, (_req, res) => res.json({ ok: true }));
  app.get("/api/admin-only", requireAdmin, (_req, res) => res.json({ ok: true }));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

beforeAll(async () => {
  const databaseUrl = inject("adminTestDatabaseUrl");
  if (!databaseUrl || process.env.DATABASE_URL !== databaseUrl) throw new Error("Falta destino validado por el setup");
  prisma = (await import("../src/config/prisma")).prisma;
  const { env } = await import("../src/config/env");
  const hash = await (await import("bcrypt")).hash(password, 12);
  admins = {};
  for (const name of ["admin", "conductor", "deleted"]) {
    const id = randomUUID();
    ownedIds.push(id);
    admins[name] = await prisma.usuario.create({
      data: {
        id, correoElectronico: `spec03-mw-${id}@example.invalid`, telefono: `spec03-mw-${id}`,
        rol: name === "admin" ? "admin" : "conductor",
        eliminadoEn: name === "deleted" ? new Date() : null,
        hashContrasena: hash,
      },
      select: { id: true, correoElectronico: true },
    });
  }
}, 30000);

afterAll(async () => {
  vi.restoreAllMocks();
  if (!prisma) return;
  try {
    const where = { id: { in: ownedIds } };
    await prisma.usuario.deleteMany({ where });
    expect(await prisma.usuario.count({ where })).toBe(0);
  } finally {
    await prisma.$disconnect();
  }
});

const protectedRoute = "/api/protected";
const adminOnlyRoute = "/api/admin-only";

it("requireAuth: Bearer ausente o mal formado devuelve 401", async () => {
  const app = testApp();
  const noAuth = await request(app).get(protectedRoute);
  expect(noAuth.status).toBe(401);
  expect(noAuth.body).toEqual({ error: { code: "UNAUTHORIZED", message: "Credenciales invalidas" } });
  for (const authorization of ["Basic abc", "Bearer", "Bearer a b", "bearer a"]) {
    const response = await request(app).get(protectedRoute).set("Authorization", authorization);
    expect(response.status).toBe(401);
  }
});

it("requireAuth: firma incorrecta, algoritmo distinto o token expirado devuelven 401", async () => {
  const app = testApp();
  const { env } = await import("../src/config/env");
  const cases = [
    signToken(admins.admin.id, "wrong-fictitious-key"),
    signToken(admins.admin.id, env.JWT_SECRET, "HS512"),
    signToken(admins.admin.id, env.JWT_SECRET, "HS256", -10),
  ];
  for (const token of cases) {
    const response = await request(app).get(protectedRoute).set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: { code: "UNAUTHORIZED", message: "Credenciales invalidas" } });
  }
});

it("requireAuth: sub invalido, usuario inexistente o eliminado devuelven 401", async () => {
  const app = testApp();
  const { env } = await import("../src/config/env");
  const cases = [
    signToken(123, env.JWT_SECRET),
    signToken(randomUUID(), env.JWT_SECRET),
    signToken(admins.deleted.id, env.JWT_SECRET),
  ];
  for (const token of cases) {
    const response = await request(app).get(protectedRoute).set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(401);
  }
});

it("requireAuth: JWT de usuario activo (admin o conductor) permite el acceso interno", async () => {
  const app = testApp();
  const { env } = await import("../src/config/env");
  for (const account of [admins.admin, admins.conductor]) {
    const token = signToken(account.id, env.JWT_SECRET);
    const response = await request(app).get(protectedRoute).set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  }
});

it("requireAuth: X-N8N-Token valido permite acceso interno; invalido devuelve 401", async () => {
  const app = testApp();
  const { env } = await import("../src/config/env");
  const valid = await request(app).get(protectedRoute).set("X-N8N-Token", env.N8N_API_TOKEN);
  expect(valid.status).toBe(200);
  const invalid = await request(app).get(protectedRoute).set("X-N8N-Token", "wrong-n8n-token");
  expect(invalid.status).toBe(401);
});

it("requireAdmin: sin Bearer o solo token n8n devuelve 401", async () => {
  const app = testApp();
  const { env } = await import("../src/config/env");
  const noAuth = await request(app).get(adminOnlyRoute);
  expect(noAuth.status).toBe(401);
  const n8nOnly = await request(app).get(adminOnlyRoute).set("X-N8N-Token", env.N8N_API_TOKEN);
  expect(n8nOnly.status).toBe(401);
});

it("requireAdmin: usuario activo sin rol admin devuelve 403; admin accede", async () => {
  const app = testApp();
  const { env } = await import("../src/config/env");
  const conductorToken = signToken(admins.conductor.id, env.JWT_SECRET);
  const conductor = await request(app).get(adminOnlyRoute).set("Authorization", `Bearer ${conductorToken}`);
  expect(conductor.status).toBe(403);
  expect(conductor.body).toEqual({ error: { code: "FORBIDDEN", message: "Permiso denegado" } });
  const adminToken = signToken(admins.admin.id, env.JWT_SECRET);
  const admin = await request(app).get(adminOnlyRoute).set("Authorization", `Bearer ${adminToken}`);
  expect(admin.status).toBe(200);
});

it("requireAdmin: consulta el rol en base en cada peticion; un cambio de rol se aplica de inmediato", async () => {
  const app = testApp();
  const { env } = await import("../src/config/env");
  const token = signToken(admins.admin.id, env.JWT_SECRET);
  const first = await request(app).get(adminOnlyRoute).set("Authorization", `Bearer ${token}`);
  expect(first.status).toBe(200);
  await prisma.usuario.update({ where: { id: admins.admin.id }, data: { rol: "conductor" } });
  try {
    const second = await request(app).get(adminOnlyRoute).set("Authorization", `Bearer ${token}`);
    expect(second.status).toBe(403);
  } finally {
    await prisma.usuario.update({ where: { id: admins.admin.id }, data: { rol: "admin" } });
  }
});

it("requireAuth y requireAdmin: fallo de PostgreSQL devuelve 500 seguro sin conceder acceso", async () => {
  const app = testApp();
  const { env } = await import("../src/config/env");
  const token = signToken(admins.admin.id, env.JWT_SECRET);
  const lookup = vi.spyOn(prisma.usuario, "findUnique").mockRejectedValueOnce(new Error("SQL connection secret stack"));
  try {
    const protectedResponse = await request(app).get(protectedRoute).set("Authorization", `Bearer ${token}`);
    expect(protectedResponse.status).toBe(500);
    expect(protectedResponse.body).toEqual({ error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } });
  } finally { lookup.mockRestore(); }

  const blocked = vi.spyOn(prisma.usuario, "findUnique").mockRejectedValueOnce(new Error("SQL connection secret stack"));
  try {
    const adminResponse = await request(app).get(adminOnlyRoute).set("Authorization", `Bearer ${token}`);
    expect(adminResponse.status).toBe(500);
    expect(adminResponse.body).toEqual({ error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } });
  } finally { blocked.mockRestore(); }
});