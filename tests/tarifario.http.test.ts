import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/app";
import { env } from "../src/config/env";
import { prisma } from "../src/config/prisma";
import * as tarifarioService from "../src/modules/tarifario/tarifario.service";

vi.mock("../src/config/env", () => ({ env: {
  JWT_SECRET: "unit-test-only-jwt-secret-not-for-deployment",
  N8N_API_TOKEN: "unit-test-only-internal-secret-not-for-deployment",
} }));
vi.mock("../src/config/prisma", () => ({ prisma: { usuario: { findUnique: vi.fn() } } }));
vi.mock("../src/modules/tarifario/tarifario.service", () => ({
  obtenerTarifasVigentes: vi.fn(),
  crearTarifa: vi.fn(),
  actualizarTarifa: vi.fn(),
}));

const listar = vi.mocked(tarifarioService.obtenerTarifasVigentes);
const crear = vi.mocked(tarifarioService.crearTarifa);
const actualizar = vi.mocked(tarifarioService.actualizarTarifa);
const lookup = vi.mocked(prisma.usuario.findUnique);

const tarifaId = "7a1f2c4e-0000-4000-8000-000000000000";
const usuarioAdmin = "4d3c2b1a-9f8e-4a6b-8c1d-2e3f4a5b6c7d";
const usuarioConductor = "8e7acf6d-0e5b-4e6a-9f2a-1c2b3d4e5f60";
const pedidoTarifa = { descripcion: "Referencia centro a terminal", monto: "15.00", vigenciaDesde: "2026-09-21" };

const tarifaDto = {
  id: tarifaId,
  descripcion: "Referencia centro a terminal",
  monto: "15.00",
  vigenciaDesde: "2026-09-21",
};

const n8n = { "X-N8N-Token": env.N8N_API_TOKEN };
const bearer = (subject: string) => ({ Authorization: `Bearer ${jwt.sign({}, env.JWT_SECRET, { subject, expiresIn: "1h" })}` });
const n8nIncorrecto = { "X-N8N-Token": "wrong-n8n-token" };

function usuarioAutenticado(rol: "admin" | "conductor", id: string) {
  lookup.mockResolvedValue({ id, rol, eliminadoEn: null } as Awaited<ReturnType<typeof prisma.usuario.findUnique>>);
}

function esperarServicioSinLlamar(mock: ReturnType<typeof vi.fn>) {
  expect(mock).not.toHaveBeenCalled();
}

const unauthorized = { error: { code: "UNAUTHORIZED", message: "Credenciales invalidas" } };
const forbidden = { error: { code: "FORBIDDEN", message: "Permiso denegado" } };
const notFoundTarifa = { error: { code: "NOT_FOUND", message: "Tarifa no encontrada" } };
const validationError = { error: { code: "VALIDATION_ERROR", message: "Entrada invalida" } };
const internalError = { error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } };

beforeEach(() => { vi.resetAllMocks(); });

