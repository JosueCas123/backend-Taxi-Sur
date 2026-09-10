import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import request from "supertest";
import type { PrismaClient } from "@prisma/client";
import app from "../src/app";
import { conductorLoginSchema } from "../src/modules/auth/auth.schema";
import { loginConductor, resetearPin } from "../src/modules/auth/auth.service";

const telefono = "0991234567";
const pin = "123456";
const ownedIds: string[] = [];
const accounts: Record<string, { id: string; telefono: string; correoElectronico: string | null }> = {};
let prisma: PrismaClient;
const endpoint = "/api/auth/conductor/login";
const unauthorized = { error: { code: "UNAUTHORIZED", message: "Credenciales invalidas" } };
const validation = { error: { code: "VALIDATION_ERROR", message: "Entrada invalida" } };

beforeAll(async () => {
  const databaseUrl = inject("adminTestDatabaseUrl");
  if (!databaseUrl || process.env.DATABASE_URL !== databaseUrl) throw new Error("Falta destino validado por el setup");
  prisma = (await import("../src/config/prisma")).prisma;
  const hash = await bcrypt.hash(pin, 12);
  for (const name of ["conductor", "deleted", "admin", "noHash", "emptyHash", "maxBytes", "resetTarget"]) {
    const id = randomUUID();
    ownedIds.push(id);
    accounts[name] = await prisma.usuario.create({
      data: {
        id, correoElectronico: `spec05-login-${id}@example.invalid`, telefono: `spec05-login-${id}`,
        rol: name === "admin" ? "admin" : "conductor",
        eliminadoEn: name === "deleted" ? new Date() : null,
        hashContrasena: name === "noHash" ? null : name === "emptyHash" ? ""
          : name === "maxBytes" ? await bcrypt.hash("a".repeat(72), 12) : hash,
      },
      select: { id: true, telefono: true, correoElectronico: true },
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

describe("loginConductor", () => {
  it("emite el contrato y JWT HS256 verificable de ocho horas", async () => {
    const before = Math.floor(Date.now() / 1000);
    const result = await loginConductor(accounts.conductor.telefono, pin);
    const after = Math.floor(Date.now() / 1000);
    expect(result).not.toBeNull();
    expect(Object.keys(result!).sort()).toEqual(["expiresIn", "token", "tokenType"]);
    expect(result!.tokenType).toBe("Bearer");
    expect(result!.expiresIn).toBe(28800);
    const { env } = await import("../src/config/env");
    let verified: jwt.Jwt | undefined;
    try {
      verified = jwt.verify(result!.token, env.JWT_SECRET, { algorithms: ["HS256"], complete: true });
    } catch { /* No volcar token ni secreto ante un fallo de firma. */ }
    expect(!!verified).toBe(true);
    expect(verified!.header.alg).toBe("HS256");
    const payload = verified!.payload as jwt.JwtPayload;
    expect(Object.keys(payload).sort()).toEqual(["exp", "iat", "sub"]);
    expect(payload.sub).toBe(accounts.conductor.id);
    expect(payload.iat! >= before && payload.iat! <= after).toBe(true);
    expect(payload.exp! - payload.iat!).toBe(28800);
  });

  it("no impone fortaleza ni transforma el PIN: 6 digitos y 72 bytes validos", async () => {
    expect((await loginConductor(accounts.conductor.telefono, "000000"))).toBeNull();
    expect(await loginConductor(accounts.maxBytes.telefono, "a".repeat(72))).not.toBeNull();
  });

  it.each([
    "missing", "wrong", "deleted", "admin", "noHash", "emptyHash", "overlong", "wrongOverlong",
  ])("credenciales rechazadas: %s", async (name) => {
    const candidateTelefono =
      name === "missing" ? `spec05-login-${randomUUID()}`
      : name === "wrong" ? accounts.conductor.telefono
      : name === "deleted" ? accounts.deleted.telefono
      : name === "admin" ? accounts.admin.telefono
      : name === "noHash" ? accounts.noHash.telefono
      : name === "emptyHash" ? accounts.emptyHash.telefono
      : accounts.conductor.telefono;
    const candidatePin =
      name === "wrong" ? "654321"
      : name === "overlong" ? "a".repeat(73)
      : name === "wrongOverlong" ? `${pin}a`.repeat(13)
      : pin;
    expect(await loginConductor(candidateTelefono, candidatePin)).toBeNull();
  });
});

describe("login HTTP", () => {
  it("login HTTP emite solo el contrato y JWT HS256 verificable de ocho horas", async () => {
    const before = Math.floor(Date.now() / 1000);
    const response = await request(app).post(endpoint).send({ telefono: accounts.conductor.telefono, pin });
    const after = Math.floor(Date.now() / 1000);
    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual(["expiresIn", "token", "tokenType"]);
    expect(response.body.tokenType).toBe("Bearer");
    expect(response.body.expiresIn).toBe(28800);
    expect(response.headers["cache-control"]).toBe("no-store");
    const { env } = await import("../src/config/env");
    let verified: jwt.Jwt | undefined;
    try {
      verified = jwt.verify(response.body.token, env.JWT_SECRET, { algorithms: ["HS256"], complete: true });
    } catch { /* No volcar token ni secreto ante un fallo de firma. */ }
    expect(!!verified).toBe(true);
    expect(verified!.header.alg).toBe("HS256");
    const payload = verified!.payload as jwt.JwtPayload;
    expect(Object.keys(payload).sort()).toEqual(["exp", "iat", "sub"]);
    expect(payload.sub).toBe(accounts.conductor.id);
    expect(payload.iat! >= before && payload.iat! <= after).toBe(true);
    expect(payload.exp! - payload.iat!).toBe(28800);
  });

  it.each([
    "missing", "wrong", "deleted", "admin", "noHash", "emptyHash",
  ])("401 uniforme: %s", async (name) => {
    const telefonoEnviado =
      name === "missing" ? `spec05-login-${randomUUID()}`
      : name === "wrong" ? accounts.conductor.telefono
      : name === "deleted" ? accounts.deleted.telefono
      : name === "admin" ? accounts.admin.telefono
      : name === "noHash" ? accounts.noHash.telefono
      : accounts.emptyHash.telefono;
    const pinEnviado = name === "wrong" ? "654321" : pin;
    const response = await request(app).post(endpoint).send({ telefono: telefonoEnviado, pin: pinEnviado });
    expect(response.status).toBe(401);
    expect(JSON.stringify(response.body) === JSON.stringify(unauthorized)).toBe(true);
  });

  it.each([
    {}, { pin }, { telefono },
    { telefono: "", pin }, { telefono, pin: "" },
    { telefono: 123, pin }, { telefono, pin: 123 },
    { telefono: null, pin }, { telefono, pin: null },
    { telefono: undefined, pin }, { telefono, pin: undefined },
  ])("body invalido caso %# devuelve 400 sin consultar DB", async (body) => {
    const lookup = vi.spyOn(prisma.usuario, "findUnique");
    try {
      const response = await request(app).post(endpoint).send(body);
      expect(response.status).toBe(400);
      expect(response.body).toEqual(validation);
      expect(lookup).not.toHaveBeenCalled();
    } finally { lookup.mockRestore(); }
  });

  it("body ausente y JSON malformado devuelven 400", async () => {
    for (const response of [await request(app).post(endpoint), await request(app).post(endpoint).set("Content-Type", "application/json").send('{"telefono":')]) {
      expect(response.status).toBe(400);
      expect(response.body).toEqual(validation);
    }
  });

  it("fallo DB es 500 seguro, no 401 ni token", async () => {
    const lookup = vi.spyOn(prisma.usuario, "findUnique").mockRejectedValueOnce(new Error("SQL connection secret stack"));
    try {
      const response = await request(app).post(endpoint).send({ telefono: accounts.conductor.telefono, pin });
      expect(response.status).toBe(500);
      expect(JSON.stringify(response.body) === JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } })).toBe(true);
    } finally { lookup.mockRestore(); }
  });
});

describe("resetearPin", () => {
  it("genera PIN de 6 digitos, lo hashea con bcrypt costo 12 y devuelve plaintext", async () => {
    const target = accounts.resetTarget;
    const result = await resetearPin(target.id);
    expect(result.ok).toBe(true);
    const pinGenerado = (result as { ok: true; pin: string }).pin;
    expect(pinGenerado).toMatch(/^\d{6}$/);
    const stored = await prisma.usuario.findUnique({
      where: { id: target.id },
      select: { hashContrasena: true },
    });
    expect(stored?.hashContrasena).not.toBeNull();
    expect(stored!.hashContrasena!.startsWith("$2")).toBe(true);
    expect(await bcrypt.compare(pinGenerado, stored!.hashContrasena!)).toBe(true);
  });

  it("PIN generado es autenticable via loginConductor", async () => {
    const target = accounts.resetTarget;
    const result = await resetearPin(target.id);
    if (!result.ok) throw new Error("Se esperaba exito en resetearPin");
    const login = await loginConductor(target.telefono, result.pin);
    expect(login).not.toBeNull();
    const previous = await resetearPin(target.id);
    if (!previous.ok) throw new Error("Se esperaba exito en resetearPin");
    expect(await loginConductor(target.telefono, result.pin)).toBeNull();
    expect(await loginConductor(target.telefono, previous.pin)).not.toBeNull();
  });

  it("usuario inexistente o eliminado no devuelve { ok: true }", async () => {
    expect(await resetearPin(randomUUID())).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await resetearPin(accounts.deleted.id)).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("usuario no conductor devuelve VALIDATION_ERROR", async () => {
    expect(await resetearPin(accounts.admin.id)).toEqual({ ok: false, code: "VALIDATION_ERROR" });
  });

  it("fallo de base de datos rechaza y no se confunde con usuario inexistente", async () => {
    const lookup = vi.spyOn(prisma.usuario, "findUnique").mockRejectedValueOnce(new Error("SQL secret stack"));
    try {
      await expect(resetearPin(accounts.resetTarget.id)).rejects.toThrow();
    } finally { lookup.mockRestore(); }
  });
});

describe("resetear PIN HTTP", () => {
  let adminToken: string;
  let conductorToken: string;
  const resetEndpoint = (id: string) => `/api/auth/conductor/${id}/resetear-pin`;
  const notFound = { error: { code: "NOT_FOUND", message: "Conductor no encontrado" } };
  const notConductor = { error: { code: "VALIDATION_ERROR", message: "El usuario no es conductor" } };
  const forbidden = { error: { code: "FORBIDDEN", message: "Permiso denegado" } };

  beforeAll(async () => {
    const admin = await request(app).post("/api/auth/admin/login").send({ correo: accounts.admin.correoElectronico, "contrase\u00f1a": pin });
    expect(admin.status).toBe(200);
    adminToken = admin.body.token;
    const conductor = await request(app).post(endpoint).send({ telefono: accounts.conductor.telefono, pin });
    expect(conductor.status).toBe(200);
    conductorToken = conductor.body.token;
  }, 30000);

  it("admin autenticado resetea el PIN de un conductor", async () => {
    const before = await prisma.usuario.findUnique({ where: { id: accounts.resetTarget.id }, select: { hashContrasena: true } });
    const response = await request(app).patch(resetEndpoint(accounts.resetTarget.id)).set("Authorization", `Bearer ${adminToken}`);
    expect(response.status).toBe(200);
    expect(response.body.pin).toMatch(/^\d{6}$/);
    expect(Object.keys(response.body).sort()).toEqual(["pin"]);
    const after = await prisma.usuario.findUnique({ where: { id: accounts.resetTarget.id }, select: { hashContrasena: true } });
    expect(after!.hashContrasena).not.toBe(before!.hashContrasena);
    expect(await bcrypt.compare(response.body.pin, after!.hashContrasena!)).toBe(true);
  });

  it("requiere JWT y autorizacion de admin", async () => {
    const target = resetEndpoint(accounts.resetTarget.id);
    const sinToken = await request(app).patch(target);
    expect(sinToken.status).toBe(401);
    expect(sinToken.body).toEqual(unauthorized);
    const tokenInvalido = await request(app).patch(target).set("Authorization", "Bearer invalid-token");
    expect(tokenInvalido.status).toBe(401);
    expect(tokenInvalido.body).toEqual(unauthorized);
    const tokenConductor = await request(app).patch(target).set("Authorization", `Bearer ${conductorToken}`);
    expect(tokenConductor.status).toBe(403);
    expect(tokenConductor.body).toEqual(forbidden);
    const tokenN8n = await request(app).patch(target).set("x-n8n-token", "unit-test-only-internal-secret-not-for-deployment");
    expect(tokenN8n.status).toBe(401);
  });

  it("usuario inexistente (incluido un :id no UUID) o eliminado devuelve 404 NOT_FOUND", async () => {
    const inexistente = await request(app).patch(resetEndpoint(randomUUID())).set("Authorization", `Bearer ${adminToken}`);
    expect(inexistente.status).toBe(404);
    expect(inexistente.body).toEqual(notFound);
    const noUuid = await request(app).patch(resetEndpoint("no-soy-un-uuid")).set("Authorization", `Bearer ${adminToken}`);
    expect(noUuid.status).toBe(404);
    expect(noUuid.body).toEqual(notFound);
    const eliminado = await request(app).patch(resetEndpoint(accounts.deleted.id)).set("Authorization", `Bearer ${adminToken}`);
    expect(eliminado.status).toBe(404);
    expect(eliminado.body).toEqual(notFound);
  });

  it("usuario no conductor devuelve 400 VALIDATION_ERROR", async () => {
    const response = await request(app).patch(resetEndpoint(accounts.admin.id)).set("Authorization", `Bearer ${adminToken}`);
    expect(response.status).toBe(400);
    expect(response.body).toEqual(notConductor);
  });

  it("fallo DB es 500 seguro", async () => {
    const lookup = vi.spyOn(prisma.usuario, "findUnique").mockRejectedValueOnce(new Error("SQL connection secret stack"));
    try {
      const response = await request(app).patch(resetEndpoint(accounts.resetTarget.id)).set("Authorization", `Bearer ${adminToken}`);
      expect(response.status).toBe(500);
      expect(JSON.stringify(response.body) === JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } })).toBe(true);
    } finally { lookup.mockRestore(); }
  });

  it("el PIN resetado por admin permite login HTTP del conductor", async () => {
    const response = await request(app).patch(resetEndpoint(accounts.resetTarget.id)).set("Authorization", `Bearer ${adminToken}`);
    expect(response.status).toBe(200);
    const login = await request(app).post(endpoint).send({ telefono: accounts.resetTarget.telefono, pin: response.body.pin });
    expect(login.status).toBe(200);
    expect(typeof login.body.token === "string").toBe(true);
    const anterior = await request(app).post(endpoint).send({ telefono: accounts.resetTarget.telefono, pin });
    expect(anterior.status).toBe(401);
  });
});

describe("conductorLoginSchema", () => {
  it.each([
    { telefono, pin },
    { telefono: "1", pin },
    { telefono, pin: "1" },
  ])("acepta credenciales validas %#", (body) => {
    expect(conductorLoginSchema.safeParse(body).success).toBe(true);
  });

  it.each([
    {},
    { pin },
    { telefono },
    { telefono: "", pin },
    { telefono, pin: "" },
    { telefono: 123, pin },
    { telefono, pin: 123 },
    { telefono: null, pin },
    { telefono, pin: null },
    { telefono, pin: [] },
    { telefono, pin: {} },
    { telefono: undefined, pin },
    { telefono, pin: undefined },
  ])("rechaza body invalido %#", (body) => {
    expect(conductorLoginSchema.safeParse(body).success).toBe(false);
  });
});