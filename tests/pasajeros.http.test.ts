import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";
import app from "../src/app";
import { env } from "../src/config/env";
import { prisma } from "../src/config/prisma";
import { aceptarAvisoPasajero, identificarPasajero } from "../src/modules/pasajeros/pasajeros.service";

vi.mock("../src/config/env", () => ({ env: {
  JWT_SECRET: "unit-test-only-jwt-secret-not-for-deployment",
  N8N_API_TOKEN: "unit-test-only-internal-secret-not-for-deployment",
} }));
vi.mock("../src/config/prisma", () => ({ prisma: { usuario: { findUnique: vi.fn() } } }));
vi.mock("../src/modules/pasajeros/pasajeros.service", () => ({
  identificarPasajero: vi.fn(), aceptarAvisoPasajero: vi.fn(),
}));

const identificar = vi.mocked(identificarPasajero);
const aceptar = vi.mocked(aceptarAvisoPasajero);
const lookup = vi.mocked(prisma.usuario.findUnique);
const dto = {
  id: "d9428888-122b-4e1f-b85c-61cd3cbb3210", whatsappId: "59170000000", nombre: "Ana Perez",
  aceptacionAvisoPrivacidad: null, creadoEn: "2026-09-15T12:00:00.000Z",
};
const post = "/api/pasajeros/identificar";
const patch = `/api/pasajeros/${dto.id}/aceptar-aviso`;
const invalid = { error: { code: "VALIDATION_ERROR", message: "Entrada invalida" } };

beforeEach(() => { vi.resetAllMocks(); });

it("POST montado devuelve DTO directo con 200 y entrega entrada validada al servicio", async () => {
  identificar.mockResolvedValue({ ok: true, pasajero: dto });
  const response = await request(app).post(post).set("X-N8N-Token", env.N8N_API_TOKEN)
    .send({ whatsappId: dto.whatsappId, nombre: "  Ana Perez  " });
  expect(response.status).toBe(200);
  expect(response.body).toEqual(dto);
  expect(identificar).toHaveBeenCalledExactlyOnceWith({ whatsappId: dto.whatsappId, nombre: dto.nombre });
});

it("POST eliminado devuelve 409", async () => {
  identificar.mockResolvedValueOnce({ ok: false, code: "PASAJERO_ELIMINADO" });
  const response = await request(app).post(post).set("X-N8N-Token", env.N8N_API_TOKEN)
    .send({ whatsappId: dto.whatsappId, nombre: dto.nombre });
  expect(response.status).toBe(409);
  expect(response.body).toEqual({ error: { code: "PASAJERO_ELIMINADO", message: "Pasajero eliminado" } });
});

it.each([undefined, {}])("PATCH acepta cuerpo %j y devuelve fecha del servicio", async (body) => {
  const aceptado = { ...dto, aceptacionAvisoPrivacidad: "2026-09-15T13:00:00.123Z" };
  aceptar.mockResolvedValueOnce({ ok: true, pasajero: aceptado });
  const response = await request(app).patch(patch).set("X-N8N-Token", env.N8N_API_TOKEN).send(body);
  expect(response.status).toBe(200);
  expect(response.body).toEqual(aceptado);
  expect(aceptar).toHaveBeenCalledExactlyOnceWith(dto.id);
});

it("PATCH UUID invalido devuelve 404 antes de validar cuerpo o consultar servicio", async () => {
  const response = await request(app).patch("/api/pasajeros/no-uuid/aceptar-aviso")
    .set("X-N8N-Token", env.N8N_API_TOKEN).send({ extra: true });
  expect(response.status).toBe(404);
  expect(response.body.error.code).toBe("NOT_FOUND");
  expect(aceptar).not.toHaveBeenCalled();
});

it("PATCH NOT_FOUND del servicio devuelve 404", async () => {
  aceptar.mockResolvedValueOnce({ ok: false, code: "NOT_FOUND" });
  const response = await request(app).patch(patch).set("X-N8N-Token", env.N8N_API_TOKEN);
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ error: { code: "NOT_FOUND", message: "Pasajero no encontrado" } });
});

it.each(["post", "patch"] as const)("%s rechaza cuerpos invalidos sin llamar al servicio", async (method) => {
  const bodies = method === "post"
    ? [undefined, {}, [], { whatsappId: "591\n", nombre: "Ana" }, { whatsappId: dto.whatsappId },
      { whatsappId: dto.whatsappId, nombre: " " }, { whatsappId: dto.whatsappId, nombre: dto.nombre, extra: true }]
    : [[], { extra: true }, { aceptacionAvisoPrivacidad: dto.creadoEn }];
  for (const body of bodies) {
    const response = await request(app)[method](method === "post" ? post : patch)
      .set("X-N8N-Token", env.N8N_API_TOKEN).send(body);
    expect(response.status).toBe(400);
    expect(response.body).toEqual(invalid);
  }
  expect(identificar).not.toHaveBeenCalled();
  expect(aceptar).not.toHaveBeenCalled();
});

it.each(["post", "patch"] as const)("%s conserva rechazo global de null y JSON malformado", async (method) => {
  for (const body of ["null", '{"secret":']) {
    const response = await request(app)[method](method === "post" ? post : patch)
      .set("Content-Type", "application/json").send(body);
    expect(response.status).toBe(400);
    expect(response.body).toEqual(invalid);
  }
  expect(identificar).not.toHaveBeenCalled();
  expect(aceptar).not.toHaveBeenCalled();
});

it.each(["post", "patch"] as const)("%s autentica antes de validar UUID y cuerpo", async (method) => {
  const path = method === "post" ? post : "/api/pasajeros/no-uuid/aceptar-aviso";
  for (const headers of [{}, { "X-N8N-Token": "invalid" }, { Authorization: "Bearer invalid" }]) {
    const response = await request(app)[method](path).set(headers).send({ extra: true });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  }
  for (const rol of ["admin", "conductor"] as const) {
    lookup.mockResolvedValue({ id: dto.id, rol, eliminadoEn: null } as Awaited<ReturnType<typeof prisma.usuario.findUnique>>);
    const authorization = `Bearer ${jwt.sign({}, env.JWT_SECRET, { subject: dto.id, expiresIn: "1h" })}`;
    const forbidden = await request(app)[method](path).set("Authorization", authorization).send({ extra: true });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe("FORBIDDEN");
    const wrongN8n = await request(app)[method](path).set("Authorization", authorization)
      .set("X-N8N-Token", "invalid").send({ extra: true });
    expect(wrongN8n.status).toBe(401);
  }
  expect(identificar).not.toHaveBeenCalled();
  expect(aceptar).not.toHaveBeenCalled();
});

it.each(["post", "patch"] as const)("%s propaga fallo del servicio como 500 seguro", async (method) => {
  const error = new Error("SQL connection secret stack");
  identificar.mockRejectedValueOnce(error);
  aceptar.mockRejectedValueOnce(error);
  const response = await request(app)[method](method === "post" ? post : patch)
    .set("X-N8N-Token", env.N8N_API_TOKEN)
    .send(method === "post" ? { whatsappId: dto.whatsappId, nombre: dto.nombre } : {});
  expect(response.status).toBe(500);
  expect(response.body).toEqual({ error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } });
});