describe("GET /api/tarifas (n8n o admin)", () => {
  const path = "/api/tarifas";

  it("n8n valido responde 200 con el array de tarifas vigentes", async () => {
    listar.mockResolvedValue([tarifaDto]);
    const response = await request(app).get(path).set(n8n);
    expect(response.status).toBe(200);
    expect(response.body).toEqual([tarifaDto]);
    expect(listar).toHaveBeenCalledExactlyOnceWith(expect.any(Date));
  });

  it("admin valido responde 200 con el array", async () => {
    usuarioAutenticado("admin", usuarioAdmin);
    listar.mockResolvedValue([]);
    const response = await request(app).get(path).set(bearer(usuarioAdmin));
    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(listar).toHaveBeenCalledExactlyOnceWith(expect.any(Date));
  });

  it("conductor valido recibe 403 FORBIDDEN sin consultar el servicio", async () => {
    usuarioAutenticado("conductor", usuarioConductor);
    const response = await request(app).get(path).set(bearer(usuarioConductor));
    expect(response.status).toBe(403);
    expect(response.body).toEqual(forbidden);
    esperarServicioSinLlamar(listar);
  });

  it("anonimo recibe 401 UNAUTHORIZED sin consultar el servicio", async () => {
    const response = await request(app).get(path);
    expect(response.status).toBe(401);
    expect(response.body).toEqual(unauthorized);
    esperarServicioSinLlamar(listar);
  });

  it("header n8n incorrecto con JWT admin valido recibe 401 (n8n tiene precedencia)", async () => {
    usuarioAutenticado("admin", usuarioAdmin);
    const response = await request(app).get(path).set(n8nIncorrecto).set(bearer(usuarioAdmin));
    expect(response.status).toBe(401);
    expect(response.body).toEqual(unauthorized);
    esperarServicioSinLlamar(listar);
  });

  it("header n8n valido con JWT conductor valido responde 200 como n8n", async () => {
    usuarioAutenticado("conductor", usuarioConductor);
    listar.mockResolvedValue([tarifaDto]);
    const response = await request(app).get(path).set(n8n).set(bearer(usuarioConductor));
    expect(response.status).toBe(200);
    expect(response.body).toEqual([tarifaDto]);
    expect(listar).toHaveBeenCalledExactlyOnceWith(expect.any(Date));
  });

  it("query no vacia recibe 400 VALIDATION_ERROR sin consultar el servicio", async () => {
    const response = await request(app).get(path).set(n8n).query({ pagina: "1" });
    expect(response.status).toBe(400);
    expect(response.body).toEqual(validationError);
    esperarServicioSinLlamar(listar);
  });

  it("fallo inesperado recibe 500 generico sin detalles internos", async () => {
    listar.mockRejectedValueOnce(new Error("SQL connection secret stack"));
    const response = await request(app).get(path).set(n8n);
    expect(response.status).toBe(500);
    expect(response.body).toEqual(internalError);
  });
});

describe("POST /api/tarifas (solo admin)", () => {
  const path = "/api/tarifas";

  it("admin valido crea y responde 201 con el DTO", async () => {
    usuarioAutenticado("admin", usuarioAdmin);
    crear.mockResolvedValue(tarifaDto);
    const response = await request(app).post(path).set(bearer(usuarioAdmin)).send(pedidoTarifa);
    expect(response.status).toBe(201);
    expect(response.body).toEqual(tarifaDto);
    expect(crear).toHaveBeenCalledExactlyOnceWith(pedidoTarifa);
  });

  it("n8n valido recibe 401 UNAUTHORIZED sin consultar el servicio", async () => {
    const response = await request(app).post(path).set(n8n).send(pedidoTarifa);
    expect(response.status).toBe(401);
    expect(response.body).toEqual(unauthorized);
    esperarServicioSinLlamar(crear);
  });

  it.each([
    { rol: "admin" as const, id: usuarioAdmin },
    { rol: "conductor" as const, id: usuarioConductor },
  ])("header n8n valido con JWT de $rol: requireAdmin exige Bearer admin activo", async ({ rol, id }) => {
    usuarioAutenticado(rol, id);
    if (rol === "admin") crear.mockResolvedValue(tarifaDto);
    const response = await request(app).post(path).set(n8n).set(bearer(id)).send(pedidoTarifa);
    expect(response.status).toBe(rol === "admin" ? 201 : 403);
    expect(response.body).toEqual(rol === "admin" ? tarifaDto : forbidden);
  });

  it("conductor valido recibe 403 FORBIDDEN sin consultar el servicio", async () => {
    usuarioAutenticado("conductor", usuarioConductor);
    const response = await request(app).post(path).set(bearer(usuarioConductor)).send(pedidoTarifa);
    expect(response.status).toBe(403);
    expect(response.body).toEqual(forbidden);
    esperarServicioSinLlamar(crear);
  });

  it("cuerpo invalido recibe 400 VALIDATION_ERROR sin consultar el servicio", async () => {
    usuarioAutenticado("admin", usuarioAdmin);
    const response = await request(app).post(path).set(bearer(usuarioAdmin)).send({ descripcion: "Incompleto" });
    expect(response.status).toBe(400);
    expect(response.body).toEqual(validationError);
    esperarServicioSinLlamar(crear);
  });

  it("campo desconocido recibe 400 VALIDATION_ERROR sin consultar el servicio", async () => {
    usuarioAutenticado("admin", usuarioAdmin);
    const response = await request(app).post(path).set(bearer(usuarioAdmin)).send({ ...pedidoTarifa, moneda: "Bs" });
    expect(response.status).toBe(400);
    expect(response.body).toEqual(validationError);
    esperarServicioSinLlamar(crear);
  });

  it("fallo inesperado recibe 500 generico sin detalles internos", async () => {
    usuarioAutenticado("admin", usuarioAdmin);
    crear.mockRejectedValueOnce(new Error("SQL connection secret stack"));
    const response = await request(app).post(path).set(bearer(usuarioAdmin)).send(pedidoTarifa);
    expect(response.status).toBe(500);
    expect(response.body).toEqual(internalError);
  });
});

