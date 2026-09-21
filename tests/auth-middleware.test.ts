import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";
import { env } from "../src/config/env";
import { prisma } from "../src/config/prisma";
import { requireAdmin, requireAuth, requireN8n, requireN8nOrAdmin, type AuthenticatedRequest } from "../src/middlewares/auth";
import { errorHandler } from "../src/middlewares/error-handler";

vi.mock("../src/config/env", () => ({
  env: {
    JWT_SECRET: "unit-test-only-jwt-secret-not-for-deployment",
    N8N_API_TOKEN: "unit-test-only-internal-secret-not-for-deployment",
  },
}));

vi.mock("../src/config/prisma", () => ({
  prisma: { usuario: { findUnique: vi.fn() } },
}));

const lookup = vi.mocked(prisma.usuario.findUnique);
const userId = "d9428888-122b-4e1f-b85c-61cd3cbb3210";
const unauthorized = { error: { code: "UNAUTHORIZED", message: "Credenciales invalidas" } };
const forbidden = { error: { code: "FORBIDDEN", message: "Permiso denegado" } };

const app = express();
for (const [path, guard] of [
  ["/n8n", requireN8n], ["/auth", requireAuth], ["/admin", requireAdmin], ["/n8n-admin", requireN8nOrAdmin],
] as const) {
  app.get(path, guard, (req, res) => res.json((req as AuthenticatedRequest).auth));
}
app.use(errorHandler);

beforeEach(() => {
  lookup.mockReset();
});

function token() {
  return jwt.sign({}, env.JWT_SECRET, { subject: userId, expiresIn: "1h" });
}

it("requireN8n: token n8n valido permite acceso sin consultar usuarios", async () => {
  const response = await request(app).get("/n8n").set("X-N8N-Token", env.N8N_API_TOKEN);
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ source: "n8n", userId: null, rol: null });
  expect(lookup).not.toHaveBeenCalled();
});

it.each([
  {},
  { "X-N8N-Token": "wrong-n8n-token" },
  { Authorization: "Bearer invalid" },
  { Authorization: "Basic invalid" },
])("requireN8n: credenciales ausentes o invalidas reciben 401 (%j)", async (headers) => {
  const response = await request(app).get("/n8n").set(headers);
  expect(response.status).toBe(401);
  expect(response.body).toEqual(unauthorized);
  expect(lookup).not.toHaveBeenCalled();
});

it.each(["admin", "conductor"] as const)("requireN8n: JWT valido de %s recibe 403", async (rol) => {
  lookup.mockResolvedValue({ id: userId, rol, eliminadoEn: null } as Awaited<ReturnType<typeof prisma.usuario.findUnique>>);
  const response = await request(app).get("/n8n").set("Authorization", `Bearer ${token()}`);
  expect(response.status).toBe(403);
  expect(response.body).toEqual(forbidden);
  expect(lookup).toHaveBeenCalledExactlyOnceWith({
    where: { id: userId }, select: { id: true, rol: true, eliminadoEn: true },
  });
});

it.each(["/n8n", "/auth"])("%s: token n8n incorrecto tiene precedencia sobre JWT valido", async (path) => {
  const response = await request(app).get(path)
    .set("X-N8N-Token", "wrong-n8n-token").set("Authorization", `Bearer ${token()}`);
  expect(response.status).toBe(401);
  expect(response.body).toEqual(unauthorized);
  expect(lookup).not.toHaveBeenCalled();
});

it("requireN8n: token n8n valido tiene precedencia sobre JWT invalido", async () => {
  const response = await request(app).get("/n8n")
    .set("X-N8N-Token", env.N8N_API_TOKEN).set("Authorization", "Bearer invalid");
  expect(response.status).toBe(200);
  expect(response.body.source).toBe("n8n");
  expect(lookup).not.toHaveBeenCalled();
});

