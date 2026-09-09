import { afterAll, beforeAll, expect, inject, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import request from "supertest";
import type { PrismaClient } from "@prisma/client";
import app from "../src/app";

const password = "  fictitious-login-password  ";
const ownedIds: string[] = [];
const accounts: Record<string, { id: string; correoElectronico: string | null }> = {};
let prisma: PrismaClient;
const endpoint = "/api/auth/admin/login";
const unauthorized = { error: { code: "UNAUTHORIZED", message: "Credenciales invalidas" } };
const validation = { error: { code: "VALIDATION_ERROR", message: "Entrada invalida" } };

beforeAll(async () => {
  const databaseUrl = inject("adminTestDatabaseUrl");
  if (!databaseUrl || process.env.DATABASE_URL !== databaseUrl) throw new Error("Falta destino validado por el setup");
  prisma = (await import("../src/config/prisma")).prisma;
  const hash = await bcrypt.hash(password, 12);
  for (const name of ["admin", "conductor", "deleted", "noHash", "emptyHash", "maxBytes", "short", "unicode"]) {
    const id = randomUUID();
    ownedIds.push(id);
    accounts[name] = await prisma.usuario.create({
      data: {
        id, correoElectronico: `spec03-login-${id}@example.invalid`, telefono: `spec03-login-${id}`,
        rol: name === "conductor" ? "conductor" : "admin",
        eliminadoEn: name === "deleted" ? new Date() : null,
        hashContrasena: name === "noHash" ? null : name === "emptyHash" ? ""
          : name === "maxBytes" ? await bcrypt.hash("a".repeat(72), 12)
          : name === "short" ? await bcrypt.hash("short", 12)
          : name === "unicode" ? await bcrypt.hash("\u00e9".repeat(36), 12) : hash,
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

it("login HTTP emite solo el contrato y JWT HS256 verificable de ocho horas", async () => {
  const before = Math.floor(Date.now() / 1000);
  const response = await request(app).post(endpoint).send({ correo: accounts.admin.correoElectronico, "contrase\u00f1a": password, rol: "conductor" });
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
  } catch { /* No volcar token o secreto ante un fallo de firma. */ }
  expect(!!verified).toBe(true);
  expect(verified!.header.alg).toBe("HS256");
  const payload = verified!.payload as jwt.JwtPayload;
  expect(Object.keys(payload).sort()).toEqual(["exp", "iat", "sub"]);
  expect(payload.sub).toBe(accounts.admin.id);
  expect(payload.iat! >= before && payload.iat! <= after).toBe(true);
  expect(payload.exp! - payload.iat!).toBe(28800);
  let wrongSignatureRejected = false;
  try { jwt.verify(response.body.token, "different-fictitious-key", { algorithms: ["HS256"] }); }
  catch { wrongSignatureRejected = true; }
  expect(wrongSignatureRejected).toBe(true);
  let expired = false;
  try { jwt.verify(response.body.token, env.JWT_SECRET, { algorithms: ["HS256"], clockTimestamp: payload.exp }); }
  catch (error) { expired = error instanceof jwt.TokenExpiredError; }
  expect(expired).toBe(true);
});

it.each(["missing", "wrong", "conductor", "deleted", "noHash", "emptyHash", "trimmed", "overlong", "unicodeOverlong", "shortWrong"])("401 uniforme: %s", async (name) => {
  const account = accounts[name] ?? accounts[name === "overlong" ? "maxBytes" : name === "unicodeOverlong" ? "unicode" : "admin"];
  const correo = name === "missing" ? `spec03-login-${randomUUID()}@example.invalid` : account.correoElectronico;
  const candidate = name === "wrong" ? "wrong-password" : name === "trimmed" ? password.trim()
    : name === "overlong" ? "a".repeat(73) : name === "unicodeOverlong" ? "\u00e9".repeat(37)
    : name === "shortWrong" ? "x" : password;
  const response = await request(app).post(endpoint).send({ correo, "contrase\u00f1a": candidate });
  expect(response.status).toBe(401);
  expect(JSON.stringify(response.body) === JSON.stringify(unauthorized)).toBe(true);
});

it.each([["maxBytes", "a".repeat(72)], ["short", "short"], ["unicode", "\u00e9".repeat(36)]])("login no impone fortaleza ni transforma: %s", async (name, candidate) => {
  const response = await request(app).post(endpoint).send({ correo: accounts[name].correoElectronico, "contrase\u00f1a": candidate });
  expect(response.status).toBe(200);
  expect(typeof response.body.token === "string").toBe(true);
});

it.each([
  {}, { correo: "valid@example.invalid" }, { "contrase\u00f1a": password },
  { correo: "invalid", "contrase\u00f1a": password },
  { correo: 123, "contrase\u00f1a": password },
  { correo: "valid@example.invalid", "contrase\u00f1a": 123 },
  { correo: "valid@example.invalid", "contrase\u00f1a": null },
  { correo: "valid@example.invalid", "contrase\u00f1a": "" },
  { correo: "valid@example.invalid", contrasena: password },
  { correo: "valid@example.invalid", password }, [],
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
  for (const response of [await request(app).post(endpoint), await request(app).post(endpoint).set("Content-Type", "application/json").send('{"correo":')]) {
    expect(response.status).toBe(400);
    expect(response.body).toEqual(validation);
  }
});

it("fallo DB es 500 seguro, no 401 ni token", async () => {
  const lookup = vi.spyOn(prisma.usuario, "findUnique").mockRejectedValueOnce(new Error("SQL connection secret stack"));
  try {
    const response = await request(app).post(endpoint).send({ correo: accounts.admin.correoElectronico, "contrase\u00f1a": password });
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body) === JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } })).toBe(true);
  } finally { lookup.mockRestore(); }
});