describe("PATCH /api/tarifas/:id (solo admin)", () => {
  const path = `/api/tarifas/${tarifaId}`;
  const cambio = { descripcion: "Carrera centro a terminal" };

  it("admin valido actualiza y responde 200 con el DTO", async () => {
    usuarioAutenticado("admin", usuarioAdmin);
    actualizar.mockResolvedValue({ ok: true, tarifa: { ...tarifaDto, descripcion: cambio.descripcion } });
    const response = await request(app).patch(path).set(bearer(usuarioAdmin)).send(cambio);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ...tarifaDto, descripcion: cambio.descripcion });
    expect(actualizar).toHaveBeenCalledExactlyOnceWith(tarifaId, cambio);
  });

  it("UUID invalido recibe 404 sin consultar el servicio", async () => {
    usuarioAutenticado("admin", usuarioAdmin);
    const response = await request(app).patch("/api/tarifas/no-uuid").set(bearer(usuarioAdmin)).send(cambio);
    expect(response.status).toBe(404);
    expect(response.body).toEqual(notFoundTarifa);
    esperarServicioSinLlamar(actualizar);
  });

  it("tarifa inexistente o eliminada recibe 404 del servicio", async () => {
    usuarioAutenticado("admin", usuarioAdmin);
    actualizar.mockResolvedValue({ ok: false, code: "NOT_FOUND" });
    const response = await request(app).patch(path).set(bearer(usuarioAdmin)).send(cambio);
    expect(response.status).toBe(404);
    expect(response.body).toEqual(notFoundTarifa);
  });

  it("n8n valido recibe 401 UNAUTHORIZED sin consultar el servicio", async () => {
    const response = await request(app).patch(path).set(n8n).send(cambio);
    expect(response.status).toBe(401);
    expect(response.body).toEqual(unauthorized);
    esperarServicioSinLlamar(actualizar);
  });

  it("conductor valido recibe 403 FORBIDDEN sin consultar el servicio", async () => {
    usuarioAutenticado("conductor", usuarioConductor);
    const response = await request(app).patch(path).set(bearer(usuarioConductor)).send(cambio);
    expect(response.status).toBe(403);
    expect(response.body).toEqual(forbidden);
    esperarServicioSinLlamar(actualizar);
  });

  it("cuerpo vacio recibe 400 VALIDATION_ERROR sin consultar el servicio", async () => {
    usuarioAutenticado("admin", usuarioAdmin);
    const response = await request(app).patch(path).set(bearer(usuarioAdmin)).send({});
    expect(response.status).toBe(400);
    expect(response.body).toEqual(validationError);
    esperarServicioSinLlamar(actualizar);
  });

  it("vigenciaDesde en PATCH recibe 400 VALIDATION_ERROR (fecha inmutable)", async () => {
    usuarioAutenticado("admin", usuarioAdmin);
    const response = await request(app).patch(path).set(bearer(usuarioAdmin))
      .send({ ...cambio, vigenciaDesde: tarifaDto.vigenciaDesde });
    expect(response.status).toBe(400);
    expect(response.body).toEqual(validationError);
    esperarServicioSinLlamar(actualizar);
  });

  it("campo desconocido recibe 400 VALIDATION_ERROR sin consultar el servicio", async () => {
    usuarioAutenticado("admin", usuarioAdmin);
    const response = await request(app).patch(path).set(bearer(usuarioAdmin)).send({ ...cambio, id: tarifaId });
    expect(response.status).toBe(400);
    expect(response.body).toEqual(validationError);
    esperarServicioSinLlamar(actualizar);
  });

  it("fallo inesperado recibe 500 generico sin detalles internos", async () => {
    usuarioAutenticado("admin", usuarioAdmin);
    actualizar.mockRejectedValueOnce(new Error("SQL connection secret stack"));
    const response = await request(app).patch(path).set(bearer(usuarioAdmin)).send(cambio);
    expect(response.status).toBe(500);
    expect(response.body).toEqual(internalError);
  });
});