it.each([null, { id: userId, rol: "admin", eliminadoEn: new Date() }])(
  "requireN8n: JWT de usuario inexistente o eliminado recibe 401",
  async (user) => {
    lookup.mockResolvedValue(user as Awaited<ReturnType<typeof prisma.usuario.findUnique>>);
    const response = await request(app).get("/n8n").set("Authorization", `Bearer ${token()}`);
    expect(response.status).toBe(401);
    expect(response.body).toEqual(unauthorized);
  },
);

it.each(["/n8n", "/auth", "/admin", "/n8n-admin"])("%s: fallo de persistencia se propaga como 500 seguro", async (path) => {
  lookup.mockRejectedValueOnce(new Error("SQL connection secret stack"));
  const response = await request(app).get(path).set("Authorization", `Bearer ${token()}`);
  expect(response.status).toBe(500);
  expect(response.body).toEqual({ error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } });
});

it.each(["admin", "conductor"] as const)("guards existentes conservan permisos JWT de %s", async (rol) => {
  lookup.mockResolvedValue({ id: userId, rol, eliminadoEn: null } as Awaited<ReturnType<typeof prisma.usuario.findUnique>>);
  const authorization = `Bearer ${token()}`;
  const authenticated = await request(app).get("/auth").set("Authorization", authorization);
  expect(authenticated.status).toBe(200);
  expect(authenticated.body).toEqual({ source: "jwt", userId, rol });
  const admin = await request(app).get("/admin").set("Authorization", authorization);
  expect(admin.status).toBe(rol === "admin" ? 200 : 403);
  expect(admin.body).toEqual(rol === "admin" ? { source: "jwt", userId, rol } : forbidden);
});

it("guards existentes conservan permisos del token n8n", async () => {
  const authenticated = await request(app).get("/auth").set("X-N8N-Token", env.N8N_API_TOKEN);
  expect(authenticated.status).toBe(200);
  expect(authenticated.body).toEqual({ source: "n8n", userId: null, rol: null });
  const admin = await request(app).get("/admin").set("X-N8N-Token", env.N8N_API_TOKEN);
  expect(admin.status).toBe(401);
  expect(admin.body).toEqual(unauthorized);
  expect(lookup).not.toHaveBeenCalled();
});

it("requireN8nOrAdmin: token n8n valido permite acceso sin consultar usuarios", async () => {
  const response = await request(app).get("/n8n-admin").set("X-N8N-Token", env.N8N_API_TOKEN);
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ source: "n8n", userId: null, rol: null });
  expect(lookup).not.toHaveBeenCalled();
});

it.each([
  {},
  { "X-N8N-Token": "wrong-n8n-token" },
  { Authorization: "Bearer invalid" },
  { Authorization: "Basic invalid" },
])("requireN8nOrAdmin: credenciales ausentes o invalidas reciben 401 (%j)", async (headers) => {
  const response = await request(app).get("/n8n-admin").set(headers);
  expect(response.status).toBe(401);
  expect(response.body).toEqual(unauthorized);
  expect(lookup).not.toHaveBeenCalled();
});

it("requireN8nOrAdmin: JWT de admin permite acceso", async () => {
  lookup.mockResolvedValue({ id: userId, rol: "admin", eliminadoEn: null } as Awaited<ReturnType<typeof prisma.usuario.findUnique>>);
  const response = await request(app).get("/n8n-admin").set("Authorization", `Bearer ${token()}`);
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ source: "jwt", userId, rol: "admin" });
});

it("requireN8nOrAdmin: JWT de conductor recibe 403", async () => {
  lookup.mockResolvedValue({ id: userId, rol: "conductor", eliminadoEn: null } as Awaited<ReturnType<typeof prisma.usuario.findUnique>>);
  const response = await request(app).get("/n8n-admin").set("Authorization", `Bearer ${token()}`);
  expect(response.status).toBe(403);
  expect(response.body).toEqual(forbidden);
});
